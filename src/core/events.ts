/**
 * 游戏内事件模型 —— 15 种 update-info key，用 zod 做运行时校验。
 *
 * 价值：本实现满屏 `JSON.parse(t.value)` + `any`，改逻辑时全靠猜字段；
 * 这里一次性把契约、容错、类型收齐，之后所有游戏内处理逻辑都在类型上写。
 */
import { z } from 'zod';
const Numeric = z.union([z.number().finite(), z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number)]);

/** 一个单位（棋子）在玩家棋盘/备战席上的一条记录 */
export const ChampionPlacement = z
  .object({
    name: z.string(),
    /** 1/2/3 星；某些事件里是字符串 */
    level: z.union([z.number(), z.string()]).optional(),
    /** 本实现聚合后写入的副本数：2星=3、3星=9 */
    num: z.number().optional(),
    position: z.number().int().optional(),
    /** Original scoreboard location=1 board, 2 bench, verified against local GEP cells. */
    area: z.enum(['board','bench']).optional(),
    items: z.array(z.string()).optional(),
    item_1: z.string().optional(),
    item_2: z.string().optional(),
    item_3: z.string().optional(),
  })
  .passthrough();
export type ChampionPlacement = z.infer<typeof ChampionPlacement>;

/** tft_roster：8 名玩家的血量/名次索引 */
export const RosterEntry = z
  .object({
    summoner: z.string().optional(),
    tag_line: z.string().optional(),
    health: Numeric,
    index: Numeric.optional(),
    is_locale: z.boolean().optional(),
    localplayer: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
export type RosterEntry = z.infer<typeof RosterEntry>;

/** players_info：每名玩家 + 其棋子明细 */
export const PlayerInfo = z
  .object({
    name: z.string().optional(),
    summoner: z.string().optional(),
    tag_line: z.string().optional(),
    health: z.number().optional(),
    is_locale: z.boolean().optional(),
    champions: z.array(ChampionPlacement).default([]),
    coverage: z.enum(['full', 'partial']).optional(),
  })
  .passthrough();
export type PlayerInfo = z.infer<typeof PlayerInfo>;

export const RankEntry = z
  .object({
    rank: z.number(),
    summoner: z.string().optional(),
    tag_line: z.string().optional(),
  })
  .passthrough();
export type RankEntry = z.infer<typeof RankEntry>;

/** 海克斯 / 装备选择：三个（或五个）槽位 */
const Slot = z.object({ name: z.string().optional() }).passthrough();
export const AugmentsPayload = z
  .object({
    augment_1: Slot.optional(),
    augment_2: Slot.optional(),
    augment_3: Slot.optional(),
  })
  .passthrough();
export const ItemSelectPayload = z
  .object({
    item_1: Slot.optional(),
    item_2: Slot.optional(),
    item_3: Slot.optional(),
    item_4: Slot.optional(),
    item_5: Slot.optional(),
  })
  .passthrough();

/** tft_shop：商店 5 张牌 */
const ShopSlot = z.object({ name: z.string() }).passthrough();
const NumberedShop = z.object({slot_1:ShopSlot.optional(),slot_2:ShopSlot.optional(),slot_3:ShopSlot.optional(),slot_4:ShopSlot.optional(),slot_5:ShopSlot.optional()})
  .refine(v=>Object.values(v).some(Boolean),'商店缺少槽位')
  .transform(v=>[v.slot_1,v.slot_2,v.slot_3,v.slot_4,v.slot_5].map(c=>c??{name:''}));
export const ShopPayload = z.union([z.array(ShopSlot),NumberedShop]);
export type ShopPayload = z.infer<typeof ShopPayload>;

export const GAME_EVENT_KEYS = [
  'tft_roster',
  'players_info',
  'players_rank',
  'tft_augments',
  'tft_item_select',
  'tft_shop',
  'tft_round',
  'tft_board',
  'tft_combat',
  'tft_round_outcome',
  'tft_opp',
  'team_opp',
  'tft_picked_augment',
  'tft_picked_item',
  'gep_module',
] as const;
export type GameEventKey = (typeof GAME_EVENT_KEYS)[number];

export type ParsedGameEvent =
  | { key: 'tft_roster'; data: RosterEntry[] }
  | { key: 'players_info'; data: PlayerInfo[] }
  | { key: 'players_rank'; data: RankEntry[] }
  | { key: 'tft_augments'; data: z.infer<typeof AugmentsPayload> }
  | { key: 'tft_item_select'; data: z.infer<typeof ItemSelectPayload> }
  | { key: 'tft_shop'; data: ShopPayload }
  | { key: 'tft_round' | 'tft_round_outcome' | 'tft_combat' | 'tft_opp' | 'team_opp' | 'tft_board'; data: string }
  | { key: 'tft_picked_augment' | 'tft_picked_item' | 'gep_module'; data: string }
  | { key: string; data: unknown };

export interface ParseResult<T = unknown> {
  ok: boolean;
  key: string;
  data: T;
  error?: string;
  /** 原始字符串 —— 解析失败时保留，方便回放/上报 */
  raw?: string;
}

function safeJson(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const SCHEMAS: Partial<Record<GameEventKey, z.ZodTypeAny>> = {
  tft_roster: z.array(RosterEntry),
  players_info: z.array(PlayerInfo),
  players_rank: z.array(RankEntry),
  tft_augments: AugmentsPayload,
  tft_item_select: ItemSelectPayload,
  tft_shop: ShopPayload,
  tft_round: z.string(),
  tft_round_outcome: z.string(),
  tft_combat: z.string(),
  tft_opp: z.string(),
  team_opp: z.string(),
  tft_board: z.string(),
  tft_picked_augment: z.union([z.string(),z.object({slot_1:Slot.optional(),slot_2:Slot.optional(),slot_3:Slot.optional(),slot_4:Slot.optional()}).transform(v=>Object.values(v).map(c=>c?.name??'').filter(Boolean).at(-1)??'')]),
  tft_picked_item: z.string(),
  gep_module: z.string(),
};

/**
 * 单条 update-info 的解析入口。
 * 未知 key 不丢：原样带出，保证前向兼容（本实现就是这么做的，没有 schema）。
 */
export function parseGameEvent(key: string, rawValue: string): ParseResult<ParsedGameEvent> {
  const schema = SCHEMAS[key as GameEventKey];
  const json = safeJson(rawValue);
  const parsed = (schema instanceof z.ZodString || key === 'tft_picked_augment') && json == null ? rawValue : json;
  if (!schema) {
    return { ok: true, key, data: { key, data: parsed } as ParsedGameEvent, raw: rawValue };
  }
  const res = schema.safeParse(parsed);
  if (!res.success) {
    return {
      ok: false,
      key,
      data: { key, data: parsed } as ParsedGameEvent,
      error: res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      raw: rawValue,
    };
  }
  return { ok: true, key, data: { key, data: res.data } as ParsedGameEvent, raw: rawValue };
}

/** 便捷：只吃 msg（{key,value}），返回解析结果 */
export function parseUpdateInfo(msg: { key: string; value: string }): ParseResult<ParsedGameEvent> {
  return parseGameEvent(msg.key, msg.value);
}

/** 供回放/测试使用的构造器（把对象合成成应用期望的字符串事件） */
export function makeEvent<K extends GameEventKey>(key: K, data: unknown): { key: K; value: string } {
  return { key, value: JSON.stringify(data) };
}
