import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import CompsPanel from '../src/ui/CompsPanel.vue';
import { allComps, metatftComps } from '../src/game/comps-sources';

const mixed = [...allComps({ set: 18 }), ...metatftComps(18)];

describe('CompsPanel 交互芯片', () => {
  it('渲染 4 个源芯片 + 6 个 Tier 芯片', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(CompsPanel, { comps: mixed }) }));
    const sources = [...html.matchAll(/data-filter-source="([^"]+)"/g)].map((m) => m[1]);
    expect(sources).toEqual(['all', 'official', 'blitz', 'metatft']);
    const tiers = [...html.matchAll(/data-filter-tier="([^"]+)"/g)].map((m) => m[1]);
    expect(tiers).toEqual(['all', '0', '1', '2', '3', '4']);
    expect(html).toContain('data-section="filters"');
  });

  it('初始高亮来自 props（source=metatft / tier=1）', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(CompsPanel, { comps: mixed, source: 'metatft', tier: 1, limit: 40 }) }),
    );
    expect(html).toMatch(/data-filter-source="metatft"[^>]*class="[^"]*active|class="[^"]*active[^"]*"[^>]*data-filter-source="metatft"/);
    expect(html).toMatch(/data-filter-tier="1"[^>]*class="[^"]*active|class="[^"]*active[^"]*"[^>]*data-filter-tier="1"/);
    // 列表只剩 MetaTFT 的 T1
    const rows = [...html.matchAll(/data-comp-id="([^"]+)" data-tier="([^"]*)" data-source="([^"]+)"/g)];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(([, , tier, src]) => tier === '1' && src === 'metatft')).toBe(true);
  });

  it('tier 过滤与 source 过滤互不干扰（only official 时 MT 不出现）', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(CompsPanel, { comps: mixed, source: 'official', limit: 100 }) }),
    );
    const srcs = [...html.matchAll(/data-source="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.every((s) => s === 'official')).toBe(true);
  });

  it('无数据时芯片仍在（可点回去）', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(CompsPanel, { comps: [], source: 'metatft' }) }));
    expect(html).toContain('data-filter-source="all"');
    expect(html).toContain('没有匹配的阵容');
  });
});
