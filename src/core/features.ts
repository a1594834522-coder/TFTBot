/**
 * 功能状态/功能开关（TS 版）—— membership 解析。
 *
 * 与既有的区别：把“启用策略”抽成可注入的 policy。
 *   - 'server'：完全照本实现，看服务端 unlocked（用于对齐行为/回归测试）
 *   - 'always'：全部启用（等价于本地的默认策略）
 * 这样同一份代码既能当“本实现行为本实现”，也能当开放版实现。
 */
export type FeatureKey = 'three_mark' | 'three_star_warning' | 'overall_record' | 'card_tracker';

export interface FeatureProgress {
  current: number;
  required: number;
  unlocked: boolean;
}

export interface FeatureFlag {
  id: number;
  key: FeatureKey;
  name: string;
  unlocked: boolean;
  unlockMethod?: 'play' | 'legacy_play' | null;
  play?: FeatureProgress;
  invite?: FeatureProgress;
}

/** 与 index-c77d2682.js / index-ca358bcc.js 里的内置默认表一致 */
export const DEFAULT_FEATURES: FeatureFlag[] = [
  {
    id: 1,
    key: 'three_mark',
    name: '追三标记',
    unlocked: false,
    unlockMethod: 'play',
    play: { current: 0, required: 3, unlocked: false },
    invite: { current: 0, required: 1, unlocked: false },
  },
  {
    id: 2,
    key: 'three_star_warning',
    name: '三星预警',
    unlocked: false,
    unlockMethod: 'legacy_play',
    play: { current: 0, required: 3, unlocked: false },
    invite: { current: 0, required: 3, unlocked: false },
  },
  {
    id: 3,
    key: 'overall_record',
    name: '全局战绩',
    unlocked: false,
    unlockMethod: 'legacy_play',
    play: { current: 0, required: 5, unlocked: false },
    invite: { current: 0, required: 5, unlocked: false },
  },
  {
    id: 4,
    key: 'card_tracker',
    name: '记牌器',
    unlocked: false,
    unlockMethod: null,
    play: { current: 0, required: 10, unlocked: false },
    invite: { current: 0, required: 10, unlocked: false },
  },
];

export type UnlockPolicy = 'server' | 'always';

function unlockFeature(flag: FeatureFlag): FeatureFlag {
  return {
    ...flag,
    unlocked: true,
    play: flag.play ? { ...flag.play, unlocked: true } : flag.play,
    invite: flag.invite ? { ...flag.invite, unlocked: true } : flag.invite,
  };
}

export interface MemberState {
  plan: string | null;
  startedAt: number | null;
  expireAt: number | null;
  isPermanent: boolean;
  remainingDays: number;
  legacyPermanent: boolean;
  displayStatus: 'none' | 'normal' | 'partial' | 'permanent';
  unlockedCount: number;
}

export const EMPTY_MEMBERSHIP: MemberState = {
  plan: null,
  startedAt: null,
  expireAt: null,
  isPermanent: false,
  remainingDays: 0,
  legacyPermanent: false,
  displayStatus: 'none',
  unlockedCount: 0,
};

const toMs = (n: unknown): number | null => {
  const v = typeof n === 'number' ? n : null;
  if (v == null || v === 0 || v > 1e12) return v;
  return v * 1000;
};

/** 原实现：index-*.js 的 li()/di() */
export function parseMembership(raw: any): MemberState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_MEMBERSHIP };
  const plan = raw.plan ?? null;
  const expireAtRaw = typeof raw.expireAt === 'number' ? raw.expireAt : null;
  const expireAt = toMs(expireAtRaw);
  const startedAt = toMs(raw.startedAt);
  const isPermanent = raw.isPermanent === true || expireAtRaw === Number.MAX_SAFE_INTEGER;
  const legacyPermanent = raw.legacyPermanent === true;
  let displayStatus: MemberState['displayStatus'] = 'none';
  if (['permanent', 'partial', 'normal', 'none'].includes(raw.displayStatus)) displayStatus = raw.displayStatus;
  if (displayStatus === 'none' && isPermanent) displayStatus = 'permanent';
  if (displayStatus === 'none' && plan) displayStatus = 'normal';
  const unlockedCount =
    typeof raw.unlockedCount === 'number' && raw.unlockedCount >= 0 ? Math.min(4, Math.floor(raw.unlockedCount)) : 0;
  return {
    plan,
    startedAt,
    expireAt,
    isPermanent,
    remainingDays: typeof raw.remainingDays === 'number' ? raw.remainingDays : 0,
    legacyPermanent,
    displayStatus,
    unlockedCount,
  };
}

export function isMember(m: MemberState | null): boolean {
  if (!m || !m.plan) return false;
  return !!(m.isPermanent || (m.expireAt != null && m.expireAt > Date.now()));
}

export interface FeatureSnapshot {
  features: FeatureFlag[];
  advancedFinishedCount: number;
  entertainFinishedCount: number;
  membership: MemberState;
  _diag?: unknown;
}

/** 原实现：normalizeSnapshot */
export function parseFeatureUnlockResponse(raw: any, policy: UnlockPolicy = 'server'): FeatureSnapshot {
  const src = raw && typeof raw === 'object' ? raw : {};
  const list: FeatureFlag[] = Array.isArray(src.features) && src.features.length ? src.features : DEFAULT_FEATURES;
  const features = policy === 'always' ? list.map(unlockFeature) : list.map((f) => ({ ...f }));
  const membership = policy === 'always'
    ? {
        plan: 'vip',
        startedAt: 0,
        expireAt: Number.MAX_SAFE_INTEGER,
        isPermanent: true,
        remainingDays: 9999,
        legacyPermanent: true,
        displayStatus: 'permanent' as const,
        unlockedCount: 4,
      }
    : parseMembership(src.membership);
  return {
    features,
    advancedFinishedCount: Number(src.advancedFinishedCount || 0),
    entertainFinishedCount: Number(src.entertainFinishedCount || 0),
    membership,
    _diag: src._diag,
  };
}

export function findFeature(features: FeatureFlag[], key: FeatureKey): FeatureFlag | undefined {
  return features.find((f) => f.key === key);
}

export function isFeatureUnlocked(features: FeatureFlag[], key: FeatureKey, policy: UnlockPolicy = 'server'): boolean {
  if (policy === 'always') return true;
  return findFeature(features, key)?.unlocked === true;
}

export function areAllFeaturesUnlocked(features: FeatureFlag[], policy: UnlockPolicy = 'server'): boolean {
  if (policy === 'always') return true;
  return features.length > 0 && features.every((f) => f.unlocked === true);
}

export function unlockedCount(features: FeatureFlag[], membership?: MemberState | null): number {
  if (!features.length) return 0;
  if (membership?.legacyPermanent) return features.length;
  return features.filter((f) => f.unlocked).length;
}

/** 顶栏文案（原实现 formatMemberDisplay） */
export function formatMemberDisplay(m: MemberState): string {
  switch (m.displayStatus) {
    case 'permanent':
      return '永久会员';
    case 'partial':
      return `已解锁 ${m.unlockedCount}/4`;
    case 'normal':
      return m.expireAt ? new Date(m.expireAt).toISOString().slice(0, 10) : '';
    default:
      return '未开通';
  }
}
