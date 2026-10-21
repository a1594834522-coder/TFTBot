/**
 * 回放器 —— 把真机录下来的 `update-info` 序列喂给核心，逐帧重算出「当时应该显示什么」。
 *
 * 用途：
 *   1. 重写回归：TS 版 vs 本实现，对同一段录像比 cardTracker / 三星预警 / 存活人数；
 *   2. 开发调试：不起游戏也能复现某个局面；
 *   3. 未来 Rust 化：同一份 JSONL 可以喂给 Rust 实现做等价验证。
 *
 * 录像格式（JSONL，一行一条；`t` 是毫秒时间戳，可选）：
 *   {"t":1200,"key":"tft_roster","value":"[{...}]"}
 *   {"t":1300,"key":"players_info","value":"[{...}]"}
 */
import type { GameEventMessage } from './cube';
import { parseUpdateInfo } from './events';
import { buildSnapshot, type RosterSnapshot } from '../game/roster';
import { analyzePool, cardTrackerRows, threeStarWarnings, type ChampionCatalogEntry, type PoolConfig, type PoolRow } from '../game/cardTracker';

export interface RecordedEvent {
  /** 毫秒时间戳（可选，仅用于排序/展示） */
  t?: number;
  key: string;
  /** 原始 JSON 字符串 */
  value: string;
}

export interface ReplayFrame {
  index: number;
  t?: number;
  key: string;
  snapshot: RosterSnapshot | null;
  /** 该帧之后记牌器行 */
  tracker: ReturnType<typeof cardTrackerRows>;
  /** 该帧之后的三星预警 */
  warnings: PoolRow[];
}

export interface ReplayOptions {
  catalog?: ChampionCatalogEntry[];
  pool?: PoolConfig;
  /** 只保留这些 key 的帧（默认全部） */
  keys?: string[];
  /** 每帧都算 pool（默认只在 roster/players 变化后算，省 CPU） */
  always?: boolean;
}

export interface ReplayResult {
  frames: ReplayFrame[];
  events: number;
  invalid: number;
  final: RosterSnapshot | null;
  finalTracker: ReturnType<typeof cardTrackerRows>;
  finalWarnings: PoolRow[];
}

/** 解析 JSONL（坏行跳过并计数，不抛） */
export function parseRecordedEvents(text: string): { events: RecordedEvent[]; invalid: number } {
  const events: RecordedEvent[] = [];
  let invalid = 0;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    try {
      const obj = JSON.parse(s);
      if (!obj || typeof obj.key !== 'string') {
        invalid++;
        continue;
      }
      events.push({ t: typeof obj.t === 'number' ? obj.t : undefined, key: obj.key, value: typeof obj.value === 'string' ? obj.value : JSON.stringify(obj.value ?? null) });
    } catch {
      invalid++;
    }
  }
  return { events, invalid };
}

function parseJson(raw: string): any {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 这些 key 的 value 一定是 JSON；其它（如 tft_combat='combat_end'）是裸字符串，不算坏包 */
const JSON_KEYS = new Set(['tft_roster', 'players_info', 'players_rank', 'tft_augments', 'tft_item_select', 'tft_shop', 'tft_board', 'tft_opp', 'team_opp', 'tft_round']);

/** 纯函数回放：不改动输入，返回逐帧结果 */
export function replayEvents(input: { events: RecordedEvent[]; invalid?: number }, opts: ReplayOptions = {}): ReplayResult {
  const keyFilter = opts.keys ? new Set(opts.keys) : null;
  const catalog = opts.catalog ?? [];
  const frames: ReplayFrame[] = [];
  let roster: any[] | null = null;
  let players: any[] | null = null;
  let snap: RosterSnapshot | null = null;
  let invalid = input.invalid ?? 0;

  const compute = (): { tracker: ReturnType<typeof cardTrackerRows>; warnings: PoolRow[] } => {
    const pool = analyzePool(snap?.ownedByName ?? {}, catalog, {
      pool: opts.pool,
      players: snap?.players.filter((p) => p.health > 0).map((p) => ({
        player: p.name,
        ownedByName: Object.fromEntries(p.champions.map((c) => [c.name, c.copies])),
      })) ?? [],
    });
    return { tracker: cardTrackerRows(pool), warnings: threeStarWarnings(pool) };
  };

  input.events.forEach((evt, i) => {
    if (keyFilter && !keyFilter.has(evt.key)) return;
    let data = parseJson(evt.value);
    if (evt.key === 'tft_roster' || evt.key === 'players_info') {
      const parsed = parseUpdateInfo(evt);
      if (!parsed.ok) { invalid++; data = null; }
      else data = parsed.data.data;
    } else if (data == null && evt.value && JSON_KEYS.has(evt.key)) invalid++;
    let changed = false;
    if (evt.key === 'tft_roster' && Array.isArray(data)) {
      roster = data;
      if (!roster.length) players = null;
      changed = true;
    } else if (evt.key === 'players_info' && Array.isArray(data)) {
      players = data;
      changed = true;
    }
    if (changed && roster) snap = buildSnapshot(roster, players);
    const { tracker, warnings } = opts.always || changed ? compute() : { tracker: [], warnings: [] };
    frames.push({ index: i, t: evt.t, key: evt.key, snapshot: snap, tracker, warnings });
  });

  const finalCompute = compute();
  return {
    frames,
    events: input.events.length,
    invalid,
    final: snap,
    finalTracker: finalCompute.tracker,
    finalWarnings: finalCompute.warnings,
  };
}

/** 便捷：直接吃 JSONL 文本 */
export function replayText(text: string, opts: ReplayOptions = {}): ReplayResult {
  const parsed = parseRecordedEvents(text);
  return replayEvents(parsed, opts);
}

/**
 * 只保留「用户能看到」的字段，用于跨实现比对（TS vs 本实现 vs 将来的 Rust）。
 * 结构稳定、可 JSON 化，所以可以直接当 golden 文件。
 */
export interface ReplaySummary {
  events: number;
  invalid: number;
  alive: number;
  players: Array<{ name: string; health: number; champions: number }>;
  owned: Record<string, number>;
  tracker: Array<{ champion: string; remaining: number }>;
  warnings: Array<{ champion: string; needed: number }>;
}

export function replaySummary(result: ReplayResult): ReplaySummary {
  return {
    events: result.events,
    invalid: result.invalid,
    alive: result.final?.alive ?? 0,
    players: (result.final?.players ?? []).map((p) => ({ name: p.name, health: p.health, champions: p.champions.length })),
    owned: Object.fromEntries(Object.entries(result.final?.ownedByName ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    tracker: result.finalTracker.map((r) => ({ champion: r.champion, remaining: r.remaining })),
    warnings: result.finalWarnings.map((r) => ({ champion: r.champion, needed: r.neededForThree })),
  };
}
