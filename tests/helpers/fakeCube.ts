/**
 * 测试用假 cube：内存版 localStorage + 可编程的 message/IPC + 窗口表。
 * 目标：让 background 侧的服务（broker/settings/comps/feature）可以脱离平台单测。
 */
import type { Cube } from '../../src/core/cube';

export interface FakeCubeOptions {
  windows?: string[];
  /** invoke 由谁处理（默认走注册表） */
  onInvoke?: (windowId: string, command: string, payload: any) => any;
}

export interface FakeCube {
  cube: Cube;
  /** 内存版宿主存储 */
  store: Map<string, string>;
  /** 模拟「某窗口 invoke background」 */
  invoke: (command: string, payload?: any, from?: string) => Promise<any>;
  /** 模拟 background 广播 */
  sent: Array<{ windowId: string; command: string; payload: any }>;
  /** 已打开窗口 */
  windows: Set<string>;
  /** 窗口 show/hide 调用记录（断言窗口类命令用） */
  windowOps: Array<{ op: 'show' | 'hide'; id: string }>;
  /** 模拟原生层推 update-info 事件 */
  emit(key: string, value: unknown): void;
  openWindow(name: string): void;
  closeWindow(name: string): void;
  listenerCounts(): { game: number; received: number; invoked: number };
}

export function createFakeCube(opts: FakeCubeOptions = {}): FakeCube {
  const store = new Map<string, string>();
  const sent: FakeCube['sent'] = [];
  const windows = new Set<string>(opts.windows ?? ['background', 'main', 'trick', 'tracker']);
  const invokedHandlers = new Set<(cmd: string, payload: any) => any>();
  const windowOps: FakeCube['windowOps'] = [];
  const gameListeners = new Set<(evt: unknown, payload: unknown) => void>();
  const receivedListeners = new Set<(command: string, payload: unknown) => void>();

  const cube = {
    windows: {
      current: { id: () => 'background', isOffscreen: () => false, dragMove: () => {} },
      getMainWindow: async () => ({ id: 'main' }),
      getCurrentWindow: async () => ({ id: 'background', maximized: false }),
      getWindowByName: async (name: string) => {
        if (!windows.has(name)) throw new Error('window not found: ' + name);
        return { id: name };
      },
      getWindowInfo: async () => ({ show: true }),
      obtainDeclaredWindow: async (name: string) => ({ id: name }),
      show: (id: string) => {
        windowOps.push({ op: 'show', id });
      },
      hide: (id: string) => {
        windowOps.push({ op: 'hide', id });
      },
      close: () => {},
      minimize: () => {},
      maximize: () => {},
      unmaximize: () => {},
      setSize: () => {},
      setBounds: () => {},
      setPosition: () => {},
      on: () => () => {},
      message: {
        invoke: async (windowId: string, command: string, payload: any) => {
          if (opts.onInvoke) return opts.onInvoke(windowId, command, payload);
          for (const h of invokedHandlers) {
            const r = await h(command, payload);
            if (r !== undefined) return r;
          }
          return undefined;
        },
        send: (windowId: string, command: string, payload: any) => {
          sent.push({ windowId, command, payload });
          // 同进程模拟：接收侧立刻收到（真实环境是跨窗口 IPC）
          for (const cb of receivedListeners) cb(command, payload);
        },
        on: (event: string, cb: any) => {
          if (event === 'received') {
            receivedListeners.add(cb);
            return () => receivedListeners.delete(cb);
          }
          if (event === 'invoked') {
            const h = async (cmd: string, payload: any) => {
              let out: any;
              let done = false;
              await new Promise<void>((resolve) => {
                const timer = setTimeout(() => resolve(), 500); // 兜底：handler 没回包也别挂死
                cb(cmd, payload, (v: any) => {
                  out = v;
                  done = true;
                  clearTimeout(timer);
                  resolve();
                });
              });
              return done ? out : undefined;
            };
            invokedHandlers.add(h);
            return () => invokedHandlers.delete(h);
          }
          return () => {};
        },
      },
    },
    io: {
      localStorage: {
        getItem: async (k: string) => store.get(k) ?? '',
        setItem: async (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: async (k: string) => {
          store.delete(k);
        },
      },
    },
    games: {
      getRunningGame: async () => null,
      on: () => () => {},
      launchers: { events: { on: () => () => {} }, invokeLEP: async () => ({}) },
      events: {
        on: (event: string, cb: (evt: unknown, payload: unknown) => void) => {
          if (event !== 'update-info') return () => {};
          gameListeners.add(cb);
          return () => gameListeners.delete(cb);
        },
        getInfo: async () => null,
        provider: { loadGEP: async () => '', updateInfo: () => {}, triggerEvent: () => {} },
      },
    },
    utils: {} as any,
    net: {} as any,
    node: {} as any,
    extensions: { current: { getManifest: () => ({ meta: { name: 'tftbot', version: 'test' }, data: {} }) } },
    settings: { setGeneralSetting: () => {} },
  } as unknown as Cube;

  return {
    cube,
    store,
    sent,
    windows,
    windowOps,
    invoke: (command, payload, from = 'main') => cube.windows.message.invoke(from, command as any, payload),
    emit: (key, value) => {
      for (const cb of gameListeners) cb({}, { key, value });
    },
    openWindow: (name) => windows.add(name),
    closeWindow: (name) => windows.delete(name),
    listenerCounts: () => ({ game: gameListeners.size, received: receivedListeners.size, invoked: invokedHandlers.size }),
  };
}
