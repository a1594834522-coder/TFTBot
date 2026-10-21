import { describe, expect, it } from 'vitest';
import { createCompsStore, COMPS_PREFIX, PIN_PREFIX, type TeamComp } from '../src/core/comps-store';
import { createFakeCube } from './helpers/fakeCube';

function makeStore(owner = 'u1') {
  const f = createFakeCube();
  const store = createCompsStore({
    cube: f.cube,
    getOwner: () => owner,
    now: () => 1000,
    genId: () => 'id-' + Math.random().toString(36).slice(2, 6),
  });
  return { f, store };
}

const comp = (name: string, set = 17): Omit<TeamComp, 'id' | 'updatedAt'> => ({
  name,
  set,
  units: [{ character_id: 'TFT17_Teemo', position: 3 }, { character_id: 'TFT17_Garen' }],
  tags: ['reroll'],
});

describe('comps-store（我的阵容）', () => {
  it('新增/列出/按赛季过滤', async () => {
    const { store } = makeStore();
    const a = await store.add(comp('A', 17));
    await store.add(comp('B', 16));
    expect(a.id).toBeTruthy();
    expect((await store.list()).length).toBe(2);
    expect((await store.list(17)).map((c) => c.name)).toEqual(['A']);
  });

  it('持久化到 tftbot:comps:<owner>，同 owner 可重新读回', async () => {
    const f = createFakeCube();
    const s1 = createCompsStore({ cube: f.cube, getOwner: () => 'u9' });
    await s1.add(comp('持久化'));
    const raw = f.store.get(`${COMPS_PREFIX}u9`)!;
    expect(JSON.parse(raw)[0].name).toBe('持久化');
    const s2 = createCompsStore({ cube: f.cube, getOwner: () => 'u9' });
    expect((await s2.list())[0].name).toBe('持久化');
  });

  it('不同 owner 互不干扰', async () => {
    const f = createFakeCube();
    const a = createCompsStore({ cube: f.cube, getOwner: () => 'A' });
    const b = createCompsStore({ cube: f.cube, getOwner: () => 'B' });
    await a.add(comp('A的'));
    expect(await b.list()).toEqual([]);
  });

  it('update 会刷新 updatedAt 且能改字段', async () => {
    const { store } = makeStore();
    const c = await store.add(comp('A'));
    const next = await store.update(c.id, { name: 'A2' });
    expect(next!.name).toBe('A2');
    expect(next!.updatedAt).toBe(1000);
    expect(await store.update('nope', { name: 'x' })).toBeNull();
  });

  it('remove', async () => {
    const { store } = makeStore();
    const c = await store.add(comp('A'));
    expect(await store.remove(c.id)).toBe(true);
    expect(await store.remove(c.id)).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('列表按 updatedAt 倒序', async () => {
    const f = createFakeCube();
    let t = 100;
    const store = createCompsStore({ cube: f.cube, getOwner: () => 'u', now: () => (t += 10) });
    const a = await store.add(comp('旧'));
    const b = await store.add(comp('新'));
    const list = await store.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});

describe('comps-store（pin 当前阵容）', () => {
  it('默认 none', async () => {
    const { store } = makeStore();
    expect(await store.getPinned()).toEqual({ type: 'none', set: 0, details: '' });
  });

  it('set/get/clear，details 保持原样字符串', async () => {
    const { f, store } = makeStore();
    const details = JSON.stringify({ units: [{ character_id: 'X' }], expanded: false });
    const p = await store.setPinned({ type: 'mycomps', set: 18, details });
    expect(p).toEqual({ type: 'mycomps', set: 18, details });
    expect(JSON.parse(f.store.get(`${PIN_PREFIX}u1`)!).details).toBe(details);
    expect((await store.getPinned()).type).toBe('mycomps');
    await store.clearPinned();
    expect((await store.getPinned()).type).toBe('none');
  });

  it('partial 更新不会清掉已有字段', async () => {
    const { store } = makeStore();
    await store.setPinned({ type: 'popular', set: 18, details: '{"a":1}' });
    const p = await store.setPinned({ type: 'official' } as any);
    expect(p.type).toBe('official');
    expect(p.details).toBe('{"a":1}');
  });
});
