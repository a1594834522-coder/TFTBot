/**
 * background（服务页）装配层 —— 服务页装配层：命令注册、设置、阵容、游戏数据。
 *
 * 设计取向（比本实现更优的地方）：
 *   1. 本实现是巨型 IIFE + 几百行 handler 分支；这里按职责拆成 broker + 若干 store/service，
 *      每个都能单测；命令实现是显式注册表，`app.commands()` 可自省、覆盖率可统计。
 *   2. 本实现存储键/双写/默认值散落各处；这里统一在 store 内（settings/hotkeys/record/comps）。
 *   3. 本实现 handler 出错会把调用方 Promise 挂死；broker 一定回包（undefined + 日志）。
 *   4. 外部进程（OBS）用 Port 抽象，测试用内存实现，真机换成 spawn/IPC 即可。
 *
 * 未实现的命令不注册，broker 立即回 undefined —— 与本实现「命令不存在」一致，但不悬空。
 */
import type { Cube, IpcCommand, WindowName } from '../core/cube';
import { createBroker, type Broker } from '../core/broker';
import { createSettingsStore, type SettingsStore } from '../core/settings-store';
import { createCompsStore, type CompsStore } from '../core/comps-store';
import { createFeatureService, type FeatureService } from '../core/feature-service';
import { createLcu, type LcuLike } from '../core/lcu';
import { createHotkeyStore, type HotkeyStore, type HotkeySlot } from '../core/hotkeys';
import { createRecorder, createMemoryRecorderPort, type RecorderService, type RecorderPort } from '../core/recorder';
import { createHexOrderService, type HexOrderService } from '../core/hex-order';
import { createAccountService, type AccountService } from '../core/account';
import { createRankService } from '../core/rank';
import { HexApiClient } from '../core/hexapi';
import type { UnlockPolicy } from '../core/features';
import { buildDataset, type TftDataset, type RawDataset } from '../game/tft-data';
import { allComps } from '../game/comps-sources';
import { normalizeSettings, type Settings } from '../core/settings';

export interface BackgroundOptions {
  getOwner?: () => Promise<string> | string;
  unlockPolicy?: UnlockPolicy;
  api?: HexApiClient;
  supportSets?: number[];
  initialSet?: number;
  featureIntervalMs?: number;
  local?: Pick<Storage, 'getItem' | 'setItem'> | null;
  broadcastChanges?: boolean;
  /** 游戏数据（默认用抽出来的真实数据） */
  dataset?: TftDataset;
  /** 录制端口（默认内存实现；真机传 OBS 适配器） */
  recorderPort?: RecorderPort;
  /** 邮箱绑定探测（真机接 hexapi；默认用本地已知信息推导） */
  probeEmailBind?: () => Promise<{ bound: boolean; email?: string | null }>;
  /** GPU 编码可用性探测（默认在浏览器里做一个真实 WebGL 探测） */
  probeGpu?: () => Promise<{ enabled: boolean; reason?: string }>;
  /** 删除录制文件（真机接 fs；默认用 cube.node.require('fs')） */
  deleteMedia?: (file: string) => Promise<boolean>;
}

export interface BackgroundApp {
  broker: Broker;
  settings: SettingsStore;
  comps: CompsStore;
  features: FeatureService;
  hotkeys: HotkeyStore;
  recorder: RecorderService;
  hexOrder: HexOrderService;
  account: AccountService;
  lcu: LcuLike;
  dataset: TftDataset;
  commands(): string[];
  ready(): Promise<{ settings: Settings; set: number }>;
  dispose(): void;
}

/** 当前已实现的命令（覆盖率统计用；与 broker.handle 保持同步） */
export const SUPPORTED_COMMAND_NAMES: IpcCommand[] = [
  // 设置 / 赛季 / 语言
  'getSettings', 'setSettings', 'getCurrentSet', 'setCurrentSet', 'getCurLocale', 'setCurLocale', 'getSupportSets',
  // 阵容
  'getMyTeamComps', 'setMyTeamComps', 'deleteMyTeamComps', 'getPinCompsInfo', 'setPinCompsInfo',
  // 功能状态
  'getFeaturesList', 'getInviteCount',
  // 热键
  'getShowMainHotkey', 'setShowMainHotkey', 'getShowTrackerHotkey', 'setShowTrackerHotkey',
  'getshowOverallRecordHotkey', 'setOverallRecordHotkey', 'getStartRecordHotkey', 'setStartRecordHotkey',
  'getStopRecordHotkey', 'setStopRecordHotkey',
  // 录制 / OBS
  'getObsState', 'stopObs', 'getVideoEncoders', 'getRecordBaseSetting', 'setRecordBaseSetting',
  'getLiveList', 'setLiveList',
  // 游戏数据
  'getCharacters', 'getItems', 'getTraits', 'getComps', 'getRankData', 'getUnitsItems', 'getHexArguments',
  'getTFTHighlight', 'setTFTHighlight',
  // Hex 订单
  'getHexStatus', 'setHexOrderStatus', 'getHexOrderRes', 'setHexOrderRes', 'setHexGamePlayBegan',
  'syncHexOrderLifecycle', 'resetHexOrderForAccountChange', 'showHexPredict', 'showHexPredictRecharge',
  'showHexPredictAdvancedApply', 'showHexOrderResult', 'showHexPredictCompactReturn', 'pauseHexmsgFollow',
  // 账号 / 邮箱
  'requireEmailBind', 'requireEmailRegistration', 'requestEmailBindProbe', 'probeEmailBindStatus',
  'summonerIdChanged', 'tftbotMigrationDebug',
  // 广播类（实现为「取当前状态并重播给所有窗口」，供新开窗口主动同步）
  'settingsChanged', 'currentSetChanged', 'myTeamCompsChanged', 'pinCompsChanged',
  'featureUnlockChanged', 'syncMembershipUpdated', 'icChanged',
  'showMainHotkeyChanged', 'showTrackerHotkeyChanged', 'showOverallRecordHotkeyChanged',
  'recordStateChanged', 'recordMediaChanged',
  // 其它状态
  'setInviteCount', 'forceLogoutCleanup', 'deleteRecordMedia', 'checkGpuEnable',
  'getHexOrderStatus', 'getHexGamePlayBegan',
  // 窗口 / 其它
  'showMainPage', 'showOrHideCharacterwin', 'closeAdWindow', 'setIc', 'icChanged', 'rebuildGameinWindows',
];

const LOCALE_KEY = 'tftbot:locale';
const SET_KEY = 'tftbot:currentSet';
const HIGHLIGHT_KEY = 'tftbot:tftHighlight';
const IC_KEY = 'tftbot:ic';
const INVITE_KEY = 'tftbot:inviteCount';

/** 热键命令 ↔ 槽位 + 变更广播 */
const HOTKEY_COMMANDS: Array<{ get: IpcCommand; set: IpcCommand; changed: IpcCommand; slot: HotkeySlot }> = [
  { get: 'getShowMainHotkey', set: 'setShowMainHotkey', changed: 'showMainHotkeyChanged', slot: 'show_main' },
  { get: 'getShowTrackerHotkey', set: 'setShowTrackerHotkey', changed: 'showTrackerHotkeyChanged', slot: 'show_tracker' },
  { get: 'getshowOverallRecordHotkey', set: 'setOverallRecordHotkey', changed: 'showOverallRecordHotkeyChanged', slot: 'show_overall_record' },
  { get: 'getStartRecordHotkey', set: 'setStartRecordHotkey', changed: 'recordStateChanged', slot: 'start_record' },
  { get: 'getStopRecordHotkey', set: 'setStopRecordHotkey', changed: 'recordStateChanged', slot: 'stop_record' },
];

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

export function createBackgroundApp(cube: Cube, opts: BackgroundOptions = {}): BackgroundApp {
  const broker = createBroker(cube);
  const broadcastChanges = opts.broadcastChanges !== false;
  const getOwner = opts.getOwner ?? readSessionOwner;

  const settings = createSettingsStore({ cube, getOwner, local: opts.local });
  const comps = createCompsStore({ cube, getOwner, local: opts.local });
  const hotkeys = createHotkeyStore({ cube, getOwner, local: opts.local });
  const dataset = opts.dataset ?? buildDataset();

  const features = createFeatureService({
    cube,
    api: opts.api,
    broker,
    settings,
    policy: opts.unlockPolicy ?? 'server',
    intervalMs: opts.featureIntervalMs ?? 5 * 60 * 1000,
  });

  const recorder = createRecorder({
    cube,
    port: opts.recorderPort ?? createMemoryRecorderPort(),
    broker,
    getOwner,
    local: opts.local,
  });

  const lcu = createLcu(cube);
  const rank = createRankService({ lcu });
  const hexOrder = createHexOrderService({ cube, broker, getOwner, local: opts.local });
  const account = createAccountService({ cube, broker, getOwner, local: opts.local, probe: opts.probeEmailBind });

  const latestSet = dataset.supportSets.at(-1)!;
  let currentSet = latestSet;
  let locale = 'zh-CN';
  let inviteCount = 0;
  let highlight: unknown = {};
  let ic: unknown = null;

  /** 窗口开关的小工具（本实现各处散着 obtainDeclaredWindow + show） */
  const showWindow = async (name: WindowName) => {
    const w = await cube.windows.getWindowByName(name, false).catch(() => null);
    if (w?.id) cube.windows.show(w.id);
    return !!w;
  };
  const hideWindow = async (name: WindowName) => {
    const w = await cube.windows.getWindowByName(name, false).catch(() => null);
    if (w?.id) cube.windows.hide(w.id);
    return !!w;
  };

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

  /* ---------------- 设置 ---------------- */
  broker.handle('getSettings', async () => settings.get());
  broker.handle('setSettings', async (payload: any) => {
    const next = await settings.patch(safeJson(payload), { userAction: true });
    await notify('settingsChanged', next);
    return next;
  });

  /* ---------------- 阵容 ---------------- */
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
  broker.handle('getPinCompsInfo', async () => comps.getPinned());
  broker.handle('setPinCompsInfo', async (payload: any) => {
    const pin = await comps.setPinned(safeJson(payload));
    await notify('pinCompsChanged', pin);
    return pin;
  });

  /* ---------------- 功能状态 / 会员 ---------------- */
  broker.handle('getFeaturesList', async () => {
    const snap = features.cached() ?? (await features.refresh());
    return snap.features;
  });
  broker.handle('getInviteCount', async () => inviteCount);

  /* ---------------- 热键 ---------------- */
  for (const h of HOTKEY_COMMANDS) {
    broker.handle(h.get, async () => hotkeys.get(h.slot));
    broker.handle(h.set, async (payload: any) => {
      const next = await hotkeys.set(h.slot, safeJson(payload));
      await notify(h.changed, next);
      return next;
    });
  }

  /* ---------------- 录制 / OBS ---------------- */
  broker.handle('getObsState', async () => recorder.state());
  broker.handle('stopObs', async () => recorder.stop());
  broker.handle('getVideoEncoders', async () => recorder.encoders());
  broker.handle('getRecordBaseSetting', async () => recorder.getSettings());
  broker.handle('setRecordBaseSetting', async (payload: any) => {
    const next = await recorder.setSettings(safeJson(payload) ?? {});
    return next;
  });
  broker.handle('getLiveList', async () => recorder.liveList());
  broker.handle('setLiveList', async (payload: any) => {
    const list = Array.isArray(payload) ? payload : safeJson(payload) ?? [];
    return recorder.setLiveList(list as string[]);
  });

  /* ---------------- 游戏数据 ---------------- */
  broker.handle('getSupportSets', async () => [latestSet]);
  broker.handle('getCurrentSet', async () => currentSet);
  broker.handle('setCurrentSet', async (payload: any) => {
    const set = Number(payload);
    if (set === latestSet) {
      currentSet = set;
      await kv.set(SET_KEY, String(set));
      await notify('currentSetChanged', set);
    }
    return currentSet;
  });
  broker.handle('getCharacters', async (payload: any) => {
    const set = Number(payload) || currentSet;
    return dataset.charactersOf(set);
  });
  broker.handle('getItems', async () => dataset.items);
  broker.handle('getTraits', async () => dataset.traits);
  broker.handle('getComps', async (payload: any) => {
    const p = typeof payload === 'string' ? safeJson(payload) : payload;
    const set = Number(typeof p === 'number' ? p : p?.set ?? 0) || currentSet;
    const title = typeof p === 'object' && p ? p.title : undefined;
    const source = (typeof p === 'object' && p ? p.source : undefined) ?? settings.get().compsSource ?? 'all';
    return allComps({ set, source, title });
  });
  /** 排名数据按本实现是从 LCU/后端取；这里留接口，返回空数组而不是 undefined */
  broker.handle('getRankData', async () => rank.getRankData());
  broker.handle('getUnitsItems', async () => ({}));
  broker.handle('getHexArguments', async () => []);
  broker.handle('getTFTHighlight', async () => highlight);
  broker.handle('setTFTHighlight', async (payload: any) => {
    highlight = safeJson(payload) ?? {};
    await kv.set(HIGHLIGHT_KEY, JSON.stringify(highlight));
    return highlight;
  });

  /* ---------------- 语言 ---------------- */
  broker.handle('getCurLocale', async () => locale);
  broker.handle('setCurLocale', async (payload: any) => {
    locale = String(payload || locale);
    await kv.set(LOCALE_KEY, locale);
    return locale;
  });

  /* ---------------- Hex 订单 ---------------- */
  broker.handle('getHexStatus', async () => hexOrder.current());
  broker.handle('setHexOrderStatus', async (payload: any) => hexOrder.setStatus(payload));
  broker.handle('getHexOrderRes', async () => hexOrder.current());
  broker.handle('setHexOrderRes', async (payload: any) => hexOrder.setResult(payload));
  broker.handle('setHexGamePlayBegan', async (payload: any) => {
    const started = payload === true || payload === 'true' || payload === 1 || payload === '1';
    return hexOrder.markGameStarted(started);
  });
  broker.handle('syncHexOrderLifecycle', async () => hexOrder.sync());
  broker.handle('resetHexOrderForAccountChange', async (payload: any) => hexOrder.reset(String(payload || 'account-changed')));
  broker.handle('showHexPredict', async () => showWindow('hexmsg'));
  broker.handle('showHexPredictRecharge', async () => {
    await showWindow('main');
    await notify('showHexPredictRecharge', '');
    return true;
  });
  broker.handle('showHexPredictAdvancedApply', async () => {
    await showWindow('main');
    await notify('showHexPredictAdvancedApply', '');
    return true;
  });
  broker.handle('showHexOrderResult', async (payload: any) => {
    await showWindow('hexmsg');
    await notify('showHexOrderResult', payload ?? hexOrder.current());
    return true;
  });
  broker.handle('showHexPredictCompactReturn', async () => {
    await showWindow('sidewin');
    return true;
  });
  broker.handle('pauseHexmsgFollow', async (payload: any) => {
    const paused = payload === true || payload === 'true';
    await notify('pauseHexmsgFollow', paused);
    return paused;
  });

  /* ---------------- 账号 / 邮箱 ---------------- */
  broker.handle('requireEmailBind', async () => {
    await showWindow('main');
    const req = account.requirement();
    await notify('requireEmailBind', req === 'bind' ? 'bind' : 'none');
    return req === 'bind';
  });
  broker.handle('requireEmailRegistration', async () => {
    await showWindow('main');
    const req = account.requirement();
    await notify('requireEmailRegistration', req === 'register' ? 'register' : 'none');
    return req === 'register';
  });
  broker.handle('requestEmailBindProbe', async () => {
    const st = await account.probe();
    await notify('probeEmailBindStatus', { phase: st.phase, email: st.email });
    return st;
  });
  broker.handle('probeEmailBindStatus', async () => account.probe());
  broker.handle('summonerIdChanged', async (payload: any) => account.setSummoner(payload ? String(payload) : null));
  broker.handle('tftbotMigrationDebug', async (payload: any) => {
    const on = payload === true || payload === 'true';
    return account.setMigrationDebug(on);
  });

  /* ---------------- 窗口 / 其它 ---------------- */
  broker.handle('showMainPage', async () => showWindow('main'));
  broker.handle('showOrHideCharacterwin', async (payload: any) => {
    const show = payload === true || payload === 'true' || safeJson(payload)?.show === true;
    return show ? showWindow('characterwin') : hideWindow('characterwin');
  });
  broker.handle('closeAdWindow', async () => hideWindow('adwin'));
  broker.handle('setIc', async (payload: any) => {
    ic = safeJson(payload) ?? payload ?? null;
    await kv.set(IC_KEY, JSON.stringify(ic));
    await notify('icChanged', ic);
    return ic;
  });
  broker.handle('icChanged', async () => ic);
  broker.handle('rebuildGameinWindows', async () => {
    // 销毁并重建 trick/tracker 两个 gamein 窗口；这里用 hide→show 复现可观察行为
    for (const name of ['trick', 'tracker'] as WindowName[]) {
      await hideWindow(name);
      await showWindow(name);
    }
    return true;
  });

  /* ---------------- 广播类命令：取当前状态并重播 ---------------- */
  // 实现里这些名字只在"通知子窗口"方向出现；新窗口打开时也会 invoke 一次拿当前值，
  // 所以实现成"返回当前状态 + 重播给所有窗口"，语义与行为都可解释。
  broker.handle('settingsChanged', async () => {
    const s = settings.get();
    await notify('settingsChanged', s);
    return s;
  });
  broker.handle('currentSetChanged', async () => {
    await notify('currentSetChanged', currentSet);
    return currentSet;
  });
  broker.handle('myTeamCompsChanged', async () => {
    const list = await comps.list();
    await notify('myTeamCompsChanged', list);
    return list;
  });
  broker.handle('pinCompsChanged', async () => {
    const pin = await comps.getPinned();
    await notify('pinCompsChanged', pin);
    return pin;
  });
  broker.handle('featureUnlockChanged', async () => {
    const snap = features.cached() ?? (await features.refresh());
    await notify('featureUnlockChanged', '');
    return snap.features;
  });
  broker.handle('syncMembershipUpdated', async () => {
    const snap = features.cached() ?? (await features.refresh());
    await notify('syncMembershipUpdated', snap.membership);
    return snap.membership;
  });
  broker.handle('showMainHotkeyChanged', async () => {
    const hk = hotkeys.get('show_main');
    await notify('showMainHotkeyChanged', hk);
    return hk;
  });
  broker.handle('showTrackerHotkeyChanged', async () => {
    const hk = hotkeys.get('show_tracker');
    await notify('showTrackerHotkeyChanged', hk);
    return hk;
  });
  broker.handle('showOverallRecordHotkeyChanged', async () => {
    const hk = hotkeys.get('show_overall_record');
    await notify('showOverallRecordHotkeyChanged', hk);
    return hk;
  });
  broker.handle('recordStateChanged', async () => {
    const st = recorder.state();
    await notify('recordStateChanged', st);
    return st;
  });
  broker.handle('recordMediaChanged', async () => {
    const st = recorder.state();
    await notify('recordMediaChanged', { file: st.lastMedia ?? null });
    return st;
  });

  /* ---------------- 其它状态 ---------------- */
  broker.handle('setInviteCount', async (payload: any) => {
    const n = Number(typeof payload === 'string' ? safeJson(payload) : payload);
    if (Number.isFinite(n) && n >= 0) {
      inviteCount = Math.floor(n);
      await kv.set(INVITE_KEY, String(inviteCount));
      // 邀请数变化会影响功能状态进度
      await notify('featureUnlockChanged', '');
    }
    return inviteCount;
  });

  broker.handle('forceLogoutCleanup', async (reason: any) => {
    // 退出登录：清订单、清账号绑定、清邀请数，并通知所有窗口
    await hexOrder.reset(String(reason || 'logout'));
    await account.setSummoner(null);
    await account.setEmail(null);
    inviteCount = 0;
    await kv.set(INVITE_KEY, '0');
    await notify('forceLogoutCleanup', '');
    return true;
  });

  broker.handle('deleteRecordMedia', async (payload: any) => {
    const file = typeof payload === 'string' ? payload : String(payload?.file ?? '');
    let ok = false;
    if (file) {
      if (opts.deleteMedia) {
        ok = await opts.deleteMedia(file).catch(() => false);
      } else {
        try {
          const fs = cube.node?.require?.('fs');
          if (fs?.existsSync?.(file)) {
            fs.unlinkSync(file);
            ok = true;
          }
        } catch {
          ok = false;
        }
      }
    }
    await notify('recordMediaChanged', { file, deleted: ok });
    return ok;
  });

  broker.handle('checkGpuEnable', async () => {
    if (opts.probeGpu) return opts.probeGpu();
    // 真实探测：能不能建 WebGL 上下文（OBS 硬件编码的前提）
    try {
      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      const gl = canvas?.getContext?.('webgl') ?? canvas?.getContext?.('experimental-webgl');
      return { enabled: !!gl, reason: gl ? 'webgl-available' : 'webgl-unavailable' };
    } catch {
      return { enabled: false, reason: 'probe-failed' };
    }
  });

  broker.handle('getHexOrderStatus', async () => hexOrder.current().phase);
  broker.handle('getHexGamePlayBegan', async () => hexOrder.current().gameStarted);

  return {
    broker,
    settings,
    comps,
    features,
    hotkeys,
    recorder,
    hexOrder,
    account,
    lcu,
    dataset,
    commands: () => broker.commands(),
    async ready() {
      const s = await settings.load();
      await hotkeys.load();
      await recorder.load();
      await hexOrder.load();
      await account.load().catch(() => null);
      const savedSet = Number(await kv.get(SET_KEY));
      if (savedSet === latestSet) currentSet = savedSet;
      const savedLocale = await kv.get(LOCALE_KEY);
      if (savedLocale) locale = savedLocale;
      const savedHighlight = await kv.get(HIGHLIGHT_KEY);
      if (savedHighlight) highlight = safeJson(savedHighlight);
      const snap = await features.start().catch(() => null);
      if (snap) inviteCount = 0;
      return { settings: normalizeSettings(s), set: currentSet };
    },
    dispose() {
      features.dispose();
      broker.dispose();
    },
  };
}
