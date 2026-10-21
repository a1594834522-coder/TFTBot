/**
 * 阵容牌高亮联动 —— trick（悬浮窗）与 tracker（阵容面板）是**两个窗口**，
 * 所以「当前阵容需要哪些棋子」必须跨窗口传：
 *
 *   CompsPanel 选中阵容
 *        └─ emit('highlightUnits', units)
 *             └─ boot.pushHighlightUnits(): ① 写 localStorage（窗口后开也能恢复）
 *                                          ② message.send(trickId, 'highlightUnits', …)
 *                                                └─ trick 侧 message.on('received') → ref → 棋盘高亮
 *
 * 和本实现对应：本实现 `chessHighlight` 里那层 `actived: Me(t.name)` 判定。
 */
export const HIGHLIGHT_KEY = 'tftbot:highlight:units';
export const HIGHLIGHT_COMMAND = 'highlightUnits';

export interface HighlightPayload {
  /** 需要高亮的棋子 id（通常是当前阵容的 units） */
  units: string[];
  /** 来源阵容（调试/回溯用） */
  compId?: string;
  /** 写入时间（毫秒） */
  at?: number;
}

/** 容错解析：坏数据/旧数据一律当空，绝不抛 */
export function parseHighlight(raw: unknown): HighlightPayload {
  let obj: any = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return { units: [] };
    try {
      obj = JSON.parse(s);
    } catch {
      return { units: [] };
    }
  }
  if (!obj || typeof obj !== 'object') return { units: [] };
  const units: string[] = Array.isArray(obj.units)
    ? obj.units.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
    : [];
  return {
    units: [...new Set(units)],
    ...(typeof obj.compId === 'string' ? { compId: obj.compId } : {}),
    ...(Number.isFinite(Number(obj.at)) ? { at: Number(obj.at) } : {}),
  };
}

export interface HighlightStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

export interface HighlightStore {
  load(): Promise<HighlightPayload>;
  save(units: string[], compId?: string): Promise<HighlightPayload>;
  clear(): Promise<void>;
  /** 同窗口内订阅（跨窗口靠 message） */
  subscribe(cb: (p: HighlightPayload) => void): () => void;
}

export function createHighlightStore(opts: { storage?: HighlightStorage | null; now?: () => number } = {}): HighlightStore {
  const now = opts.now ?? (() => Date.now());
  const listeners = new Set<(p: HighlightPayload) => void>();
  let cache: HighlightPayload = { units: [] };

  const emit = () => {
    for (const cb of listeners) {
      try {
        cb(cache);
      } catch {}
    }
  };

  const read = async (): Promise<string> => {
    try {
      const v = await opts.storage?.getItem(HIGHLIGHT_KEY);
      return String(v ?? '');
    } catch {
      return '';
    }
  };

  return {
    async load() {
      cache = parseHighlight(await read());
      return cache;
    },
    async save(units, compId) {
      const payload: HighlightPayload = { units: [...new Set(units)], at: now() };
      if (compId) payload.compId = compId;
      cache = payload;
      try {
        await opts.storage?.setItem(HIGHLIGHT_KEY, JSON.stringify(payload));
      } catch {}
      emit();
      return payload;
    },
    async clear() {
      cache = { units: [], at: now() };
      try {
        await opts.storage?.setItem(HIGHLIGHT_KEY, JSON.stringify(cache));
      } catch {}
      emit();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
