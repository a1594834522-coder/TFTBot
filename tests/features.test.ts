import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FEATURES,
  EMPTY_MEMBERSHIP,
  areAllFeaturesUnlocked,
  findFeature,
  formatMemberDisplay,
  isFeatureUnlocked,
  isMember,
  parseFeatureUnlockResponse,
  parseMembership,
  unlockedCount,
} from '../src/core/features';
import { normalizeSettings, DEFAULT_SETTINGS, SETTING_FEATURE_MAP } from '../src/core/settings';

describe('membership 解析', () => {
  it('秒级时间戳转毫秒', () => {
    const m = parseMembership({ plan: 'vip', expireAt: 1_800_000_000 });
    expect(m.expireAt).toBe(1_800_000_000_000);
    expect(m.displayStatus).toBe('normal');
    expect(isMember(m)).toBe(true);
  });

  it('毫秒时间戳不重复乘 1000', () => {
    const m = parseMembership({ plan: 'vip', expireAt: 1_800_000_000_000 });
    expect(m.expireAt).toBe(1_800_000_000_000);
  });

  it('MAX_SAFE_INTEGER → 永久', () => {
    const m = parseMembership({ plan: 'vip', expireAt: Number.MAX_SAFE_INTEGER });
    expect(m.isPermanent).toBe(true);
    expect(m.displayStatus).toBe('permanent');
    expect(formatMemberDisplay(m)).toBe('永久会员');
  });

  it('partial 状态与 unlockedCount 夹紧到 4', () => {
    const m = parseMembership({ plan: 'vip', displayStatus: 'partial', unlockedCount: 99 });
    expect(m.unlockedCount).toBe(4);
    expect(formatMemberDisplay(m)).toBe('已解锁 4/4');
  });

  it('空/过期不算会员', () => {
    expect(isMember(parseMembership(null))).toBe(false);
    expect(isMember(parseMembership({ plan: 'vip', expireAt: 1 }))).toBe(false);
    expect(parseMembership(null)).toEqual(EMPTY_MEMBERSHIP);
  });
});

describe('功能开关 gate', () => {
  it('policy=server 时严格看服务端 unlocked', () => {
    const snap = parseFeatureUnlockResponse({ features: DEFAULT_FEATURES }, 'server');
    expect(isFeatureUnlocked(snap.features, 'card_tracker')).toBe(false);
    expect(areAllFeaturesUnlocked(snap.features)).toBe(false);
    expect(unlockedCount(snap.features)).toBe(0);
  });

  it('policy=always 时全部视为已开启', () => {
    const snap = parseFeatureUnlockResponse({ features: DEFAULT_FEATURES }, 'always');
    expect(snap.features.every((f) => f.unlocked)).toBe(true);
    expect(isFeatureUnlocked(snap.features, 'card_tracker', 'always')).toBe(true);
    expect(areAllFeaturesUnlocked(snap.features, 'always')).toBe(true);
    expect(snap.membership.displayStatus).toBe('permanent');
  });

  it('legacyPermanent 影响已解锁计数', () => {
    const snap = parseFeatureUnlockResponse({ features: DEFAULT_FEATURES, membership: { legacyPermanent: true } });
    expect(unlockedCount(snap.features, snap.membership)).toBe(4);
  });

  it('findFeature 命中 4 个 key', () => {
    expect(findFeature(DEFAULT_FEATURES, 'three_mark')?.name).toBe('追三标记');
    expect(findFeature(DEFAULT_FEATURES, 'card_tracker')?.id).toBe(4);
    expect(findFeature(DEFAULT_FEATURES, 'nope' as any)).toBeUndefined();
  });
});

describe('settings 模型', () => {
  it('默认值与约定一致', () => {
    expect(DEFAULT_SETTINGS.threeMarkCosts).toEqual([4, 5]);
    expect(DEFAULT_SETTINGS.level3Warning).toHaveLength(7);
    expect(DEFAULT_SETTINGS.showCardTracker).toBe(false);
    expect(SETTING_FEATURE_MAP.showCardTracker).toBe('card_tracker');
  });

  it('老存档缺字段/脏数据被补齐', () => {
    const s = normalizeSettings({ level3Warning: [true], showItemsSeconds: 0, threeMarkCosts: [] } as any);
    expect(s.level3Warning).toHaveLength(7);
    expect(s.level3Warning[0]).toBe(true);
    expect(s.showItemsSeconds).toBeGreaterThan(0);
    expect(s.threeMarkCosts).toEqual([4, 5]);
    expect(s.showCompsWin).toBe(DEFAULT_SETTINGS.showCompsWin);
  });
});
