/**
 * MetaTFT 前期棋盘聚类（tft-early-comps）适配层。
 *
 * 线上结构（实测）：
 *   { tft_set, sampleSize, comps_overview: { "stage-2": { stats:{…}, comps:[…] }, "stage-3": …, … } }
 *
 * 阶段整体 matchup_winrate 恒为 0.5；具体棋盘的对战胜率并不恒为 0.5。
 * 这两个粒度必须分开。具体棋盘统计可用于比较过渡表现，不是本局预测胜率。
 */
import rawEarly from '../../data/metatft-early.json';
import { splitList } from './metatft-comps';
import { displayName } from './names';
import { normalizeShopHero } from './shop-mechanics';

export interface EarlyBoard {
  id?:string;
  units: string[];
  battleWinRate?:number;
  matchupCount?:number;
  /** 平均名次（越小越好） */
  avgPlace?: number;
  /** 吃鸡率（线上字段是 final_place_winrate，实测 ≈0.12） */
  winRate?: number;
  count?: number;
}

export interface EarlyStage {
  /** "stage-2" → 2 */
  stage: number;
  sampleSize?: number;
  boards: EarlyBoard[];
}

export interface EarlyCompsFile {
  meta?: { fetchedAt?: string; tft_set?: string; sampleSize?: number };
  sets: Record<string, EarlyStage[]>;
}

const RAW = rawEarly as unknown as EarlyCompsFile;

export function earlyStages(set: number): EarlyStage[] {
  const list = RAW.sets?.[String(set)];
  return Array.isArray(list) ? list : [];
}

export function earlyMeta() {
  return RAW.meta ?? {};
}

/** 解析线上 overview → 阶段数组（纯函数，便于测试） */
export function parseEarlyOverview(input: unknown, limit = 200): EarlyStage[] {
  const root = (input as any)?.comps_overview ?? (input as any);
  if (!root || typeof root !== 'object') return [];
  const out: EarlyStage[] = [];
  for (const [key, val] of Object.entries(root as Record<string, any>)) {
    const m = /^stage-(\d+)$/.exec(key);
    if (!m) continue;
    const stage = Number(m[1]);
    const boards = (Array.isArray(val?.comps) ? val.comps : [])
      .map((c: any) => {
        // 线上 name 是逗号分隔的棋子名（如 `TFT18_Akali,TFT18_Camille`）；单棋子也算
        const rawUnits: unknown[] =
          typeof c?.name === 'string' && c.name.trim()
            ? c.name.split(',').map((s: string) => s.trim())
            : splitList(c?.units_list ?? c?.units);
        const units = [...new Set(rawUnits.map((u) => normalizeShopHero(String(u).trim())).filter(Boolean))];
        // latest_stats is the current patch slice; never fill gaps in this slice from older stats.
        const stats=c?.latest_stats??c?.stats??c;
        const finite=(n:unknown)=>Number.isFinite(Number(n))?Number(n):undefined;
        return {
          id:`early-${stage}-${c?.cluster??units.join('|')}`,
          units,
          avgPlace: finite(stats?.final_place_avg??stats?.avg),
          winRate: finite(stats?.final_place_winrate??stats?.win),
          count: finite(stats?.final_place_count??stats?.count),
          battleWinRate:finite(stats?.matchup_winrate),
          matchupCount:finite(stats?.matchup_count),
        };
      })
      .filter((b: EarlyBoard) => b.units.length)
      .sort((a: EarlyBoard, b: EarlyBoard) => (a.avgPlace ?? 9) - (b.avgPlace ?? 9))
      .slice(0, limit);
    out.push({ stage, sampleSize: Number(val?.stats?.sampleSize ?? val?.sampleSize) || undefined, boards });
  }
  return out.sort((a, b) => a.stage - b.stage);
}

export function boardLabel(units: string[]): string {
  return units.map((u) => displayName(u)).join(' / ');
}
