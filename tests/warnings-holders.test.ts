import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { analyzePool, threeStarWarnings, DEFAULT_POOL_BY_COST, neededForThreeStar } from '../src/game/cardTracker';
import TrickPage from '../src/windows/trick/TrickPage.vue';
import { createTrickController } from '../src/windows/trick/controller';
import { buildSnapshot } from '../src/game/roster';
import { dataset } from '../src/game/tft-data';

const catalog = dataset.charactersOf(18).length
  ? dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }))
  : dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));

const SET = dataset.charactersOf(18).length ? 18 : 16;

describe('池子数量与设计一致（xe(cost)）', () => {
  it('1/2/3/4/5 费 = 29/22/18/10/9', () => {
    expect(DEFAULT_POOL_BY_COST).toMatchObject({ 1: 29, 2: 22, 3: 18, 4: 10, 5: 9 });
  });

  it('4 费 8 张时还差 1 张、池里只剩 2 张但够补 → 仍可三星', () => {
    expect(neededForThreeStar(8)).toBe(1);
    const rows = analyzePool({ [catalog.find((c) => c.cost === 4)!.character_id]: 8 }, catalog, { costs: [4] });
    const row = rows.find((r) => r.owned === 8)!;
    expect(row.pool).toBe(10);
    expect(row.remaining).toBe(2);
    expect(row.canThreeStar).toBe(true);
    expect(threeStarWarnings([row])).toHaveLength(1);
  });
});

describe('“谁在追”分摊（holders）', () => {
  const target = catalog.find((c) => c.cost === 4)!;

  it('analyzePool 按玩家分摊副本数', () => {
    const rows = analyzePool({ [target.character_id]: 6 }, catalog, {
      costs: [4],
      players: [
        { player: 'Me#1', ownedByName: { [target.character_id]: 4 } },
        { player: 'Foe#2', ownedByName: { [target.character_id]: 2 } },
      ],
    });
    const row = rows.find((r) => r.champion === target.character_id)!;
    expect(row.holders).toEqual([
      { player: 'Me#1', copies: 4 },
      { player: 'Foe#2', copies: 2 },
    ]);
  });

  it('不传 players 就没有 holders（保持旧行为）', () => {
    const rows = analyzePool({ [target.character_id]: 3 }, catalog, { costs: [4] });
    expect(rows.find((r) => r.champion === target.character_id)!.holders).toBeUndefined();
  });

  it('同名的多条目会合并、0 张不出现', () => {
    const rows = analyzePool({}, catalog, {
      costs: [4],
      players: [{ player: 'A', ownedByName: { [target.character_id]: 0 } }],
    });
    expect(rows.find((r) => r.champion === target.character_id)!.holders).toBeUndefined();
  });
});

describe('trick 页面把 holders 渲染出来（其他人也在预警里）', () => {
  it('别人攒到 8 张 → 出现在预警且带玩家名', async () => {
    // 构造：别人手上 8 张 4 费，我方 0 张
    const target = catalog.find((c) => c.cost === 4)!;
    const snap = buildSnapshot(
      [
        { summoner: 'Me', tag_line: '1', health: 40, index: 0 },
        { summoner: 'Foe', tag_line: '2', health: 35, index: 1 },
      ],
      [
        { summoner: 'Me', tag_line: '1', champions: [] },
        { summoner: 'Foe', tag_line: '2', champions: [{ name: target.character_id, num: 8 }] },
      ],
    );
    const ctrl = createTrickController({ core: { snapshot: () => snap, onGame: () => () => {} }, catalog, costs: [4] });
    ctrl.apply(snap, 'players_info');

    const st = ctrl.state();
    expect(st.warnings.length).toBeGreaterThan(0);
    const warn = st.warnings.find((w) => w.champion === target.character_id)!;
    expect(warn.holders?.some((x) => x.player.includes('Foe'))).toBe(true);

    const html = await renderToString(createSSRApp({ render: () => h(TrickPage, { controller: ctrl, set: SET }) }));
    expect(html).toContain(`data-warn="${target.character_id}"`);
    expect(html).toMatch(/data-holder="Foe#2"/);
    expect(html).toMatch(/data-copies="8"/);
    ctrl.dispose();
  });
});
