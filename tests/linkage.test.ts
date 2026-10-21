import { describe, expect, it, vi } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import CompsPanel from '../src/ui/CompsPanel.vue';
import CharacterPage from '../src/windows/characterwin/CharacterPage.vue';
import TrackerPage from '../src/windows/tracker/TrackerPage.vue';
import { createTrickController } from '../src/windows/trick/controller';
import { buildSnapshot } from '../src/game/roster';
import { dataset } from '../src/game/tft-data';
import { metatftComps } from '../src/game/comps-sources';
import { normalizeSettings } from '../src/core/settings';
import { createFakeCube } from './helpers/fakeCube';
import { openCharacterWindow, CHARACTER_KEY } from '../src/boot/lean';

const catalog = dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));
const snap = buildSnapshot(
  [{ summoner: 'Me', tag_line: '1', health: 30, index: 0 }],
  [{ summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 2 }] }],
);

describe('阵容面板 → characterwin 联动', () => {
  it('小棋盘棋子点击会 emit selectCharacter（事件绑定存在）', async () => {
    const onPick = vi.fn();
    const comps = metatftComps(18);
    const html = await renderToString(
      createSSRApp({
        render: () => h(CompsPanel, { comps, selectedId: comps[0].id, source: 'metatft', onSelectCharacter: onPick }),
      }),
    );
    // SSR 不触发点击，但棋盘棋子带 data-character-id，事件链由 openCharacterWindow 单测覆盖
    expect(html).toMatch(/data-slot="\d+" data-character-id="[^"]+"/);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('openCharacterWindow 写入待看英雄并显示窗口', async () => {
    const f = createFakeCube({ windows: ['background', 'main', 'characterwin'] });
    const ok = await openCharacterWindow(f.cube, 'DA_18_Caitlyn');
    expect(ok).toBe(true);
    expect(f.store.get(CHARACTER_KEY)).toBe('DA_18_Caitlyn');
    expect(f.windowOps.some((op: any) => op.op === 'show' && op.id === 'characterwin')).toBe(true);
  });

  it('窗口不存在时返回 false，但仍然记下了英雄', async () => {
    const f = createFakeCube({ windows: ['background', 'main'] });
    const ok = await openCharacterWindow(f.cube, 'DA_18_Ahri');
    expect(ok).toBe(false);
    expect(f.store.get(CHARACTER_KEY)).toBe('DA_18_Ahri');
  });

  it('tracker 把 onOpenCharacter 透传给面板（有面板即接线）', async () => {
    const ctrl = createTrickController({ core: { snapshot: () => snap, onGame: () => () => {} }, catalog, costs: [2] });
    ctrl.apply(snap, 'players_info');
    const onOpen = vi.fn();
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(TrackerPage, { controller: ctrl, comps: metatftComps(18), set: 18, onOpenCharacter: onOpen }),
      }),
    );
    expect(html).toContain('data-section="comps"');
    expect(onOpen).not.toHaveBeenCalled();
    ctrl.dispose();
  });
});

describe('characterwin 设置门控', () => {
  const render = (settings: any) =>
    renderToString(
      createSSRApp({ render: () => h(CharacterPage, { characterId: 'DA_18_Caitlyn', set: 18, settings }) }),
    );

  it('showItems 关掉 → 不渲染推荐装备', async () => {
    const on = await render(normalizeSettings({ showItems: true }));
    const off = await render(normalizeSettings({ showItems: false }));
    expect(on).toContain('data-section="items"');
    expect(off).not.toContain('data-section="items"');
  });

  it('showAugments 关掉 → 不渲染 MetaTFT 单卡表现', async () => {
    const unit = metatftComps(18).find((c) => c.details?.unitStats?.length)!.details!.unitStats![0].unit;
    const on = await renderToString(
      createSSRApp({
        render: () => h(CharacterPage, { characterId: unit, set: 18, settings: normalizeSettings({ showAugments: true }) }),
      }),
    );
    const off = await renderToString(
      createSSRApp({
        render: () => h(CharacterPage, { characterId: unit, set: 18, settings: normalizeSettings({ showAugments: false }) }),
      }),
    );
    expect(on).toContain('data-section="unit-stats"');
    expect(off).not.toContain('data-section="unit-stats"');
  });

  it('未传 settings 保持全开', async () => {
    const html = await render(undefined);
    expect(html).toContain('data-section="items"');
  });
});
