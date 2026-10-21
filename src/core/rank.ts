/**
 * 段位数据（getRankData）—— 本实现从 LCU 取当前账号的排位信息。
 *
 * LCU 接口：
 *   GET /lol-ranked/v1/current-ranked-stats  → { queueMap: { RANKED_TFT: { tier, division, leaguePoints, wins, losses } } }
 *   GET /lol-summoner/v1/current-summoner    → 名称/等级（可选，做展示用）
 *
 * 本实现把这段塞在 background 的巨型 handler 里，且没有失败兜底（LCU 没起来就抛）。
 * 这里：可注入 lcu、失败回空数组、tier 归一化、算胜率。
 */
import type { LcuLike } from './lcu';

export const RANK_ENDPOINTS = {
  rankedStats: '/lol-ranked/v1/current-ranked-stats',
  summoner: '/lol-summoner/v1/current-summoner',
} as const;

export interface RankEntryView {
  /** 队列：RANKED_TFT / RANKED_TFT_DOUBLE_UP / RANKED_SOLO_5x5 … */
  queue: string;
  /** 大段：IRON/BRONZE/SILVER/GOLD/PLATINUM/EMERALD/DIAMOND/MASTER/GRANDMASTER/CHALLENGER/UNRANKED */
  tier: string;
  /** 小段：I…IV（大师以上为空） */
  division: string;
  lp: number;
  wins: number;
  losses: number;
  /** 0..1，保留三位小数；无对局为 0 */
  winRate: number;
  /** 展示串，例如 GOLD II 45LP */
  label: string;
}

const TIER_LABEL: Record<string, string> = {
  IRON: '黑铁',
  BRONZE: '青铜',
  SILVER: '白银',
  GOLD: '黄金',
  PLATINUM: '铂金',
  EMERALD: '翡翠',
  DIAMOND: '钻石',
  MASTER: '大师',
  GRANDMASTER: '宗师',
  CHALLENGER: '王者',
  UNRANKED: '未定级',
};

/** LCU 有时给 "VI" 这种罗马数字反序，统一成 I..IV */
export function normalizeDivision(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase();
  const map: Record<string, string> = { VI: 'IV', IV: 'IV', III: 'III', II: 'II', I: 'I', V: 'V' };
  return map[s] ?? '';
}

export function formatRankLabel(e: Pick<RankEntryView, 'tier' | 'division' | 'lp'>): string {
  const name = TIER_LABEL[e.tier] ?? e.tier;
  if (!e.division || ['MASTER', 'GRANDMASTER', 'CHALLENGER', 'UNRANKED'].includes(e.tier)) return `${name} ${e.lp}LP`;
  return `${name} ${e.division} ${e.lp}LP`;
}

/** 把 LCU 的 queueMap 拍平成数组 */
export function parseRankedStats(raw: any): RankEntryView[] {
  const map = raw?.queueMap;
  if (!map || typeof map !== 'object') return [];
  const out: RankEntryView[] = [];
  for (const [queue, v] of Object.entries<any>(map)) {
    if (!v) continue;
    const tier = String(v.tier ?? 'UNRANKED').toUpperCase();
    const division = normalizeDivision(v.division);
    const lp = Number(v.leaguePoints ?? 0) || 0;
    const wins = Number(v.wins ?? 0) || 0;
    const losses = Number(v.losses ?? 0) || 0;
    const total = wins + losses;
    out.push({
      queue,
      tier,
      division,
      lp,
      wins,
      losses,
      winRate: total ? Math.round((wins / total) * 1000) / 1000 : 0,
      label: formatRankLabel({ tier, division, lp }),
    });
  }
  return out.sort((a, b) => b.lp - a.lp);
}

export interface RankService {
  getRankData(): Promise<RankEntryView[]>;
  /** 只取 TFT 队列 */
  getTftRank(): Promise<RankEntryView | null>;
}

export function createRankService(deps: { lcu: LcuLike }): RankService {
  let cache: { at: number; data: RankEntryView[] } | null = null;
  const ttl = 30_000;

  async function fetchOnce(): Promise<RankEntryView[]> {
    const res = await deps.lcu.invoke('get', RANK_ENDPOINTS.rankedStats).catch(() => null);
    const data = parseRankedStats(res);
    if (data.length) return data;
    // 兼容某些 LCU 版本：直接返回单队列对象
    if (res && typeof res === 'object' && (res as any).tier) return parseRankedStats({ queueMap: { RANKED_TFT: res } });
    return [];
  }

  return {
    async getRankData() {
      const now = Date.now();
      if (cache && now - cache.at < ttl) return cache.data;
      const data = await fetchOnce();
      cache = { at: now, data };
      return data;
    },
    async getTftRank() {
      const all = await this.getRankData();
      return all.find((r) => r.queue === 'RANKED_TFT') ?? all[0] ?? null;
    },
  };
}
