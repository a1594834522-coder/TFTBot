import { describe, expect, it, vi } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createSettingsStore } from '../src/core/settings-store';
import { normalizeSettings } from '../src/core/settings';
import { createFakeCube } from './helpers/fakeCube';
import TrickPage from '../src/windows/trick/TrickPage.vue';
import TrackerPage from '../src/windows/tracker/TrackerPage.vue';
import { createTrickController } from '../src/windows/trick/controller';
import { buildSnapshot } from '../src/game/roster';
import { dataset } from '../src/game/tft-data';

const catalog = dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));
const snap = buildSnapshot(
  [{ summoner: 'Me', tag_line: '1', health: 40, index: 0 }],
  [{ summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 2 }] }],
);
const coreOf = () => ({ snapshot: () => snap, onGame: () => () => {} });

async function renderTrick(settings: any, highlightIds: string[] = []) {
  const ctrl = createTrickController({ core: coreOf(), catalog, costs: [2], meName: 'Me#1' });
  ctrl.apply(snap, 'players_info');
  const html = await renderToString(createSSRApp({ render: () => h(TrickPage, { controller: ctrl, set: 18, settings, highlightIds }) }));
  ctrl.dispose();
  return html;
}

async function renderTracker(settings: any) {
  const ctrl = createTrickController({ core: coreOf(), catalog, costs: [2], meName: 'Me#1' });
  ctrl.apply(snap, 'players_info');
  const html = await renderToString(createSSRApp({ render: () => h(TrackerPage, { controller: ctrl, set: 18, settings }) }));
  ctrl.dispose();
  return html;
}

describe('设置订阅（store.subscribe）', () => {
  it('patch/save 后通知订阅者，退订后不再通知', async () => {
    const f = createFakeCube();
    const store = createSettingsStore({ cube: f.cube, getOwner: () => 'local', local: null });
    await store.load();
    const seen: boolean[] = [];
    const off = store.subscribe((s) => seen.push(s.showWarning));
    await store.patch({ showWarning: false }, { userAction: true });
    expect(seen).toEqual([false]);
    await store.save(normalizeSettings({ showWarning: true }));
    expect(seen).toEqual([false, true]);
    off();
    await store.patch({ showWarning: false }, { userAction: true });
    expect(seen).toEqual([false, true]);
  });

  it('订阅者抛错不影响其它订阅者', async () => {
    const f = createFakeCube();
    const store = createSettingsStore({ cube: f.cube, getOwner: () => 'local', local: null });
    await store.load();
    const ok = vi.fn();
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(ok);
    await store.patch({ showItems: false }, { userAction: true });
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('页面按设置门控', () => {
  it('关掉三星预警 → trick 不渲染预警区', async () => {
    const on = await renderTrick(normalizeSettings({ showWarning: true }));
    const off = await renderTrick(normalizeSettings({ showWarning: false }));
    expect(on).toContain('data-warn-count');
    expect(off).not.toContain('data-warn-count');
  });

  it('关掉记牌器 → trick/tracker 都不渲染记牌器条', async () => {
    const trickOn = await renderTrick(normalizeSettings({ showCardTracker: true }));
    const trickOff = await renderTrick(normalizeSettings({ showCardTracker: false }));
    expect(trickOn).toContain('data-champion=');
    expect(trickOff).not.toContain('data-champion=');

    const trackerOn = await renderTracker(normalizeSettings({ showCardTracker: true }));
    const trackerOff = await renderTracker(normalizeSettings({ showCardTracker: false }));
    expect(trackerOn).toContain('data-champion=');
    expect(trackerOff).not.toContain('data-champion=');
  });

  it('关掉棋盘高亮 → 不再有 highlight 格', async () => {
    const on = await renderTrick(normalizeSettings({ chessHighlight: true }), ['DA_18_Caitlyn']);
    const off = await renderTrick(normalizeSettings({ chessHighlight: false }), ['DA_18_Caitlyn']);
    expect(/class="[^"]*\bhighlight\b[^"]*"/.test(on)).toBe(true);
    expect(/class="[^"]*\bhighlight\b[^"]*"/.test(off)).toBe(false);
  });

  it('未传 settings 时保持原样（向后兼容）', async () => {
    const html = await renderTrick(undefined);
    expect(html).toContain('data-champion=');
    expect(html).toContain('data-warn-count');
  });
});
