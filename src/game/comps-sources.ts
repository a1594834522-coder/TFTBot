/**
 * 阵容数据源注册表 —— 把「内嵌快照」和「MetaTFT 快照」合成一个可查询的接口。
 *
 * 数据源：
 *   official  内嵌官网阵容（comps.json，数字 id）
 *   blitz     内嵌 blitz 聚类（comps.json，trait:/unit: 串 id）
 *   metatft   MetaTFT 聚类（metatft-comps.json，由 `npm run metatft:sync` 生成）
 *
 * 设计：只做「读取 + 合并 + 过滤」，不做网络请求 —— 运行时永远离线可用；
 *       在线拉取在 scripts/metatft-sync.mjs 里，产物是普通 JSON。
 */
import rawMetatft from '../../data/metatft-comps.json';
import type { OfficialComp, CompGroup } from './comps-data';
import { comps as bundled } from './comps-data';
import type { MetatftComp, MetatftCompsFile } from './metatft-comps';

export type CompsSource = 'official' | 'blitz' | 'metatft';

export interface SourceInfo {
  id: CompsSource;
  label: string;
  /** 该源在某个赛季的阵容数 */
  count(set: number): number;
  /** 该源是否已就绪（空快照 = 未就绪） */
  ready(set: number): boolean;
}

export interface CompsQuery {
  set: number;
  source?: CompsSource | 'all';
  title?: string;
  limit?: number;
}

const METATFT = rawMetatft as unknown as MetatftCompsFile;

export function sourceOfComp(comp: OfficialComp): CompsSource {
  if ((comp as MetatftComp).source === 'metatft') return 'metatft';
  return String(comp.id).startsWith('trait:') ? 'blitz' : 'official';
}

/** 各赛季可用的 MetaTFT 阵容 */
export function metatftComps(set: number): MetatftComp[] {
  const list = METATFT.sets?.[String(set)];
  return Array.isArray(list) ? (list as MetatftComp[]) : [];
}

export function metatftMeta() {
  return METATFT.meta ?? {};
}

/** 合并后的分组：官方两源来自 comps-data 的 group，MetaTFT 作为额外一组 */
export function groupsOf(set: number): CompGroup[] {
  const base = bundled.groups(set);
  const mt = metatftComps(set);
  return mt.length ? [...base, { title: 'MetaTFT', type: 'metatft', comps: mt }] : base;
}

/** 合并查询（UI/getComps 的统一入口） */
export function allComps(query: CompsQuery): OfficialComp[] {
  const { set, source = 'all', title, limit } = query;
  let list: OfficialComp[] = [];
  if (source === 'metatft') list = metatftComps(set);
  else if (source === 'official') list = bundled.comps(set, '官网阵容');
  else if (source === 'blitz') list = bundled.comps(set, 'blitz');
  else list = [...bundled.comps(set), ...metatftComps(set)];

  if (title) {
    const t = title.trim();
    const bySource = t === 'MetaTFT' ? 'metatft' : t === '官网阵容' ? 'official' : t === 'blitz' ? 'blitz' : null;
    list = bySource ? list.filter((c) => sourceOfComp(c) === bySource) : list.filter((c) => c.name.includes(t));
  }
  return typeof limit === 'number' && limit > 0 ? list.slice(0, limit) : list;
}

export const SOURCES: SourceInfo[] = [
  {
    id: 'official',
    label: '官网阵容',
    count: (set) => bundled.comps(set, '官网阵容').length,
    ready: (set) => bundled.comps(set, '官网阵容').length > 0,
  },
  {
    id: 'blitz',
    label: 'blitz',
    count: (set) => bundled.comps(set, 'blitz').length,
    ready: (set) => bundled.comps(set, 'blitz').length > 0,
  },
  {
    id: 'metatft',
    label: 'MetaTFT',
    count: (set) => metatftComps(set).length,
    ready: (set) => metatftComps(set).length > 0,
  },
];

export function sourcesFor(set: number) {
  return SOURCES.map((s) => ({ id: s.id, label: s.label, count: s.count(set), ready: s.ready(set) }));
}

/** 按英雄反查（跨源） */
export function byChampionAll(set: number, characterId: string): OfficialComp[] {
  return allComps({ set })
    .filter((c) => c.units.some((u) => u.character_id === characterId))
    .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99));
}
