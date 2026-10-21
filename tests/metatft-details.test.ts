import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import CompsPanel from '../src/ui/CompsPanel.vue';
import { allComps, metatftComps } from '../src/game/comps-sources';
import { parseDetails } from '../src/game/metatft-comps';
import { DEFAULT_SETTINGS, normalizeSettings, COMPS_SOURCE_PREFS } from '../src/core/settings';
import { createLeanBackground } from '../src/app/lean';
import { createFakeCube } from './helpers/fakeCube';

const live = metatftComps(18);
const withDetails = live.find((c) => c.details?.builds?.length && c.details?.levels?.length);

describe('MetaTFT comp_details 决策项', () => {
  it('parseDetails 解析 levels / final_levels / builds / augments', () => {
    const d = parseDetails(
      {
        levels: [{ stage: 3, round: 2, level: 6, count: 100 }],
        final_levels: [
          { level: '9', count: 10, avg: 3.5 },
          { level: '8', count: 20, avg: 4.6 },
        ],
        builds: [
          { buildName: ['DA_BlueBuff', 'DA_RabadonsDeathcap'], unit: 'DA_18_Sentry', count: 500, avg: 3.87 },
          { buildName: ['DA_ThiefsGloves'], count: 100, avg: 4.2 },
        ],
        augments: [{ aug: 'DA_Augment_A', count: 5, avg: 3.9 }],
      },
      3,
    )!;
    expect(d.levels).toEqual([{ stage: 3, round: 2, level: 6, count: 100 }]);
    // 按等级升序
    expect(d.finalLevels!.map((f) => f.level)).toEqual(['8', '9']);
    // 按场次降序
    expect(d.builds![0].items).toEqual(['DA_BlueBuff', 'DA_RabadonsDeathcap']);
    expect(d.builds![0].unit).toBe('DA_18_Sentry');
    expect(d.augments![0].name).toBe('DA_Augment_A');
  });

  it('parseDetails 对空输入返回 undefined', () => {
    expect(parseDetails(undefined)).toBeUndefined();
    expect(parseDetails({} as any)).toBeUndefined();
  });

  it('快照里 60 套都带 levels，builds 覆盖大部分', () => {
    expect(live.length).toBe(60);
    const withLevels = live.filter((c) => c.details?.levels?.length).length;
    const withBuilds = live.filter((c) => c.details?.builds?.length).length;
    expect(withLevels).toBe(60);
    expect(withBuilds).toBeGreaterThan(30);
  });

  it('CompsPanel 渲染升级节奏 / 等级名次 / 装备', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(CompsPanel, { comps: live, selectedId: withDetails!.id, source: 'metatft' }) }),
    );
    expect(html).toContain('data-section="levels"');
    expect(html).toContain('data-step="');
    expect(html).toContain('data-section="final-levels"');
    expect(html).toContain('data-section="builds"');
    expect(html).toContain('data-holder=');
  });

  it('普通（官方）阵容没有 details 区块，不渲染空壳', async () => {
    const official = allComps({ set: 18, source: 'official' });
    const html = await renderToString(
      createSSRApp({ render: () => h(CompsPanel, { comps: official, selectedId: official[0].id }) }),
    );
    expect(html).not.toContain('data-section="levels"');
    expect(html).not.toContain('data-section="builds"');
  });
});

describe('设置里的默认阵容源', () => {
  it('默认 MetaTFT；非法值回落到默认', () => {
    expect(DEFAULT_SETTINGS.compsSource).toBe('metatft');
    expect(normalizeSettings({}).compsSource).toBe('metatft');
    expect(normalizeSettings({ compsSource: 'metatft' } as any).compsSource).toBe('metatft');
    expect(normalizeSettings({ compsSource: 'nope' } as any).compsSource).toBe('metatft');
    expect(COMPS_SOURCE_PREFS).toContain('metatft');
  });

  it('getComps 未显式传 source 时用设置里的偏好', async () => {
    const f = createFakeCube();
    const app = createLeanBackground(f.cube, { getOwner: () => 'local', initialSet: 18 });
    await app.ready();
    const all = await f.invoke('getComps', { set: 18 } as any);
    const mt = await f.invoke('getComps', { set: 18, source: 'metatft' } as any);
    expect(all.length).toBe(mt.length); // 默认主数据源为 MetaTFT

    await f.invoke('setSettings', { compsSource: 'metatft' } as any);
    const afterPref = await f.invoke('getComps', { set: 18 } as any);
    expect(afterPref.length).toBe(mt.length);
    expect(afterPref.every((c: any) => String(c.id).startsWith('metatft:'))).toBe(true);

    // 显式 source 仍然优先于设置
    const explicit = await f.invoke('getComps', { set: 18, source: 'official' } as any);
    expect(explicit.every((c: any) => !String(c.id).startsWith('metatft:'))).toBe(true);
    app.dispose();
  });
});
