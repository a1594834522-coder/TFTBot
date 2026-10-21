import { describe, expect, it } from 'vitest';
import { buildCompsDataset, comps, rawComps } from '../src/game/comps-data';
import { dataset } from '../src/game/tft-data';

describe('官方阵容数据（从 background 抽取）', () => {
  it('仅包含最新赛季的官网和 Blitz 阵容', () => {
    expect(comps.supportSets).toEqual([18]);
    for (const set of [18]) {
      const groups = comps.groups(set);
      expect(groups.length, `set ${set}`).toBeGreaterThanOrEqual(2);
      const titles = groups.map((g) => g.title).sort();
      expect(titles).toContain('官网阵容');
      expect(titles).toContain('blitz');
    }
  });

  it('阵容数量与抽取结果一致（set18 = 33 + 48）', () => {
    expect(comps.comps(18).length).toBe(33 + 48);
    expect(comps.comps(18, '官网阵容').length).toBe(33);
    expect(comps.comps(18, 'blitz').length).toBe(48);
    expect(comps.comps(99)).toEqual([]);
  });

  it('阵容结构完整（units / synergy / name）', () => {
    const comp = comps.comps(18, '官网阵容')[0];
    expect(comp.name).toBeTruthy();
    expect(comp.units.length).toBeGreaterThan(0);
    expect(comp.units.every((u) => u.character_id)).toBe(true);
    expect(Array.isArray(comp.synergy)).toBe(true);
  });

  it('按 id 查（数字 id 与 blitz 字符串 id 都能查到）', () => {
    const official = comps.comps(18, '官网阵容')[0];
    expect(comps.comp(18, official.id)?.name).toBe(official.name);
    const blitz = comps.comps(18, 'blitz')[0];
    expect(comps.comp(18, String(blitz.id))?.name).toBe(blitz.name);
    expect(comps.comp(18, 'nope')).toBeUndefined();
  });

  it('按英雄反查阵容，并按 tier 升序', () => {
    const rows = comps.byChampion(18, 'DA_18_Caitlyn');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((c) => c.units.some((u) => u.character_id === 'DA_18_Caitlyn'))).toBe(true);
    const tiers = rows.map((c) => c.tier ?? 99);
    expect([...tiers]).toEqual([...tiers].sort((a, b) => a - b));
    expect(comps.byChampion(18, 'NOT_A_CHAMP')).toEqual([]);
  });

  it('平均费用：用英雄数据算，缺失返回 0', () => {
    const comp = comps.comps(18, '官网阵容')[0];
    const cost = comps.costOf(18, comp, (id) => dataset.characterById(id)?.cost);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThanOrEqual(5);
    const zero = comps.costOf(18, { id: 'x', name: 'x', units: [{ character_id: 'nope' }] }, (id) => dataset.characterById(id)?.cost);
    expect(zero).toBe(0);
  });

  it('buildCompsDataset 可注入小样本', () => {
    const tiny = buildCompsDataset({ sets: { 9: [{ title: '官网阵容', comps: [{ id: 1, name: 'T', units: [{ character_id: 'X' }] }] }] } });
    expect(tiny.supportSets).toEqual([9]);
    expect(tiny.comps(9).length).toBe(1);
    expect(tiny.byChampion(9, 'X').length).toBe(1);
    expect(rawComps.sets).toBeTruthy();
  });
});
