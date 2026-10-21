import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import CompsPanel from '../src/ui/CompsPanel.vue';
import {
  parseUnits,
  parseTraits,
  splitList,
  prettifyId,
  assignTiers,
  entryToComp,
  compsFromOptions,
  type MetatftComp,
} from '../src/game/metatft-comps';
import { allComps, sourcesFor } from '../src/game/comps-sources';

/** 线上真实形状：units/traits 是 `&` 分隔的字符串，trait 末尾拼 count */
const liveBuckets = {
  '7': [{ cluster: '426000', units_list: 'DA_18_A&DA_18_B&DA_18_C', traits_list: 'DA_18_Defender_3&DA_18_Rival_1', count: 2403, avg: 5.22, score: 67.4 }],
  '8': [{ cluster: '426000', units_list: 'DA_18_A&DA_18_B&DA_18_C&DA_18_D', traits_list: 'DA_18_Defender_4', count: 120, avg: 4.1, score: 40 }],
  '9': [{ cluster: '426000', units_list: 'DA_18_A&DA_18_B&DA_18_C&DA_18_D&DA_18_E', traits_list: 'DA_18_Defender_5', count: 3, avg: 1.0, score: 9 }],
};

describe('MetaTFT 线上格式（& 分隔 / trait 末尾 count）', () => {
  it('splitList 拆 & 也兼容数组', () => {
    expect(splitList('A&B&C')).toEqual(['A', 'B', 'C']);
    expect(splitList(['A', 'B'])).toEqual(['A', 'B']);
    expect(splitList(null)).toEqual([]);
  });

  it('parseUnits 解析 & 串（DA_ 前缀原样保留）', () => {
    expect(parseUnits('DA_18_Cassiopeia&DA_Fiddlesticks18', 18).map((u) => u.character_id)).toEqual([
      'DA_18_Cassiopeia',
      'DA_Fiddlesticks18',
    ]);
  });

  it('parseTraits 取末尾数字作为 count', () => {
    expect(parseTraits('DA_18_Defender_3&DA_18_Rival_1', 18)).toEqual([
      { trait_id: 'DA_18_Defender', count: 3 },
      { trait_id: 'DA_18_Rival', count: 1 },
    ]);
  });

  it('代表样本取「场次最多」，而不是人口最多的桶', () => {
    const comp = entryToComp(426, '426000', liveBuckets, { set: 18 })!;
    expect(comp.games).toBeUndefined();
    expect(comp.avgPlace).toBeUndefined();
    expect(comp.units).toHaveLength(3); // 来自 7 人桶
    expect(comp.name).toContain('护卫');
  });

  it('prettifyId 把 DA_/TFTxx_ 前缀与驼峰拆成可读名', () => {
    expect(prettifyId('DA_18_ElderDragon')).toBe('Elder Dragon');
    expect(prettifyId('DA_18_Ahri')).toBe('Ahri');
    expect(prettifyId('DA_Fiddlesticks18')).toBe('Fiddlesticks');
    expect(prettifyId('DA_18_Defender')).toBe('Defender');
  });

  it('assignTiers 按分位分档（样本足够时 T0..T4 都有）', () => {
    const comps: MetatftComp[] = Array.from({ length: 20 }, (_, i) => ({
      id: `metatft:1:${i}`,
      name: `c${i}`,
      units: [{ character_id: 'DA_18_A' }],
      source: 'metatft' as const,
      avgPlace: 3 + i * 0.1,
    }));
    assignTiers(comps);
    const tiers = comps.map((c) => c.tier);
    expect(new Set(tiers).size).toBe(5);
    const sorted = [...comps].sort((a, b) => (a.avgPlace ?? 9) - (b.avgPlace ?? 9));
    expect(sorted[0].tier).toBe(0);
    expect(sorted[sorted.length - 1].tier).toBe(4);
  });

  it('样本不足 4 条时不分档（避免瞎猜）', () => {
    const comps: MetatftComp[] = [
      { id: 'a', name: 'a', units: [{ character_id: 'X' }], source: 'metatft' as const, avgPlace: 3 },
      { id: 'b', name: 'b', units: [{ character_id: 'X' }], source: 'metatft' as const, avgPlace: 5 },
    ];
    assignTiers(comps);
    expect(comps.every((c) => c.tier === undefined)).toBe(true);
  });
});

describe('快照并入运行期数据源', () => {
  const live = compsFromOptions({ results: { options: { 426000: liveBuckets } } }, { clusterId: 426, set: 18 });

  it('MetaTFT 快照里有 set 18 的 60 套（仓库已 sync）', () => {
    const list = allComps({ set: 18, source: 'metatft' });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => String(c.id).startsWith('metatft:'))).toBe(true);
    const s = sourcesFor(18).find((x) => x.id === 'metatft')!;
    expect(s.ready).toBe(true);
    expect(s.count).toBe(list.length);
  });

  it('合并后 set 18 = 内嵌（官方 + blitz）+ MetaTFT', () => {
    const all = allComps({ set: 18 });
    const mt = allComps({ set: 18, source: 'metatft' });
    const bundled = allComps({ set: 18, source: 'official' }).length + allComps({ set: 18, source: 'blitz' }).length;
    expect(bundled).toBeGreaterThan(0);
    expect(all.length).toBe(bundled + mt.length);
  });

  it('CompsPanel 只显示 MetaTFT 源时的 data-source 标记', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(CompsPanel, { comps: live, source: 'metatft', limit: 5, sourceCounts: { metatft: 1 } }) }),
    );
    expect(html).toContain('data-source="metatft"');
    expect(html).toContain('data-metatft-count');
  });

  it('CompsPanel source=official 时过滤掉 MetaTFT', async () => {
    const mixed = [...allComps({ set: 18 }), ...live];
    const html = await renderToString(createSSRApp({ render: () => h(CompsPanel, { comps: mixed, source: 'official', limit: 5 }) }));
    expect(html).not.toContain('data-source="metatft"');
    expect(html).toContain('data-source="official"');
  });
});
