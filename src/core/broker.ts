/**
 * IPC 代理（background 侧）—— 把平台底层协议包成「注册命令 / 回包 / 广播」。
 *
 * 协议来自平台 preload：
 *   子窗口：cube.windows.message.invoke(mainWinId, command, payload)   → Promise<returnValue>
 *   background：message.on('invoked', (command, payload, reply) => reply(value))
 *   通知：message.send(winId, command, payload) ↔ on('received', (command, payload))
 */
import type { Cube, IpcCommand, WindowName } from './cube';

export type Handler = (payload: any) => any | Promise<any>;

export interface Broker {
  /** 注册一个命令处理器（重复注册会覆盖，返回解绑） */
  handle(command: IpcCommand | string, fn: Handler): () => void;
  /** 有没有实现这个命令 */
  has(command: string): boolean;
  /** 已实现的命令列表 */
  commands(): string[];
  /** 向单个窗口广播 */
  send(windowId: string, command: IpcCommand | string, payload?: any): void;
  /** 向若干具名窗口广播（找不到的静默跳过） */
  broadcast(command: IpcCommand | string, payload?: any, targets?: WindowName[]): Promise<void>;
  dispose(): void;
}

export const BROADCAST_TARGETS: WindowName[] = ['main', 'tracker', 'trick', 'overallrecord', 'characterwin', 'settings', 'hexmsg', 'adwin', 'tgd', 'sidewin'];

export function createBroker(cube: Pick<Cube, 'windows'>, targets: WindowName[] = BROADCAST_TARGETS): Broker {
  const handlers = new Map<string, Handler>();
  const off = cube.windows.message.on('invoked', (command: string, payload: any, reply: (v: any) => void) => {
    const fn = handlers.get(command);
    if (!fn) {
      // 未实现：返回 undefined，避免调用方永远挂着
      reply(undefined);
      return;
    }
    Promise.resolve()
      .then(() => fn(payload))
      .then((v) => reply(v))
      .catch((e) => {
        console.warn('[broker] handler failed:', command, e && e.message);
        reply(undefined);
      });
  });

  return {
    handle(command, fn) {
      handlers.set(command, fn);
      return () => {
        if (handlers.get(command) === fn) handlers.delete(command);
      };
    },
    has: (c) => handlers.has(c),
    commands: () => [...handlers.keys()],
    send(windowId, command, payload) {
      cube.windows.message.send(windowId, command, payload);
    },
    async broadcast(command, payload, list) {
      for (const name of list ?? targets) {
        try {
          const win = await cube.windows.getWindowByName(name, false);
          if (win && win.id) cube.windows.message.send(win.id, command, payload);
        } catch {
          /* 窗口没开就跳过 */
        }
      }
    },
    dispose() {
      handlers.clear();
      off();
    },
  };
}
