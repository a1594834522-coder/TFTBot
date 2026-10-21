#!/usr/bin/env node
/**
 * verify-release.mjs —— 校验发布包完整性（不改文件、不联网）
 *
 *   node scripts/verify-release.mjs                       # 默认校验 dist/release 下最新的 zip
 *   node scripts/verify-release.mjs path/to/tftbot-x.zip
 *
 * 做三件事：
 *   1. 解析 ZIP 中央目录，确认没有损坏/截断；
 *   2. 逐个 inflate 并计算 SHA-256，和包内 BUILD-INFO.json 对比；
 *   3. 检查必需文件是否齐全（boot chunk / css / 数据 / 安装脚本）。
 *
 * 退出码：0 全部通过 / 1 有校验失败 / 2 用法或读包失败
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2];

function latestZip() {
  const dir = path.join(root, 'dist', 'release');
  if (!fs.existsSync(dir)) return null;
  const zips = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return zips.length ? path.join(dir, zips[0].f) : null;
}

const file = arg ? path.resolve(arg) : latestZip();
if (!file || !fs.existsSync(file)) {
  console.error('找不到发布包；先 npm run pack');
  process.exit(2);
}

const buf = fs.readFileSync(file);

/* ---------- 找 EOCD ---------- */
let eocd = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    eocd = i;
    break;
  }
}
if (eocd < 0) {
  console.error('不是有效的 ZIP（找不到 EOCD）');
  process.exit(2);
}

const entryCount = buf.readUInt16LE(eocd + 10);
const cdOffset = buf.readUInt32LE(eocd + 16);

/* ---------- 读中央目录 ---------- */
const entries = [];
let p = cdOffset;
for (let i = 0; i < entryCount; i++) {
  if (buf.readUInt32LE(p) !== 0x02014b50) {
    console.error(`中央目录第 ${i} 项签名不对 @${p}`);
    process.exit(2);
  }
  const method = buf.readUInt16LE(p + 10);
  const crc = buf.readUInt32LE(p + 16);
  const compSize = buf.readUInt32LE(p + 20);
  const size = buf.readUInt32LE(p + 24);
  const nameLen = buf.readUInt16LE(p + 28);
  const extraLen = buf.readUInt16LE(p + 30);
  const commentLen = buf.readUInt16LE(p + 32);
  const localOffset = buf.readUInt32LE(p + 42);
  const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
  entries.push({ name, method, crc, compSize, size, localOffset });
  p += 46 + nameLen + extraLen + commentLen;
}

/* ---------- 解压并算摘要 ---------- */
function readEntry(e) {
  const lp = e.localOffset;
  if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error(`local header 签名不对: ${e.name}`);
  const nameLen = buf.readUInt16LE(lp + 26);
  const extraLen = buf.readUInt16LE(lp + 28);
  const start = lp + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  const data = e.method === 0 ? raw : zlib.inflateRawSync(raw);
  if (data.length !== e.size) throw new Error(`${e.name} 解压长度不符（${data.length} != ${e.size}）`);
  return data;
}

const crc32 = (b) => {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};

const problems = [];
const files = new Map();
for (const e of entries) {
  try {
    const data = readEntry(e);
    if (crc32(data) !== e.crc) problems.push(`${e.name}: CRC32 不符`);
    files.set(e.name, data);
  } catch (err) {
    problems.push(`${e.name}: ${err.message}`);
  }
}

/* ---------- 对比 BUILD-INFO ---------- */
const infoRaw = files.get('BUILD-INFO.json');
let info = null;
if (!infoRaw) problems.push('缺少 BUILD-INFO.json');
else {
  try {
    info = JSON.parse(infoRaw.toString('utf8'));
  } catch {
    problems.push('BUILD-INFO.json 不是合法 JSON');
  }
}

if (info) {
  if (info.name !== 'tftbot' || typeof info.version !== 'string' || !info.version || !Number.isFinite(Date.parse(info.builtAt))) {
    problems.push('BUILD-INFO 的项目名、版本或构建时间无效');
  }
  if (!Array.isArray(info.files)) problems.push('BUILD-INFO.files 不是数组');
  const declared = new Set(Array.isArray(info.files) ? info.files.map((f) => f.path) : []);
  for (const name of files.keys()) {
    if (name !== 'BUILD-INFO.json' && !declared.has(name)) problems.push(`${name}: 没有 SHA-256 清单条目`);
  }
  for (const f of Array.isArray(info.files) ? info.files : []) {
    const data = files.get(f.path);
    if (!data) {
      problems.push(`BUILD-INFO 声明了 ${f.path}，但包里没有`);
      continue;
    }
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    if (sha !== f.sha256) problems.push(`${f.path}: SHA-256 不符`);
    if (data.length !== f.bytes) problems.push(`${f.path}: 字节数不符`);
  }
}

/* ---------- 必需文件 ---------- */
const required = ['assets/tftbot-boot.js', 'assets/tftbot-core.js', 'assets/tftbot.css', 'data/tft-sets.json', 'data/comps.json', 'data/metatft-comps.json', 'data/metatft-early.json', 'install.ps1', 'VERIFY.ps1', 'README.txt'];
for (const r of required) if (!files.has(r)) problems.push(`缺少必需文件：${r}`);

/* ---------- 报告 ---------- */
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`[verify] ${path.basename(file)} · ${entries.length} 项 · ${kb(buf.length)}`);
for (const e of entries) console.log(`  ${problems.some((x) => x.startsWith(e.name)) ? '✗' : '✓'} ${e.name.padEnd(28)} ${kb(e.size)}`);
if (info) console.log(`[verify] 包版本 ${info.name}@${info.version}，构建于 ${info.builtAt}`);

if (problems.length) {
  console.error(`\n[verify] ${problems.length} 个问题：`);
  for (const x of problems) console.error('  - ' + x);
  process.exit(1);
}
console.log('\n[verify] 全部通过（结构 / CRC / SHA-256 / 必需文件）');
