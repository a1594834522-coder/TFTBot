import { createRenderer, h, nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { CURRENT_SET, requireCurrentSeason } from '../src/game/current-season';
import { dataset } from '../src/game/tft-data';
import { comps } from '../src/game/comps-data';
import { allComps, metatftComps, type CompsSource } from '../src/game/comps-sources';
import { bundledAugmentTiers } from '../src/game/metatft-augments';
import { displayName } from '../src/game/names';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import CompBrowser from '../src/desktop/CompBrowser.vue';
import { find, host, node, type TestNode } from './helpers/renderer';

const count = (root: TestNode, predicate: (n: TestNode) => boolean): number => Number(predicate(root)) + root.children.reduce((sum, n) => sum + count(n, predicate), 0);
describe('最新赛季与中文数据约束', () => {
  it('仅暴露一个赛季，拒绝历史和错误的在线缓存赛季', () => {
    expect(dataset.supportSets).toEqual([CURRENT_SET]);
    expect(comps.supportSets).toEqual([CURRENT_SET]);
    expect(dataset.charactersOf(16)).toEqual([]);
    expect(allComps({ set: 16 })).toEqual([]);
    expect(() => requireCurrentSeason(16)).toThrow('仅接受最新赛季');
    expect(() => requireCurrentSeason(CURRENT_SET + 1)).toThrow();
  });
  it('当前英雄、装备、羁绊、海克斯、三个源的阵容名称全部有中文', () => {
    const labels = [...dataset.characters, ...dataset.items, ...dataset.traits, ...dataset.augments].map(e => e.display_name);
    labels.push(...allComps({ set: CURRENT_SET }).map(c => c.name), ...bundledAugmentTiers.augments.map(a => a.name));
    expect(labels.every(name => !!name && /[\u3400-\u9fff]/.test(name))).toBe(true);
    expect(labels.some(name => /(?:DA_|TFT\d+_)/.test(name!))).toBe(false);
    expect(bundledAugmentTiers.augments.some(a => a.name === '名称待更新')).toBe(false);
    expect(displayName('DA_InfinityEdge')).toBe('无尽之刃');
    expect(displayName('DA_Amumu18')).toBe('阿木木');
    expect(displayName('unknown')).toBe('名称待更新');
    expect(DEFAULT_SETTINGS.compsSource).toBe('metatft');
  });
  it('阵容的全部英雄和装备，以及英雄的羁绊都可以在当前目录查询', () => {
    for (const c of allComps({ set: CURRENT_SET })) for (const u of c.units) {
      expect(dataset.character(CURRENT_SET, u.character_id), u.character_id).toBeDefined();
      for (const id of u.items ?? []) expect(dataset.item(id), id).toBeDefined();
    }
    for (const c of dataset.characters) for (const id of c.trait_ids) expect(dataset.trait(id), id).toBeDefined();
  });
  it('桌面默认 MetaTFT，可展开、按英雄筛选，并显式切换辅助数据源', async () => {
    const root = node();
    const source = ref<CompsSource | 'all'>('metatft');
    const app = createRenderer(host).createApp({ render: () => h(CompBrowser, { comps: allComps({ set: CURRENT_SET }), set: CURRENT_SET, source: source.value, snapshotDate: '', 'onUpdate:source': value => { source.value = value; } }) });
    app.mount(root);
    const articles = () => count(root, n => n.type === 'article');
    expect(articles()).toBe(metatftComps(CURRENT_SET).length);
    const toggle = find(root, n => n.type === 'button' && n.props['aria-expanded'] === true)!;
    toggle.props.onClick(); await nextTick();
    expect(find(root, n => n.type === 'button' && n.props['aria-expanded'] === true)).toBeUndefined();
    const hero = metatftComps(CURRENT_SET)[0].units[0].character_id;
    find(root, n => n.props['data-filter'] === hero)!.props.onClick(); await nextTick();
    expect(articles()).toBe(metatftComps(CURRENT_SET).filter(c => c.units.some(u => u.character_id === hero)).length);
    find(root, n => n.props['data-source'] === 'official')!.props.onClick(); await nextTick();
    expect(source.value).toBe('official');
    expect(articles()).toBe(comps.comps(CURRENT_SET, '官网阵容').filter(c => c.units.some(u => u.character_id === hero)).length);
    app.unmount();
  });
});
