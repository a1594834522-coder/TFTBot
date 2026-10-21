#!/usr/bin/env node
/**
 * shadow.mjs —— 重写回归：同一段录像喂给 TS 版，和"基准输出"逐字段比对。
 *
 *   node scripts/shadow.mjs tests/fixtures/round.jsonl --set 18 --golden tests/fixtures/round.golden.json
 *   node scripts/shadow.mjs <record.jsonl> --set 18 --golden <path> --update   # 首次生成/有意更新
 *
 * 基准可以是：
 *   - 本实现 App 录下来的期望输出（人工/脚本导出成同结构 JSON）
 *   - 或本脚本 --update 生成的快照（用于"改代码后有没有意外漂移"）
 *
 * 退出码：0 一致 / 1 有差异 / 2 用法或文件问题
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(here, '..', 'dist', 'tftbot-core.js')).href).catch((e) => {
  console.error('先构建：npm run build');
  throw e;
});

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const get = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const set = Number(get('set', String(mod.CURRENT_SET)));
mod.requireCurrentSeason(set);
const goldenPath = get('golden', null);
const update = args.includes('--update');
const json = args.includes('--json');

if (!file) {
  console.error('用法: node scripts/shadow.mjs <record.jsonl> [--set 18] [--golden path] [--update] [--json]');
  process.exit(2);
}

const text = fs.readFileSync(file, 'utf8');
const catalog = mod.dataset.charactersOf(set).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));
const result = mod.replayText(text, { catalog });

/** 只比对"用户能看到"的字段（复用 core 里的 replaySummary，保证与单测同源） */
const summary = mod.replaySummary(result);

if (update || !goldenPath) {
  const out = goldenPath ?? path.join(path.dirname(file), path.basename(file).replace(/\.jsonl?$/, '') + '.golden.json');
  fs.writeFileSync(out, JSON.stringify(summary, null, 2) + '\n');
  console.log(`[shadow] 写入基准：${out}`);
  if (json) console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (!fs.existsSync(goldenPath)) {
  console.error(`[shadow] 基准不存在：${goldenPath}（先用 --update 生成）`);
  process.exit(2);
}

const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

/** 递归 diff，返回差异路径列表 */
function diff(a, b, at = '', out = []) {
  if (a === b) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) {
    out.push(`${at || '$'}: 类型不同 (${ta} vs ${tb})`);
    return out;
  }
  if (ta === 'array') {
    if (a.length !== b.length) out.push(`${at || '$'}: 长度不同 (${a.length} vs ${b.length})`);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) diff(a[i], b[i], `${at}[${i}]`, out);
    return out;
  }
  if (ta === 'object') {
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const k of keys) diff(a?.[k], b?.[k], at ? `${at}.${k}` : k, out);
    return out;
  }
  out.push(`${at || '$'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return out;
}

const diffs = diff(golden, summary);
if (json) console.log(JSON.stringify({ ok: diffs.length === 0, diffs, summary }, null, 2));

if (!diffs.length) {
  console.log(`[shadow] 一致（${result.events} 个事件，alive=${summary.alive}，tracker=${summary.tracker.length}）`);
  process.exit(0);
}

console.error(`[shadow] 发现 ${diffs.length} 处差异：`);
for (const d of diffs.slice(0, 50)) console.error('  - ' + d);
if (diffs.length > 50) console.error(`  … 还有 ${diffs.length - 50} 处`);
process.exit(1);
