import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import CompsPanel from '../src/ui/CompsPanel.vue';
import { metatftComps } from '../src/game/comps-sources';
import { parseDetails } from '../src/game/metatft-comps';

const live = metatftComps(18);

describe('MetaTFT proComps / early_options', () => {
  it('parseDetails 解析作者阵容（按 distance 升序，取前几条）', () => {
    const d = parseDetails(
      {
        proComps: [
          { distance: 0.9, content: { metadata: { title: 'far' }, author: { riotid: 'B#X' } } },
          { distance: 0.1, content: { metadata: { title: 'near' }, author: { riotid: 'A#Y', region: 'euw1' } } },
          { distance: 0.5, content: { metadata: {} } }, // 没标题 → 丢弃
        ],
      } as any,
      3,
    )!;
    expect(d.proComps!.map((p) => p.title)).toEqual(['near', 'far']);
    expect(d.proComps![0]).toMatchObject({ author: 'A#Y', region: 'euw1' });
  });

  it('parseDetails 解析开局分支（按人口排序，每口最多 2 条）', () => {
    const d = parseDetails(
      {
        early_options: {
          5: [
            { unit_list: 'DA_A&DA_B&DA_C&DA_D&DA_E', count: 10, avg: 4.5, win: 0.5 },
            { unit_list: 'DA_A&DA_B&DA_C&DA_D&DA_F', count: 20, avg: 4.0, win: 0.62 },
            { unit_list: 'DA_A&DA_B&DA_C&DA_D&DA_G', count: 30, avg: 3.9, win: 0.6 },
          ],
          4: [{ unit_list: 'DA_A&DA_B', count: 5, avg: 4.2, win: 0.7 }],
        },
      } as any,
      3,
    )!;
    expect(d.earlyOptions!.map((e) => e.level)).toEqual([4, 5, 5]);
    expect(d.earlyOptions![1].units.length).toBe(5);
    // 同口内按胜率降序
    expect(d.earlyOptions![1].win).toBeGreaterThan(d.earlyOptions![2].win!);
  });

  it('空输入不产生空字段', () => {
    expect(parseDetails({ proComps: [], early_options: {} } as any)).toBeUndefined();
  });

  it('快照里多数阵容带这两项', () => {
    const withPro = live.filter((c) => c.details?.proComps?.length).length;
    const withEarly = live.filter((c) => c.details?.earlyOptions?.length).length;
    expect(withPro).toBeGreaterThan(20);
    expect(withEarly).toBe(60);
  });

  it('CompsPanel 渲染开局分支与作者阵容', async () => {
    const rich = live.find((c) => c.details?.proComps?.length && c.details?.earlyOptions?.length)!;
    const html = await renderToString(
      createSSRApp({ render: () => h(CompsPanel, { comps: live, selectedId: rich.id, source: 'metatft' }) }),
    );
    expect(html).toContain('data-section="early-options"');
    expect(html).toMatch(/data-level="[4-9]"/);
    expect(html).toContain('data-section="pro-comps"');
    expect(html).toContain('data-author=');
  });
});
