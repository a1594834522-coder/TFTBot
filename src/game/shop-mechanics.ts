import mechanics from '../../data/current-shop-mechanics.json';
import nonPool from '../../data/current-non-pool-units.json';
import { dataset } from './tft-data';
import type { Cost, PoolConfig } from './cardTracker';
export { mechanics };
export const normalizeShopHero = (id: string): string => (mechanics.aliases as Record<string, string>)[id] ?? id;
// Known generated combat units are not copies removed from the shared shop pool.
// Keep this explicit: an unrecognized new champion must remain unknown, not disappear.
const generatedUnits=new Set(nonPool.ids);
export const isGeneratedUnit=(id:string):boolean=>generatedUnits.has(id);
export const shopCatalog = mechanics.units.map(u => ({ character_id: u.id, cost: u.cost, display_name: dataset.characterById(u.id)?.display_name ?? '名称待更新' }));
export const currentPool: PoolConfig = { poolByCost: Object.fromEntries(mechanics.units.map(u => [u.cost, u.pool])) as Record<Cost, number> };
const keys = ['OneCostOdds', 'TwoCostOdds', 'ThreeCostOdds', 'FourCostOdds', 'FiveCostOdds'] as const;
export function tierOdds(level: number, cost: Cost): number {
  const points = mechanics.shopOdds[keys[cost - 1]];
  return points.filter(([l]) => l <= level).at(-1)?.[1] ?? 0;
}
