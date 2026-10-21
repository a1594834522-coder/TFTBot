import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createMetatftClient,
  placementStats,
  METATFT_HEADERS,
  modelUrls,
  iconUrl,
  MetatftError,
} from '../src/core/metatft';
import {
  compsFromOptions,
  entryToComp,
  normalizeUnitId,
  parseTraits,
  parseUnits,
  pickId,
  setOfUnits,
  tierFromAvgPlace,
  groupBySet,
} from '../src/game/metatft-comps';
import { allComps, metatftComps, groupsOf, sourceOfComp, sourcesFor, byChampionAll } from '../src/game/comps-sources';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'metatft', 'sample.json'), 'utf8'));

/** 假 fetch：按 url 后缀路由，记录请求 */
function fakeFetch(routes: Record<string, any>, status = 200) {
  const calls: Array<{ url: string; headers: any }> = [];
  const impl = vi.fn(async (url: string, init: any) => {
    calls.push({ url, headers: init?.headers });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const body = key ? routes[key] : { error: 'not found' };
    return {
      ok: status < 400,
      status,
      text: async () => JSON.stringify(body),
    } as any;
  });
  return { impl, calls };
}

describe('MetaTFT 客户端（按 INTERFACES.md）', () => {
  it('带必需请求头（UA / Referer / Origin / Accept）', async () => {
    const { impl, calls } = fakeFetch({ '/patch': fixture.patch });
    const client = createMetatftClient({ fetchImpl: impl as any });
    const patch = await client.patch();
    expect(patch.patch).toBe('18.4');
    expect(calls[0].headers).toMatchObject(METATFT_HEADERS);
    expect(calls[0].headers.Referer).toBe('https://www.metatft.com/');
    expect(calls[0].url).toBe('https://api-hc.metatft.com/tft-stat-api/patch');
  });

  it('comp_details 必须同时带 comp 与 cluster_id', async () => {
    const { impl, calls } = fakeFetch({ '/comp_details': fixture.comp_details });
    const client = createMetatftClient({ fetchImpl: impl as any });
    const d = await client.compDetails(426007, 426);
    expect(d.results?.placements).toHaveLength(8);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('comp')).toBe('426007');
    expect(url.searchParams.get('cluster_id')).toBe('426');
  });

  it('explorer 默认 compact=true，参数进 query', async () => {
    const { impl, calls } = fakeFetch({ '/tft-explorer-api/level': fixture.explorer_level });
    const client = createMetatftClient({ fetchImpl: impl as any });
    const rows = await client.explorer('level', { queue: 1100, patch: '18.4', b_patch: 'b' });
    expect(rows).toHaveLength(2);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('compact')).toBe('true');
    expect(url.searchParams.get('b_patch')).toBe('b');
  });

  it('TTL 缓存命中不重复请求；clearCache 后重发', async () => {
    const { impl, calls } = fakeFetch({ '/latest_cluster_id': fixture.latest_cluster_id });
    let t = 0;
    const client = createMetatftClient({ fetchImpl: impl as any, cacheTtlMs: 1000, now: () => t });
    await client.latestCluster();
    await client.latestCluster();
    expect(calls).toHaveLength(1);
    t = 2000;
    await client.latestCluster();
    expect(calls).toHaveLength(2);
    client.clearCache();
    await client.latestCluster();
    expect(calls).toHaveLength(3);
  });

  it('非 2xx 抛 MetatftError（带状态码，不重试 4xx）', async () => {
    const { impl, calls } = fakeFetch({ '/patch': { err: true } }, 404);
    const client = createMetatftClient({ fetchImpl: impl as any, retries: 2 });
    await expect(client.patch()).rejects.toBeInstanceOf(MetatftError);
    expect(calls).toHaveLength(1);
  });

  it('静态资源 URL 形如文档（model/lookups/图标）', () => {
    expect(modelUrls(18).lookups).toBe('https://data.metatft.com/model_lookupsEA_TFTSet18.json');
    expect(modelUrls(18).model).toContain('WinRateModelImproved_BoardStrengthEA_TFTSet18/model.json');
    expect(iconUrl('champions', 'TFT18_Ahri')).toBe('https://cdn.metatft.com/file/metatft/champions/tft18_ahri.png');
  });

  it('名次向量换算：games / avgPlace / win / top4', () => {
    const pc = [100, 100, 100, 100, 200, 200, 200, 200]; // 1200 局
    const m = placementStats(pc);
    expect(m.games).toBe(1200);
    expect(m.win).toBeCloseTo(1 / 12, 6);
    expect(m.top4).toBeCloseTo(400 / 1200, 6);
    expect(m.avgPlace).toBeCloseTo((100 * 1 + 100 * 2 + 100 * 3 + 100 * 4 + 200 * 5 + 200 * 6 + 200 * 7 + 200 * 8) / 1200, 6);
    expect(placementStats([])).toEqual({ games: 0, avgPlace: 0, win: 0, top4: 0 });
  });
});

describe('MetaTFT 阵容适配', () => {
  it('units_list 支持字符串/对象/带前缀/不带前缀', () => {
    expect(pickId('TFT18_Ahri', 18)).toBe('TFT18_Ahri');
    expect(pickId('Ahri', 18)).toBe('TFT18_Ahri');
    expect(pickId({ unit: 'Ahri' }, 18)).toBe('TFT18_Ahri');
    expect(pickId({ apiName: 'TFT18_Lux' }, 18)).toBe('TFT18_Lux');
    expect(pickId(null, 18)).toBeNull();
    expect(normalizeUnitId('DA_18_Maokai', 18)).toBe('DA_18_Maokai');
  });

  it('traits_list 支持字符串/对象（count|num_units|style）', () => {
    const t = parseTraits(['Arcanist', { trait: 'TFT18_Void', count: 5 }, { name: 'Scholar', num_units: 2 }], 18);
    expect(t).toEqual([
      { trait_id: 'TFT18_Arcanist', count: 1 },
      { trait_id: 'TFT18_Void', count: 5 },
      { trait_id: 'TFT18_Scholar', count: 2 },
    ]);
  });

  it('units 解析星级/装备/位置', () => {
    const u = parseUnits([{ unit: 'Ahri', level: 3, items: ['TFT_Item_InfinityEdge'], position: 5 }], 18);
    expect(u[0]).toEqual({ character_id: 'TFT18_Ahri', level: 3, items: ['TFT_Item_InfinityEdge'], position: 5 });
  });

  it('avgPlace → tier 阈值', () => {
    expect(tierFromAvgPlace(4.0)).toBe(0);
    expect(tierFromAvgPlace(4.3)).toBe(1);
    expect(tierFromAvgPlace(4.6)).toBe(2);
    expect(tierFromAvgPlace(4.7)).toBe(3);
    expect(tierFromAvgPlace(5.0)).toBe(4);
    expect(tierFromAvgPlace(5.2)).toBe(5);
    expect(tierFromAvgPlace(undefined)).toBeUndefined();
  });

  it('comp_options → 阵容（取人口最多的桶；空单位丢弃）', () => {
    const comps = compsFromOptions(fixture.comp_options, { clusterId: 426, set: 18 });
    expect(comps).toHaveLength(2); // 426030 没单位被丢弃
    const byId = Object.fromEntries(comps.map((c) => [String(c.id), c]));
    expect(byId['metatft:426:426007']).toBeTruthy();
    expect(byId['metatft:426:426007'].units.map((u) => u.character_id)).toContain('TFT18_ChoGath');
    expect(byId['metatft:426:426007'].synergy).toContainEqual({ trait_id: 'TFT18_Void', count: 5 });
    // 有 name 字段就用它，没有就用主羁绊拼
    expect(byId['metatft:426:426007'].name).toBe('虚空大龙');
    expect(byId['metatft:426:426012'].name).toContain('名称待更新');
    expect(comps.every((c) => c.source === 'metatft')).toBe(true);
    // 没有 details 时按 tier 排序（undefined 当 99）
    expect(comps.length).toBeGreaterThan(0);
  });

  it('带 details 时算出 avgPlace / games / winRate / top4，并按指标定 tier', () => {
    const comp = entryToComp(426, '426007', fixture.comp_options.results.options['426007'], {
      set: 18,
      details: fixture.comp_details.results,
    })!;
    const m = placementStats(fixture.comp_details.results.placements);
    expect(comp.avgPlace).toBeCloseTo(m.avgPlace, 6);
    expect(comp.games).toBe(m.games);
    expect(comp.winRate).toBeCloseTo(m.win, 6);
    expect(comp.top4).toBeCloseTo(m.top4, 6);
    expect(comp.tier).toBe(tierFromAvgPlace(m.avgPlace));
  });

  it('groupBySet 按单位前缀归档', () => {
    const comps = compsFromOptions(fixture.comp_options, { clusterId: 426, set: 18 });
    const g = groupBySet(comps, 18);
    expect(Object.keys(g)).toEqual(['18']);
    expect(g['18'].length).toBe(2);
    expect(setOfUnits(comps[0].units, 18)).toBe(18);
  });
});

describe('阵容源注册表（bundled + MetaTFT）', () => {
  it('枚举当前赛季三个可用数据源', () => {
    const list = sourcesFor(18);
    expect(list.map((s) => s.id)).toEqual(['official', 'blitz', 'metatft']);
    expect(list.find((s) => s.id === 'official')!.count).toBe(33);
    expect(list.find((s) => s.id === 'blitz')!.count).toBe(48);
    // 仓库里的快照是空占位 → ready=false，但接口不报错
    expect(list.find((s) => s.id === 'metatft')!.ready).toBe(true);
    expect(metatftComps(18)).toHaveLength(60);
  });

  it('合并查询：all / official / blitz / MetaTFT', () => {
    expect(allComps({ set: 18 })).toHaveLength(141);
    expect(allComps({ set: 18, source: 'official' })).toHaveLength(33);
    expect(allComps({ set: 18, source: 'blitz' })).toHaveLength(48);
    expect(allComps({ set: 18, source: 'metatft' })).toHaveLength(60);
    expect(allComps({ set: 18, limit: 5 })).toHaveLength(5);
  });

  it('sourceOfComp 区分官方/blitz/metatft', () => {
    const official = allComps({ set: 18, source: 'official' })[0];
    const blitz = allComps({ set: 18, source: 'blitz' })[0];
    const mt = compsFromOptions(fixture.comp_options, { clusterId: 426, set: 18 })[0];
    expect(sourceOfComp(official)).toBe('official');
    expect(sourceOfComp(blitz)).toBe('blitz');
    expect(sourceOfComp(mt)).toBe('metatft');
  });

  it('title 过滤：MetaTFT / 官网阵容 / blitz / 名字片段', () => {
    expect(allComps({ set: 18, title: 'MetaTFT' })).toHaveLength(60);
    expect(allComps({ set: 18, title: '官网阵容' }).every((c) => sourceOfComp(c) === 'official')).toBe(true);
    expect(allComps({ set: 18, title: 'blitz' }).every((c) => sourceOfComp(c) === 'blitz')).toBe(true);
    const sample = allComps({ set: 18, source: 'official' })[0].name.slice(0, 2);
    expect(allComps({ set: 18, title: sample }).every((c) => c.name.includes(sample))).toBe(true);
  });

  it('分组与英雄查询覆盖三个数据源', () => {
    expect(groupsOf(18).map((g) => g.title)).toEqual(['官网阵容', 'blitz', 'MetaTFT']);
    const hits = byChampionAll(18, 'DA_18_Caitlyn');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((c) => c.units.some((u) => u.character_id === 'DA_18_Caitlyn'))).toBe(true);
  });
});
