import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import SettingsPage from '../src/windows/settings/SettingsPage.vue';
import { DEFAULT_SETTINGS, TOGGLE_KEYS, toggleSetting, patchSetting, normalizeSettings } from '../src/core/settings';
import { pageForWindow } from '../src/boot/lean';
import { createFakeCube } from './helpers/fakeCube';
import { createLeanBackground } from '../src/app/lean';

const render = (props: InstanceType<typeof SettingsPage>['$props']) => renderToString(createSSRApp({ render: () => h(SettingsPage, props) }));

describe('设置页渲染', () => {
  it('渲染全部开关 + 阵容源芯片', async () => {
    const html = await render({ settings: DEFAULT_SETTINGS });
    const keys = [...html.matchAll(/data-setting="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...TOGGLE_KEYS].sort());
    expect(html).toContain('data-section="comps-source"');
    for (const s of ['all', 'official', 'blitz', 'metatft']) expect(html).toContain(`data-source="${s}"`);
    expect(html).toMatch(/data-enabled="\d+"/);
  });

  it('开关状态反映 settings（data-on）', async () => {
    const html = await render({
      settings: normalizeSettings({ showCardTracker: true, showWarning: false }),
    });
    expect(html).toMatch(/data-setting="showCardTracker"[^>]*data-on="1"/);
    expect(html).toMatch(/data-setting="showWarning"[^>]*data-on="0"/);
  });

  it('当前阵容源高亮', async () => {
    const html = await render({ settings: normalizeSettings({ compsSource: 'metatft' }) });
    expect(html).toMatch(/data-source="metatft"[^>]*class="[^"]*active|class="[^"]*active[^"]*"[^>]*data-source="metatft"/);
  });

  it('自定义 label 覆盖默认文案', async () => {
    const html = await render({ settings: DEFAULT_SETTINGS, labels: { showWarning: '我的预警' } });
    expect(html).toContain('我的预警');
  });
});

describe('设置纯函数', () => {
  it('toggleSetting 取反且不改原对象', () => {
    const base = normalizeSettings({ showWarning: true });
    const next = toggleSetting(base, 'showWarning');
    expect(next.showWarning).toBe(false);
    expect(base.showWarning).toBe(true);
  });

  it('patchSetting 处理普通键、数组键与非法 compsSource', () => {
    const s = normalizeSettings({});
    expect(patchSetting(s, 'compsSource', 'metatft').compsSource).toBe('metatft');
    expect(patchSetting(s, 'compsSource', 'bogus').compsSource).toBe('metatft');
    expect(patchSetting(s, 'threeMarkCosts', ['4', '5']).threeMarkCosts).toEqual([4, 5]);
    expect(patchSetting(s, 'level3Warning', [1, 0, 1]).level3Warning.slice(0, 7)).toEqual([true, false, true, false, true, true, true]);
  });

  it('boot 把 settings 窗口识别出来', () => {
    expect(pageForWindow('settings')).toBe('settings');
    expect(pageForWindow('settingwin')).toBe('settings');
  });
});

describe('设置页 ↔ background 打通', () => {
  it('改开关后 setSettings 落盘并广播', async () => {
    const f = createFakeCube({ windows: ['background', 'main', 'settings'] });
    const app = createLeanBackground(f.cube, { getOwner: () => 'local' });
    await app.ready();
    const before = await f.invoke('getSettings');
    expect(before.showCardTracker).toBe(false);
    const next = await f.invoke('setSettings', { showCardTracker: true } as any);
    expect(next.showCardTracker).toBe(true);
    const persisted = JSON.parse(f.store.get('tftbot:settings:local')!);
    expect(persisted.showCardTracker).toBe(true);
    expect(f.sent.some((m) => m.command === 'settingsChanged')).toBe(true);
    app.dispose();
  });
});
