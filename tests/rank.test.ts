import { describe, expect, it } from 'vitest';
import { createRankService, parseRankedStats, normalizeDivision, formatRankLabel } from '../src/core/rank';
import type { LcuLike } from '../src/core/lcu';

function lcuReturning(payload: any): LcuLike {
  return { invoke: async () => payload };
}

const sample = {
  queueMap: {
    RANKED_TFT: { tier: 'GOLD', division: 'II', leaguePoints: 45, wins: 30, losses: 20 },
    RANKED_TFT_DOUBLE_UP: { tier: 'SILVER', division: 'IV', leaguePoints: 10, wins: 5, losses: 5 },
  },
};

describe('段位解析', () => {
  it('拍平 queueMap 并算胜率/展示串', () => {
    const rows = parseRankedStats(sample);
    expect(rows.length).toBe(2);
    const tft = rows.find((r) => r.queue === 'RANKED_TFT')!;
    expect(tft.tier).toBe('GOLD');
    expect(tft.winRate).toBe(0.6);
    expect(tft.label).toBe('黄金 II 45LP');
    // 按 LP 降序
    expect(rows[0].queue).toBe('RANKED_TFT');
  });

  it('division 归一化（VI → IV）与大师以上无小段', () => {
    expect(normalizeDivision('vi')).toBe('IV');
    expect(normalizeDivision('i')).toBe('I');
    expect(normalizeDivision('')).toBe('');
    expect(formatRankLabel({ tier: 'MASTER', division: '', lp: 320 })).toBe('大师 320LP');
    expect(formatRankLabel({ tier: 'UNRANKED', division: 'I', lp: 0 })).toBe('未定级 0LP');
  });

  it('空数据/异常结构不炸', () => {
    expect(parseRankedStats(null)).toEqual([]);
    expect(parseRankedStats({})).toEqual([]);
    expect(parseRankedStats({ queueMap: { RANKED_TFT: null } })).toEqual([]);
  });
});

describe('RankService', () => {
  it('返回 LCU 数据并做 30s 缓存', async () => {
    let calls = 0;
    const lcu: LcuLike = {
      invoke: async () => {
        calls++;
        return sample;
      },
    };
    const svc = createRankService({ lcu });
    const first = await svc.getRankData();
    const second = await svc.getRankData();
    expect(first.length).toBe(2);
    expect(second).toBe(first); // 命中缓存（同一引用）
    expect(calls).toBe(1);
  });

  it('LCU 失败返回空数组', async () => {
    const svc = createRankService({ lcu: { invoke: async () => Promise.reject(new Error('lcu down')) } });
    await expect(svc.getRankData()).resolves.toEqual([]);
  });

  it('兼容直接返回单队列对象', async () => {
    const svc = createRankService({
      lcu: lcuReturning({ tier: 'DIAMOND', division: 'I', leaguePoints: 88, wins: 9, losses: 1 }),
    });
    const tft = await svc.getTftRank();
    expect(tft?.tier).toBe('DIAMOND');
    expect(tft?.label).toBe('钻石 I 88LP');
  });

  it('getTftRank 优先 RANKED_TFT', async () => {
    const svc = createRankService({ lcu: lcuReturning(sample) });
    expect((await svc.getTftRank())?.queue).toBe('RANKED_TFT');
  });
});
