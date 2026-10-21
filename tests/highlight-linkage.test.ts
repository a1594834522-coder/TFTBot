import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import CompsPanel from '../src/ui/CompsPanel.vue';
import TrickPage from '../src/windows/trick/TrickPage.vue';
import { createTrickController } from '../src/windows/trick/controller';
import { buildSnapshot } from '../src/game/roster';
import { dataset } from '../src/game/tft-data';
import { metatftComps } from '../src/game/comps-sources';
import { createHighlightStore, parseHighlight, HIGHLIGHT_KEY, HIGHLIGHT_COMMAND } from '../src/core/highlight';
import { pushHighlightUnits } from '../src/boot/lean';
import { createFakeCube } from './helpers/fakeCube';
import { normalizeSettings } from '../src/core/settings';

const catalog = dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));

describe('highlight store', () => {
  it('save → load 往返，compId/at 保留，去重', async () => {
    const mem = new Map<string, string>();
    const store = createHighlightStore({
      storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) },
      now: () => 1234,
    });
    const p = await store.save(['A', 'B', 'A'], 'metatft:1');
    expect(p.units).toEqual(['A', 'B']);
    expect(p.compId).toBe('metatft:1');
    expect(p.at).toBe(1234);
    expect(JSON.parse(mem.get(HIGHLIGHT_KEY)!)).toMatchObject({ units: ['A', 'B'], compId: 'metatft:1' });

    const back = await store.load();
    expect(back.units).toEqual(['A', 'B']);
  });

  it('parseHighlight 容错：坏 JSON / 空 / 非数组 → 空', () => {
    expect(parseHighlight('{oops').units).toEqual([]);
    expect(parseHighlight('').units).toEqual([]);
    expect(parseHighlight(null).units).toEqual([]);
    expect(parseHighlight({ units: 'x' }).units).toEqual([]);
    expect(parseHighlight({ units: ['A', 1, null, 'B'] }).units).toEqual(['A', 'B']);
  });

  it('clear 清空并通知订阅者', async () => {
    const mem = new Map<string, string>();
    const store = createHighlightStore({ storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) } });
    const seen: number[] = [];
    store.subscribe((p) => seen.push(p.units.length));
    await store.save(['A']);
    await store.clear();
    expect(seen).toEqual([1, 0]);
  });
});

describe('跨窗口推送（pushHighlightUnits）', () => {
  it('写 localStorage 并发给 trick 窗口', async () => {
    const f = createFakeCube({ windows: ['background', 'main', 'trick', 'tracker'] });
    const payload = await pushHighlightUnits(f.cube, ['DA_18_Caitlyn', 'DA_18_Ahri'], 'official:1');
    expect(payload.units).toHaveLength(2);
    expect(f.store.get(HIGHLIGHT_KEY)).toContain('DA_18_Caitlyn');
    const msg = f.sent.find((m) => m.command === HIGHLIGHT_COMMAND);
    expect(msg).toBeTruthy();
    expect(msg!.windowId).toBe('trick');
    expect((msg!.payload as any).compId).toBe('official:1');
  });

  it('trick 窗口不存在时仍写入（不抛）', async () => {
    const f = createFakeCube({ windows: ['background', 'main'] });
    const payload = await pushHighlightUnits(f.cube, ['A']);
    expect(payload.units).toEqual(['A']);
    expect(f.store.get(HIGHLIGHT_KEY)).toContain('"A"');
    expect(f.sent.some((m) => m.command === HIGHLIGHT_COMMAND)).toBe(false);
  });
});

describe('面板选中即推送', () => {
  it('CompsPanel 选中阵容会 emit highlightUnits（含 compId）', async () => {
    const comps = metatftComps(18);
    const calls: Array<{ units: string[]; compId?: string }> = [];
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(CompsPanel, {
            comps,
            selectedId: comps[2].id,
            onHighlightUnits: (units: string[], compId?: string) => calls.push({ units, compId }),
          }),
      }),
    );
    expect(html).toContain('data-detail');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].compId).toBe(String(comps[2].id));
    expect(calls[0].units).toEqual(comps[2].units.map((u) => u.character_id));
  });
});

describe('trick 收到高亮后棋盘标记', () => {
  const snap = buildSnapshot(
    [{ summoner: 'Me', tag_line: '1', health: 50, index: 0 }],
    [{ summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 2 }] }],
  );

  it('highlightIds 命中时对应格子带 highlight 类', async () => {
    const ctrl = createTrickController({ core: { snapshot: () => snap, onGame: () => () => {} }, catalog, costs: [2], meName: 'Me#1' });
    ctrl.apply(snap, 'players_info');
    const html = await renderToString(
      createSSRApp({ render: () => h(TrickPage, { controller: ctrl, set: 18, highlightIds: ['DA_18_Caitlyn'] }) }),
    );
    const btn = /<button[^>]*data-character-id="DA_18_Caitlyn"[^>]*>/.exec(html)?.[0] ?? '';
    expect(btn).toContain('highlight');
    ctrl.dispose();
  });

  it('拿到的 id 不在棋盘上时不会误标（只标存在的）', async () => {
    const ctrl = createTrickController({ core: { snapshot: () => snap, onGame: () => () => {} }, catalog, costs: [2], meName: 'Me#1' });
    ctrl.apply(snap, 'players_info');
    const html = await renderToString(
      createSSRApp({ render: () => h(TrickPage, { controller: ctrl, set: 18, highlightIds: ['DA_18_Ahri'], settings: normalizeSettings({ showThreeMark: false }) }) }),
    );
    const marked = [...html.matchAll(/<button[^>]*class="([^"]*highlight[^"]*)"/g)];
    expect(marked.length).toBe(0);
    ctrl.dispose();
  });
});
