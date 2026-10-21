import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { bundledAugmentTiers, parseAugmentTiers } from '../src/game/metatft-augments';
import { createFileStorage } from '../src/desktop/storage';
import { createDesktopSession } from '../src/desktop/session';
import type { DesktopBridge } from '../src/desktop/bridge';
import AugmentsPage from '../src/desktop/AugmentsPage.vue';

describe('MetaTFT 海克斯评级', () => {
  it('使用真实作者评级快照，赛季和来源明确，名称不依赖旧海克斯表', () => {
    expect(bundledAugmentTiers).toMatchObject({ source: 'MetaTFT', kind: 'author-rating', set: 18, patch: '18.4b' });
    expect(bundledAugmentTiers.augments).toHaveLength(259);
    expect(bundledAugmentTiers.augments.filter((a) => a.rating === 'S')).toHaveLength(27);
    expect(bundledAugmentTiers.augments.every((a) => a.name && !a.name.startsWith('DA_'))).toBe(true);
  });
  it('按 API 的 label 评级并过滤非海克斯，不将其它统计字段猜成评级', () => {
    const parsed = parseAugmentTiers({ tft_set: 'TFTSet18', content: { author: { gameName: 'Author', tagLine: 'EUW' }, content: { tierList: [
      { label: 'S', content: [{ id: 'DA_NewAugment', type: 'augment', avg: 8 }, { id: 'Unit', type: 'unit' }] },
      { label: 'A', content: [{ id: 'DA_NewAugment', type: 'augment' }] },
    ] } } });
    expect(parsed.augments).toEqual([{ id: 'DA_NewAugment', name: '名称待更新', rating: 'S', rarity: undefined }]);
    expect(parsed.author).toBe('Author#EUW');
  });
  it('拒绝空快照和无法识别的赛季，不覆盖有效缓存', () => {
    expect(() => parseAugmentTiers({})).toThrow();
    expect(() => parseAugmentTiers({ tft_set: 'TFTSet18', content: { content: { tierList: [] } } })).toThrow('空评级');
  });
  it('页面标明作者建议，旧赛季不会显示 S18 评级', async () => {
    const render = (set: number) => renderToString(createSSRApp({ render: () => h(AugmentsPage, { snapshot: bundledAugmentTiers, set, loading: false, error: '' }) }));
    const current = await render(18);
    expect(current).toContain('不等同于统计胜率');
    expect(current).toContain('data-rating="S"');
    const old = await render(16);
    expect(old).toContain('当前快照适用于 S18');
    expect(old).not.toContain('data-rating=');
  });
});

describe('独立桌面持久化与事件边界', () => {
  it('文件存储顺序写入并可重新读取，拒绝任意键和过大输入', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tftbot-storage-'));
    const file = path.join(dir, 'preferences.json');
    const store = createFileStorage(file);
    await Promise.all([store.setItem('tftbot:a', '1'), store.setItem('tftbot:b', '2')]);
    const reopened = createFileStorage(file);
    expect(await reopened.getItem('tftbot:a')).toBe('1');
    expect(await reopened.getItem('tftbot:b')).toBe('2');
    await reopened.removeItem('tftbot:a');
    expect(await createFileStorage(file).getItem('tftbot:a')).toBe('');
    await expect(store.setItem('../outside', 'x')).rejects.toThrow('存储键');
    await expect(store.setItem('tftbot:large', 'x'.repeat(2_000_001))).rejects.toThrow('过大');
  });
  it('不伪造实时对局，保留设置并迁移历史赛季偏好', async () => {
    const values = new Map<string, string>([['tftbot:desktop:set', '16']]);
    const bridge = { storage: { getItem: async (k: string) => values.get(k) ?? '', setItem: async (k: string, v: string) => { values.set(k, v); }, removeItem: async (k: string) => { values.delete(k); } } } as DesktopBridge;
    const session = await createDesktopSession(bridge);
    expect(session.controller.state().ready).toBe(false);
    expect(session.currentSet()).toBe(18);
    expect(values.has('tftbot:desktop:set')).toBe(false);
    await expect(session.changeSet(16)).rejects.toThrow('仅接受最新赛季');
    await session.settings.patch({ compsSource: 'metatft', showItems: false });
    const text = [
      { key: 'tft_roster', value: JSON.stringify([{ summoner: 'Me', health: 80, localplayer: '1' }]) },
      { key: 'players_info', value: JSON.stringify([{ summoner: 'Me', champions: [{ name: 'DA_18_Caitlyn', level: 2, position: 8 }] }]) },
    ].map((e) => JSON.stringify(e)).join('\n');
    expect(session.loadRecording(text)).toEqual({ events: 2, invalid: 0 });
    expect(session.controller.state().me?.placements?.[0].position).toBe(8);
    session.clearRecording();
    expect(session.controller.state().ready).toBe(false);
    session.dispose();
    const resumed = await createDesktopSession(bridge);
    expect(resumed.currentSet()).toBe(18);
    expect(resumed.settings.get()).toMatchObject({ compsSource: 'metatft', showItems: false });
    expect(resumed.controller.state().ready).toBe(false);
    resumed.dispose();
  });
});
