import { describe, expect, it } from 'vitest';
import { copiesFromLevel, aggregateChampions, parseRoster, aliveCount, mergeRosterWithPlayers, buildSnapshot } from '../src/game/roster';
import { makeEvent, parseUpdateInfo } from '../src/core/events';

describe('copiesFromLevel（星级→副本数折算）', () => {
  it('1星=1、2星=3、3星=9', () => {
    expect(copiesFromLevel(1)).toBe(1);
    expect(copiesFromLevel(2)).toBe(3);
    expect(copiesFromLevel(3)).toBe(9);
  });
  it('字符串星级与非法值', () => {
    expect(copiesFromLevel('2')).toBe(3);
    expect(copiesFromLevel(undefined)).toBe(0);
    expect(copiesFromLevel(0)).toBe(0);
  });
});

describe('aggregateChampions', () => {
  it('同名合并副本、保留装备与星级', () => {
    const out = aggregateChampions([
      { name: 'TFT17_Teemo', level: 1, item_1: 'a' },
      { name: 'TFT17_Teemo', level: 2, item_2: 'b' },
      { name: 'TFT17_Garen', level: 3 },
    ]);
    const teemo = out.find((c) => c.name === 'TFT17_Teemo')!;
    expect(teemo.copies).toBe(1 + 3);
    expect(teemo.levels).toEqual([1, 2]);
    expect(teemo.items).toEqual(['a', 'b']);
    expect(out.find((c) => c.name === 'TFT17_Garen')!.copies).toBe(9);
  });

  it('已带 num 的记录直接用 num（players_info 聚合过的数据）', () => {
    const out = aggregateChampions([{ name: 'X', num: 7 }]);
    expect(out[0].copies).toBe(7);
  });
});

describe('parseRoster（tft_roster）', () => {
  it('拼 name、按血量降序、同血量按 index 降序', () => {
    const roster = parseRoster([
      { summoner: 'A', tag_line: '111', health: 50, index: 1 },
      { summoner: 'B', tag_line: '222', health: 80, index: 2 },
      { summoner: 'C', tag_line: '333', health: 50, index: 5 },
      { summoner: 'D', tag_line: '444', health: 0, index: 3 },
    ]);
    expect(roster.map((p) => p.name)).toEqual(['B#222', 'C#333', 'A#111', 'D#444']);
    expect(aliveCount(roster)).toBe(3);
  });

  it('空/异常输入不炸', () => {
    expect(parseRoster(null)).toEqual([]);
    expect(parseRoster([{ health: 10 } as any])[0].name).toBe('');
  });
});

describe('mergeRosterWithPlayers + buildSnapshot（全场副本数）', () => {
  const roster = [
    { summoner: 'Me', tag_line: '1', health: 60, index: 0 },
    { summoner: 'Foe', tag_line: '2', health: 60, index: 1 },
  ];
  const players = [
    { summoner: 'Me', tag_line: '1', champions: [{ name: 'Teemo', level: 2 }, { name: 'Teemo', level: 1 }] },
    { summoner: 'Foe', tag_line: '2', champions: [{ name: 'Teemo', level: 3 }] },
  ];

  it('按 summoner#tag 精确合并', () => {
    const merged = mergeRosterWithPlayers(parseRoster(roster), players);
    const me = merged.find((p) => p.name === 'Me#1')!;
    const foe = merged.find((p) => p.name === 'Foe#2')!;
    expect(me.champions[0].name).toBe('Teemo');
    expect(me.champions[0].copies).toBe(4);
    expect(foe.champions[0].copies).toBe(9);
  });

  it('buildSnapshot 汇总全场持有量', () => {
    const snap = buildSnapshot(roster, players);
    expect(snap.alive).toBe(2);
    expect(snap.ownedByName.Teemo).toBe(13);
  });
});

describe('事件模型（zod）', () => {
  it('tft_roster 正常解析', () => {
    const evt = makeEvent('tft_roster', [{ summoner: 'A', health: 10 }]);
    const r = parseUpdateInfo(evt);
    expect(r.ok).toBe(true);
    expect((r.data as any).data[0].summoner).toBe('A');
  });

  it('格式不合法时不丢事件，返回 error 与原始串', () => {
    const r = parseUpdateInfo({ key: 'tft_roster', value: '{"not":"array"}' });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.raw).toBe('{"not":"array"}');
  });

  it('未知 key 前向兼容（原样带出）', () => {
    const r = parseUpdateInfo({ key: 'tft_future_thing', value: '{"a":1}' });
    expect(r.ok).toBe(true);
    expect((r.data as any).data).toEqual({ a: 1 });
  });

  it('players_info 缺 champions 时补空数组', () => {
    const r = parseUpdateInfo({ key: 'players_info', value: '[{"summoner":"A"}]' });
    expect(r.ok).toBe(true);
    expect((r.data as any).data[0].champions).toEqual([]);
  });
});
