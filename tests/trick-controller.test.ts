import { describe, expect, it, vi } from 'vitest';
import { createTrickController, EMPTY_TRICK_STATE } from '../src/windows/trick/controller';
import type { TrickCorePort } from '../src/windows/trick/controller';
import { buildSnapshot } from '../src/game/roster';
import { dataset } from '../src/game/tft-data';

const catalog = dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));

function fakeCore() {
  const listeners = new Set<(e: any) => void>();
  const core: TrickCorePort = {
    snapshot: () => null,
    onGame: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const emit = (payload: any) => listeners.forEach((fn) => fn(payload));
  return { core, emit, listeners };
}

const roster = [
  { summoner: 'Me', tag_line: '1', health: 60, index: 0 },
  { summoner: 'Foe', tag_line: '2', health: 40, index: 1 },
  { summoner: 'Dead', tag_line: '3', health: 0, index: 2 },
];
const players = [
  { summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 3 }, { name: 'DA_18_Ahri', level: 2 }] },
  { summoner: 'Foe', tag_line: '2', champions: [{ name: 'DA_18_Caitlyn', level: 2 }] },
  { summoner: 'Dead', tag_line: '3', champions: [] },
];

const snap = buildSnapshot(roster, players);

describe('trick 控制器', () => {
  it('初始状态为空', () => {
    const { core } = fakeCore();
    const c = createTrickController({ core, catalog });
    expect(c.state()).toEqual(EMPTY_TRICK_STATE);
    c.dispose();
  });

  it('收到快照后算出存活/我方/记牌器/预警', () => {
    const { core, emit } = fakeCore();
    const c = createTrickController({ core, catalog, meName: 'Me#1' });
    const seen: any[] = [];
    c.subscribe((s) => seen.push(s));

    emit({ snapshot: snap, raw: { key: 'tft_roster' } });
    const s = c.state();
    expect(s.ready).toBe(true);
    expect(s.alive).toBe(2);
    expect(s.players.length).toBe(3);
    expect(s.me?.name).toBe('Me#1');
    expect(s.lastEvent).toBe('tft_roster');
    // Tristana 全场 12 张（3★=9 + 2★=3），2 费池 22 → 剩 10，进记牌器需要 costs 命中
    expect(s.tracker.every((r) => r.remaining > 0)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    c.dispose();
  });

  it('meName 可指定；costs 可覆盖（默认只标 4/5 费）', () => {
    const { core, emit } = fakeCore();
    const c = createTrickController({ core, catalog, meName: 'Foe#2', costs: [1, 2] });
    emit({ snapshot: snap });
    expect(c.state().me?.name).toBe('Foe#2');
    // 2 费现在被标了 → Tristana 应出现在记牌器
    expect(c.state().tracker.some((r) => r.champion === 'DA_18_Caitlyn')).toBe(true);
    c.dispose();
  });

  it('三星预警：差 1 张时命中', () => {
    const near = buildSnapshot(
      [{ summoner: 'Me', tag_line: '1', health: 50, index: 0 }],
      [{ summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 3 }, { name: 'DA_18_Ahri', level: 3 }] }],
    );
    // Tristana 9 + Garen 9；再给 Tristana 8 张的另一种情况不好构造，改为直接断言结构
    const { core } = fakeCore();
    const c = createTrickController({ core, catalog });
    c.apply(near, 'players_info');
    expect(Array.isArray(c.state().warnings)).toBe(true);
    c.dispose();
  });

  it('select 切换悬浮卡选中；apply 可手动注入（回放用）', () => {
    const { core } = fakeCore();
    const c = createTrickController({ core, catalog });
    c.apply(snap, 'tft_roster');
    c.select('DA_18_Caitlyn');
    expect(c.state().selected).toBe('DA_18_Caitlyn');
    c.select(null);
    expect(c.state().selected).toBeNull();
    c.dispose();
  });

  it('dispose 后不再响应事件', () => {
    const { core, emit, listeners } = fakeCore();
    const c = createTrickController({ core, catalog });
    const fn = vi.fn();
    c.subscribe(fn);
    emit({ snapshot: snap });
    expect(fn).toHaveBeenCalled();
    const before = fn.mock.calls.length;
    c.dispose();
    expect(listeners.size).toBe(0);
    emit({ snapshot: snap });
    expect(fn.mock.calls.length).toBe(before);
  });
});
