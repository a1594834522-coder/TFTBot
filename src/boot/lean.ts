/**
 * 精简版 boot —— 一行把「游戏专用 background + 窗口页」跑起来。
 *
 * 用法（真机 / 页面里）：
 *   <script type="module" src="/assets/tftbot-boot.js"></script>
 *   <script>window.__tftbot__?.boot()</script>
 *
 * 设计：
 *   - 不注册非游戏面板相关命令（精简版 background 只注册游戏命令）；
 *   - 窗口按 `cube.windows.current.id()`（或 location 里的窗口名）决定挂哪页；
 *   - 已实现：trick（棋盘）、tracker（记牌器/玩家/推荐阵容）、characterwin（英雄详情）；
 *   - 返回 handle，便于 e2e/调试时拿到 core 与 controller。
 */
import { createApp, h, shallowRef } from 'vue';
import type { App } from 'vue';
import type { Cube, WindowName } from '../core/cube';
import { createLeanBackground, type LeanApp, type LeanOptions } from '../app/lean';
import { createCore, type tftbotCore } from '../core/index';
import { createTrickController, type TrickController } from '../windows/trick/controller';
import TrickPage from '../windows/trick/TrickPage.vue';
import TrackerPage from '../windows/tracker/TrackerPage.vue';
import CharacterPage from '../windows/characterwin/CharacterPage.vue';
import SettingsPage from '../windows/settings/SettingsPage.vue';
import { allComps, sourcesFor } from '../game/comps-sources';
import type { RankEntryView } from '../core/rank';
import type { Settings } from '../core/settings';
import { createShadowRecorder, SHADOW_ENABLED_KEY, SHADOW_DUMP_KEY, type ShadowRecorder } from '../core/shadow';
import { createHighlightStore, parseHighlight, HIGHLIGHT_COMMAND, type HighlightPayload } from '../core/highlight';

export const BOOT_VERSION = '0.2.0';

export type WindowKind = 'trick' | 'tracker' | 'characterwin' | 'settings' | 'none';

/** 窗口名 → 页面类型（纯函数，便于测试） */
export function pageForWindow(name: string): WindowKind {
  const n = String(name || '').toLowerCase();
  if (n.includes('trick')) return 'trick';
  if (n.includes('tracker')) return 'tracker';
  if (n.includes('character')) return 'characterwin';
  if (n.includes('setting')) return 'settings';
  return 'none';
}

export interface WindowHandle {
  window: WindowKind;
  app: App;
  controller?: TrickController;
  core?: tftbotCore;
}

export interface BootHandle {
  cube: Cube;
  lean: LeanApp;
  core: tftbotCore;
  windows: WindowHandle[];
  currentWindow: string;
  /** shadow 录制器（未开启时为 null） */
  shadow: ShadowRecorder | null;
  dispose(): void;
}

export interface BootOptions extends LeanOptions {
  cube?: Cube;
  /** 强制指定窗口（不做自动判断） */
  window?: WindowKind;
  /** 挂载点，默认 #app */
  el?: string;
  /** 我方玩家名 */
  meName?: string;
  /** characterwin 要展示的英雄 */
  characterId?: string;
  /** 段位（不传则由 boot 从 LCU 取；取不到为 null） */
  rank?: RankEntryView | null;
  /** 设置取值器（boot 内部注入：响应 settingsChanged） */
  getSettings?: () => Settings;
  /** 强制开启/关闭 shadow 录制（默认读 localStorage 的 tftbot:shadow） */
  shadow?: boolean;
  /** boot 创建的共享核心；单独挂载窗口时由窗口自行管理核心。 */
  core?: tftbotCore;
}

/** 从 location / cube 里猜当前窗口 */
export function detectWindow(cube?: Cube): string {
  let windowId = '';
  try {
    const id = cube?.windows?.current?.id?.();
    if (id) windowId = String(id);
    if (pageForWindow(windowId) !== 'none') return windowId;
  } catch {}
  try {
    const path = typeof location !== 'undefined' ? location.pathname : '';
    const m = /pages\/([a-z]+)\//.exec(path);
    if (m) return m[1];
    const hash = typeof location !== 'undefined' ? location.hash.replace(/^#\/?/, '') : '';
    if (hash) return hash.split('/')[0];
  } catch {}
  return windowId;
}

function catalogOf(lean: LeanApp, set: number) {
  return lean.dataset.charactersOf(set).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));
}

function resolveSet(opts: BootOptions, lean: LeanApp): number {
  const sets = lean.supportSets;
  const requested = opts.initialSet ?? lean.currentSet();
  return sets.includes(requested) ? requested : sets[sets.length - 1] ?? 17;
}

function windowContext(lean: LeanApp, opts: BootOptions & { set?: number }) {
  const requested = opts.set ?? resolveSet(opts, lean);
  const set = shallowRef(lean.supportSets.includes(requested) ? requested : resolveSet({}, lean));
  const settings = shallowRef(lean.settings.get());
  const cleanups: Array<() => void> = [
    lean.settings.subscribe((s) => { settings.value = s; }),
    lean.subscribeSet((s) => { set.value = s; }),
  ];
  return {
    set,
    getSettings: () => opts.getSettings?.() ?? settings.value,
    changeSet: (s: number) => { void lean.setCurrentSet(s); },
    cleanups,
  };
}

function attachController(cube: Cube, lean: LeanApp, opts: BootOptions, ctx: ReturnType<typeof windowContext>) {
  const getCatalog = () => catalogOf(lean, ctx.set.value);
  const core = opts.core ?? createCore({ cube, unlockPolicy: 'always', catalog: getCatalog(), settingsProvider: async () => lean.settings.get() });
  const controller = createTrickController({ core, getCatalog, getSettings: ctx.getSettings, meName: opts.meName });
  ctx.cleanups.push(
    lean.settings.subscribe(() => controller.refresh()),
    lean.subscribeSet(() => { core.setCatalog(getCatalog()); controller.refresh(); }),
    () => controller.dispose(),
  );
  if (!opts.core) ctx.cleanups.push(() => core.dispose());
  return { core, controller };
}

function mountApp(app: App, opts: BootOptions, cleanups: Array<() => void>) {
  const unmount = app.unmount.bind(app);
  let disposed = false;
  app.unmount = () => {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups) cleanup();
    unmount();
  };
  try { app.mount((opts.el ?? '#app') as any); }
  catch (error) { app.unmount(); throw error; }
}

/** 挂 trick 窗口页 */
export function mountTrickWindow(cube: Cube, lean: LeanApp, opts: BootOptions & { set?: number } = {}): WindowHandle {
  const ctx = windowContext(lean, opts);
  const { core, controller } = attachController(cube, lean, opts, ctx);

  // 阵容牌高亮：启动时从 localStorage 恢复，之后靠 message 实时更新
  const highlight = shallowRef<string[]>([]);
  const highlightStore = createHighlightStore({ storage: cube.io.localStorage as any });
  let highlightRevision = 0;
  let closed = false;
  void highlightStore.load().then((p) => {
    if (!closed && highlightRevision === 0) highlight.value = p.units;
  });
  try {
    (globalThis as any).__tftbot_HIGHLIGHT__ = { get units() { return highlight.value; } };
  } catch {}
  let offHighlight: (() => void) | null = null;
  try {
    offHighlight = cube.windows.message.on('received', (command: string, payload: any) => {
      if (command === HIGHLIGHT_COMMAND) {
        highlightRevision++;
        highlight.value = parseHighlight(payload).units;
      }
    }) as any;
  } catch {}

  // 兜底：IPC 不可用时每 500ms 从存储同步一次（窗口重启也能恢复）
  const syncTimer = setInterval(() => {
    const revision = highlightRevision;
    void highlightStore.load().then((p) => {
      if (closed || revision !== highlightRevision) return;
      const next = p.units.join('|');
      if (next !== highlight.value.join('|')) highlight.value = p.units;
    });
  }, 500);

  const app = createApp({
    render: () =>
      h(TrickPage, {
        controller,
        set: ctx.set.value,
        supportSets: lean.supportSets,
        rank: opts.rank ?? null,
        settings: ctx.getSettings(),
        highlightIds: highlight.value,
        onChangeSet: ctx.changeSet,
      }),
  });
  ctx.cleanups.push(() => { closed = true; }, () => offHighlight?.(), () => clearInterval(syncTimer));
  mountApp(app, opts, ctx.cleanups);
  return { window: 'trick', app, controller, core, highlightRef: highlight } as any;
}

/** 挂 tracker 窗口页（复用同一个控制器：玩家/记牌器口径一致） */
export function mountTrackerWindow(
  cube: Cube,
  lean: LeanApp,
  opts: BootOptions & {
    set?: number;
    rank?: RankEntryView | null;
    onOpenCharacter?: (id: string) => void;
    onHighlightUnits?: (units: string[], compId?: string) => void;
  } = {},
): WindowHandle {
  const ctx = windowContext(lean, opts);
  const { core, controller } = attachController(cube, lean, opts, ctx);
  const app = createApp({
    render: () =>
      h(TrackerPage, {
        controller,
        comps: allComps({ set: ctx.set.value }),
        set: ctx.set.value,
        supportSets: lean.supportSets,
        sourceCounts: Object.fromEntries(sourcesFor(ctx.set.value).map((s) => [s.id, s.count])),
        rank: opts.rank ?? null,
        settings: ctx.getSettings(),
        onChangeSet: ctx.changeSet,
        onOpenCharacter: opts.onOpenCharacter,
        onHighlightUnits: opts.onHighlightUnits,
      }),
  });
  mountApp(app, opts, ctx.cleanups);
  return { window: 'tracker', app, controller, core };
}

/** 最近一次要看哪个英雄（跨窗口传递，characterwin 启动时读它） */
export const CHARACTER_KEY = 'tftbot:character:last';
export const CHARACTER_CHANGED = 'tftbot:characterChanged';

/**
 * 阵容牌高亮：把「当前阵容需要哪些棋子」推给 trick 窗口。
 * ① 写 localStorage（trick 后开也能恢复）② message.send 到 trick（实时）
 */
export async function pushHighlightUnits(
  cube: Cube,
  units: string[],
  compId?: string,
  name: WindowName = 'trick',
): Promise<HighlightPayload> {
  const store = createHighlightStore({ storage: cube.io.localStorage as any });
  const payload = await store.save(units, compId);
  try {
    const w = await cube.windows.getWindowByName(name, true);
    if (w?.id) cube.windows.message.send(w.id, HIGHLIGHT_COMMAND, payload);
  } catch {}
  return payload;
}

/**
 * 从别的窗口打开 characterwin：记下要看的英雄，然后显示窗口。
 * 只依赖 cube 的 localStorage + windows 两个能力，便于假 cube 测试。
 */
export async function openCharacterWindow(cube: Cube, characterId: string, name: WindowName = 'characterwin'): Promise<boolean> {
  try {
    await cube.io.localStorage.setItem(CHARACTER_KEY, characterId);
  } catch {}
  try {
    const w = await cube.windows.getWindowByName(name, true);
    if (w?.id) {
      cube.windows.message.send(w.id, CHARACTER_CHANGED, characterId);
      cube.windows.show(w.id);
      return true;
    }
  } catch {}
  return false;
}

/** 挂 characterwin 页 */
export function mountCharacterWindow(cube: Cube, lean: LeanApp, opts: BootOptions & { set?: number } = {}): WindowHandle {
  const ctx = windowContext(lean, opts);
  const initialCharacter =
    opts.characterId ??
    (typeof location !== 'undefined' ? location.hash.replace(/^#\/?/, '').split('/')[1] : '') ??
    '';
  const characterId = shallowRef(initialCharacter);
  let disposed = false;
  let revision = 0;
  ctx.cleanups.push(cube.windows.message.on('received', (command: string, payload: unknown) => {
    if (command === CHARACTER_CHANGED && typeof payload === 'string') {
      revision++;
      characterId.value = payload;
    }
  }), () => { disposed = true; });
  if (!initialCharacter) {
    const startedRevision = revision;
    void cube.io.localStorage.getItem(CHARACTER_KEY).then((id) => {
      if (!disposed && revision === startedRevision && id) characterId.value = id;
    }).catch(() => {});
  }
  const app = createApp({
    render: () =>
      h(CharacterPage, {
        characterId: characterId.value,
        set: ctx.set.value,
        comps: allComps({ set: ctx.set.value }),
        supportSets: lean.supportSets,
        settings: ctx.getSettings(),
        onChangeSet: ctx.changeSet,
      }),
  });
  mountApp(app, opts, ctx.cleanups);
  return { window: 'characterwin', app };
}

/** 挂 settings 窗口页：开关改动直接写回 background（getSettings/setSettings） */
export function mountSettingsWindow(cube: Cube, lean: LeanApp, opts: BootOptions & { set?: number } = {}): WindowHandle {
  const ctx = windowContext(lean, opts);
  const app = createApp({
    render: () =>
      h(SettingsPage, {
        settings: ctx.getSettings(),
        'onUpdate:setting': (key: keyof Settings, value: unknown) => {
          // 与命令面同一条路径：settings.patch → 双写 + 通知其它窗口
          void lean.settings.patch({ [key]: value } as any, { userAction: true }).then((next) => {
            void lean.broker.broadcast('settingsChanged', next);
          });
        },
      }),
  });
  mountApp(app, opts, ctx.cleanups);
  return { window: 'settings', app };
}

/** 启动：装配 background，并按当前窗口挂页面 */
export async function boot(opts: BootOptions = {}): Promise<BootHandle> {
  const cube = (opts.cube ?? (globalThis as any).cube) as Cube;
  if (!cube) throw new Error('[tftbot-boot] 找不到 cube（不在平台窗口里？）');

  const lean = createLeanBackground(cube, opts);
  try { await lean.ready(); } catch (error) { lean.dispose(); throw error; }

  // 设置变化 → 页面重渲染（settings.patch/save 会触发 store 的 emit）
  const settingsRef = shallowRef<Settings>(lean.settings.get());
  const offSettings = lean.settings.subscribe((s) => {
    settingsRef.value = s;
  });
  const getSettings = () => settingsRef.value;
  const bootOpts: BootOptions = { ...opts, getSettings };

  const rawWindow = opts.window ?? detectWindow(cube);
  const kind: WindowKind = opts.window ?? pageForWindow(rawWindow);
  const windows: WindowHandle[] = [];
  const createdCore = createCore({
    cube,
    unlockPolicy: 'always',
    catalog: catalogOf(lean, resolveSet(opts, lean)),
    settingsProvider: async () => lean.settings.get(),
  });
  bootOpts.core = createdCore;

  try {
    if (kind === 'trick') {
      const rank = opts.rank !== undefined ? opts.rank : await lean.rank.getTftRank().catch(() => null);
      windows.push(mountTrickWindow(cube, lean, { ...bootOpts, rank }));
    } else if (kind === 'tracker') {
      const rank = opts.rank !== undefined ? opts.rank : await lean.rank.getTftRank().catch(() => null);
      windows.push(mountTrackerWindow(cube, lean, {
        ...bootOpts,
        rank,
        onOpenCharacter: (id: string) => void openCharacterWindow(cube, id),
        onHighlightUnits: (units: string[], compId?: string) => void pushHighlightUnits(cube, units, compId),
      }));
    } else if (kind === 'characterwin') windows.push(mountCharacterWindow(cube, lean, bootOpts));
    else if (kind === 'settings') windows.push(mountSettingsWindow(cube, lean, bootOpts));
  } catch (error) {
    for (const w of windows) w.app.unmount();
    createdCore.dispose();
    offSettings();
    lean.dispose();
    throw error;
  }

  // —— shadow 录制：实机对照实验用（localStorage 开关，或 opts.shadow 强制） ——
  let shadow: ShadowRecorder | null = null;
  let offShadow: (() => void) | null = null;
  let storedShadow = '';
  try { storedShadow = (opts.local ?? globalThis.localStorage)?.getItem(SHADOW_ENABLED_KEY) ?? ''; } catch {}
  const shadowOn = opts.shadow ?? storedShadow === '1';
  if (shadowOn) {
    shadow = createShadowRecorder({
      sink: (line) => {
        // 边录边落到 localStorage（环形缓冲已限长，dump 时整体重写）
        try {
          (opts.local ?? globalThis.localStorage)?.setItem(SHADOW_DUMP_KEY, shadow!.dump());
        } catch {}
      },
    });
    try {
      const onUpdate = (_evt: unknown, payload: any) => {
        const key = String(payload?.key ?? '');
        if (key) shadow!.record(key, payload?.value);
      };
      offShadow = cube.games.events.on('update-info', onUpdate) as any;
    } catch {}
    // 真机调试用：控制台可直接拷贝 dump 喂 scripts/shadow.mjs
    try {
      (globalThis as any).__TFTBOT_SHADOW__ = {
        dump: () => shadow!.dump(),
        clear: () => {
          shadow!.clear();
          try { (opts.local ?? globalThis.localStorage)?.setItem(SHADOW_DUMP_KEY, ''); } catch {}
        },
        size: () => shadow!.size(),
        dropped: () => shadow!.dropped(),
      };
    } catch {}
  }

  let disposed = false;
  return {
    cube,
    lean,
    core: createdCore,
    windows,
    currentWindow: rawWindow,
    shadow,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const w of windows) {
        try {
          w.app.unmount();
        } catch {}
        w.controller?.dispose();
      }
      try {
        offShadow?.();
      } catch {}
      createdCore.dispose();
      offSettings();
      lean.dispose();
    },
  };
}

export { createLeanBackground, createTrickController, TrickPage, TrackerPage, CharacterPage };

// 兼容已安装的 HTML 引导代码；新安装脚本直接导入 boot。
(globalThis as any).__tftbot__ = { boot, BOOT_VERSION };
