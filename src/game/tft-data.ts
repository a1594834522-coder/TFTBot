/**
 * 游戏数据层 —— 从 background 里内嵌的数组抽取而来（见 port/extract-tft-data.mjs）。
 *
 * 数据以 JS 字面量塞在 52k 行压缩产物里，靠字符串表解码；
 * 这里：抽成 JSON（`data/tft-sets.json`），加类型 + 索引，一次构图反复查询。
 *
 * 只发布最新赛季。当前 S18：74 英雄、161 装备、37 羁绊、260 海克斯定义。
 */
import raw from '../../data/tft-sets.json';

export interface ChampionAbility {
  name?: string;
  description?: string;
  image_path?: string;
  mana_cost?: number;
  mana_start?: number;
}

export interface ChampionStats {
  armor?: number;
  health?: number;
  magic_resist?: number;
  attack_speed?: number;
  attack?: number;
  range?: number;
}

export interface Champion {
  character_id: string;
  display_name: string;
  trait_ids: string[];
  code?: number;
  cost: number;
  image_path?: string;
  background_path?: string;
  ability?: ChampionAbility;
  stats?: ChampionStats;
  top_items?: string[];
}

export interface Item {
  item_id: string;
  display_name: string;
  description?: string;
  builds_from: string[];
  builds_into: string[];
  type: number;
  image_path?: string;
}

export interface Trait {
  trait_id: string;
  display_name: string;
  image_path?: string;
  description?: string;
  type?: number;
}

export interface Augment {
  augment_id: string;
  tier?: number;
  display_name?: string;
}

export interface RawDataset {
  characters: Record<string, Champion[]>;
  items: Item[];
  traits: Trait[];
  augments: Augment[];
}

const RAW = raw as unknown as RawDataset;

export interface TftDataset {
  /** 全部英雄，按赛季归组（键为 set number，0 表示无编号组） */
  sets: Record<number, Champion[]>;
  characters: Champion[];
  items: Item[];
  traits: Trait[];
  augments: Augment[];
  /** 支持的赛季（升序，排除 0） */
  supportSets: number[];
  /* ---- 查询 ---- */
  character(set: number, id: string): Champion | undefined;
  characterById(id: string): Champion | undefined;
  charactersOf(set: number): Champion[];
  byCost(set: number, cost: number): Champion[];
  item(id: string): Item | undefined;
  itemsOfType(type: number): Item[];
  /** 合成来源 + 可合成去向（做装备推荐时用） */
  itemBuildGraph(id: string): { from: Item[]; into: Item[] };
  trait(id: string): Trait | undefined;
  augment(id: string): Augment | undefined;
  /** 英雄的羁绊解析成对象 */
  traitsOf(set: number, id: string): Trait[];
}

/** 用任意数据源构建数据集（测试可传小样本） */
export function buildDataset(input: RawDataset = RAW): TftDataset {
  const sets: Record<number, Champion[]> = {};
  const charIndex = new Map<string, Champion>();
  for (const [setKey, list] of Object.entries(input.characters ?? {})) {
    const set = Number(setKey);
    sets[set] = list;
    for (const c of list) if (!charIndex.has(c.character_id)) charIndex.set(c.character_id, c);
  }
  const allChars = Object.values(sets).flat();
  const itemIndex = new Map(input.items.map((i) => [i.item_id, i]));
  const traitIndex = new Map(input.traits.map((t) => [t.trait_id, t]));
  const augmentIndex = new Map(input.augments.map((a) => [a.augment_id, a]));
  const supportSets = Object.keys(sets)
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  return {
    sets,
    characters: allChars,
    items: input.items,
    traits: input.traits,
    augments: input.augments,
    supportSets,
    character(set, id) {
      return sets[set]?.find((c) => c.character_id === id);
    },
    characterById: (id) => charIndex.get(id),
    charactersOf: (set) => sets[set] ?? [],
    byCost: (set, cost) => (sets[set] ?? []).filter((c) => c.cost === cost),
    item: (id) => itemIndex.get(id),
    itemsOfType: (type) => input.items.filter((i) => i.type === type),
    itemBuildGraph(id) {
      const self = itemIndex.get(id);
      if (!self) return { from: [], into: [] };
      return {
        from: self.builds_from.map((x) => itemIndex.get(x)).filter((x): x is Item => !!x),
        into: self.builds_into.map((x) => itemIndex.get(x)).filter((x): x is Item => !!x),
      };
    },
    trait: (id) => traitIndex.get(id),
    augment: (id) => augmentIndex.get(id),
    traitsOf(set, id) {
      const c = sets[set]?.find((x) => x.character_id === id);
      return (c?.trait_ids ?? []).map((t) => traitIndex.get(t)).filter((t): t is Trait => !!t);
    },
  };
}

/** 默认最新赛季数据集，随 chunk 一起打包。 */
export const dataset: TftDataset = buildDataset();

export { RAW as rawDataset };
