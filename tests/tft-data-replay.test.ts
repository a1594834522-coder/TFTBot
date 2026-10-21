import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildDataset, dataset, rawDataset } from '../src/game/tft-data';
import { parseRecordedEvents, replayEvents, replayText } from '../src/core/replay';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'round.jsonl'), 'utf8');

describe('游戏数据层（从 background 抽取的真实数据）', () => {
  it('支持赛季与规模', () => {
    expect(dataset.supportSets).toEqual([18]);
    expect(dataset.charactersOf(16)).toEqual([]);
    expect(dataset.characters.length).toBeGreaterThan(70);
    expect(dataset.items.length).toBeGreaterThan(150);
    expect(dataset.traits.length).toBeGreaterThan(30);
    expect(dataset.augments.length).toBeGreaterThan(200);
  });

  it('英雄字段完整（id/名字/费用/羁绊/技能）', () => {
    const c = dataset.characterById('DA_18_Caitlyn');
    expect(c?.display_name).toBe('凯特琳');
    expect(c?.cost).toBe(2);
    expect(c?.trait_ids.length).toBeGreaterThan(0);
    expect(c?.ability?.name).toBeTruthy();
    expect(c?.stats?.health).toBeGreaterThan(0);
  });

  it('按 set 查询 / 按费用过滤', () => {
    const set16 = dataset.charactersOf(18);
    expect(set16.length).toBe(74);
    expect(dataset.byCost(18, 5).every((c) => c.cost === 5)).toBe(true);
    expect(dataset.character(18, 'DA_18_Caitlyn')?.display_name).toBe('凯特琳');
    expect(dataset.character(999, 'DA_18_Caitlyn')).toBeUndefined();
  });

  it('装备合成图（builds_from / builds_into 解析成对象）', () => {
    const bf = dataset.item('DA_Component_BFSword');
    expect(bf?.display_name).toBe('暴风大剑');
    const graph = dataset.itemBuildGraph('DA_Component_BFSword');
    expect(graph.from.length).toBe(0);
    expect(graph.into.length).toBeGreaterThan(5);
    expect(graph.into.every((i) => i.item_id)).toBe(true);
    expect(dataset.itemsOfType(1).length).toBeGreaterThan(0);
  });

  it('英雄羁绊解析成 trait 对象', () => {
    const traits = dataset.traitsOf(18, 'DA_18_Caitlyn');
    expect(traits.length).toBe(dataset.character(18, 'DA_18_Caitlyn')!.trait_ids.length);
    expect(traits.every((t) => t.trait_id && t.display_name)).toBe(true);
  });

  it('buildDataset 可注入小样本（测试/裁剪）', () => {
    const tiny = buildDataset({
      characters: { 99: [{ character_id: 'X', display_name: 'X', trait_ids: [], cost: 1 }] },
      items: [],
      traits: [],
      augments: [],
    } as any);
    expect(tiny.supportSets).toEqual([99]);
    expect(tiny.charactersOf(99).length).toBe(1);
    expect(tiny.item('nope')).toBeUndefined();
  });

  it('原始数据结构可复用（rawDataset）', () => {
    expect(Object.keys(rawDataset.characters).length).toBeGreaterThan(0);
  });
});

describe('回放器（JSONL → 逐帧快照）', () => {
  it('解析录像：事件数与坏行计数', () => {
    const parsed = parseRecordedEvents(fixture + '\n{bad json}\n\n# comment\n');
    expect(parsed.events.length).toBe(7);
    expect(parsed.invalid).toBe(1);
  });

  it('回放出存活人数、全场持有量、记牌器', () => {
    const r = replayText(fixture, {
      catalog: dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost })),
    });
    expect(r.events).toBe(7);
    // 最后一次 roster：Foe1 血量 0 → 存活 2
    expect(r.final?.alive).toBe(2);
    // 最后一次 players_info：我方 3★Tristana(9) + 2★Garen(3)，Foe1 2★Tristana(3)
    expect(r.final?.ownedByName.DA_18_Caitlyn).toBe(9); // 已阵亡玩家的牌回池，不计入
    expect(r.final?.ownedByName.DA_18_Ahri).toBe(3);
    expect(r.finalTracker.length).toBeGreaterThan(0);
  });

  it('帧序列与 key 过滤', () => {
    const r = replayText(fixture, { keys: ['tft_roster'] });
    expect(r.frames.every((f) => f.key === 'tft_roster')).toBe(true);
    expect(r.frames.length).toBe(2);
    expect(r.frames[0].snapshot?.alive).toBe(3);
    expect(r.frames[1].snapshot?.alive).toBe(2);
  });

  it('坏数据不炸：非法 JSON 的 roster 被忽略', () => {
    const r = replayEvents({
      events: [
        { key: 'tft_roster', value: '{oops' },
        { key: 'tft_roster', value: '[{"summoner":"A","health":5}]' },
      ],
    });
    expect(r.invalid).toBe(1);
    expect(r.final?.alive).toBe(1);
  });
});
