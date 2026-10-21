import bundled from '../../data/metatft-augments.raw.json';
import names from '../../data/metatft-augment-names.json';

export const AUGMENT_TIERS = ['S', 'A', 'B', 'C', 'D'] as const;
export type AugmentRating = typeof AUGMENT_TIERS[number];
export interface RatedAugment { id: string; name: string; rating: AugmentRating; rarity?: string; }
export interface AugmentTierSnapshot {
  source: 'MetaTFT';
  kind: 'author-rating';
  set: number;
  patch: string;
  author: string;
  updatedAt: string;
  fetchedAt: string;
  augments: RatedAugment[];
}
const definitions = names.augments as Record<string, { name: string; rarity?: string }>;
export function parseAugmentTiers(input: unknown): AugmentTierSnapshot {
  const raw = input as any;
  const response = raw?.response ?? raw;
  const content = response?.content;
  const tiers = content?.content?.tierList;
  const set = Number(/TFTSet(\d+)/.exec(String(response?.tier_list_set ?? response?.tft_set))?.[1]);
  if (!Array.isArray(tiers) || !Number.isFinite(set) || set <= 0) throw new Error('MetaTFT 海克斯评级格式或赛季无效');
  const augments: RatedAugment[] = [];
  const seen = new Set<string>();
  for (const tier of tiers) {
    const rating = String(tier?.label).toUpperCase() as AugmentRating;
    if (!AUGMENT_TIERS.includes(rating) || !Array.isArray(tier?.content)) continue;
    for (const entry of tier.content) {
      if (entry?.type !== 'augment' || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const definition = definitions[entry.id];
      augments.push({
        id: entry.id, rating,
        name: definition?.name ?? '名称待更新',
        rarity: definition?.rarity,
      });
    }
  }
  if (!augments.length) throw new Error('MetaTFT 返回了空评级，保留已有快照');
  return {
    source: 'MetaTFT', kind: 'author-rating', set,
    patch: typeof raw?.meta?.patch === 'string' ? raw.meta.patch : '',
    author: [content?.author?.gameName, content?.author?.tagLine].filter((s) => typeof s === 'string' && s).join('#'),
    updatedAt: typeof content?.updated_at === 'string' ? content.updated_at : '',
    fetchedAt: typeof raw?.meta?.fetchedAt === 'string' ? raw.meta.fetchedAt : '',
    augments: augments.sort((a, b) => AUGMENT_TIERS.indexOf(a.rating) - AUGMENT_TIERS.indexOf(b.rating) || a.name.localeCompare(b.name)),
  };
}
export const bundledAugmentTiers = parseAugmentTiers(bundled);
