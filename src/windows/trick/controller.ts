/**
 * trick 窗口控制器 —— 把「游戏事件 → 页面状态」这一层抽出来，独立于 Vue。
 *
 * 本实现 trick 窗口是个 1500 行的组件：事件订阅、快照计算、排序、UI 状态全搅在一起。
 * 这里控制器只做状态机 + 计算，Vue 组件只负责渲染（所以能 SSR 测、能单测、能换框架）。
 */
import type { RosterSnapshot } from '../../game/roster';
import type { PoolRow } from '../../game/cardTracker';
import type { ChampionCatalogEntry, PoolConfig } from '../../game/cardTracker';
import { analyzePool, cardTrackerRows, threeStarWarnings } from '../../game/cardTracker';
import type { ParsedGameEvent } from '../../core/events';
import type { Settings } from '../../core/settings';

/** 控制器只依赖这些能力，便于用假数据测试（真实实现是 tftbotCore） */
export interface TrickCorePort {
  snapshot(): RosterSnapshot | null;
  onGame(handler: (evt: { snapshot?: RosterSnapshot; raw: unknown }) => void): () => void;
}

export interface TrickState {
  alive: number;
  players: RosterSnapshot['players'];
  /** 我方（显式姓名或宿主的 is_locale 标记；未知时不猜测） */
  me: RosterSnapshot['players'][number] | null;
  tracker: ReturnType<typeof cardTrackerRows>;
  warnings: PoolRow[];
  marks: string[];
  /** 最近一次事件 key（调试用） */
  lastEvent: string | null;
  /** 选中棋子（悬浮卡用） */
  selected: string | null;
  /** 是否有数据 */
  ready: boolean;
}

export const EMPTY_TRICK_STATE: TrickState = {
  alive: 0,
  players: [],
  me: null,
  tracker: [],
  warnings: [],
  marks: [],
  lastEvent: null,
  selected: null,
  ready: false,
};

export interface TrickControllerOptions {
  core: TrickCorePort;
  catalog?: ChampionCatalogEntry[];
  getCatalog?: () => ChampionCatalogEntry[];
  getSettings?: () => Settings;
  pool?: PoolConfig;
  normalizeName?: (name: string) => string;
  /** 只看这些费用（默认 [4,5]） */
  costs?: number[];
  /** 我方玩家名（`summoner#tag`）；缺省使用 is_locale */
  meName?: string;
}

export interface TrickController {
  state(): TrickState;
  subscribe(fn: (s: TrickState) => void): () => void;
  select(characterId: string | null): void;
  /** 手动注入一帧快照（回放/测试用） */
  apply(snapshot: RosterSnapshot | null, eventKey?: string): void;
  refresh(): void;
  dispose(): void;
}

export function createTrickController(opts: TrickControllerOptions): TrickController {
  let state: TrickState = { ...EMPTY_TRICK_STATE };
  const listeners = new Set<(s: TrickState) => void>();
  let lastSnapshot = opts.core.snapshot();

  const emit = () => {
    for (const fn of listeners) fn(state);
  };

  const recompute = (snap: RosterSnapshot | null, eventKey?: string | null) => {
    lastSnapshot = snap;
    if (!snap) {
      state = { ...EMPTY_TRICK_STATE, selected: state.selected, lastEvent: eventKey ?? state.lastEvent };
      emit();
      return;
    }
    const settings = opts.getSettings?.();
    const pool = analyzePool(snap.ownedByName, opts.getCatalog?.() ?? opts.catalog ?? [], {
      pool: opts.pool,
      normalizeName: opts.normalizeName,
      costs: settings?.threeMarkCosts ?? opts.costs,
      // 分摊到玩家 → 预警里能显示「谁在追」
      players: snap.players.filter((p) => p.health > 0).map((p) => ({
        player: p.name,
        ownedByName: Object.fromEntries(p.champions.map((c) => [c.name, c.copies])),
      })),
    });
    const me = (opts.meName ? snap.players.find((p) => p.name === opts.meName) : snap.players.find((p) => p.isLocal)) ?? null;
    const warningCosts = settings?.level3Warning.flatMap((enabled, cost) => enabled ? [cost] : []);
    state = {
      ...state,
      ready: true,
      alive: snap.alive,
      players: snap.players,
      me,
      tracker: cardTrackerRows(pool),
      warnings: threeStarWarnings(warningCosts ? pool.map((r) => ({ ...r, marked: warningCosts.includes(r.cost ?? 0) })) : pool),
      marks: pool.filter((r) => r.marked && r.holders?.some((h) =>
        (!settings?.showOnlyMe || h.player === me?.name) && h.copies < 9 && h.copies + r.remaining >= 9,
      )).map((r) => r.champion),
      lastEvent: eventKey ?? state.lastEvent,
    };
    emit();
  };

  const off = opts.core.onGame(({ snapshot, raw }) => {
    const key = (raw as ParsedGameEvent | undefined)?.key ?? null;
    if (snapshot) recompute(snapshot, key);
    else recompute(opts.core.snapshot(), key);
  });

  // 段位查询/窗口初始化期间可能已收到事件，挂载时立即恢复已有快照。
  if (lastSnapshot) recompute(lastSnapshot);

  return {
    state: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    select(id) {
      state = { ...state, selected: id };
      emit();
    },
    apply(snapshot, eventKey) {
      recompute(snapshot, eventKey ?? null);
    },
    refresh() {
      recompute(lastSnapshot ?? opts.core.snapshot());
    },
    dispose() {
      listeners.clear();
      off();
    },
  };
}
