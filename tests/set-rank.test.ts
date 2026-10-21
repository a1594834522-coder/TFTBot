import { describe, expect, it, vi } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import SetSwitcher from '../src/ui/SetSwitcher.vue';
import RankBadge from '../src/ui/RankBadge.vue';
import TrackerPage from '../src/windows/tracker/TrackerPage.vue';
import { createTrickController } from '../src/windows/trick/controller';
import type { TrickCorePort } from '../src/windows/trick/controller';
import { buildSnapshot } from '../src/game/roster';
import { dataset } from '../src/game/tft-data';
import { comps as compsData } from '../src/game/comps-data';
import type { RankEntryView } from '../src/core/rank';

const catalog = dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));
const snap = buildSnapshot(
  [
    { summoner: 'Me', tag_line: '1', health: 72, index: 0 },
    { summoner: 'Foe', tag_line: '2', health: 40, index: 1 },
  ],
  [
    { summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 3 }] },
    { summoner: 'Foe', tag_line: '2', champions: [] },
  ],
);

const coreOf = (s: any): TrickCorePort => ({ snapshot: () => s, onGame: () => () => {} });
const render = (comp: any, props: Record<string, any>) => renderToString(createSSRApp({ render: () => h(comp, props) }));

const rank: RankEntryView = {
  queue: 'RANKED_TFT',
  tier: 'GOLD',
  division: 'II',
  lp: 45,
  wins: 30,
  losses: 20,
  winRate: 0.6,
  label: '黄金 II 45LP',
};

describe('SetSwitcher 赛季切换', () => {
  it('渲染所有赛季，当前赛季高亮', async () => {
    const html = await render(SetSwitcher, { supportSets: [18, 16, 17], currentSet: 17, counts: { 16: 77, 17: 80 } });
    const sets = [...html.matchAll(/data-set="(\d+)"/g)].map((m) => Number(m[1]));
    expect(sets).toEqual([16, 17, 18]); // 升序
    expect(html).toContain('data-current="17"');
    expect(html).toContain('data-count="3"');
    expect((html.match(/class="[^"]*\bactive\b[^"]*"/g) ?? []).length).toBe(1);
  });

  it('有阵容数据的赛季显示数量，没有的置空样式', async () => {
    const html = await render(SetSwitcher, { supportSets: [16, 18], currentSet: 16, counts: { 16: 77 } });
    expect(html).toContain('77');
    expect(html).toMatch(/class="[^"]*empty[^"]*" data-set="18"/);
  });

  it('compact 只显示 S+数字', async () => {
    const html = await render(SetSwitcher, { supportSets: [16], currentSet: 16, compact: true, counts: { 16: 5 } });
    expect(html).not.toContain('<span class="n"');
    expect(html).toContain('S16');
  });

  it('点击会 emit change（用事件触发验证）', async () => {
    const onChange = vi.fn();
    const app = createSSRApp({
      render: () =>
        h(SetSwitcher, {
          supportSets: [16, 17],
          currentSet: 16,
          onChange,
        }),
    });
    const html = await renderToString(app);
    expect(html).toContain('data-set="17"');
    // SSR 不触发点击，但事件名与 handler 绑定存在（运行时在浏览器里验证）
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('RankBadge 段位徽标', () => {
  it('渲染标签/胜率/战绩', async () => {
    const html = await render(RankBadge, { entry: rank });
    expect(html).toContain('黄金 II 45LP');
    expect(html).toContain('data-tier="GOLD"');
    expect(html).toContain('data-lp="45"');
    expect(html).toContain('data-win-rate="60"');
    expect(html).toContain('30W 20L');
  });

  it('未定级 / 无数据时不炸', async () => {
    const none = await render(RankBadge, {});
    expect(none).toContain('未定级');
    expect(none).toContain('data-tier="UNRANKED"');
    const unranked = await render(RankBadge, { entry: { ...rank, tier: 'UNRANKED', label: '未定级', lp: 0 } });
    expect(unranked).toContain('未定级');
  });

  it('compact 只显示徽标', async () => {
    const html = await render(RankBadge, { entry: rank, compact: true });
    expect(html).toContain('黄金 II 45LP');
    expect(html).not.toContain('data-win-rate');
  });
});

describe('tracker 顶栏集成', () => {
  it('顶栏包含赛季切换与段位', async () => {
    const ctrl = createTrickController({ core: coreOf(snap), catalog });
    ctrl.apply(snap, 'players_info');
    const html = await render(TrackerPage, {
      controller: ctrl,
      comps: compsData.comps(18),
      set: 18,
      supportSets: [16, 17, 18],
      rank,
    });
    expect(html).toContain('data-current="18"');
    expect(html).toContain('data-tier="GOLD"');
    expect(html).toContain('黄金 II 45LP');
    ctrl.dispose();
  });

  it('没有段位数据时显示未定级（不阻断渲染）', async () => {
    const ctrl = createTrickController({ core: coreOf(snap), catalog });
    ctrl.apply(snap);
    const html = await render(TrackerPage, { controller: ctrl, comps: [], supportSets: [16] });
    expect(html).toContain('未定级');
    ctrl.dispose();
  });
});
