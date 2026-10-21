import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import TrackerPage from '../src/windows/tracker/TrackerPage.vue';
import CharacterPage from '../src/windows/characterwin/CharacterPage.vue';
import { createTrickController } from '../src/windows/trick/controller';
import type { TrickCorePort } from '../src/windows/trick/controller';
import { buildSnapshot } from '../src/game/roster';
import { dataset } from '../src/game/tft-data';
import { comps as compsData } from '../src/game/comps-data';
import { pageForWindow } from '../src/boot/lean';

const catalog = dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));

const snap = buildSnapshot(
  [
    { summoner: 'Me', tag_line: '1', health: 72, index: 0 },
    { summoner: 'Foe', tag_line: '2', health: 40, index: 1 },
    { summoner: 'Out', tag_line: '3', health: 0, index: 2 },
  ],
  [
    { summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 3 }, { name: 'DA_18_Ahri', level: 2 }] },
    { summoner: 'Foe', tag_line: '2', champions: [{ name: 'DA_18_Caitlyn', level: 2 }] },
    { summoner: 'Out', tag_line: '3', champions: [] },
  ],
);

function coreOf(s: any): TrickCorePort {
  return { snapshot: () => s, onGame: () => () => {} };
}

describe('tracker 页面（SSR）', () => {
  it('渲染存活/玩家列表/记牌器/推荐阵容', async () => {
    const ctrl = createTrickController({ core: coreOf(snap), catalog, costs: [1, 2] });
    ctrl.apply(snap, 'players_info');
    const comps = compsData.comps(18);
    const html = await renderToString(
      createSSRApp({ render: () => h(TrackerPage, { controller: ctrl, comps, set: 18 }) }),
    );
    expect(html).toContain('data-alive="2"');
    expect(html).toContain('data-players="3"');
    expect(html).toContain('data-player="Me#1"');
    expect(html).toContain('data-health="0"'); // 阵亡玩家存在
    expect(html).toContain('data-champion="DA_18_Caitlyn"');
    // 阵容面板：默认展示一批，并自动选中第一条（含小棋盘/羁绊/标签）
    expect(Number(html.match(/data-comps="(\d+)"/)?.[1] ?? 0)).toBeGreaterThan(0);
    expect(html).toMatch(/data-selected="[^"]+"/);
    expect(html).toContain('data-section="synergy"');
    ctrl.dispose();
  });

  it('无阵容数据/无对局时给空态', async () => {
    const ctrl = createTrickController({ core: coreOf(null), catalog });
    const html = await renderToString(createSSRApp({ render: () => h(TrackerPage, { controller: ctrl, comps: [] }) }));
    expect(html).toContain('等待数据');
    expect(html).toContain('未加载阵容数据');
    ctrl.dispose();
  });

  it('compLimit 生效', async () => {
    const ctrl = createTrickController({ core: coreOf(snap), catalog });
    ctrl.apply(snap);
    const html = await renderToString(
      createSSRApp({ render: () => h(TrackerPage, { controller: ctrl, comps: compsData.comps(18), compLimit: 2 }) }),
    );
    expect(html).toContain('data-comps="2"');
    ctrl.dispose();
  });
});

describe('characterwin 页面（SSR）', () => {
  it('渲染英雄大卡/属性/羁绊/推荐装备/相关阵容', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(CharacterPage, { characterId: 'DA_18_Caitlyn', set: 18 }) }),
    );
    expect(html).toContain('data-character-id="DA_18_Caitlyn"');
    expect(html).toContain('凯特琳');
    expect(html).toContain('data-stat="health"');
    expect(html).toContain('data-section="traits"');
    expect(html).toContain('data-section="items"');
    expect(html).toContain('无尽之刃'); // 推荐装（当前英雄的推荐装备）
    expect(html).toContain('data-section="comps"');
    // 含该英雄的阵容至少一条
    expect(Number(html.match(/data-comps="(\d+)"/)?.[1] ?? 0)).toBeGreaterThan(0);
  });

  it('未知英雄不炸（空态）', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(CharacterPage, { characterId: 'NOPE', set: 18 }) }));
    expect(html).toContain('data-comps="0"');
    expect(html).toContain('暂无');
  });
});

describe('boot 窗口分发', () => {
  it('窗口名 → 页面类型', () => {
    expect(pageForWindow('trick')).toBe('trick');
    expect(pageForWindow('tracker')).toBe('tracker');
    expect(pageForWindow('characterwin')).toBe('characterwin');
    expect(pageForWindow('character')).toBe('characterwin');
    expect(pageForWindow('main')).toBe('none');
    expect(pageForWindow('')).toBe('none');
  });
});
