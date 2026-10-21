/**
 * 精简版 background（游戏专用）—— 按 YG 的要求把「和游戏无关的东西」全部拿掉：
 *
 *   删掉：登录/账号/邮箱绑定、功能开关/会员/邀请、Hex 下注与钱包、广告窗口、
 *         录制与回放（OBS）、以及围绕这些的广播命令。
 *   保留：设置、赛季/语言、阵容（我的/置顶）、热键（只留三个显示类）、
 *         游戏数据（英雄/装备/羁绊/段位）、棋盘相关窗口控制，以及同步用的 *Changed 命令。
 *
 * 为什么不是直接把源码文件删掉：完整版 `createBackgroundApp` 仍然是最全的"本实现行为参考"，
 * 精简版是**产品目标**。两者共用同一批 store/service，所以删功能=不注册命令，不用改核心。
 */
import type { Cube, IpcCommand, WindowName } from '../core/cube';
import { createBroker, type Broker } from '../core/broker';
import { createSettingsStore, type SettingsStore } from '../core/settings-store';
import { createCompsStore, type CompsStore } from '../core/comps-store';
import { createHotkeyStore, type HotkeyStore, type HotkeySlot } from '../core/hotkeys';
import { createLcu, type LcuLike } from '../core/lcu';
import { createRankService } from '../core/rank';
import { buildDataset, type TftDataset } from '../game/tft-data';
import { comps as officialComps } from '../game/comps-data';
import { allComps, sourcesFor } from '../game/comps-sources';
import { normalizeSettings, type Settings } from '../core/settings';

/** 精简版实现的命令（= 游戏相关） */
export const LEAN_COMMANDS: IpcCommand[] = [
  // 设置
  'getSettings', 'setSettings', 'settingsChanged',
  // 赛季 / 语言
  'getCurrentSet', 'setCurrentSet', 'currentSetChanged', 'getCurLocale', 'setCurLocale', 'getSupportSets',
  // 阵容
  'getMyTeamComps', 'setMyTeamComps', 'deleteMyTeamComps', 'myTeamCompsChanged',
  'getPinCompsInfo', 'setPinCompsInfo', 'pinCompsChanged',
  // 热键（只保留显示类；录制热键随录制一起删）
  'getShowMainHotkey', 'setShowMainHotkey', 'showMainHotkeyChanged',
  'getShowTrackerHotkey', 'setShowTrackerHotkey', 'showTrackerHotkeyChanged',
  'getshowOverallRecordHotkey', 'setOverallRecordHotkey', 'showOverallRecordHotkeyChanged',
  // 游戏数据
  'getCharacters', 'getItems', 'getTraits', 'getComps', 'getRankData', 'getTFTHighlight', 'setTFTHighlight',
  // 窗口（棋盘相关）
  'showMainPage', 'showOrHideCharacterwin', 'rebuildGameinWindows',
];

/** 精简版**不实现**的命令（显式列出，便于审计"删了什么"） */
export const LEAN_REMOVED: IpcCommand[] = [
  // 账号 / 登录 / 邮箱
  'requireEmailBind', 'requireEmailRegistration', 'requestEmailBindProbe', 'probeEmailBindStatus',
  'summonerIdChanged', 'tftbotMigrationDebug', 'forceLogoutCleanup',
  // 会员 / 邀请（完整版专用）
  'getFeaturesList', 'featureUnlockChanged', 'syncMembershipUpdated', 'getInviteCount', 'setInviteCount',
  // Hex 下注 / 钱包 / 订单
  'getHexStatus', 'getHexOrderStatus', 'setHexOrderStatus', 'getHexOrderRes', 'setHexOrderRes',
  'setHexGamePlayBegan', 'getHexGamePlayBegan', 'syncHexOrderLifecycle', 'resetHexOrderForAccountChange',
  'showHexPredict', 'showHexPredictRecharge', 'showHexPredictAdvancedApply', 'showHexOrderResult',
  'showHexPredictCompactReturn', 'pauseHexmsgFollow', 'getHexArguments', 'getUnitsItems',
  // 广告
  'closeAdWindow', 'setIc', 'icChanged',
  // 录制 / 回放（OBS）
  'getObsState', 'stopObs', 'getVideoEncoders', 'getRecordBaseSetting', 'setRecordBaseSetting',
  'getLiveList', 'setLiveList', 'deleteRecordMedia', 'recordStateChanged', 'recordMediaChanged',
  'getStartRecordHotkey', 'setStartRecordHotkey', 'getStopRecordHotkey', 'setStopRecordHotkey',
  // 只在完整版里才有意义的杂项
  'checkGpuEnable',
];

export interface LeanOptions {
  getOwner?: () => Promise<string> | string;
  dataset?: TftDataset;
  supportSets?: number[];
  initialSet?: number;
  local?: Pick<Storage, 'getItem' | 'setItem'> | null;
  broadcastChanges?: boolean;
}

export interface LeanApp {
  broker: Broker;
  settings: SettingsStore;
  comps: CompsStore;
  hotkeys: HotkeyStore;
  lcu: LcuLike;
  dataset: TftDataset;
  supportSets: number[];
  /** 段位（走 LCU，和游戏相关所以保留） */
  rank: ReturnType<typeof createRankService>;
  commands(): string[];
  /** 精简版里被移除的命令（审计用） */
  removed(): string[];
  currentSet(): number;
  setCurrentSet(set: number): Promise<number>;
  subscribeSet(fn: (set: number) => void): () => void;
  ready(): Promise<{ settings: Settings; set: number }>;
  dispose(): void;
}

const LOCALE_KEY = 'tftbot:locale';
const SET_KEY = 'tftbot:currentSet';
const HIGHLIGHT_KEY = 'tftbot:tftHighlight';

function readSessionOwner(): string {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('tftbot:auth:session') : '';
    if (!raw) return '';
    const s = JSON.parse(raw);
    return String(s?.userUuid ?? '');
  } catch {
    return '';
  }
}

function safeJson(v: any): any {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export function createLeanBackground(cube: Cube, opts: LeanOptions = {}): LeanApp {
  const broker = createBroker(cube);
  const broadcastChanges = opts.broadcastChanges !== false;
  // 精简版不依赖登录态：没有 owner 就用本地命名空间
  const getOwner = opts.getOwner ?? (() => readSessionOwner() || 'local');
  const dataset = opts.dataset ?? buildDataset();

  const settings = createSettingsStore({ cube, getOwner, local: opts.local });
  const comps = createCompsStore({ cube, getOwner, local: opts.local });
  const hotkeys = createHotkeyStore({ cube, getOwner, local: opts.local });
  const lcu = createLcu(cube);
  const rank = createRankService({ lcu });

  let currentSet = dataset.supportSets.at(-1)!;
  let locale = 'zh-CN';
  let highlight: unknown = {};
  const setListeners = new Set<(set: number) => void>();
  const supportedSets = [currentSet];
  if (!supportedSets.includes(currentSet)) currentSet = supportedSets[supportedSets.length - 1] ?? 17;
  const acceptSet = (set: number) => {
    if (!supportedSets.includes(set) || currentSet === set) return;
    currentSet = set;
    for (const fn of setListeners) fn(set);
  };
  const offSync = cube.windows.message.on('received', (command: string, payload: any) => {
    if (command === 'settingsChanged') settings.sync(safeJson(payload));
    if (command === 'currentSetChanged') acceptSet(Number(payload));
  });

  const kv = {
    async get(k: string): Promise<string> {
      try {
        const v = opts.local?.getItem(k);
        if (v) return v;
      } catch {}
      try {
        return (await cube.io.localStorage.getItem(k)) || '';
      } catch {
        return '';
      }
    },
    async set(k: string, v: string) {
      try {
        await cube.io.localStorage.setItem(k, v);
      } catch {}
      try {
        opts.local?.setItem(k, v);
      } catch {}
    },
  };

  const notify = async (command: IpcCommand, payload: any, targets?: WindowName[]) => {
    if (!broadcastChanges) return;
    await broker.broadcast(command, payload, targets);
  };

  const showWindow = async (name: WindowName) => {
    const w = await cube.windows.getWindowByName(name, false).catch(() => null);
    if (w?.id) cube.windows.show(w.id);
    return !!w;
  };

  /* 设置 */
  broker.handle('getSettings', async () => settings.get());
  broker.handle('setSettings', async (payload: any) => {
    const next = await settings.patch(safeJson(payload), { userAction: true });
    await notify('settingsChanged', next);
    return next;
  });
  broker.handle('settingsChanged', async () => {
    const s = settings.get();
    await notify('settingsChanged', s);
    return s;
  });

  /* 赛季 / 语言 */
  const setCurrentSet = async (set: number) => {
    if (supportedSets.includes(set)) {
      acceptSet(set);
      await kv.set(SET_KEY, String(set));
      await notify('currentSetChanged', set);
    }
    return currentSet;
  };
  broker.handle('getSupportSets', async () => supportedSets);
  broker.handle('getCurrentSet', async () => currentSet);
  broker.handle('setCurrentSet', async (payload: any) => {
    return setCurrentSet(Number(payload));
  });
  broker.handle('currentSetChanged', async () => {
    await notify('currentSetChanged', currentSet);
    return currentSet;
  });
  broker.handle('getCurLocale', async () => locale);
  broker.handle('setCurLocale', async (payload: any) => {
    locale = String(payload || locale);
    await kv.set(LOCALE_KEY, locale);
    return locale;
  });

  /* 阵容 */
  broker.handle('getMyTeamComps', async (payload: any) => {
    const set = payload === '' || payload == null ? undefined : Number(payload);
    return comps.list(Number.isFinite(set as number) ? (set as number) : undefined);
  });
  broker.handle('setMyTeamComps', async (payload: any) => {
    const saved = await comps.add(safeJson(payload));
    await notify('myTeamCompsChanged', saved);
    return saved;
  });
  broker.handle('deleteMyTeamComps', async (payload: any) => {
    const id = typeof payload === 'string' ? payload : String(payload?.id ?? '');
    const ok = await comps.remove(id);
    await notify('myTeamCompsChanged', { id, removed: ok });
    return ok;
  });
  broker.handle('myTeamCompsChanged', async () => {
    const list = await comps.list();
    await notify('myTeamCompsChanged', list);
    return list;
  });
  broker.handle('getPinCompsInfo', async () => comps.getPinned());
  broker.handle('setPinCompsInfo', async (payload: any) => {
    const pin = await comps.setPinned(safeJson(payload));
    await notify('pinCompsChanged', pin);
    return pin;
  });
  broker.handle('pinCompsChanged', async () => {
    const pin = await comps.getPinned();
    await notify('pinCompsChanged', pin);
    return pin;
  });

  /* 热键（只留三个显示类） */
  const HOTKEYS: Array<{ get: IpcCommand; set: IpcCommand; changed: IpcCommand; slot: HotkeySlot }> = [
    { get: 'getShowMainHotkey', set: 'setShowMainHotkey', changed: 'showMainHotkeyChanged', slot: 'show_main' },
    { get: 'getShowTrackerHotkey', set: 'setShowTrackerHotkey', changed: 'showTrackerHotkeyChanged', slot: 'show_tracker' },
    { get: 'getshowOverallRecordHotkey', set: 'setOverallRecordHotkey', changed: 'showOverallRecordHotkeyChanged', slot: 'show_overall_record' },
  ];
  for (const h of HOTKEYS) {
    broker.handle(h.get, async () => hotkeys.get(h.slot));
    broker.handle(h.set, async (payload: any) => {
      const next = await hotkeys.set(h.slot, safeJson(payload));
      await notify(h.changed, next);
      return next;
    });
    broker.handle(h.changed, async () => {
      const hk = hotkeys.get(h.slot);
      await notify(h.changed, hk);
      return hk;
    });
  }

  /* 游戏数据 */
  broker.handle('getCharacters', async (payload: any) => dataset.charactersOf(Number(payload) || currentSet));
  broker.handle('getItems', async () => dataset.items);
  broker.handle('getTraits', async () => dataset.traits);
  broker.handle('getComps', async (payload: any) => {
    const p = typeof payload === 'string' ? safeJson(payload) : payload;
    const set = Number(typeof p === 'number' ? p : p?.set ?? 0) || currentSet;
    const title = typeof p === 'object' && p ? p.title : undefined;
    // 显式 source > 设置里的偏好 > 全部
    const source = (typeof p === 'object' && p ? p.source : undefined) ?? settings.get().compsSource ?? 'all';
    return allComps({ set, source, title });
  });
  broker.handle('getRankData', async () => rank.getRankData());
  broker.handle('getTFTHighlight', async () => highlight);
  broker.handle('setTFTHighlight', async (payload: any) => {
    highlight = safeJson(payload) ?? {};
    await kv.set(HIGHLIGHT_KEY, JSON.stringify(highlight));
    return highlight;
  });

  /* 窗口 */
  broker.handle('showMainPage', async () => showWindow('main'));
  broker.handle('showOrHideCharacterwin', async (payload: any) => {
    const show = payload === true || payload === 'true' || safeJson(payload)?.show === true;
    const w = await cube.windows.getWindowByName('characterwin', false).catch(() => null);
    if (w?.id) show ? cube.windows.show(w.id) : cube.windows.hide(w.id);
    return !!w;
  });
  broker.handle('rebuildGameinWindows', async () => {
    for (const name of ['trick', 'tracker'] as WindowName[]) {
      const w = await cube.windows.getWindowByName(name, false).catch(() => null);
      if (w?.id) {
        cube.windows.hide(w.id);
        cube.windows.show(w.id);
      }
    }
    return true;
  });

  return {
    broker,
    settings,
    comps,
    hotkeys,
    lcu,
    dataset,
    supportSets: [...supportedSets],
    rank,
    commands: () => broker.commands(),
    removed: () => [...LEAN_REMOVED],
    currentSet: () => currentSet,
    setCurrentSet,
    subscribeSet(fn) {
      setListeners.add(fn);
      return () => setListeners.delete(fn);
    },
    async ready() {
      const s = await settings.load();
      await hotkeys.load();
      const savedSet = Number(await kv.get(SET_KEY));
      if (opts.initialSet === undefined) acceptSet(savedSet);
      const savedLocale = await kv.get(LOCALE_KEY);
      if (savedLocale) locale = savedLocale;
      const savedHighlight = await kv.get(HIGHLIGHT_KEY);
      if (savedHighlight) highlight = safeJson(savedHighlight);
      return { settings: normalizeSettings(s), set: currentSet };
    },
    dispose() {
      offSync();
      setListeners.clear();
      broker.dispose();
    },
  };
}
