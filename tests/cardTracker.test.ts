import { describe, expect, it } from 'vitest';
import {
  analyzePool,
  cardTrackerRows,
  threeStarWarnings,
  remainingCopies,
  neededForThreeStar,
  canStillThreeStar,
  defaultNormalizeName,
  DEFAULT_POOL,
  type ChampionCatalogEntry,
} from '../src/game/cardTracker';

const catalog: ChampionCatalogEntry[] = [
  { character_id: 'Teemo', cost: 4 },
  { character_id: 'Garen', cost: 5 },
  { character_id: 'Ashe', cost: 1 },
  { character_id: 'TFT10_Akali_Special', cost: 4 },
];

describe('牌池基础运算', () => {
  it('剩余 = 池 - 已出，且不为负', () => {
    expect(remainingCopies(0, 12)).toBe(12);
    expect(remainingCopies(5, 12)).toBe(7);
    expect(remainingCopies(99, 12)).toBe(0);
  });
  it('三星差多少张', () => {
    expect(neededForThreeStar(0)).toBe(9);
    expect(neededForThreeStar(6)).toBe(3);
    expect(neededForThreeStar(9)).toBe(0);
  });
  it('还能不能三星（池子够不够）', () => {
    expect(canStillThreeStar(0, 12)).toBe(true);
    expect(canStillThreeStar(9, 12)).toBe(false); // 已三星，差 0
    expect(canStillThreeStar(10, 12)).toBe(false);
  });
});

describe('analyzePool（追三标记 + 记牌器）', () => {
  it('按费用过滤标记，默认只标 4/5 费', () => {
    const rows = analyzePool({ Teemo: 4, Ashe: 2, Garen: 1 }, catalog);
    const teemo = rows.find((r) => r.champion === 'Teemo')!;
    const ashe = rows.find((r) => r.champion === 'Ashe')!;
    const garen = rows.find((r) => r.champion === 'Garen')!;
    expect(teemo.marked).toBe(true);
    expect(ashe.marked).toBe(false);
    expect(garen.marked).toBe(true);
    expect(teemo.remaining).toBe(DEFAULT_POOL.poolByCost[4] - 4);
  });

  it('名字归一化：同英雄不同写法会被合并（Akali 特判）', () => {
    expect(defaultNormalizeName('TFT10_Akali_Special')).toBe('TFT10_Akali');
    const rows = analyzePool({ TFT10_Akali: 3, TFT10_Akali_Special: 3 }, [
      { character_id: 'TFT10_Akali', cost: 4 },
    ]);
    expect(rows[0].owned).toBe(6);
  });

  it('自定义池子大小生效（赛季不同池子不同）', () => {
    const rows = analyzePool({ Teemo: 10 }, catalog, { pool: { poolByCost: { 1: 20, 2: 20, 3: 20, 4: 9, 5: 9 } } });
    const teemo = rows.find((r) => r.champion === 'Teemo')!;
    expect(teemo.pool).toBe(9);
    expect(teemo.canThreeStar).toBe(false); // 池子 9 张 + 已出 10 → 不可能三星
  });

  it('记牌器：只保留有剩余且在标记费用的英雄，按剩余升序', () => {
    const rows = analyzePool({ Teemo: 9, Garen: 2, Ashe: 1 }, catalog);
    const tracker = cardTrackerRows(rows);
    expect(tracker.map((r) => r.champion)).toEqual(['Teemo', 'Garen']);
    expect(tracker[0].remaining).toBeLessThan(tracker[1].remaining);
  });

  it('三星预警：还差 1 张时命中', () => {
    const rows = analyzePool({ Teemo: 8, Garen: 0 }, catalog);
    const warn = threeStarWarnings(rows, 1);
    expect(warn.map((r) => r.champion)).toEqual(['Teemo']);
  });
});

describe('池子耗尽边界', () => {
  it('已出超过池子：remaining=0、不能三星、不进记牌器', () => {
    const rows = analyzePool({ Teemo: 99 }, catalog);
    const teemo = rows.find((r) => r.champion === 'Teemo')!;
    expect(teemo.remaining).toBe(0);
    expect(teemo.canThreeStar).toBe(false);
    expect(cardTrackerRows(rows).some((r) => r.champion === 'Teemo')).toBe(false);
  });
});
