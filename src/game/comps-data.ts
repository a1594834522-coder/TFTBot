/**
 * 官方阵容数据（getComps）—— 从 background 里抽出来的真实数据（见 port/extract-comps.mjs）。
 *
 * 结构（本实现原样保留）：
 *   分组 { title: '官网阵容' | 'blitz', comps: [...] }
 *   阵容 { id, name, units[{character_id, level, items, position}], early_units, synergy[], play_tags[], tier }
 *
 * 仅保留最新赛季：S18 = 33 官网 + 48 Blitz；MetaTFT 在数据源注册表合并。
 */
import raw from '../../data/comps.json';

export interface CompUnit {
  character_id: string;
  level?: number;
  items?: string[];
  position?: number;
  chosen?: boolean;
}

export interface CompSynergy {
  trait_id: string;
  count: number;
  rank?: string;
}

export interface OfficialComp {
  /** 官网阵容是数字 id，blitz 是 `trait:...,unit:...,tag:...` 串 */
  id: string | number;
  name: string;
  units: CompUnit[];
  early_units?: CompUnit[];
  synergy?: CompSynergy[];
  play_tags?: string[];
  augments?: Array<string | { name?: string }>;
  replacements?: Array<{ out: string[]; in: string[] }>;
  tier?: number;
}

export interface CompGroup {
  title: string;
  type?: string;
  comps: OfficialComp[];
}

export interface RawComps {
  sets: Record<string, CompGroup[]>;
}

const RAW = raw as unknown as RawComps;

export interface CompsDataset {
  sets: Record<number, CompGroup[]>;
  supportSets: number[];
  groups(set: number): CompGroup[];
  /** 某赛季全部阵容；可按分组标题过滤 */
  comps(set: number, title?: string): OfficialComp[];
  comp(set: number, id: string | number): OfficialComp | undefined;
  /** 含某英雄的阵容（按 tier 升序，tier 小的更主流） */
  byChampion(set: number, characterId: string): OfficialComp[];
  /** 阵容的平均费用（用于筛选） */
  costOf(set: number, comp: OfficialComp, costOfChampion: (id: string) => number | undefined): number;
}

export function buildCompsDataset(input: RawComps = RAW): CompsDataset {
  const sets: Record<number, CompGroup[]> = {};
  for (const [k, groups] of Object.entries(input.sets ?? {})) sets[Number(k)] = groups;
  const supportSets = Object.keys(sets)
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  const allOf = (set: number, title?: string) => {
    const groups = sets[set] ?? [];
    const picked = title ? groups.filter((g) => g.title === title) : groups;
    return picked.flatMap((g) => g.comps);
  };

  return {
    sets,
    supportSets,
    groups: (set) => sets[set] ?? [],
    comps: (set, title) => allOf(set, title),
    comp(set, id) {
      return allOf(set).find((c) => String(c.id) === String(id));
    },
    byChampion(set, characterId) {
      return allOf(set)
        .filter((c) => c.units.some((u) => u.character_id === characterId))
        .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99));
    },
    costOf(set, comp, costOfChampion) {
      const costs = comp.units.map((u) => costOfChampion(u.character_id)).filter((n): n is number => typeof n === 'number' && n > 0);
      if (!costs.length) return 0;
      return Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 10) / 10;
    },
  };
}

export const comps: CompsDataset = buildCompsDataset();
export { RAW as rawComps };
