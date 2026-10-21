#!/usr/bin/env node
/**
 * replay.mjs —— 回放一段录下来的对局事件（JSONL），输出每帧/最终的游戏视图。
 *
 *   node scripts/replay.mjs tests/fixtures/round.jsonl
 *   node scripts/replay.mjs my-run.jsonl --set 18 --tracker --json
 *
 * 用途：
 *   - 重写回归：同一份录像，比对 TS 版与本实现输出
 *   - 开发调试：不开游戏复现某个局面
 *   - 未来 Rust 化：同一输入喂两份实现做等价验证
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(here, '..', 'dist', 'tftbot-core.js')).href).catch((e) => {
  console.error('先构建：npm run build（需要 dist/tftbot-core.js）');
  throw e;
});

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const get = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const json = args.includes('--json');
const showFrames = args.includes('--tracker');
const set = Number(get('set', String(mod.CURRENT_SET)));
mod.requireCurrentSeason(set);

if (!file) {
  console.error('用法: node scripts/replay.mjs <record.jsonl> [--set 18] [--tracker] [--json]');
  process.exit(2);
}

const text = fs.readFileSync(file, 'utf8');
const catalog = mod.dataset.charactersOf(set).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));
const result = mod.replayText(text, { catalog, keys: undefined });

if (json) {
  console.log(
    JSON.stringify(
      {
        events: result.events,
        invalid: result.invalid,
        alive: result.final?.alive ?? null,
        owned: result.final?.ownedByName ?? {},
        tracker: result.finalTracker,
        warnings: result.finalWarnings,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`events=${result.events} invalid=${result.invalid} set=${set}`);
  console.log(`final: alive=${result.final?.alive ?? '-'} players=${result.final?.players.length ?? 0}`);
  const owned = Object.entries(result.final?.ownedByName ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  console.log('owned(top8):', owned.map(([k, v]) => `${k}=${v}`).join(' '));
  console.log('tracker:', result.finalTracker.map((r) => `${r.champion}(剩${r.remaining})`).join(' ') || '(空)');
  console.log('warnings:', result.finalWarnings.map((r) => `${r.champion}差${r.neededForThree}`).join(' ') || '(空)');
  if (showFrames) {
    console.log('\nframes:');
    for (const f of result.frames) {
      console.log(
        `  #${String(f.index).padStart(2)} t=${String(f.t ?? '-').padStart(5)} ${f.key.padEnd(16)} alive=${f.snapshot?.alive ?? '-'} tracker=${f.tracker.length}`,
      );
    }
  }
}
