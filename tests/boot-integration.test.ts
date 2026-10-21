import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { find, roots } from './helpers/renderer';
import { createFakeCube } from './helpers/fakeCube';
import { boot, openCharacterWindow, detectWindow, type BootHandle } from '../src/boot/lean';
import { SHADOW_DUMP_KEY } from '../src/core/shadow';

vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>();
  const { host, node, roots } = await import('./helpers/renderer');
  const renderer = vue.createRenderer(host);
  return {
    ...vue,
    createApp: (...args: Parameters<typeof renderer.createApp>) => {
      const app = renderer.createApp(...args);
      const mount = app.mount.bind(app);
      app.mount = ((el: string) => {
        const root = node(); roots.set(el, root);
        return mount(root);
      }) as typeof app.mount;
      return app;
    },
  };
});

const handles: BootHandle[] = [];
const start = async (opts: Parameters<typeof boot>[0]) => {
  const handle = await boot({ rank: null, ...opts });
  handles.push(handle);
  return handle;
};
const flush = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } };
afterEach(() => {
  for (const h of handles.splice(0)) h.dispose();
  roots.clear(); vi.unstubAllGlobals();
});

describe('boot 实际组件联动', () => {
  it('设置页点击能持久化并让另一窗口立即重渲染', async () => {
    const f = createFakeCube();
    const trick = await start({ cube: f.cube, window: 'trick', el: '#trick' });
    await start({ cube: f.cube, window: 'settings', el: '#settings' });
    const root = roots.get('#trick')!;
    expect(find(root, (n) => n.props['data-warn-count'] !== undefined)).toBeTruthy();
    const row = find(roots.get('#settings')!, (n) => n.props['data-setting'] === 'showWarning')!;
    find(row, (n) => n.type === 'button')!.props.onClick();
    await flush();
    expect(trick.lean.settings.get().showWarning).toBe(false);
    expect(find(root, (n) => n.props['data-warn-count'] !== undefined)).toBeUndefined();
    expect(JSON.parse(f.store.get('tftbot:settings:local')!).showWarning).toBe(false);
  });

  it('赛季切换同步窗口、计算目录与阵容数据，重启恢复保存的赛季', async () => {
    const f = createFakeCube();
    const a = await start({ cube: f.cube, window: 'tracker', el: '#tracker', initialSet: 18 });
    const b = await start({ cube: f.cube, window: 'trick', el: '#trick', initialSet: 18 });
    find(roots.get('#tracker')!, (n) => n.type === 'button' && n.props['data-set'] === 18)!.props.onClick();
    await flush();
    expect(a.lean.currentSet()).toBe(18);
    expect(b.lean.currentSet()).toBe(18);
    expect(find(roots.get('#tracker')!, (n) => n.props['data-comps'] > 0)).toBeTruthy();
    expect(a.core.pool().some((r) => r.champion.startsWith('DA_'))).toBe(true);
    const resumed = await start({ cube: f.cube, window: 'none' });
    expect(resumed.lean.currentSet()).toBe(18);
    await resumed.lean.setCurrentSet(999);
    expect(resumed.lean.currentSet()).toBe(18);
  });

  it('恢复英雄选择，已经打开的详情窗口也能切换英雄', async () => {
    const f = createFakeCube({ windows: ['main', 'characterwin'] });
    await openCharacterWindow(f.cube, 'DA_18_Caitlyn');
    await start({ cube: f.cube, window: 'characterwin', initialSet: 18 });
    await flush();
    expect(find(roots.get('#app')!, (n) => n.props['data-character-id'] === 'DA_18_Caitlyn')).toBeTruthy();
    await openCharacterWindow(f.cube, 'DA_18_Ahri');
    await flush();
    expect(find(roots.get('#app')!, (n) => n.props['data-character-id'] === 'DA_18_Ahri')).toBeTruthy();
  });

  it('销毁并重开窗口不会累积事件监听或计时器', async () => {
    const f = createFakeCube();
    for (let i = 0; i < 3; i++) {
      const h = await start({ cube: f.cube, window: 'trick' });
      expect(f.listenerCounts().game).toBe(1);
      h.dispose(); h.dispose();
      expect(f.listenerCounts()).toEqual({ game: 0, received: 0, invoked: 0 });
    }
  });

  it('旧宿主的赛季偏好和列表不能重新启用历史赛季', async () => {
    const f = createFakeCube();
    const h = await start({ cube: f.cube, window: 'trick', supportSets: [16, 17], initialSet: 18 });
    expect(h.lean.currentSet()).toBe(18);
    expect(h.lean.supportSets).toEqual([18]);
    expect(find(roots.get('#app')!, (n) => n.type === 'button' && n.props['data-set'] === 16)).toBeUndefined();
    await h.lean.setCurrentSet(16);
    expect(h.lean.currentSet()).toBe(18);
  });

  it('shadow 遵循存储开关，持久化保持 2000 条上限且可清空', async () => {
    const local = new Map([['tftbot:shadow', '1']]);
    const storage = { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => { local.set(k, v); } };
    const f = createFakeCube();
    const h = await start({ cube: f.cube, window: 'none', local: storage });
    for (let i = 0; i < 2002; i++) f.emit('future-event', '{}');
    expect(h.shadow?.size()).toBe(2000);
    expect(local.get(SHADOW_DUMP_KEY)?.split('\n')).toHaveLength(2000);
    (globalThis as any).__TFTBOT_SHADOW__.clear();
    expect(local.get(SHADOW_DUMP_KEY)).toBe('');
    const off = await start({ cube: f.cube, window: 'none', local: storage, shadow: false });
    expect(off.shadow).toBeNull();
  });

  it('宿主返回不透明窗口 ID 时按 URL 识别页面', () => {
    const f = createFakeCube();
    f.cube.windows.current.id = () => 'window-123';
    vi.stubGlobal('location', { pathname: '/src/pages/trick/index.html', hash: '' });
    expect(detectWindow(f.cube)).toBe('trick');
    expect((globalThis as any).__tftbot__.boot).toBe(boot);
  });
});
