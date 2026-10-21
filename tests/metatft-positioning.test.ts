import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import CompsPanel from '../src/ui/CompsPanel.vue';
import TftBoard from '../src/ui/TftBoard.vue';
import CharacterPage from '../src/windows/characterwin/CharacterPage.vue';
import { metatftComps } from '../src/game/comps-sources';
import { parseDetails } from '../src/game/metatft-comps';

const live = metatftComps(18);
const rich = live.find((c) => c.details?.positioning && c.details?.unitStats?.length);

describe('站位热区（positioning → 棋盘）', () => {
  it('parseDetails 把 positioning 归一成 cell 号 + 次数', () => {
    const d = parseDetails({
      positioning: {
        units: {
          DA_18_Sentry: { positions: [{ cell: 'cell_25', count: 229450 }, { cell: 'cell_26', count: 87241 }] },
        },
      },
    } as any)!;
    expect(d.positioning!.DA_18_Sentry[0]).toEqual({ cell: 25, count: 229450 });
    expect(d.positioning!.DA_18_Sentry.length).toBe(2);
  });

  it('快照里的 positioning 每个单位最多 3 格、最多 6 个单位', () => {
    for (const c of live) {
      const pos = c.details?.positioning;
      if (!pos) continue;
      expect(Object.keys(pos).length).toBeLessThanOrEqual(6);
      for (const cells of Object.values(pos)) expect(cells.length).toBeLessThanOrEqual(3);
    }
  });

  it('TftBoard 接受 heat 并渲染 data-heat', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(TftBoard, { champions: [{ character_id: 'DA_18_Ahri', position: 5 }], heat: { 5: 1, 6: 0.4 } }),
      }),
    );
    expect(html).toContain('data-heat="1.00"');
    expect(html).toContain('data-heat="0.40"');
    expect(html).toContain('hot');
  });

  it('CompsPanel 把热区透传给小棋盘（有 positioning 的阵容）', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(CompsPanel, { comps: live, selectedId: rich!.id, source: 'metatft' }) }),
    );
    expect(html).toMatch(/data-heat="0\.\d+"/);
  });
});

describe('characterwin 单卡表现（unit_stats）', () => {
  it('快照里有 unit_stats 的阵容至少 40 套', () => {
    expect(live.filter((c) => c.details?.unitStats?.length).length).toBeGreaterThan(40);
  });

  it('含该英雄时渲染星级分布与装备件数', async () => {
    const comp = live.find((c) => c.details?.unitStats?.length)!;
    const unit = comp.details!.unitStats![0].unit;
    const html = await renderToString(
      createSSRApp({ render: () => h(CharacterPage, { characterId: unit, set: 18, supportSets: [16, 17, 18] }) }),
    );
    expect(html).toContain('data-section="unit-stats"');
    expect(html).toMatch(/data-star="[123]"/);
    expect(html).toMatch(/data-item-count="\d"/);
  });

  it('没有该英雄数据时不渲染空壳', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(CharacterPage, { characterId: 'NOT_A_CHAMPION', set: 18 }) }),
    );
    expect(html).not.toContain('data-section="unit-stats"');
  });
});
