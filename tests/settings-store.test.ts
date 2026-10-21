import { describe, expect, it } from 'vitest';
import { createSettingsStore, SETTINGS_PREFIX, CUSTOMIZED_PREFIX } from '../src/core/settings-store';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { createFakeCube } from './helpers/fakeCube';

function makeStore(owner = 'user-1', initial: Record<string, string> = {}) {
  const f = createFakeCube();
  for (const [k, v] of Object.entries(initial)) f.store.set(k, v);
  const localMap = new Map<string, string>();
  const store = createSettingsStore({
    cube: f.cube,
    getOwner: () => owner,
    local: {
      getItem: (k: string) => localMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        localMap.set(k, v);
      },
    } as any,
  });
  return { f, store, localMap };
}

describe('settings-store（存储键/双写/默认值）', () => {
  it('存储键是 tftbot:settings:<owner>', async () => {
    const { store } = makeStore('abc');
    await expect(store.storageKey()).resolves.toBe(`${SETTINGS_PREFIX}abc`);
  });

  it('空存储时回落到默认值', async () => {
    const { store } = makeStore();
    const s = await store.load();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('读取已有存档并补齐缺失字段', async () => {
    const { store } = makeStore('u1', { [`${SETTINGS_PREFIX}u1`]: JSON.stringify({ showCardTracker: true, level3Warning: [true] }) });
    const s = await store.load();
    expect(s.showCardTracker).toBe(true);
    expect(s.level3Warning).toHaveLength(7);
    expect(s.threeMarkCosts).toEqual([4, 5]);
  });

  it('损坏 JSON 不致命', async () => {
    const { store } = makeStore('u1', { [`${SETTINGS_PREFIX}u1`]: '{oops' });
    await expect(store.load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('save 同时写入宿主存储与页面 localStorage', async () => {
    const { f, store, localMap } = makeStore('u1');
    await store.load();
    await store.save({ ...DEFAULT_SETTINGS, showThreeMark: false });
    expect(JSON.parse(f.store.get(`${SETTINGS_PREFIX}u1`)!).showThreeMark).toBe(false);
    expect(JSON.parse(localMap.get(`${SETTINGS_PREFIX}u1`)!).showThreeMark).toBe(false);
  });

  it('patch 会记录 user-customized 键', async () => {
    const { f, store } = makeStore('u1');
    await store.load();
    await store.patch({ showCardTracker: true });
    expect(await store.isCustomized('showCardTracker')).toBe(true);
    const raw = f.store.get(`${CUSTOMIZED_PREFIX}u1`)!;
    expect(JSON.parse(raw)).toContain('showCardTracker');
  });
});

describe('settings-store（解锁后自动勾开）', () => {
  it('解锁的 4 项会被自动打开', async () => {
    const { store } = makeStore('u1');
    await store.load();
    const s = await store.applyUnlockedFeatures([
      { key: 'three_mark', unlocked: true },
      { key: 'three_star_warning', unlocked: true },
      { key: 'overall_record', unlocked: true },
      { key: 'card_tracker', unlocked: true },
    ]);
    expect(s.showThreeMark).toBe(true);
    expect(s.showWarning).toBe(true);
    expect(s.showOverallRecord).toBe(true);
    expect(s.showCardTracker).toBe(true);
  });

  it('用户主动关掉的项不会被强行打开（与约定一致）', async () => {
    const { store } = makeStore('u1');
    await store.load();
    await store.patch({ showCardTracker: false }, { userAction: true });
    const s = await store.applyUnlockedFeatures([{ key: 'card_tracker', unlocked: true }]);
    expect(s.showCardTracker).toBe(false);
  });

  it('force 可以覆盖用户选择', async () => {
    const { store } = makeStore('u1');
    await store.load();
    await store.patch({ showCardTracker: false }, { userAction: true });
    const s = await store.applyUnlockedFeatures([{ key: 'card_tracker', unlocked: true }], { force: true });
    expect(s.showCardTracker).toBe(true);
  });

  it('未解锁的项不动', async () => {
    const { store } = makeStore('u1');
    await store.load();
    const before = store.get().showOverallRecord;
    const s = await store.applyUnlockedFeatures([{ key: 'overall_record', unlocked: false }]);
    expect(s.showOverallRecord).toBe(before);
  });
});
