import { describe, expect, it, vi } from 'vitest';
import { createCore } from '../src/core/index';
import type { Cube } from '../src/core/cube';

/** 造一个最小的假 cube（只实现核心用到的部分） */
function fakeCube() {
  const listeners = new Set<(h: any, m: any) => void>();
  const cube = {
    windows: {
      getMainWindow: async () => ({ id: 'background' }),
      message: {
        invoke: async (_id: string, cmd: string) => {
          if (cmd === 'getSettings') return { showCardTracker: true };
          return null;
        },
        send: () => {},
        on: () => () => {},
      },
      current: { id: () => 'trick', isOffscreen: () => false, dragMove: () => {} },
    },
    games: {
      events: {
        on: (_evt: string, cb: any) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        provider: {},
      },
      launchers: {
        invokeLEP: async (_id: number, _m: string, params: any) => ({ ok: true, uri: params.uri }),
      },
    },
  } as unknown as Cube;
  const emit = (msg: any) => listeners.forEach((cb) => cb({}, msg));
  return { cube, emit, listeners };
}

describe('createCore 装配', () => {
  it('settings 走 IPC + normalize', async () => {
    const { cube } = fakeCube();
    const core = createCore({ cube, unlockPolicy: 'always' });
    const s = await core.settings();
    expect(s.showCardTracker).toBe(true);
    expect(s.threeMarkCosts).toEqual([4, 5]);
    core.dispose();
  });

  it('订阅 update-info 后能出 roster 快照与记牌器', async () => {
    const { cube, emit } = fakeCube();
    const core = createCore({
      cube,
      catalog: [
        { character_id: 'Teemo', cost: 4 },
        { character_id: 'Garen', cost: 5 },
      ],
    });
    emit({
      key: 'tft_roster',
      value: JSON.stringify([
        { summoner: 'Me', tag_line: '1', health: 60 },
        { summoner: 'Foe', tag_line: '2', health: 40 },
      ]),
    });
    emit({
      key: 'players_info',
      value: JSON.stringify([
        { summoner: 'Me', tag_line: '1', champions: [{ name: 'Teemo', level: 2 }] },
        { summoner: 'Foe', tag_line: '2', champions: [{ name: 'Teemo', level: 1 }, { name: 'Garen', level: 3 }] },
      ]),
    });

    const snap = core.snapshot()!;
    expect(snap.alive).toBe(2);
    expect(snap.ownedByName.Teemo).toBe(4);
    expect(snap.ownedByName.Garen).toBe(9);

    const tracker = core.cardTracker();
    // 池子对齐本实现 xe(cost)：4 费 10 张、5 费 9 张
    // Garen 9 张 = 已三星（remaining 0）→ 不再进记牌器；Teemo 4 张（池 10 → 剩 6）
    expect(tracker.map((r) => r.champion)).toEqual(['Teemo']);
    expect(tracker[0].remaining).toBe(10 - 4);
    core.dispose();
  });

  it('isUnlocked 在 always 策略下恒 true', async () => {
    const { cube } = fakeCube();
    const core = createCore({ cube, unlockPolicy: 'always' });
    // 没有网络 → api 返回 500 → server 策略会 false；always 策略必须 true
    await expect(core.isUnlocked('card_tracker')).resolves.toBe(true);
    core.dispose();
  });

  it('dispose 之后不再响应事件', () => {
    const { cube, emit, listeners } = fakeCube();
    const core = createCore({ cube });
    const fn = vi.fn();
    core.onGame(fn);
    emit({ key: 'tft_roster', value: '[]' });
    expect(fn).toHaveBeenCalledTimes(1);
    core.dispose();
    expect(listeners.size).toBe(0);
  });
});
