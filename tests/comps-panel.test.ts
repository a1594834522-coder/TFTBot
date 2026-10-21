import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import CompsPanel from '../src/ui/CompsPanel.vue';
import { comps as compsData } from '../src/game/comps-data';

const set16 = compsData.comps(18);
const official = compsData.comps(18, '官网阵容');
const blitz = compsData.comps(18, 'blitz');

async function render(props: InstanceType<typeof CompsPanel>['$props']) {
  return renderToString(createSSRApp({ render: () => h(CompsPanel, props) }));
}

describe('CompsPanel（阵容列表 + 详情）', () => {
  it('列表渲染 + 计数 + 自动选中第一条', async () => {
    const html = await render({ comps: set16, limit: 10 });
    const rows = [...html.matchAll(/data-comp-id="([^"]+)"/g)].map((m) => m[1]);
    expect(rows.length).toBe(10);
    expect(html).toContain('data-comps="10"');
    // 自动选中第一条并显示详情
    expect(html).toMatch(new RegExp(`data-selected="${rows[0]}"`));
    expect(html).toMatch(new RegExp(`data-detail="${rows[0]}"`));
  });

  it('详情里有小棋盘、羁绊、标签或过渡', async () => {
    const html = await render({ comps: set16, selectedId: official[0].id });
    expect(html).toContain('data-section="synergy"');
    expect(html).toContain('data-slot="'); // 棋盘格
    expect(html).toMatch(/data-trait-id="[^"]+" data-count="\d+"/);
    // 官网阵容大多有 play_tags 或 early_units
    expect(/data-section="(tags|early)"/.test(html)).toBe(true);
  });

  it('Tier 过滤生效', async () => {
    const html = await render({ comps: set16, tier: 1, limit: 50 });
    const rows = [...html.matchAll(/data-comp-id="([^"]+)" data-tier="([^"]*)"/g)];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(([, , tier]) => tier === '1')).toBe(true);
  });

  it('分组过滤：官网 vs blitz（id 形态不同）', async () => {
    const officialHtml = await render({ comps: set16, group: '官网阵容', limit: 100 });
    const ids = [...officialHtml.matchAll(/data-comp-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(official.length);
    expect(ids.every((id) => !id.startsWith('trait:'))).toBe(true);

    const blitzHtml = await render({ comps: set16, group: 'blitz', limit: 100 });
    const blitzIds = [...blitzHtml.matchAll(/data-comp-id="([^"]+)"/g)].map((m) => m[1]);
    expect(blitzIds.length).toBe(blitz.length);
    expect(blitzIds.every((id) => id.startsWith('trait:'))).toBe(true);
  });

  it('英雄搜索：按中文名/id 命中', async () => {
    const byId = await render({ comps: set16, search: 'DA_18_Caitlyn', limit: 50 });
    const ids = [...byId.matchAll(/data-comp-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    // 每条命中都应真的含该英雄（用数据集反查）
    for (const id of ids) {
      const c = compsData.comp(18, id)!;
      expect(c.units.some((u) => u.character_id === 'DA_18_Caitlyn')).toBe(true);
    }

    const byName = await render({ comps: set16, search: '凯特琳', limit: 50 });
    expect(byName).toMatch(/data-comps="\d+"/);
  });

  it('搜索无结果 / 空数据给空态', async () => {
    const none = await render({ comps: set16, search: 'zzz-not-exist' });
    expect(none).toContain('没有匹配的阵容');
    expect(none).toContain('data-comps="0"');
    const empty = await render({ comps: [] });
    expect(empty).toContain('没有匹配的阵容');
  });

  it('selectedId 受控：指定哪条就显示哪条', async () => {
    const target = official[official.length - 1];
    const html = await render({ comps: set16, selectedId: target.id });
    expect(html).toContain(`data-selected="${target.id}"`);
    expect(html).toContain(`data-detail="${target.id}"`);
  });
});
