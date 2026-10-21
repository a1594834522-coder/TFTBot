import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import EarlyCompsPanel from '../src/ui/EarlyCompsPanel.vue';
import CompsPanel from '../src/ui/CompsPanel.vue';
import { parseEarlyOverview, earlyStages, boardLabel } from '../src/game/metatft-early';
import { metatftComps } from '../src/game/comps-sources';
import { normalizeSettings } from '../src/core/settings';

const live = earlyStages(18);

describe('early-comps 解析（线上真实形状）', () => {
  it('name 是逗号分隔棋子名，stats 里有名次/吃鸡率', async () => {
    const stages = parseEarlyOverview(
      {
        comps_overview: {
          'stage-2': {
            stats: { sampleSize: 1234 },
            comps: [
              { name: 'DA_18_A,DA_18_B', stats: { final_place_avg: 4.4, final_place_winrate: 0.12, final_place_count: 100 } },
              { name: 'DA_18_C', stats: { final_place_avg: 3.9, final_place_winrate: 0.2, final_place_count: 50 } },
            ],
          },
        },
      },
      5,
    );
    expect(stages).toHaveLength(1);
    expect(stages[0].stage).toBe(2);
    // 按平均名次升序 → 3.9 在前
    expect(stages[0].boards[0].avgPlace).toBeCloseTo(3.9);
    expect(stages[0].boards[0].units).toEqual(['DA_18_C']);
    expect(stages[0].boards[0].winRate).toBeCloseTo(0.2);
    expect(stages[0].boards[0].count).toBe(50);
  });

  it('按阶段升序、每阶段限条数、空输入返回空', () => {
    const stages = parseEarlyOverview(
      {
        comps_overview: {
          'stage-4': { comps: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
          'stage-3': { comps: [{ name: 'D' }] },
        },
      },
      2,
    );
    expect(stages.map((s) => s.stage)).toEqual([3, 4]);
    expect(stages[1].boards).toHaveLength(2);
    expect(parseEarlyOverview(null)).toEqual([]);
    expect(parseEarlyOverview({})).toEqual([]);
  });

  it('仓库保留完整前期候选，不再只截取每阶段5条', () => {
    expect(live.map((s) => s.stage)).toEqual([2, 3, 4, 5]);
    for (const s of live) {
      expect(s.boards.length).toBeGreaterThan(30);
      expect(s.boards.every((b) => b.units.length > 0)).toBe(true);
    }
  });
  it('区分阶段整体50%与具体棋盘胜率，并优先当前版本切片',()=>{
    const [s]=parseEarlyOverview({comps_overview:{'stage-2':{stats:{matchup_winrate:.5},comps:[{cluster:'0',name:'TFT18_Akali,TFT18_Rakan,TFT18_Varus',stats:{matchup_winrate:.6,matchup_count:900},latest_stats:{matchup_winrate:.71,matchup_count:800,final_place_avg:4.31,final_place_count:400}}]}}});
    expect(s.boards[0]).toMatchObject({battleWinRate:.71,matchupCount:800,avgPlace:4.31,count:400,units:['DA_18_Akali_AD','DA_18_Rakan','DA_18_Varus']});
  });

  it('boardLabel 把 id 变成可读名', () => {
    expect(boardLabel(['DA_18_ElderDragon', 'TFT18_Ahri'])).toBe('远古巨龙 / 阿狸');
  });
});

describe('EarlyCompsPanel 渲染', () => {
  const render = (props: InstanceType<typeof EarlyCompsPanel>['$props']) =>
    renderToString(createSSRApp({ render: () => h(EarlyCompsPanel, props) }));

  it('阶段芯片 + 棋盘列表 + 名次/吃鸡率', async () => {
    const html = await render({ set: 18, limit: 2 });
    const chips = [...html.matchAll(/data-stage="(\d)"/g)].map((m) => m[1]);
    expect(chips).toEqual(['2', '3', '4', '5']);
    expect(html).toMatch(/data-stage-block="2"/);
    expect(html).toMatch(/data-units="\d+"/);
    expect(html).toMatch(/class="win"/);
  });

  it('指定 stage 只显示该阶段', async () => {
    const html = await render({ set: 18, stage: 4 });
    expect(html).toContain('data-stage-block="4"');
    expect(html).not.toContain('data-stage-block="2"');
  });

  it('没有数据的赛季给空态（不抛错）', async () => {
    const html = await render({ set: 99 });
    expect(html).toContain('data-stages="0"');
  });
});

describe('CompsPanel 的 showLevel 门控', () => {
  const rich = metatftComps(18).find((c) => c.details?.levels?.length)!;
  const render = (settings: any) =>
    renderToString(createSSRApp({ render: () => h(CompsPanel, { comps: [rich], selectedId: rich.id, settings }) }));

  it('showLevel=false 时不渲染升级节奏与等级名次', async () => {
    const on = await render(normalizeSettings({ showLevel: true }));
    const off = await render(normalizeSettings({ showLevel: false }));
    expect(on).toContain('data-section="levels"');
    expect(on).toContain('data-section="final-levels"');
    expect(off).not.toContain('data-section="levels"');
    expect(off).not.toContain('data-section="final-levels"');
  });
});
