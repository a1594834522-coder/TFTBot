/**
 * 游戏内处理逻辑（一）：棋子/阵容/血量
 *
 * 逐行约定：
 *   trick-1ce3cda3.js:414-421  tft_roster → 名字拼接、按血量排序、存活计数
 *   trick-1ce3cda3.js:432-449  players_info → 按 level 折算 num（2星=3、3星=9）后同名合并
 * 本实现把这段写死在组件里，这里抽成纯函数：可单测、可复用、可喂假数据回放。
 */
import type { ChampionPlacement, PlayerInfo, RosterEntry } from '../core/events';

export interface AggregatedChampion {
  name: string;
  /** 副本数（2星=3、3星=9，1星=1） */
  copies: number;
  /** 星级集合，用于“有几个三星”这类判断 */
  levels: number[];
  items: string[];
}

export interface RosterPlayer {
  summoner: string;
  tagLine: string;
  /** 显示名：`summoner#tag`（与设计一致） */
  name: string;
  health: number;
  index: number;
  champions: AggregatedChampion[];
  isLocal?: boolean;
  /** 原始事件顺序；不受血量排序影响。 */
  sourceIndex?: number;
  /** 独立棋子及站位，供棋盘使用；champions 仅供统计。 */
  placements?: ChampionPlacement[];
  coverage?: 'full' | 'partial';
}

/** 星级 → 副本数（level == 2 ? 3 : level == 3 ? 9 : level） */
export function copiesFromLevel(level: number | string | undefined): number {
  const lv = typeof level === 'string' ? Number(level) : level;
  if (!lv || Number.isNaN(lv)) return 0;
  if (lv === 2) return 3;
  if (lv === 3) return 9;
  if (lv === 4) return 27;
  return lv >= 1 ? Math.min(lv, 9) : 0;
}

/** 同名棋子合并：copies 相加、levels 去重、装备保留 */
export function aggregateChampions(champs: ChampionPlacement[] | undefined): AggregatedChampion[] {
  const map = new Map<string, AggregatedChampion>();
  for (const c of Array.isArray(champs) ? champs : []) {
    if (!c || !c.name) continue;
    const lv = typeof c.level === 'number' ? c.level : Number(c.level) || 0;
    const copies = c.num != null && Number.isFinite(c.num) ? Math.max(0, c.num) : copiesFromLevel(lv);
    const items = c.items ?? [c.item_1, c.item_2, c.item_3].filter((x): x is string => !!x);
    const cur = map.get(c.name);
    if (cur) {
      cur.copies += copies;
      if (lv && !cur.levels.includes(lv)) cur.levels.push(lv);
      cur.items.push(...items);
    } else {
      map.set(c.name, { name: c.name, copies, levels: lv ? [lv] : [], items });
    }
  }
  return [...map.values()];
}

/** 解析 tft_roster：拼显示名、按血量降序（同血量按 index 降序，与设计一致） */
export function parseRoster(entries: RosterEntry[] | null | undefined): RosterPlayer[] {
  const list = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e === 'object')
    .map((e, i) => {
      const summoner = String(e.summoner ?? '');
      const tagLine = String(e.tag_line ?? '');
      return {
        summoner,
        tagLine,
        name: summoner ? `${summoner}#${tagLine}` : tagLine,
        health: Number(e.health ?? 0),
        index: Number(e.index ?? i),
        sourceIndex: i,
        isLocal: e.is_locale === true || String(e.localplayer) === '1',
        champions: [] as AggregatedChampion[],
      };
    });
  return list.sort((a, b) => (b.health === a.health ? b.index - a.index : b.health - a.health));
}

/** 存活人数（roster.filter(p => p.health > 0).length） */
export function aliveCount(roster: RosterPlayer[]): number {
  return roster.filter((p) => p.health > 0).length;
}

/**
 * 把 players_info 的棋子明细挂到 roster 上。
 * 本实现靠数组顺序隐式对应，这里优先用 `summoner#tag` 精确匹配，匹配不到再按顺序回退。
 */
export function mergeRosterWithPlayers(roster: RosterPlayer[], players: PlayerInfo[] | null | undefined): RosterPlayer[] {
  const list = Array.isArray(players) ? players : [];
  const byName = new Map<string, PlayerInfo>();
  for (const p of list) {
    const key = p.summoner ? `${p.summoner}#${p.tag_line ?? ''}` : p.name ?? '';
    if (key) byName.set(key, p);
  }
  return roster.map((r, i) => {
    const fallback = list[r.sourceIndex ?? i];
    // 有身份的记录不按顺序乱配，避免缺失玩家时把对手棋子挂到我方。
    const match = byName.get(r.name) ?? (fallback && !fallback.summoner && !fallback.name ? fallback : undefined);
    return {
      ...r,
      isLocal: r.isLocal || match?.is_locale === true,
      champions: match ? aggregateChampions(match.champions) : r.champions,
      placements: match?.champions?.map((c) => ({ ...c })),
      ...(match?.coverage ? {coverage:match.coverage} : {}),
    };
  });
}

export interface RosterSnapshot {
  players: RosterPlayer[];
  alive: number;
  /** 全场共有的棋子副本数（记牌器/追三的输入） */
  ownedByName: Record<string, number>;
}

/** 一次事件吃完，直接给出“全场”视图 */
export function buildSnapshot(roster: RosterEntry[] | null, players: PlayerInfo[] | null): RosterSnapshot {
  const merged = mergeRosterWithPlayers(parseRoster(roster), players);
  const ownedByName: Record<string, number> = {};
  for (const p of merged) {
    if (p.health <= 0) continue;
    for (const c of p.champions) ownedByName[c.name] = (ownedByName[c.name] ?? 0) + c.copies;
  }
  return { players: merged, alive: aliveCount(merged), ownedByName };
}
