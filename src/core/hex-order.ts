/**
 * Hex 下注 / 订单状态机（background 侧）
 *
 * 相关命令：getHexOrderStatus / setHexOrderStatus / getHexOrderRes / setHexOrderRes /
 * setHexGamePlayBegan / syncHexOrderLifecycle / resetHexOrderForAccountChange，
 * 以及 showHexPredict / showHexPredictRecharge / showHexPredictAdvancedApply /
 * showHexOrderResult / showHexPredictCompactReturn / pauseHexmsgFollow 这些"窗口指令"。
 *
 * 本实现把订单状态散在多个布尔 + 字符串里，靠 if 判断当前处于哪一步；
 * 这里建模成显式状态机（idle → pending → placed → settled / cancelled），
 * 非法迁移直接拒绝并记录原因 —— 比本实现"多点写入"更安全。
 */
import type { Broker } from './broker';
import type { Cube } from './cube';

export type HexOrderPhase = 'idle' | 'pending' | 'placed' | 'settled' | 'cancelled' | 'error';

export interface HexOrder {
  /** 本地订单号（后端返回前的临时 id） */
  orderId: string | null;
  phase: HexOrderPhase;
  /** 下注金额（分为单位，避免浮点） */
  amountCents: number;
  /** 赔率，例如 1.85 */
  odds: number | null;
  /** 模式：娱乐 / 进阶 */
  mode: 'entertain' | 'advanced';
  /** 是否已开局（setHexGamePlayBegan） */
  gameStarted: boolean;
  /** 结算结果 */
  result: 'win' | 'lose' | 'refund' | null;
  /** 预计返还（分） */
  refundCents: number;
  updatedAt: number;
  /** 最近一次失败原因 */
  lastError?: string;
}

export const IDLE_ORDER: HexOrder = {
  orderId: null,
  phase: 'idle',
  amountCents: 0,
  odds: null,
  mode: 'entertain',
  gameStarted: false,
  result: null,
  refundCents: 0,
  updatedAt: 0,
};

/** 允许的迁移；不在表里的迁移一律拒绝 */
const TRANSITIONS: Record<HexOrderPhase, HexOrderPhase[]> = {
  idle: ['pending', 'cancelled', 'error'],
  pending: ['placed', 'cancelled', 'error'],
  placed: ['settled', 'cancelled', 'error'],
  settled: ['idle'],
  cancelled: ['idle', 'pending'],
  error: ['idle', 'pending'],
};

export interface HexOrderStoreDeps {
  cube: Pick<Cube, 'io'>;
  broker?: Broker;
  getOwner: () => Promise<string> | string;
  local?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
}

export const HEX_ORDER_KEY = 'tftbot:hex:order';

export interface HexOrderService {
  load(): Promise<HexOrder>;
  current(): HexOrder;
  /** 状态迁移（内部用，也暴露给命令层） */
  transition(patch: Partial<HexOrder> & { phase?: HexOrderPhase }): Promise<HexOrder>;
  setStatus(status: Partial<HexOrder> | string): Promise<HexOrder>;
  setResult(res: any): Promise<HexOrder>;
  markGameStarted(started: boolean): Promise<HexOrder>;
  /** 账号切换/退出时清空（本实现 resetHexOrderForAccountChange） */
  reset(reason?: string): Promise<HexOrder>;
  /** 生命周期同步：按当前状态决定通知哪些窗口 */
  sync(): Promise<HexOrder>;
  dispose(): void;
}

function isTransitionAllowed(from: HexOrderPhase, to: HexOrderPhase): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function createHexOrderService(deps: HexOrderStoreDeps): HexOrderService {
  const now = deps.now ?? (() => Date.now());
  let owner = '';
  let order: HexOrder = { ...IDLE_ORDER };

  const key = () => `${HEX_ORDER_KEY}:${owner}`;

  async function read(): Promise<string> {
    try {
      const v = deps.local?.getItem(key());
      if (v) return String(v);
    } catch {}
    try {
      return (await deps.cube.io.localStorage.getItem(key())) || '';
    } catch {
      return '';
    }
  }

  async function write(v: string) {
    try {
      await deps.cube.io.localStorage.setItem(key(), v);
    } catch {}
    try {
      deps.local?.setItem(key(), v);
    } catch {}
  }

  const notify = async (command: string, payload: any) => {
    await deps.broker?.broadcast(command as any, payload).catch(() => null);
  };

  return {
    async load() {
      try {
        owner = String((await deps.getOwner()) ?? '');
      } catch {
        owner = '';
      }
      const raw = await read();
      if (raw) {
        try {
          order = { ...IDLE_ORDER, ...JSON.parse(raw) };
        } catch {
          order = { ...IDLE_ORDER };
        }
      }
      return order;
    },

    current: () => order,

    async transition(patch) {
      const next: HexOrder = { ...order, ...patch, updatedAt: now() };
      const changing = patch.phase && patch.phase !== order.phase;
      if (changing && !isTransitionAllowed(order.phase, patch.phase!)) {
        // 非法迁移：保持原状态，只记录原因（不抛，避免打断调用方）
        order = { ...order, lastError: `illegal transition ${order.phase} → ${patch.phase}`, updatedAt: now() };
        await write(JSON.stringify(order));
        await notify('setHexOrderStatus', order);
        return order;
      }
      order = next;
      delete order.lastError;
      await write(JSON.stringify(order));
      await notify('setHexOrderStatus', order);
      return order;
    },

    async setStatus(status) {
      const patch = typeof status === 'string' ? safeJson(status) : status;
      return this.transition(patch ?? {});
    },

    async setResult(res) {
      const data = typeof res === 'string' ? safeJson(res) : res;
      const win = data?.result === 'win' || data?.win === true;
      const refund = Number(data?.refundCents ?? data?.refund ?? 0) || 0;
      return this.transition({
        phase: 'settled',
        result: win ? 'win' : data?.refund ? 'refund' : 'lose',
        refundCents: refund,
        gameStarted: false,
      });
    },

    async markGameStarted(started) {
      return this.transition({ gameStarted: !!started });
    },

    async reset(reason) {
      owner = (await Promise.resolve(deps.getOwner()).catch(() => '')) || '';
      order = { ...IDLE_ORDER, updatedAt: now(), lastError: reason };
      await write(JSON.stringify(order));
      await notify('setHexOrderStatus', order);
      return order;
    },

    /** 按状态把"该弹什么"通知给 hexmsg / main（本实现散在各处的 showHex* 调用） */
    async sync() {
      if (order.phase === 'settled') await notify('showHexOrderResult', order);
      else if (order.phase === 'placed' || order.phase === 'pending') await notify('setHexOrderRes', order);
      return order;
    },

    dispose() {
      /* 目前无定时器；保留接口以便后续加重连/超时 */
    },
  };
}

function safeJson(v: any): any {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}
