import { describe, expect, it } from 'vitest';
import { createLeanBackground, LEAN_COMMANDS, LEAN_REMOVED } from '../src/app/lean';
import { SUPPORTED_COMMAND_NAMES } from '../src/app/background';
import { createFakeCube } from './helpers/fakeCube';
import { createTrickController } from '../src/windows/trick/controller';
import { buildSnapshot } from '../src/game/roster';

describe('精简版（游戏专用）命令面', () => {
  it('只注册游戏相关命令，且与声明清单一致', async () => {
    const f = createFakeCube();
    const app = createLeanBackground(f.cube, { getOwner: () => 'local' });
    await app.ready();
    expect(app.commands().sort()).toEqual([...LEAN_COMMANDS].sort());
    app.dispose();
  });

  it('非游戏面板类命令一律未实现（回 undefined）', async () => {
    const f = createFakeCube();
    const app = createLeanBackground(f.cube, { getOwner: () => 'local' });
    await app.ready();
    for (const cmd of LEAN_REMOVED) {
      await expect(f.invoke(cmd as any), cmd).resolves.toBeUndefined();
    }
    app.dispose();
  });

  it('精简清单 + 移除清单 = 完整版命令全集（不漏不重）', () => {
    const union = new Set([...LEAN_COMMANDS, ...LEAN_REMOVED]);
    for (const cmd of SUPPORTED_COMMAND_NAMES) expect(union.has(cmd), cmd + ' 未分类').toBe(true);
    // 两个清单不重叠
    const overlap = LEAN_COMMANDS.filter((c) => LEAN_REMOVED.includes(c));
    expect(overlap).toEqual([]);
    // 精简后仍保留 30+ 个游戏命令
    expect(LEAN_COMMANDS.length).toBeGreaterThanOrEqual(30);
    // 这些命令不在精简版里，应回 undefined
    expect(LEAN_COMMANDS).not.toContain('getFeaturesList');
    expect(LEAN_COMMANDS).not.toContain('requireEmailBind');
    expect(LEAN_COMMANDS).not.toContain('getObsState');
    expect(LEAN_COMMANDS).not.toContain('closeAdWindow');
  });
});

describe('精简版仍能支撑游戏功能', () => {
  it('设置/阵容/热键/数据 全部可用', async () => {
    const f = createFakeCube({ windows: ['background', 'main', 'trick'] });
    const app = createLeanBackground(f.cube, { getOwner: () => 'local', initialSet: 18 });
    await app.ready();

    // 设置
    const s = await f.invoke('setSettings', { showThreeMark: false } as any);
    expect(s.showThreeMark).toBe(false);
    expect(f.sent.some((x) => x.command === 'settingsChanged')).toBe(true);

    // 阵容 CRUD
    const comp = await f.invoke('setMyTeamComps', { name: '开局阵容', set: 18, units: [{ character_id: 'DA_18_Caitlyn' }] } as any);
    expect(comp.id).toBeTruthy();
    expect((await f.invoke('getMyTeamComps', '' as any)).length).toBe(1);

    // 热键（只留三个）
    expect((await f.invoke('getShowMainHotkey')).format).toBe('ctrl+`');
    expect(await f.invoke('getStartRecordHotkey')).toBeUndefined();

    // 数据
    expect((await f.invoke('getCharacters', 18 as any)).length).toBe(74);
    expect((await f.invoke('getItems')).length).toBeGreaterThan(150);
    expect((await f.invoke('getSupportSets'))).toContain(18);

    // 阵容：默认合并全部源；可按 source 过滤
    const all16 = await f.invoke('getComps', { set: 18, source: 'all' } as any);
    const official16 = await f.invoke('getComps', { set: 18, source: 'official' } as any);
    const blitz16 = await f.invoke('getComps', { set: 18, source: 'blitz' } as any);
    expect(all16.length).toBe(official16.length + blitz16.length + 60);
    const metatft18 = await f.invoke('getComps', { set: 18, source: 'metatft' } as any);
    expect(Array.isArray(metatft18)).toBe(true);

    app.dispose();
  });

  it('精简版数据集可直接驱动 trick 页面状态', async () => {    const f = createFakeCube();
    const app = createLeanBackground(f.cube, { getOwner: () => 'local', initialSet: 18 });
    await app.ready();
    const chars = await f.invoke('getCharacters', 18 as any);
    const catalog = chars.map((c: any) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));

    const snap = buildSnapshot(
      [{ summoner: 'Me', tag_line: '1', health: 50, index: 0 }],
      [{ summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 2 }] }],
    );
    const ctrl = createTrickController({ core: { snapshot: () => snap, onGame: () => () => {} }, catalog, costs: [2] });
    ctrl.apply(snap, 'players_info');
    expect(ctrl.state().ready).toBe(true);
    expect(ctrl.state().tracker.length).toBeGreaterThan(0);
    ctrl.dispose();
    app.dispose();
  });

  it('不依赖登录态：没有 owner 也能跑（用 local 命名空间）', async () => {
    const f = createFakeCube();
    const app = createLeanBackground(f.cube);
    await app.ready();
    await f.invoke('setSettings', { showCardTracker: true } as any);
    expect(f.store.get('tftbot:settings:local')).toBeTruthy();
    app.dispose();
  });
});
