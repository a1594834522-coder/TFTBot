import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { replayText, replaySummary } from '../src/core/replay';
import { dataset } from '../src/game/tft-data';

const dir = path.join(__dirname, 'fixtures');
const record = fs.readFileSync(path.join(dir, 'round.jsonl'), 'utf8');
const golden = JSON.parse(fs.readFileSync(path.join(dir, 'round.golden.json'), 'utf8'));

const catalog = dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));

describe('shadow 回归（录像 → 摘要 与基准一致）', () => {
  it('摘要结构与 golden 完全一致', () => {
    const summary = replaySummary(replayText(record, { catalog }));
    expect(summary).toEqual(golden);
  });

  it('摘要字段是用户可见口径（不掺内部对象）', () => {
    const summary = replaySummary(replayText(record, { catalog }));
    expect(Object.keys(summary).sort()).toEqual(['alive', 'events', 'invalid', 'owned', 'players', 'tracker', 'warnings']);
    expect(summary.players.every((p) => typeof p.name === 'string' && typeof p.health === 'number')).toBe(true);
    // owned 已排序，便于直接 diff
    expect(Object.keys(summary.owned)).toEqual(Object.keys(summary.owned).slice().sort());
  });

  it('改一个事件就会产生差异（保证 golden 有约束力）', () => {
    // 结构化改：改「最后一条 roster」里 Me 的血量（前面几条会被覆盖）
    const lines = record.split(/\r?\n/).filter(Boolean);
    let target = -1;
    lines.forEach((l, i) => {
      if (JSON.parse(l).key === 'tft_roster') target = i;
    });
    const evt = JSON.parse(lines[target]);
    const roster = JSON.parse(evt.value);
    roster.find((p: any) => p.summoner === 'Me').health = 10;
    evt.value = JSON.stringify(roster);
    const mutated = lines.map((l, i) => (i === target ? JSON.stringify(evt) : l)).join('\n');

    const a = replaySummary(replayText(record, { catalog }));
    const b = replaySummary(replayText(mutated, { catalog }));
    expect(b.players.find((p) => p.name === 'Me#111')?.health).toBe(10);
    expect(a).not.toEqual(b);
  });
});
