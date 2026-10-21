#!/usr/bin/env node
/**
 * pack.mjs —— 把构建产物打成可发布的 zip（供二次开发/分发）
 *
 *   node scripts/pack.mjs                 # → dist/release/tftbot-<版本>.zip
 *   node scripts/pack.mjs --version 0.4.0
 *
 * 包内容：
 *   assets/tftbot-boot.js(.map) / tftbot.css / tftbot-core.js   ← 运行时
 *   data/tft-sets.json / comps.json                             ← 数据（便于二次开发替换）
 *   install.ps1                                                 ← 一键装进 tftbot 包
 *   BUILD-INFO.json                                             ← 版本/文件摘要/命令面
 *   README.txt                                                  ← 安装与说明
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = get('version', pkg.version ?? '0.0.0');
const outDir = path.join(root, 'dist', 'release');
fs.mkdirSync(outDir, { recursive: true });

/* ---------- 收集文件 ---------- */
const entries = [];
const add = (zipPath, absPath) => {
  if (!fs.existsSync(absPath)) {
    throw new Error('[pack] 缺少发布文件，请先 npm run build: ' + absPath);
  }
  entries.push({ name: zipPath, data: fs.readFileSync(absPath), sha256: crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex') });
};

add('assets/tftbot-boot.js', path.join(root, 'dist/boot/tftbot-boot.js'));
add('assets/tftbot-boot.js.map', path.join(root, 'dist/boot/tftbot-boot.js.map'));
add('assets/tftbot.css', path.join(root, 'dist/boot/tftbot.css'));
add('assets/tftbot-core.js', path.join(root, 'dist/tftbot-core.js'));
add('data/tft-sets.json', path.join(root, 'data/tft-sets.json'));
add('data/comps.json', path.join(root, 'data/comps.json'));
add('data/metatft-comps.json', path.join(root, 'data/metatft-comps.json'));
add('data/metatft-early.json', path.join(root, 'data/metatft-early.json'));

/* ---------- 生成随包文件 ---------- */
const verifyPs1 = `# VERIFY.ps1 —— 校验本包文件完整性（SHA-256 对比 BUILD-INFO.json）
param([string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path))
$info = Get-Content (Join-Path $Root 'BUILD-INFO.json') -Raw | ConvertFrom-Json
$bad = 0
foreach ($f in $info.files) {
  $p = Join-Path $Root ($f.path -replace '/', '\\')
  if (-not (Test-Path $p)) { Write-Host "MISSING $($f.path)"; $bad++; continue }
  $sha = (Get-FileHash $p -Algorithm SHA256).Hash.ToLower()
  $size = (Get-Item $p).Length
  if ($sha -ne $f.sha256) { Write-Host "SHA MISMATCH $($f.path)"; $bad++ }
  elseif ($size -ne $f.bytes) { Write-Host "SIZE MISMATCH $($f.path)"; $bad++ }
  else { Write-Host "ok $($f.path)" }
}
foreach ($r in @('assets/tftbot-boot.js','assets/tftbot-core.js','assets/tftbot.css','data/tft-sets.json','data/comps.json','data/metatft-comps.json','data/metatft-early.json','install.ps1','VERIFY.ps1')) {
  if (-not (Test-Path (Join-Path $Root ($r -replace '/', '\\')))) { Write-Host "MISSING required $r"; $bad++ }
}
if ($bad -gt 0) { Write-Host "$bad 个问题"; exit 1 }
Write-Host "全部通过（$($info.name)@$($info.version)）"
exit 0
`;

const installPs1 = `# tftbot ${version} —— 一键装进 tftbot 包
param([string]$Target = "$env:APPDATA\\Amumu\\extensions\\amumu\\2.2.7", [switch]$SkipVerify)
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1) 先校验包自身完整性
if (-not $SkipVerify) {
  & (Join-Path $Src 'VERIFY.ps1') -Root $Src
  $v = $LASTEXITCODE
  if ($null -ne $v -and $v -ne 0) { throw '包校验失败，已中止安装' }
}

$Assets = Join-Path $Target 'assets'
if (-not (Test-Path $Assets)) { throw "目标不像 tftbot 包（缺 assets/）: $Target" }

# 2) 复制运行时并逐个复核摘要
Copy-Item (Join-Path $Src 'assets\\*') $Assets -Force
$tag = '<link data-tftbot="style" rel="stylesheet" href="/assets/tftbot.css" />' + "\`n  " + '<script data-tftbot="boot" type="module">import { boot } from "/assets/tftbot-boot.js"; await boot();</script>'
foreach ($w in @('trick','tracker','characterwin','settings')) {
  $f = @("src\\pages\\$w\\index.html", "pages\\pages\\$w\\index.html", "pages\\$w\\index.html") | ForEach-Object { Join-Path $Target $_ } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $f) { Write-Host "skip (no window): $w"; continue }
  $html = Get-Content $f -Raw
  if ($html -like '*data-tftbot="boot"*') { Write-Host "skip (already injected): $w"; continue }
  if (-not (Test-Path -LiteralPath "$f.bak")) { Copy-Item -LiteralPath $f -Destination "$f.bak" }
  $oldEntry = '/assets/' + [regex]::Escape($w) + '(?:-[\\w-]+)?\\.js[?"'']'
  $html = [regex]::Replace($html, '<script\\b[^>]*>[\\s\\S]*?</script>', [System.Text.RegularExpressions.MatchEvaluator]{ param($m)
    if ($m.Value -match 'tftbot-boot\\.js|window\\.__tftbot__' -or ($m.Value -match 'type\\s*=\\s*["'']module["'']' -and $m.Value -match $oldEntry)) { return '' }
    return $m.Value
  }, 'IgnoreCase')
  $html = [regex]::Replace($html, '<link\\b[^>]*href\\s*=\\s*["''][^"'']*/tftbot\\.css["''][^>]*>', '', 'IgnoreCase')
  if ($html -match '</head>') { $html = $html -replace '</head>', ($tag + "\`n</head>") }
  elseif ($html -match '</body>') { $html = $html -replace '</body>', ($tag + "\`n</body>") }
  else { $html += "\`n" + $tag }
  Set-Content $f $html -Encoding UTF8
  Write-Host "injected: $w"
}
Write-Host "完成。重启 tftbot 生效。（备份：*.bak）"
`;

const readme = `tftbot ${version}
=================

游戏专用重写版（只保留游戏面板相关能力）。

安装
----
  powershell -ExecutionPolicy Bypass -File install.ps1
  或手动把 assets/* 复制到 <tftbot包>/assets/，并在窗口 HTML 里加：
    <link rel="stylesheet" href="/assets/tftbot.css" />
    <script type="module">import { boot } from "/assets/tftbot-boot.js"; await boot();</script>

窗口
----
  trick        棋盘 + 记牌器 + 悬浮卡 + 三星预警
  tracker      存活/玩家列表 + 记牌器 + 阵容面板
  characterwin 英雄详情 + 相关阵容
  boot 自动识别窗口，无需按窗口改代码。

二次开发
--------
  源码项目：Vue3 + TypeScript，含单元、SSR 与窗口交互回归
  构建：npm run build（产出 core / ui / boot 三颗 chunk）
  数据：修改源码项目 data/*.json 后重新构建（JSON 已编译进 bundle）
  回归：node scripts/shadow.mjs <录像.jsonl> --golden <基准.json>
`;

const buildInfo = {
  name: 'tftbot',
  version,
  builtAt: new Date().toISOString(),
  files: entries.map((e) => ({ path: e.name, bytes: e.data.length, sha256: e.sha256 })),
};

const mem = (zipPath, text, { bom = false } = {}) => {
  const data = Buffer.from((bom ? '\ufeff' : '') + text, 'utf8');
  entries.push({ name: zipPath, data, sha256: crypto.createHash('sha256').update(data).digest('hex') });
};
mem('README.txt', readme);
// PowerShell 5.1 按 ANSI 读无 BOM 文件，中文会乱码导致解析失败 → 这两个脚本必须带 BOM
mem('install.ps1', installPs1, { bom: true });
mem('VERIFY.ps1', verifyPs1, { bom: true });
buildInfo.files = entries.map((e) => ({ path: e.name, bytes: e.data.length, sha256: e.sha256 }));
mem('BUILD-INFO.json', JSON.stringify(buildInfo, null, 2));

/* ---------- 最小 ZIP 写入（deflate，磁盘顺序） ---------- */
function dosTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const { time, date } = dosTime();
const locals = [];
const centrals = [];
let offset = 0;

for (const e of entries) {
  const nameBuf = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
  const comp = zlib.deflateRawSync(e.data, { level: 9 });
  const crc = crc32(e.data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBuf, comp);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(e.data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + comp.length;
}

const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

const zip = Buffer.concat([...locals, centralBuf, end]);
const outFile = path.join(outDir, `tftbot-${version}.zip`);
fs.writeFileSync(outFile, zip);

console.log(`[pack] ${outFile}`);
console.log(`[pack] ${entries.length} 个文件，${(zip.length / 1024).toFixed(1)} KB`);
for (const e of entries) console.log(`  - ${e.name.padEnd(28)} ${(e.data.length / 1024).toFixed(1)} KB`);
