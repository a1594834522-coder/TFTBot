/**
 * tftbot 核心入口
 *
 * 设计目标：把“业务内核”抽成不依赖 Vue / 不依赖页面的纯 TS 包。
 * 产物是一颗 ESM chunk，应用窗口里
 *   <script type="module" src="/assets/tftbot-core.js"></script>
 * 即可直接用；也可以被 Node（测试/工具/回放）import。
 */
export * from './cube';
export * from './events';
export * from './features';
export * from './settings';
export * from './hexapi';
export * from './lcu';
export * from './broker';
export * from './settings-store';
export * from './comps-store';
export * from './feature-service';
export * from '../game/roster';
export * from '../game/cardTracker';
export * from '../game/tft-data';
export * from '../game/comps-data';
export * from '../game/metatft-comps';
export * from '../game/metatft-early';
export * from '../game/metatft-augments';
export * from '../game/current-season';
export * from '../game/names';
export * from '../game/comps-sources';
export * from './metatft';
export * from './hotkeys';
export * from './recorder';
export * from './replay';
export * from '../app/background';
export * from '../app/lean';

import type { Cube } from './cube';
import { HexApiClient } from './hexapi';
import { createLcu, subscribeGameEvents, callBg } from './lcu';
import { normalizeSettings, type Settings } from './settings';
import { parseFeatureUnlockResponse, isFeatureUnlocked, type UnlockPolicy, type FeatureSnapshot } from './features';
import { buildSnapshot, type RosterSnapshot } from '../game/roster';
import { analyzePool, cardTrackerRows, threeStarWarnings, type ChampionCatalogEntry, type PoolConfig } from '../game/cardTracker';

export const VERSION = '0.1.0';

export interface tftbotCoreOptions {
  cube: Cube;
  /** 'server' 完全照本实现；'always' 全部启用 */
  unlockPolicy?: UnlockPolicy;
  pool?: PoolConfig;
  /** 英雄表（主窗口通过 getCharacters 拿到的） */
  catalog?: ChampionCatalogEntry[];
  /** 可注入的接口客户端（测试/回放用；默认 new HexApiClient()） */
  api?: HexApiClient;
  /** 可注入的设置来源（默认走 IPC getSettings） */
  settingsProvider?: () => Promise<Settings>;
}

export interface tftbotCore {
  version: string;
  settings(): Promise<Settings>;
  features(): Promise<FeatureSnapshot>;
  isUnlocked(key: Parameters<typeof isFeatureUnlocked>[1]): Promise<boolean>;
  /** 订阅游戏事件，内部维护 roster 快照 */
  onGame(handler: (evt: { snapshot?: RosterSnapshot; raw: any }) => void): () => void;
  snapshot(): RosterSnapshot | null;
  /** 切换赛季时更新目录，保留当前对局快照。 */
  setCatalog(catalog: ChampionCatalogEntry[]): void;
  /** 记牌器/追三：基于当前快照现算 */
  pool(): ReturnType<typeof analyzePool>;
  cardTracker(): ReturnType<typeof cardTrackerRows>;
  warnings(): ReturnType<typeof threeStarWarnings>;
  lcu: ReturnType<typeof createLcu>;
  api: HexApiClient;
  /** 停止所有订阅 */
  dispose(): void;
}

/**
 * 在窗口里装配核心。会订阅 update-info 并自动把 roster / players_info 合成快照。
 */
export function createCore(opts: tftbotCoreOptions): tftbotCore {
  const { cube, unlockPolicy = 'server' } = opts;
  const api = opts.api ?? new HexApiClient();
  const lcu = createLcu(cube);
  let snap: RosterSnapshot | null = null;
  let lastRoster: any[] | null = null;
  let lastPlayers: any[] | null = null;
  let catalog = opts.catalog ?? [];
  const offs: Array<() => void> = [];
  const handlers = new Set<(e: { snapshot?: RosterSnapshot; raw: any }) => void>();

  const off = subscribeGameEvents(cube, (evt) => {
    if (evt.key === 'tft_roster') {
      lastRoster = evt.data as any[];
      if (!lastRoster.length) lastPlayers = null;
    }
    if (evt.key === 'players_info') lastPlayers = evt.data as any[];
    if (lastRoster) snap = buildSnapshot(lastRoster, lastPlayers);
    for (const h of handlers) h({ snapshot: snap ?? undefined, raw: evt });
  });
  offs.push(off);

  const settingsProvider = opts.settingsProvider;
  let featureCache: FeatureSnapshot | null = null;

  return {
    version: VERSION,
    async settings() {
      if (settingsProvider) return normalizeSettings(await settingsProvider());
      const raw = await callBg<Partial<Settings>>(cube, 'getSettings');
      return normalizeSettings(raw);
    },
    async features() {
      if (featureCache) return featureCache;
      const res = await api.featureUnlockStatus().catch(() => null);
      featureCache = parseFeatureUnlockResponse(res?.code === 200 ? res.data : null, unlockPolicy);
      return featureCache;
    },
    async isUnlocked(key) {
      // 全部启用策略下不需要打网络：少一次 RTT，也避免离线时被误判
      if (unlockPolicy === 'always') return true;
      const snap = await this.features();
      return isFeatureUnlocked(snap.features, key, unlockPolicy);
    },
    onGame(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    snapshot: () => snap,
    setCatalog(next) { catalog = next; },
    pool: () => analyzePool(snap?.ownedByName ?? {}, catalog, {
      pool: opts.pool,
      players: snap?.players.filter((p) => p.health > 0).map((p) => ({
        player: p.name,
        ownedByName: Object.fromEntries(p.champions.map((c) => [c.name, c.copies])),
      })) ?? [],
    }),
    cardTracker() {
      return cardTrackerRows(this.pool());
    },
    warnings() {
      return threeStarWarnings(this.pool());
    },
    lcu,
    api,
    dispose() {
      for (const f of offs) f();
      handlers.clear();
    },
  };
}
