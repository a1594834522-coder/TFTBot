import { dataset } from './tft-data';

/** The shipped catalog has a single season. Old saved preferences cannot select history. */
export const CURRENT_SET = Math.max(...dataset.supportSets);
export function requireCurrentSeason(set: number): void {
  if (set !== CURRENT_SET) throw new Error(`数据适用于 S${set}；程序仅接受最新赛季 S${CURRENT_SET}`);
}
