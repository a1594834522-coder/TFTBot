/**
 * MetaTFT 阵容适配层 —— 把 `tft-comps-api` 的 `comp_options` / `comp_details`
 * 转成本项目统一的 `OfficialComp`，并打上 `source: 'metatft'`。
 *
 * 为什么单独一层：
 *   - 本实现内嵌的「官网阵容 / blitz」是**离线快照**；MetaTFT 是**在线聚类**，字段名完全不同；
 *   - UI（CompsPanel）只认 `OfficialComp`，所以适配层是唯一知道 MetaTFT 字段形状的地方；
 *   - 数据结构不稳定（`units_list` 可能是字符串数组也可能是对象数组），所以解析要宽容。
 */
import type { OfficialComp, CompUnit, CompSynergy } from './comps-data';
import { chineseName } from './names';
import type { ClusterName, CompOptionEntry, CompOptionsResponse, CompDetailsResponse } from '../core/metatft';

export interface MetatftComp extends OfficialComp {
  source: 'metatft';
  /** MetaTFT 额外给的可比指标（没有 details 时为 undefined） */
  avgPlace?: number;
  games?: number;
  winRate?: number;
  top4?: number;
  score?: number;
  /** comp_details 里的决策项（升级节奏 / 等级名次 / 装备 / 海克斯） */
  details?: MetatftCompDetails;
}

export interface MetatftBuild {
  /** 装备 id（线上是 `buildName`） */
  items: string[];
  /** 持有者（线上是 `unit`） */
  unit?: string;
  count?: number;
  avg?: number;
}

export interface MetatftLevelStep {
  stage: number;
  round: number;
  level: number;
  count: number;
}

export interface MetatftUnitStat {
  unit: string;
  count?: number;
  avg?: number;
  /** 星级分布：1★/2★/3★ 各自的名次 */
  tiers?: Array<{ tier: number; count?: number; avg?: number }>;
  /** 装备件数 → 名次 */
  numItems?: Array<{ items: number; count?: number; avg?: number }>;
}

/** 站位热区：cell 号（0..27 棋盘，28+ 备战席）→ 次数 */
export type MetatftPositioning = Record<string, Array<{ cell: number; count: number }>>;

/** 职业选手/社区作者阵容（proComps） */
export interface MetatftProComp {
  title: string;
  author?: string;
  region?: string;
  /** 与聚类中心的距离，越小越贴近主流 */
  distance?: number;
  updatedAt?: string;
}

/** 开局分支（early_options）：某人口下的常见棋盘 */
export interface MetatftEarlyOption {
  level: number;
  units: string[];
  count?: number;
  avg?: number;
  win?: number;
}

export interface MetatftCompDetails {
  /** 升级里程碑（本实现 levels） */
  levels?: MetatftLevelStep[];
  /** 等级 → 平均名次（本实现 final_levels） */
  finalLevels?: Array<{ level: string; count: number; avg?: number }>;
  /** 装备组合（本实现 builds，取前若干） */
  builds?: MetatftBuild[];
  /** 海克斯（本实现 augments，取前若干） */
  augments?: Array<{ name: string; count?: number; avg?: number }>;
  /** 单卡表现（本实现 unit_stats，取前若干） */
  unitStats?: MetatftUnitStat[];
  /** 站位热区（本实现 positioning，取前若干单位 × 前几个格子） */
  positioning?: MetatftPositioning;
  /** 作者阵容（本实现 proComps，取最贴近的几条） */
  proComps?: MetatftProComp[];
  /** 开局分支（本实现 early_options，按人口取前几条） */
  earlyOptions?: MetatftEarlyOption[];
}

export interface MetatftCompsFile {
  meta?: { fetchedAt?: string; tft_set?: string; cluster_id?: number; queue?: number; patch?: string };
  sets: Record<string, MetatftComp[]>;
}

/* ---------- 宽容取值 ---------- */

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * 线上实测：`units_list` / `traits_list` 是 `&` 分隔的字符串
 *   "DA_18_Cassiopeia&DA_18_Ornn&DA_Fiddlesticks18"
 *   "DA_18_Defender_3&DA_18_Rival_1"        ← 羁绊把 count 拼在 id 末尾
 * 也兼容数组/对象写法（早期抓包与测试夹具）。
 */
export function splitList(v: unknown): unknown[] {
  if (typeof v === 'string') return v.split('&').map((s) => s.trim()).filter(Boolean);
  return asArray(v);
}

/** 从各种写法里取字符串 id：'TFT18_Ahri' / {unit:'Ahri'} / {apiName:'TFT18_Ahri'} */
export function pickId(v: unknown, set: number): string | null {
  if (typeof v === 'string' && v.trim()) return normalizeUnitId(v.trim(), set);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['character_id', 'unit', 'apiName', 'api_name', 'name', 'id', 'key']) {
      const s = o[k];
      if (typeof s === 'string' && s.trim()) return normalizeUnitId(s.trim(), set);
    }
  }
  return null;
}

/** MetaTFT 有时给不带前缀的名字（'Ahri'），补成我们数据集的 `TFT18_Ahri` */
export function normalizeUnitId(id: string, set: number): string {
  if (/^TFT\d+_/.test(id) || /^DA_/.test(id)) return id;
  return `TFT${set}_${id}`;
}

export function setOfUnits(units: CompUnit[], fallback = 18): number {
  for (const u of units) {
    const m = /^TFT(\d+)_/.exec(u.character_id);
    if (m) return Number(m[1]);
  }
  const da = units.find((u) => /^DA_/.test(u.character_id));
  return da ? 18 : fallback;
}

/** 从 traits_list 抽 {id,count}；`X_3` 形式取末尾数字，缺省 1 */
export function parseTraits(raw: unknown, set: number): CompSynergy[] {
  const out: CompSynergy[] = [];
  for (const t of splitList(raw)) {
    let id: string | null = null;
    let count = 1;
    if (typeof t === 'string') {
      const m = /^(.*)_(\d+)$/.exec(t);
      const base = m ? m[1] : t;
      if (m) count = Number(m[2]);
      id = /^TFT\d+_/.test(base) || /^DA_/.test(base) ? base : `TFT${set}_${base}`;
    } else if (t && typeof t === 'object') {
      const o = t as Record<string, unknown>;
      id = pickId(o.trait ?? o.trait_id ?? o.name ?? o.id ?? o.key, set);
      const c = Number(o.count ?? o.num_units ?? o.units ?? o.style ?? o.tier);
      if (Number.isFinite(c) && c > 0) count = c;
    }
    if (id) out.push({ trait_id: id, count });
  }
  return out;
}

/** 从 units_list 抽棋子；星级/装备有就给 */
export function parseUnits(raw: unknown, set: number): CompUnit[] {
  const out: CompUnit[] = [];
  for (const u of splitList(raw)) {
    const id = pickId(u, set);
    if (!id) continue;
    const o = (u && typeof u === 'object' ? u : {}) as Record<string, unknown>;
    const level = Number(o.level ?? o.star ?? o.tier);
    const items = splitList(o.items)
      .map((i) => (typeof i === 'string' ? i : pickId(i, set)))
      .filter((x): x is string => !!x);
    out.push({
      character_id: id,
      ...(Number.isFinite(level) && level >= 1 && level <= 3 ? { level } : {}),
      ...(items.length ? { items } : {}),
      ...(Number.isFinite(Number(o.position)) ? { position: Number(o.position) } : {}),
    });
  }
  return out;
}

/** avg place → tier（0 最好）。阈值来自 MetaTFT final_levels 的实测分布 */
export function tierFromAvgPlace(avgPlace?: number): number | undefined {
  if (!Number.isFinite(avgPlace) || !avgPlace) return undefined;
  const a = avgPlace as number;
  if (a < 4.2) return 0;
  if (a < 4.45) return 1;
  if (a < 4.65) return 2;
  if (a < 4.85) return 3;
  if (a < 5.05) return 4;
  return 5;
}

/**
 * 按「同批次内相对强弱」分档 —— MetaTFT 的 avg 分布随版本漂移（18.4b 实测 2.9~5.2），
 * 固定阈值会把九成阵容都判成 T0，所以用分位：前 15% → T0，35% → T1，60% → T2，80% → T3，其余 T4。
 * 没有 avg 的阵容保持原 tier（或 undefined）。
 */
export function assignTiers(comps: MetatftComp[]): MetatftComp[] {
  const withAvg = comps.filter((c) => Number.isFinite(c.avgPlace));
  if (withAvg.length < 4) return comps; // 样本太少，别硬分
  const sorted = [...withAvg].sort((a, b) => (a.avgPlace ?? 9) - (b.avgPlace ?? 9));
  const n = sorted.length;
  const cut = (p: number) => Math.max(0, Math.min(n - 1, Math.floor(p * n)));
  const bands: Array<[number, number, number]> = [
    [0, cut(0.15), 0],
    [cut(0.15), cut(0.35), 1],
    [cut(0.35), cut(0.6), 2],
    [cut(0.6), cut(0.8), 3],
    [cut(0.8), n, 4],
  ];
  for (const [from, to, tier] of bands) {
    for (let i = from; i < to; i++) sorted[i].tier = tier;
  }
  return comps;
}

/** `DA_18_ElderDragon` / `TFT18_Ahri` → 可读名（数据集里查不到时的兜底） */
export function prettifyId(id: string): string {
  const bare = id
    .replace(/^DA_18_/, '')
    .replace(/^DA_/, '')
    .replace(/^TFT\d+_/, '')
    .replace(/(\d+)$/, '');
  return bare
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

/** 阵容显示名：优先用原字段，否则用「主羁绊 + 人数」拼 */
export function compDisplayName(entry: Record<string, unknown>, units: CompUnit[], synergy: CompSynergy[]): string {
  for (const k of ['name', 'title', 'label', 'comp_name']) {
    const s = entry[k];
    if (typeof s === 'string' && /[\u3400-\u9fff]/.test(s)) return s.trim();
  }
  const top = [...synergy]
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((s) => `${s.count}${chineseName('traits', s.trait_id)}`);
  return `${top.join(' / ') || '精选阵容'} · ${units.length}人`;
}

export interface ConvertOptions {
  clusterName?: ClusterName;
  overall?: unknown;
  /** 从 details 里取指标（可选） */
  details?: CompDetailsResponse['results'];
  /** 赛季号（决定单位 id 前缀） */
  set?: number;
  /** builds / augments 各保留多少条（默认 3） */
  detailLimit?: number;
}

/** 聚类命名来自 latest_cluster_info；不能用某个成型棋盘的羁绊替代。 */
export function clusterDisplayName(cluster?: ClusterName): string | undefined {
  const parts = cluster?.name?.map(part => chineseName(part.type === 'unit' ? 'units' : 'traits', part.name));
  return parts?.length && parts.every(name => name !== '名称待更新') ? parts.join(' ') : undefined;
}

/** 当前接口返回 count/avg 汇总行；兼容旧版八名次数组，不把站位子样本冒充聚类总样本。 */
function aggregateMetrics(raw: unknown): { games: number; avgPlace: number } | undefined {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const valid = rows.filter((r: any) => r && typeof r === 'object' && Number(r.count) > 0 && Number(r.avg) >= 1 && Number(r.avg) <= 8);
  const games = valid.reduce((sum: number, r: any) => sum + Number(r.count), 0);
  return games ? { games, avgPlace: valid.reduce((sum: number, r: any) => sum + Number(r.count) * Number(r.avg), 0) / games } : undefined;
}

/** comp_details → 精简决策项（只留 UI 用得到的部分） */
export function parseDetails(raw: CompDetailsResponse['results'] | undefined, limit = 3): MetatftCompDetails | undefined {
  if (!raw) return undefined;
  const out: MetatftCompDetails = {};

  const levelsRaw = asArray(raw.levels)
    .map((l: any) => ({ stage: Number(l?.stage), round: Number(l?.round), level: Number(l?.level), count: Number(l?.count) || 0 }))
    .filter((l) => Number.isFinite(l.stage) && Number.isFinite(l.round) && Number.isFinite(l.level))
    .sort((a, b) => a.stage - b.stage || a.round - b.round);
  // 同一等级只留最早那一步（快照体积从 ~670KB 降到 ~200KB，UI 也用同一口径）
  const seenLevels = new Set<number>();
  const levels = levelsRaw
    .filter((l) => {
      if (seenLevels.has(l.level)) return false;
      seenLevels.add(l.level);
      return true;
    })
    .slice(0, 9);
  if (levels.length) out.levels = levels;

  const finals = asArray(raw.final_levels)
    .map((f: any) => ({ level: String(f?.level ?? ''), count: Number(f?.count) || 0, avg: Number(f?.avg) }))
    .filter((f) => f.level)
    .sort((a, b) => Number(a.level) - Number(b.level))
    .slice(0, 6);
  if (finals.length) out.finalLevels = finals;

  const builds = asArray(raw.builds)
    .map((b: any) => {
      const items = splitList(b?.buildName ?? b?.build ?? b?.items)
        .map((x) => (typeof x === 'string' ? x : pickId(x, 18)))
        .filter((x): x is string => !!x);
      return { items, unit: typeof b?.unit === 'string' ? b.unit : undefined, count: Number(b?.count), avg: Number(b?.avg) };
    })
    .filter((b) => b.items.length)
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .slice(0, limit);
  if (builds.length) out.builds = builds;

  const augments = asArray(raw.augments)
    .map((a: any) => ({
      name: String(a?.aug ?? a?.name ?? a?.augment ?? a?.augmentName ?? '').trim(),
      count: Number(a?.count),
      avg: Number(a?.avg),
    }))
    .filter((a) => a.name)
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .slice(0, limit);
  if (augments.length) out.augments = augments;

  const unitStats = asArray(raw.unit_stats)
    .map((u: any) => ({
      unit: String(u?.unit ?? u?.apiName ?? ''),
      count: Number(u?.count),
      avg: Number(u?.avg),
      tiers: asArray(u?.tiers)
        .map((t: any) => ({ tier: Number(t?.tier), count: Number(t?.count), avg: Number(t?.avg) }))
        .filter((t) => Number.isFinite(t.tier) && t.tier > 0)
        .sort((a, b) => a.tier - b.tier),
      numItems: asArray(u?.num_items)
        .map((n: any) => ({ items: Number(n?.num_items ?? n?.items), count: Number(n?.count), avg: Number(n?.avg) }))
        .filter((n) => Number.isFinite(n.items) && n.items >= 0)
        .sort((a, b) => a.items - b.items),
    }))
    .filter((u) => u.unit)
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .slice(0, Math.max(4, limit + 2));
  if (unitStats.length) out.unitStats = unitStats;

  // positioning：{ units: { <unit>: { positions:[{cell:"cell_7",count}] } } } → 按 cell 号归档
  const rp = raw as {
    positioning?: { units?: Record<string, any> };
    relative_positioning?: { units?: Record<string, any> };
  };
  const rawUnits = rp.positioning?.units ?? rp.relative_positioning?.units;
  if (rawUnits && typeof rawUnits === 'object') {
    const pos: MetatftPositioning = {};
    for (const [unit, v] of Object.entries(rawUnits as Record<string, any>)) {
      const cells = asArray(v?.positions)
        .map((p: any) => ({ cell: Number(String(p?.cell ?? '').replace(/^cell_/, '')), count: Number(p?.count) || 0 }))
        .filter((p) => Number.isFinite(p.cell) && p.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      if (cells.length && Object.keys(pos).length < 6) pos[unit] = cells;
    }
    if (Object.keys(pos).length) out.positioning = pos;
  }

  // proComps：作者阵容，distance 越小越贴近主流 → 取最近的 limit 条
  const proComps = asArray((raw as any).proComps)
    .map((p: any) => {
      const c = p?.content ?? {};
      const meta = c.metadata ?? {};
      const author = c.author ?? {};
      return {
        title: String(meta.title ?? '').trim(),
        author: typeof author.riotid === 'string' ? author.riotid : undefined,
        region: typeof author.region === 'string' ? author.region : undefined,
        distance: Number(p?.distance),
        updatedAt: typeof c.updated_at === 'string' ? c.updated_at : undefined,
      };
    })
    .filter((p) => p.title)
    .sort((a, b) => (Number.isFinite(a.distance) ? a.distance! : 9) - (Number.isFinite(b.distance) ? b.distance! : 9))
    .slice(0, limit);
  if (proComps.length) out.proComps = proComps;

  // early_options：{ "4": [{unit_list:"A&B", count, avg, win}] } → 每个人口前 2 条
  const rawEarly = (raw as any).early_options;
  if (rawEarly && typeof rawEarly === 'object') {
    const early: MetatftEarlyOption[] = [];
    for (const [levelKey, list] of Object.entries(rawEarly as Record<string, any>)) {
      const level = Number(levelKey);
      if (!Number.isFinite(level)) continue;
      const rows = asArray(list)
        .map((r: any) => ({
          level,
          units: splitList(r?.unit_list ?? r?.units_list).filter((u): u is string => typeof u === 'string'),
          count: Number(r?.count),
          avg: Number(r?.avg),
          win: Number(r?.win),
        }))
        .filter((r) => r.units.length)
        .sort((a, b) => (Number(b.win) || 0) - (Number(a.win) || 0) || (Number(a.avg) || 9) - (Number(b.avg) || 9))
        .slice(0, 2);
      early.push(...rows);
    }
    if (early.length) out.earlyOptions = early.sort((a, b) => a.level - b.level).slice(0, limit * 2);
  }

  return Object.keys(out).length ? out : undefined;
}

/** 决策缓存保留各持有者的常见出装，避免全局前几名挤掉副坦/副C。仍为聚合数据。 */
export function parseDecisionDetails(raw: CompDetailsResponse['results']): MetatftCompDetails | undefined {
  const details = parseDetails(raw, 300);
  if (!details) return undefined;
  const perUnit = new Map<string, number>(), seen = new Set<string>();
  details.builds = details.builds?.filter(b => {
    if (!b.unit || !b.count || b.count < 30 || b.items.length !== 3) return false;
    const key = `${b.unit}:${[...b.items].sort().join('|')}`;
    if (seen.has(key) || (perUnit.get(b.unit) ?? 0) >= 4) return false;
    seen.add(key); perUnit.set(b.unit, (perUnit.get(b.unit) ?? 0) + 1); return true;
  });
  details.proComps = details.proComps?.slice(0, 3);
  return details;
}

/**
 * 单个 option 条目 → MetatftComp。
 * `comp_options` 的值形如 `{ "7": [ {cluster, units_list, traits_list, …} ] }`：
 * 键是人口数，数组是候选（一般 1 条），取人口最多的那条。
 */
export function entryToComp(clusterId: number, compId: string, buckets: unknown, opts: ConvertOptions = {}): MetatftComp | null {
  const bySize = (buckets && typeof buckets === 'object' ? buckets : {}) as Record<string, unknown>;
  // 线上按人口分桶（"7"…"11"），每桶里是若干候选。
  // 代表样本取「全场次最多」的那条 —— 比取人口最大的桶更稳（大人口桶常常只有个位数场次）。
  const all: any[] = [];
  for (const v of Object.values(bySize)) all.push(...asArray(v));
  const entry = (all.reduce<any>((best, cur) => {
    const bc = Number(best?.count ?? -1);
    const cc = Number(cur?.count ?? -1);
    return cc > bc ? cur : best;
  }, all[0]) ?? {}) as Record<string, unknown>;

  const set = opts.set ?? (Number(entry.set) || 18);
  const units = parseUnits(entry.units_list ?? entry.units, set);
  const synergy = parseTraits(entry.traits_list ?? entry.traits, set);
  if (!units.length) return null;

  const placement = Array.isArray(opts.details?.placements) && opts.details.placements.length === 8 && opts.details.placements.every(p => typeof p === 'number') ? opts.details.placements as number[] : undefined;
  let metrics: { avgPlace?: number; games?: number; winRate?: number; top4?: number } = {};
  if (placement?.length) {
    const games = placement.reduce((a, b) => a + (Number(b) || 0), 0);
    if (games) {
      metrics = {
        games,
        avgPlace: placement.reduce((a, c, i) => a + (i + 1) * (Number(c) || 0), 0) / games,
        winRate: (Number(placement[0]) || 0) / games,
        top4: placement.slice(0, 4).reduce((a, b) => a + (Number(b) || 0), 0) / games,
      };
    }
  }
  // comp_options.overall 已有每个聚类的结论，只需一次请求；details 仅补过渡/装备。
  const aggregate = aggregateMetrics(opts.overall) ?? (!metrics.games ? aggregateMetrics(opts.details?.overall) ?? aggregateMetrics(opts.details?.placements) : undefined);
  if (aggregate) metrics = aggregate;

  const tierRaw = Number(entry.tier ?? entry.tier_rank);
  const tier = Number.isFinite(tierRaw) && tierRaw >= 0 ? tierRaw : tierFromAvgPlace(metrics.avgPlace);

  return {
    id: `metatft:${clusterId}:${compId}`,
    name: clusterDisplayName(opts.clusterName) ?? compDisplayName(entry, units, synergy),
    units,
    synergy,
    early_units: parseUnits(entry.early_units ?? entry.earlyOptions, set),
    play_tags: splitList(entry.tags ?? entry.play_tags).filter((x): x is string => typeof x === 'string'),
    ...(tier !== undefined ? { tier } : {}),
    ...metrics,
    ...(Number.isFinite(Number(entry.score)) ? { score: Number(entry.score) } : {}),
    ...(parseDetails(opts.details, opts.detailLimit) ? { details: parseDetails(opts.details, opts.detailLimit) } : {}),
    source: 'metatft',
  } as MetatftComp;
}

/** `comp_options` 响应 → MetatftComp[]（可带每个 comp 的 details） */
export function compsFromOptions(
  resp: CompOptionsResponse | Record<string, unknown> | null,
  opts: { clusterId: number; set?: number; details?: Record<string, CompDetailsResponse['results']>; clusterNames?: ClusterName[] },
): MetatftComp[] {
  const root = (resp as any)?.results?.options ? (resp as any).results.options : (resp as any)?.options ?? resp;
  if (!root || typeof root !== 'object') return [];
  const out: MetatftComp[] = [];
  for (const [compId, buckets] of Object.entries(root as Record<string, unknown>)) {
    if (!/^\d+$/.test(compId)) continue;
    const comp = entryToComp(opts.clusterId, compId, buckets, {
      set: opts.set,
      details: opts.details?.[compId],
      overall: (resp as CompOptionsResponse)?.results?.overall && ((resp as CompOptionsResponse).results!.overall as Record<string, unknown>)[compId],
      clusterName: opts.clusterNames?.find(c => String(c.Cluster) === compId),
    });
    if (comp) out.push(comp);
  }
  assignTiers(out);
  return out.sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || (a.avgPlace ?? 9) - (b.avgPlace ?? 9));
}

/** 快照文件 → 按赛季索引 */
export function groupBySet(comps: MetatftComp[], fallbackSet = 18): Record<string, MetatftComp[]> {
  const out: Record<string, MetatftComp[]> = {};
  for (const c of comps) {
    const set = setOfUnits(c.units, fallbackSet);
    (out[String(set)] ??= []).push(c);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99));
  return out;
}
