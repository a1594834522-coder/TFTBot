/**
 * Shadow 录制器 —— 真机对照实验的采集端。
 *
 * 用途：实机上同时跑本实现与 TS 版时，把 TS 版收到的原始事件按 JSONL 记下来，
 * 导出后直接喂 `scripts/shadow.mjs`（它会把事件重放成摘要，与本实现导出对比）。
 *
 * 设计：
 *   - 纯函数式依赖注入（`now` / `sink`），浏览器里 sink 写 localStorage，单测里写内存；
 *   - 环形缓冲，默认 2000 条，避免长时间挂机把存储撑爆；
 *   - 输出就是 `replay.ts` 认识的 JSONL（每行 `{ t, key, value }`），不需要额外转换。
 */
export interface ShadowEvent {
  /** 毫秒时间戳（相对录制开始更直观，这里直接用绝对时间） */
  t: number;
  key: string;
  value: unknown;
}

export interface ShadowRecorderOptions {
  now?: () => number;
  /** 最多保留多少条（环形） */
  limit?: number;
  /** 每条新事件回调（可选，用来做实时镜像/持久化） */
  sink?: (line: string) => void;
  /** 起始时间（默认 now()），导出时用于算相对时间 */
  startedAt?: number;
}

export interface ShadowRecorder {
  record(key: string, value: unknown): ShadowEvent;
  /** 已录制条数（受 limit 限制） */
  size(): number;
  /** 是否发生过裁剪 */
  dropped(): number;
  /** JSONL（每行一个事件，字段与 replay 的输入一致） */
  dump(): string;
  /** 事件数组快照（调试用） */
  events(): ShadowEvent[];
  clear(): void;
  /** 录制开始时间 */
  startedAt: number;
}

const DEFAULT_LIMIT = 2000;

export function createShadowRecorder(opts: ShadowRecorderOptions = {}): ShadowRecorder {
  const now = opts.now ?? (() => Date.now());
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const startedAt = opts.startedAt ?? now();
  let buf: ShadowEvent[] = [];
  let droppedCount = 0;

  return {
    startedAt,
    record(key, value) {
      const ev: ShadowEvent = { t: now(), key, value };
      buf.push(ev);
      if (buf.length > limit) {
        const over = buf.length - limit;
        buf = buf.slice(over);
        droppedCount += over;
      }
      if (opts.sink) {
        try {
          opts.sink(JSON.stringify(ev));
        } catch {}
      }
      return ev;
    },
    size: () => buf.length,
    dropped: () => droppedCount,
    dump: () => buf.map((e) => JSON.stringify(e)).join('\n'),
    events: () => [...buf],
    clear() {
      buf = [];
      droppedCount = 0;
    },
  };
}

/** 从 JSONL 还原（给测试与撤销工具用） */
export function parseShadowDump(text: string): ShadowEvent[] {
  const out: ShadowEvent[] = [];
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (o && typeof o.key === 'string') out.push({ t: Number(o.t) || 0, key: o.key, value: o.value });
    } catch {}
  }
  return out;
}

export const SHADOW_ENABLED_KEY = 'tftbot:shadow';
export const SHADOW_DUMP_KEY = 'tftbot:shadow:dump';
