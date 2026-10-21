import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import TrickPage from '../src/windows/trick/TrickPage.vue';
import { createTrickController } from '../src/windows/trick/controller';
import type { TrickCorePort } from '../src/windows/trick/controller';
import { buildSnapshot } from '../src/game/roster';
import { dataset } from '../src/game/tft-data';

const catalog = dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));

function coreWithSnapshot(snap: any): TrickCorePort {
  return { snapshot: () => snap, onGame: () => () => {} };
}

const snap = buildSnapshot(
  [
    { summoner: 'Me', tag_line: '1', health: 60, index: 0 },
    { summoner: 'Foe', tag_line: '2', health: 40, index: 1 },
  ],
  [
    { summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 3 }, { name: 'DA_18_Ahri', level: 2 }] },
    { summoner: 'Foe', tag_line: '2', champions: [{ name: 'DA_18_Caitlyn', level: 1 }] },
  ],
);

async function renderPage(ctrl: any, props: Record<string, any> = {}) {
  return renderToString(createSSRApp({ render: () => h(TrickPage, { controller: ctrl, ...props }) }));
}

describe('trick 页面（SSR）', () => {
  it('渲染顶栏/棋盘/记牌器/玩家列表', async () => {
    const ctrl = createTrickController({ core: coreWithSnapshot(snap), catalog, costs: [1, 2] });
    ctrl.apply(snap, 'tft_roster');
    const html = await renderPage(ctrl);
    // 顶栏
    expect(html).toContain('data-alive="2"');
    expect(html).toContain('Me#1');
    expect(html).toContain('tft_roster');
    // 棋盘 37 格 + 我方 2 只棋子
    expect((html.match(/data-slot="/g) ?? []).length).toBe(37);
    expect(html).toContain('凯特琳');
    // 记牌器（costs 含 1/2 费 → Tristana 在列）
    expect(html).toContain('data-champion="DA_18_Caitlyn"');
    // 玩家列表
    expect(html).toContain('data-player-count="2"');
    expect(html).toContain('data-health="60"');
    ctrl.dispose();
  });

  it('无数据时显示空态，不炸', async () => {
    const ctrl = createTrickController({ core: coreWithSnapshot(null), catalog });
    const html = await renderPage(ctrl);
    expect(html).toContain('data-ready="false"');
    expect(html).toContain('等待对局');
    expect(html).toContain('等待数据');
    ctrl.dispose();
  });

  it('选中棋子后渲染悬浮卡', async () => {
    const ctrl = createTrickController({ core: coreWithSnapshot(snap), catalog });
    ctrl.apply(snap, 'players_info');
    ctrl.select('DA_18_Caitlyn');
    const html = await renderPage(ctrl, { set: 18 });
    expect(html).toContain('data-character-id="DA_18_Caitlyn"');
    expect(html).toContain('2费');
    ctrl.dispose();
  });

  it('三星预警面板显示条目（命中时）', async () => {
    // 构造只差 1 张的局面：全场已拿 8 张 Tristana（3★=9 张里的 8 张）
    const near = buildSnapshot(
      [{ summoner: 'Me', tag_line: '1', health: 50, index: 0 }],
      [{ summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 2 }, { name: 'DA_18_Caitlyn', level: 2 }, { name: 'DA_18_Caitlyn', level: 1 }, { name: 'DA_18_Caitlyn', level: 1 }] }],
    );
    const ctrl = createTrickController({ core: coreWithSnapshot(near), catalog, costs: [1, 2] });
    ctrl.apply(near, 'players_info');
    const html = await renderPage(ctrl);
    expect(html).toContain('data-warn-count="1"');
    expect(html).toContain('差 1');
    ctrl.dispose();
  });
});
