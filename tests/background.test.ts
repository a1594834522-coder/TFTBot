import { describe, expect, it, vi } from 'vitest';
import { createBackgroundApp, SUPPORTED_COMMAND_NAMES } from '../src/app/background';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { HexApiClient } from '../src/core/hexapi';
import { createFakeCube } from './helpers/fakeCube';

function apiStub(data: any = null) {
  return new HexApiClient({
    fetchImpl: (async () => ({
      status: 200,
      text: async () => JSON.stringify(data ?? { code: 500 }),
    })) as any,
  });
}

const unlockedData = {
  code: 200,
  data: {
    features: [
      { id: 1, key: 'three_mark', name: '追三标记', unlocked: true },
      { id: 2, key: 'three_star_warning', name: '三星预警', unlocked: true },
      { id: 3, key: 'overall_record', name: '全局战绩', unlocked: true },
      { id: 4, key: 'card_tracker', name: '记牌器', unlocked: true },
    ],
    membership: { plan: 'vip', isPermanent: true, expireAt: Number.MAX_SAFE_INTEGER },
  },
};

describe('background 装配（命令注册与回包）', () => {
  it('注册了首批命令，未实现的命令回 undefined', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub() });
    const cmds = app.commands();
    for (const c of SUPPORTED_COMMAND_NAMES) expect(cmds).toContain(c);
    // 81 个命令已全实现；未知命令仍应立刻回 undefined（不挂死调用方）
    await expect(f.invoke('totallyUnknownCommand' as any)).resolves.toBeUndefined();
    app.dispose();
  });

  it('getSettings 初始为默认值；setSettings 合并并广播 settingsChanged', async () => {
    const f = createFakeCube({ windows: ['background', 'main', 'trick'] });
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    await expect(f.invoke('getSettings')).resolves.toEqual(DEFAULT_SETTINGS);

    const next = await f.invoke('setSettings', { showCardTracker: true } as any);
    expect(next.showCardTracker).toBe(true);
    const broadcasts = f.sent.filter((s) => s.command === 'settingsChanged');
    expect(broadcasts.map((b) => b.windowId).sort()).toEqual(['main', 'trick']);
    app.dispose();
  });

  it('我的阵容：set → get → delete，并广播 myTeamCompsChanged', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    const saved = await f.invoke('setMyTeamComps', { name: '测试阵容', set: 18, units: [{ character_id: 'X' }] } as any);
    expect(saved.name).toBe('测试阵容');
    const list = await f.invoke('getMyTeamComps', '' as any);
    expect(list.length).toBe(1);
    expect(f.sent.some((s) => s.command === 'myTeamCompsChanged')).toBe(true);

    await f.invoke('deleteMyTeamComps', saved.id as any);
    await expect(f.invoke('getMyTeamComps', '' as any)).resolves.toEqual([]);
    app.dispose();
  });

  it('pin 阵容：set/get，details 原样保留', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    const details = JSON.stringify({ units: [{ character_id: 'Y' }] });
    await f.invoke('setPinCompsInfo', { type: 'mycomps', set: 18, details } as any);
    const pin = await f.invoke('getPinCompsInfo');
    expect(pin).toEqual({ type: 'mycomps', set: 18, details });
    expect(f.sent.some((s) => s.command === 'pinCompsChanged')).toBe(true);
    app.dispose();
  });

  it('getFeaturesList 返回解析后的 feature 数组（接口失败也不炸）', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub(unlockedData) });
    await app.ready();
    const list = await f.invoke('getFeaturesList');
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(4);
    expect(list[3].key).toBe('card_tracker');
    app.dispose();
  });

  it('赛季/语言：setCurrentSet 持久化并广播，重启后读回', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1', initialSet: 18 });
    await app.ready();
    await f.invoke('setCurrentSet', 16 as any);
    expect(await f.invoke('getCurrentSet')).toBe(18);
    expect(f.sent.some((s) => s.command === 'currentSetChanged')).toBe(false);
    await f.invoke('setCurLocale', 'en-US' as any);
    expect(await f.invoke('getCurLocale')).toBe('en-US');
    app.dispose();

    const app2 = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app2.ready();
    expect(await f.invoke('getCurrentSet')).toBe(18);
    expect(await f.invoke('getCurLocale')).toBe('en-US');
    app2.dispose();
  });

  it('badJson payload 不致命', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    await expect(f.invoke('setSettings', '{oops' as any)).resolves.toBeTruthy();
    app.dispose();
  });

  it('热键：get 默认值 / set 后广播 *Changed', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    const main = await f.invoke('getShowMainHotkey');
    expect(main.format).toBe('ctrl+`');

    const next = await f.invoke('setShowMainHotkey', 'ctrl+shift+m' as any);
    expect(next.format).toBe('ctrl+shift+m');
    expect(f.sent.some((s) => s.command === 'showMainHotkeyChanged')).toBe(true);
    expect((await f.invoke('getShowTrackerHotkey')).format).toBe('`');
    app.dispose();
  });

  it('录制：getObsState / stopObs / 编码器 / 设置 / 直播列表', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    const st = await f.invoke('getObsState');
    expect(st).toMatchObject({ isRecord: false, isReplay: false });
    expect(await f.invoke('getVideoEncoders')).toEqual(['x264', 'nvenc']);

    const stopped = await f.invoke('stopObs');
    expect(stopped.isRecord).toBe(false);
    expect(f.sent.some((s) => s.command === 'recordStateChanged')).toBe(true);

    const set = await f.invoke('setRecordBaseSetting', { fps: 30 } as any);
    expect(set.fps).toBe(30);
    expect((await f.invoke('getRecordBaseSetting')).fps).toBe(30);

    await f.invoke('setLiveList', ['rtmp://x'] as any);
    expect(await f.invoke('getLiveList')).toEqual(['rtmp://x']);
    app.dispose();
  });

  it('游戏数据：getCharacters/getItems/getTraits 来自真实数据集', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1', initialSet: 18 });
    await app.ready();
    const chars = await f.invoke('getCharacters', 18 as any);
    expect(chars.length).toBe(74);
    expect(chars[0].character_id).toMatch(/^DA_/);
    const items = await f.invoke('getItems');
    expect(items.length).toBeGreaterThan(150);
    const traits = await f.invoke('getTraits');
    expect(traits.length).toBeGreaterThan(30);
    expect(await f.invoke('getSupportSets')).toEqual([18]);
    expect(await f.invoke('getRankData')).toEqual([]);
    expect(await f.invoke('getUnitsItems')).toEqual({});
    app.dispose();
  });

  it('TFTHighlight 可存可读（持久化）', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    await f.invoke('setTFTHighlight', { enabled: true, color: 'red' } as any);
    expect(await f.invoke('getTFTHighlight')).toEqual({ enabled: true, color: 'red' });
    app.dispose();
    const app2 = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app2.ready();
    expect(await f.invoke('getTFTHighlight')).toEqual({ enabled: true, color: 'red' });
    app2.dispose();
  });

  it('广播类命令：返回当前状态并重播给所有窗口', async () => {
    const f = createFakeCube({ windows: ['background', 'main', 'trick'] });
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    f.sent.length = 0;

    const s = await f.invoke('settingsChanged');
    expect(s).toHaveProperty('showThreeMark');
    expect(f.sent.filter((x) => x.command === 'settingsChanged').map((x) => x.windowId).sort()).toEqual(['main', 'trick']);

    const set = await f.invoke('currentSetChanged');
    expect(typeof set).toBe('number');

    const list = await f.invoke('myTeamCompsChanged');
    expect(Array.isArray(list)).toBe(true);

    const pin = await f.invoke('pinCompsChanged');
    expect(pin).toHaveProperty('type');

    const hk = await f.invoke('showMainHotkeyChanged');
    expect(hk).toHaveProperty('format');

    const obs = await f.invoke('recordStateChanged');
    expect(obs).toHaveProperty('isRecord');

    const features = await f.invoke('featureUnlockChanged');
    expect(features.length).toBe(4);
    const membership = await f.invoke('syncMembershipUpdated');
    expect(membership).toHaveProperty('displayStatus');
    app.dispose();
  });

  it('setInviteCount 写入并触发状态刷新广播', async () => {
    const f = createFakeCube({ windows: ['background', 'main'] });
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    expect(await f.invoke('getInviteCount')).toBe(0);
    await f.invoke('setInviteCount', 3 as any);
    expect(await f.invoke('getInviteCount')).toBe(3);
    expect(f.sent.some((s) => s.command === 'featureUnlockChanged')).toBe(true);
    // 负数被忽略
    await f.invoke('setInviteCount', -5 as any);
    expect(await f.invoke('getInviteCount')).toBe(3);
    app.dispose();
  });

  it('forceLogoutCleanup 清订单/账号/邀请数并广播', async () => {
    const f = createFakeCube({ windows: ['background', 'main', 'hexmsg'] });
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    await f.invoke('setSummonerIdChanged' as any, '');
    await app.hexOrder.transition({ phase: 'pending', amountCents: 100 });
    await f.invoke('setInviteCount', 2 as any);
    f.sent.length = 0;

    await expect(f.invoke('forceLogoutCleanup', 'logout' as any)).resolves.toBe(true);
    expect(app.hexOrder.current().phase).toBe('idle');
    expect(await f.invoke('getInviteCount')).toBe(0);
    expect(f.sent.some((s) => s.command === 'forceLogoutCleanup')).toBe(true);
    app.dispose();
  });

  it('deleteRecordMedia 走注入实现并广播结果', async () => {
    const f = createFakeCube({ windows: ['background', 'main'] });
    const seen: string[] = [];
    const app = createBackgroundApp(f.cube, {
      api: apiStub(),
      getOwner: () => 'u1',
      deleteMedia: async (file) => {
        seen.push(file);
        return file.endsWith('.mp4');
      },
    });
    await app.ready();
    expect(await f.invoke('deleteRecordMedia', { file: 'a.mp4' } as any)).toBe(true);
    expect(await f.invoke('deleteRecordMedia', { file: 'a.txt' } as any)).toBe(false);
    expect(seen).toEqual(['a.mp4', 'a.txt']);
    expect(f.sent.some((s) => s.command === 'recordMediaChanged')).toBe(true);
    app.dispose();
  });

  it('checkGpuEnable 用注入探测；无注入时返回结构化结果', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, {
      api: apiStub(),
      getOwner: () => 'u1',
      probeGpu: async () => ({ enabled: true, reason: 'stub' }),
    });
    await app.ready();
    expect(await f.invoke('checkGpuEnable')).toEqual({ enabled: true, reason: 'stub' });
    app.dispose();

    const f2 = createFakeCube();
    const app2 = createBackgroundApp(f2.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app2.ready();
    const r = await f2.invoke('checkGpuEnable');
    expect(r).toHaveProperty('enabled');
    expect(typeof r.enabled).toBe('boolean');
    app2.dispose();
  });

  it('getHexOrderStatus / getHexGamePlayBegan 反映订单状态', async () => {
    const f = createFakeCube();
    const app = createBackgroundApp(f.cube, { api: apiStub(), getOwner: () => 'u1' });
    await app.ready();
    expect(await f.invoke('getHexOrderStatus')).toBe('idle');
    expect(await f.invoke('getHexGamePlayBegan')).toBe(false);
    await app.hexOrder.transition({ phase: 'pending' });
    await app.hexOrder.markGameStarted(true);
    expect(await f.invoke('getHexOrderStatus')).toBe('pending');
    expect(await f.invoke('getHexGamePlayBegan')).toBe(true);
    app.dispose();
  });
});
