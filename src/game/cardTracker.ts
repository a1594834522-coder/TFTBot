/**
 * 游戏内处理逻辑（二）：牌池 / 记牌器 / 追三
 *
 * 约定：
 *   trick-1ce3cda3.js `Ue(name)`    —— 全场同名棋子副本求和，与牌池比较，决定是否还能三星
 *   trick-1ce3cda3.js `je(name)`    —— 记牌器数字（已出/剩余）
 *   settings.threeMarkCosts         —— 只对 4/5 费追三
 *   settings.showOnlyMe             —— 只看自己
 *
 * 本实现牌池大小是硬编码在业务里/由 rankData 下发；这里做成可配置（不同赛季池子不同）。
 */

export type Cost = 1 | 2 | 3 | 4 | 5;

/**
 * 每个英雄的副本数（按费用）。**与本实现 xe(cost) 一致**：29/22/18/10/9
 * （1→29, 2→22, 3→18, 4→10, 5/6→9, 7→0），可按赛季覆盖
 */
export const DEFAULT_POOL_BY_COST: Record<Cost, number> = {
  1: 29,
  2: 22,
  3: 18,
  4: 10,
  5: 9,
};

export interface PoolConfig {
  poolByCost: Record<Cost, number>;
}

export const DEFAULT_POOL: PoolConfig = { poolByCost: DEFAULT_POOL_BY_COST };

export interface ChampionCatalogEntry {
  character_id: string;
  display_name?: string;
  cost?: number;
}

export interface PoolRow {
  champion: string;
  cost: Cost | null;
  pool: number;
  /** 全场已持有副本数 */
  owned: number;
  remaining: number;
  /** 还差多少张能三星（0 = 已三星或不可三星） */
  neededForThree: number;
  canThreeStar: boolean;
  /** 是否命中“追三标记”规则（费用过滤） */
  marked: boolean;
  /** 谁手里有几张（本实现预警里“头像 + 数量”那列） */
  holders?: Array<{ player: string; copies: number }>;
}

/** 单个英雄的池内剩余 */
export function remainingCopies(owned: number, pool: number): number {
  return Math.max(0, pool - Math.max(0, owned));
}

/** 三星需要 9 张；返回还差多少张（已满足则为 0） */
export function neededForThreeStar(owned: number): number {
  return Math.max(0, 9 - Math.max(0, owned));
}

export function canStillThreeStar(owned: number, pool: number): boolean {
  // 已满 9 张（已三星）不再是「还能三星」；只有还差、且池子里补得够才算
  return owned < 9 && owned + remainingCopies(owned, pool) >= 9;
}

export interface AnalyzeOptions {
  /** 只看这些费用（本实现 settings.threeMarkCosts，默认 [4,5]） */
  costs?: number[];
  pool?: PoolConfig;
  /** 名称归一化（本实现对 TFT10_Akali / Rakan+Xayah 有特判） */
  normalizeName?: (name: string) => string;
  /** 分摊到每个玩家（可选；给了就能算出“谁在追”） */
  players?: Array<{ player: string; ownedByName: Record<string, number> }>;
}

/** 实现里的名字特判，抽成可注入的归一化函数 */
export function defaultNormalizeName(raw: string): string {
  let name = raw;
  if (name.includes('TFT10_Akali')) name = 'TFT10_Akali';
  if (name === 'TFT11_RakanBenchDummy' || name === 'TFT11_Rakan' || name === 'TFT11_Xayah') name = 'TFT11_XayahRakanDummy';
  return name;
}

/**
 * 主入口：给「全场副本数」和「英雄表」，算出每个英雄的池状态与追三标记。
 * ownedByName 由 roster.buildSnapshot() 产出。
 */
export function analyzePool(
  ownedByName: Record<string, number>,
  catalog: ChampionCatalogEntry[],
  opts: AnalyzeOptions = {},
): PoolRow[] {
  const pool = opts.pool ?? DEFAULT_POOL;
  const costs = opts.costs ?? [4, 5];
  const normalize = opts.normalizeName ?? defaultNormalizeName;

  // 归一化后合并
  const owned = new Map<string, number>();
  for (const [raw, n] of Object.entries(ownedByName)) {
    const key = normalize(raw);
    owned.set(key, (owned.get(key) ?? 0) + n);
  }

  // 每个玩家各自持有多少（给“谁在追”用；没传就跳过）
  const holdersByKey = new Map<string, Array<{ player: string; copies: number }>>();
  for (const p of opts.players ?? []) {
    for (const [raw, n] of Object.entries(p.ownedByName ?? {})) {
      if (!n || n <= 0) continue;
      const key = normalize(raw);
      const list = holdersByKey.get(key) ?? [];
      const hit = list.find((h) => h.player === p.player);
      if (hit) hit.copies += n;
      else list.push({ player: p.player, copies: n });
      holdersByKey.set(key, list);
    }
  }

  const rows: PoolRow[] = [];
  const seen = new Set<string>();
  for (const entry of catalog) {
    const key = normalize(entry.character_id);
    if (seen.has(key)) continue;
    seen.add(key);
    const cost = (entry.cost ?? 0) as Cost;
    const poolSize = pool.poolByCost[cost] ?? 0;
    if (!poolSize) continue;
    const own = owned.get(key) ?? 0;
    const holders = holdersByKey.get(key);
    const remaining = remainingCopies(own, poolSize);
    // 牌池剩余由全场持有量决定，追三进度由单个玩家决定。
    const candidates = opts.players
      ? (holders ?? []).filter((h) => h.copies < 9 && neededForThreeStar(h.copies) <= remaining)
      : own < 9 && neededForThreeStar(own) <= remaining ? [{ copies: own }] : [];
    const needed = candidates.length ? Math.min(...candidates.map((h) => neededForThreeStar(h.copies))) : 0;
    rows.push({
      champion: key,
      cost: (cost || null) as Cost | null,
      pool: poolSize,
      owned: own,
      remaining,
      neededForThree: needed,
      canThreeStar: needed > 0,
      marked: costs.includes(cost),
      ...(holders?.length ? { holders: holders.sort((a, b) => b.copies - a.copies) } : {}),
    });
  }
  return rows;
}

export interface CardTrackerRow {
  champion: string;
  cost: Cost | null;
  owned: number;
  remaining: number;
}

/**
 * 记牌器：只保留「有剩余、且在追三费用内」的英雄，按剩余张数升序（越少越关键）。
 * 本实现是把数字直接摊在悬浮层的棋盘下方。
 */
export function cardTrackerRows(rows: PoolRow[]): CardTrackerRow[] {
  return rows
    // 只统计「已经有人持有」的英雄：owned=0 的条目只是英雄表里的名字，不是牌局信息
    .filter((r) => r.owned > 0 && r.remaining > 0 && r.marked)
    .map((r) => ({ champion: r.champion, cost: r.cost, owned: r.owned, remaining: r.remaining }))
    .sort((a, b) => a.remaining - b.remaining);
}

/** 三星预警：默认从 6 张开始（原始实现 Se=3），可指定更窄的阈值。 */
export function threeStarWarnings(rows: PoolRow[], threshold = 3): PoolRow[] {
  return rows.filter((r) => r.marked && r.canThreeStar && r.neededForThree > 0 && r.neededForThree <= threshold);
}
