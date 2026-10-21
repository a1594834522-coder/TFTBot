import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { analyzePool, threeStarWarnings } from '../src/game/cardTracker';
import { buildSnapshot } from '../src/game/roster';
import { dataset } from '../src/game/tft-data';
import { allComps, metatftComps } from '../src/game/comps-sources';
import { createCore } from '../src/core/index';
import { replayEvents, replayText } from '../src/core/replay';
import { createTrickController } from '../src/windows/trick/controller';
import { createFakeCube } from './helpers/fakeCube';
import { createSettingsStore } from '../src/core/settings-store';
import { normalizeSettings } from '../src/core/settings';
import TrickPage from '../src/windows/trick/TrickPage.vue';

const catalog = [{ character_id: 'X', cost: 4 }];
const poolFor = (copies: number[], costs = [4]) => analyzePool({ X: copies.reduce((a, b) => a + b, 0) }, catalog, {
  costs, players: copies.map((n, i) => ({ player: `P${i}`, ownedByName: { X: n } })),
});

describe('已确认业务错误的回归', () => {
  it('多人各 4 张不能拼成一个人的追三进度', () => {
    expect(threeStarWarnings(poolFor([4, 4]))).toEqual([]);
  });
  it('一人 8 张、另一人 1 张时仍预警，持有 8 张者可补齐三星', () => {
    expect(threeStarWarnings(poolFor([8, 1]))[0]).toMatchObject({ neededForThree: 1, remaining: 1 });
    expect(threeStarWarnings(poolFor([8, 2]))).toEqual([]);
  });
  it('预警尊重费用过滤，已经三星的玩家不产生追三预警', () => {
    expect(threeStarWarnings(poolFor([8], [5]))).toEqual([]);
    expect(threeStarWarnings(poolFor([9]))).toEqual([]);
  });
  it('S18 阵容中的每个英雄都能在同赛季目录中解析', () => {
    expect(dataset.supportSets).toContain(18);
    expect(dataset.charactersOf(18)).toHaveLength(74);
    expect(metatftComps(18)).toHaveLength(60);
    for (const comp of allComps({ set: 18 })) for (const unit of comp.units) {
      expect(dataset.character(18, unit.character_id), unit.character_id).toBeDefined();
    }
  });
  it('我方按原始 localplayer 标记识别，不依赖血量或排序', () => {
    const snap = buildSnapshot([
      { summoner: 'Me', health: 10, localplayer: '1' },
      { summoner: 'Foe', health: 100 },
    ], []);
    const ctrl = createTrickController({ core: { snapshot: () => snap, onGame: () => () => {} } });
    expect(ctrl.state().ready).toBe(true);
    expect(ctrl.state().me?.summoner).toBe('Me');
    ctrl.apply(snap);
    expect(ctrl.state().me?.summoner).toBe('Me');
    ctrl.apply(buildSnapshot([{ summoner: 'Foe', health: 100 }], []));
    expect(ctrl.state().me).toBeNull();
    ctrl.apply(null);
    expect(ctrl.state().players).toEqual([]);
    expect(ctrl.state().ready).toBe(false);
    ctrl.dispose();
  });
  it('无姓名玩家按排序前的事件顺序匹配，有姓名记录不误配缺失玩家', () => {
    const roster = [{ summoner: 'Low', health: 10 }, { summoner: 'High', health: 100 }];
    const positional = buildSnapshot(roster, [{ champions: [{ name: 'LowUnit', level: 1 }] }, { champions: [{ name: 'HighUnit', level: 1 }] }]);
    expect(positional.players[0].champions[0].name).toBe('HighUnit');
    const named = buildSnapshot(roster, [{ name: 'High#', is_locale: true, champions: [{ name: 'HighUnit', level: 1 }] }]);
    expect(named.players.find((p) => p.summoner === 'Low')?.champions).toEqual([]);
    expect(named.players[0].isLocal).toBe(true);
  });
  it('保留同名独立棋子的棋盘、备战席坐标、星级与装备', async () => {
    const snap = buildSnapshot([{ summoner: 'Me', health: 100, is_locale: true }], [{ summoner: 'Me', champions: [
      { name: 'DA_18_Caitlyn', level: 1, position: 5, item_1: 'DA_Component_BFSword' },
      { name: 'DA_18_Caitlyn', level: 2, position: 28, item_1: 'DA_Component_RecurveBow' },
    ] }]);
    const ctrl = createTrickController({ core: { snapshot: () => snap, onGame: () => () => {} } });
    ctrl.apply(snap);
    expect(snap.players[0].champions).toHaveLength(1);
    const html = await renderToString(createSSRApp({ render: () => h(TrickPage, { controller: ctrl }) }));
    expect(html).toContain('data-slot="5" data-character-id="DA_18_Caitlyn" data-level="1"');
    expect(html).toContain('data-slot="28" data-character-id="DA_18_Caitlyn" data-level="2"');
    ctrl.dispose();
  });
  it('出局玩家的副本回池，不再占用公共牌池', () => {
    const snap = buildSnapshot([{ summoner: 'Out', health: 0 }], [{ summoner: 'Out', champions: [{ name: 'X', num: 8 }] }]);
    expect(snap.ownedByName).toEqual({});
  });
  it('非法实时事件不会抛错或覆盖有效快照，空 roster 清掉旧局棋子', () => {
    const f = createFakeCube();
    const core = createCore({ cube: f.cube, catalog });
    f.emit('tft_roster', '[{"summoner":"Me","health":10}]');
    f.emit('players_info', '[{"summoner":"Me","champions":[{"name":"X","num":8}]}]');
    const before = core.snapshot();
    expect(() => f.emit('tft_roster', '{}')).not.toThrow();
    expect(() => f.emit('players_info', '[{"champions":{}}]')).not.toThrow();
    expect(core.snapshot()).toBe(before);
    expect(core.warnings()).toHaveLength(1);
    f.emit('tft_roster', '[]');
    f.emit('tft_roster', '[{"summoner":"Me","health":100}]');
    expect(core.snapshot()?.ownedByName).toEqual({});
    core.dispose();
  });
  it('实时与回放使用同样的校验和按玩家预警规则', () => {
    const events = [
      { key: 'tft_roster', value: '[{"summoner":"A","health":100},{"summoner":"B","health":100}]' },
      { key: 'players_info', value: '[{"summoner":"A","champions":[{"name":"X","num":8}]},{"summoner":"B","champions":[{"name":"X","num":1}]}]' },
      { key: 'players_info', value: '{}' },
    ];
    const replay = replayEvents({ events }, { catalog });
    expect(replay.invalid).toBe(1);
    expect(replay.finalWarnings).toHaveLength(1);
    const objectValue = replayText(JSON.stringify({ key: 'tft_roster', value: [{ summoner: 'A', health: 100 }] }));
    expect(objectValue.final?.alive).toBe(1);
  });
  it('连续更改多个设置不会互相覆盖，重新加载仍保留全部修改', async () => {
    const f = createFakeCube();
    const make = () => createSettingsStore({ cube: f.cube, getOwner: () => 'local', local: null });
    const store = make(); await store.load();
    await Promise.all([store.patch({ showWarning: false }), store.patch({ showLevel: false }), store.patch({ showItems: false })]);
    expect(await make().load()).toMatchObject({ showWarning: false, showLevel: false, showItems: false });
  });
  it('原始预警从 6 张开始，警告费用和追三标记费用分别受设置控制', () => {
    const snap = buildSnapshot([{ summoner: 'Me', health: 100, localplayer: 1 }], [{ summoner: 'Me', champions: [{ name: 'X', num: 6 }] }]);
    let settings = normalizeSettings({ threeMarkCosts: [5] });
    const ctrl = createTrickController({ core: { snapshot: () => snap, onGame: () => () => {} }, catalog, getSettings: () => settings });
    ctrl.apply(snap);
    expect(ctrl.state().warnings).toHaveLength(1);
    expect(ctrl.state().marks).toEqual([]);
    settings = normalizeSettings({ threeMarkCosts: [4], level3Warning: [false, false, false, false, false, true, true] });
    ctrl.refresh();
    expect(ctrl.state().warnings).toEqual([]);
    expect(ctrl.state().marks).toEqual(['X']);
    ctrl.dispose();
  });
});
