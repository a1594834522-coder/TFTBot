import { describe, expect, it } from 'vitest';
import {
  formatHotkey,
  parseHotkey,
  vkCodeOf,
  createHotkeyStore,
  DEFAULT_HOTKEYS,
  HOTKEY_SLOTS,
  type HotkeySlot,
} from '../src/core/hotkeys';
import { createRecorder, createMemoryRecorderPort, DEFAULT_RECORD_SETTINGS } from '../src/core/recorder';
import { createBroker } from '../src/core/broker';
import { createFakeCube } from './helpers/fakeCube';

describe('热键解析', () => {
  it('ctrl+` → 修饰键 + code + vk + format', () => {
    const h = parseHotkey('ctrl+`');
    expect(h.code).toBe('`');
    expect(h.isCtrl).toBe(true);
    expect(h.vkCode).toBe(192);
    expect(h.format).toBe('ctrl+`');
  });

  it('F8 / 数字 / 字母 / 无修饰', () => {
    expect(parseHotkey('F8').format).toBe('F8');
    expect(parseHotkey('F8').vkCode).toBe(119);
    expect(parseHotkey('a').vkCode).toBe(65);
    expect(parseHotkey('5').vkCode).toBe(53);
    expect(parseHotkey('shift+alt+x').format).toBe('shift+alt+x');
  });

  it('formatHotkey 与 vkCodeOf 边界', () => {
    expect(formatHotkey({ code: 'f10', isCtrl: false, isShift: false, isAlt: false })).toBe('F10');
    expect(vkCodeOf('unknown-key')).toBe(0);
    expect(vkCodeOf('tab')).toBe(9);
  });
});

describe('热键仓库', () => {
  function make(owner = 'u1') {
    const f = createFakeCube();
    const local = new Map<string, string>();
    const store = createHotkeyStore({
      cube: f.cube,
      getOwner: () => owner,
      local: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v) } as any,
    });
    return { f, store, local };
  }

  it('未存过时用默认热键', async () => {
    const { store } = make();
    const all = await store.load();
    for (const slot of HOTKEY_SLOTS) expect(all[slot].format).toBe(DEFAULT_HOTKEYS[slot].format);
  });

  it('set 字符串 / 对象 都能落地并持久化', async () => {
    const { store, f } = make('u1');
    await store.load();
    const a = await store.set('show_main', 'ctrl+shift+m');
    expect(a.format).toBe('ctrl+shift+m');
    expect(a.isCtrl && a.isShift).toBe(true);
    const b = await store.set('show_tracker', { code: 'f7', isCtrl: false } as any);
    expect(b.format).toBe('F7');
    const raw = f.store.get('tftbot:hotkeys:u1')!;
    expect(JSON.parse(raw).show_main.format).toBe('ctrl+shift+m');
  });

  it('重新 load 能读回并且 name 归位', async () => {
    const { store } = make('u1');
    await store.load();
    await store.set('show_overall_record', 'ctrl+f8');
    const all = await store.load();
    expect(all.show_overall_record.format).toBe('ctrl+F8');
    expect(all.show_overall_record.name).toBe('show_overall_record');
  });

  it('不同 owner 隔离', async () => {
    const f = createFakeCube();
    const a = createHotkeyStore({ cube: f.cube, getOwner: () => 'A', local: null });
    const b = createHotkeyStore({ cube: f.cube, getOwner: () => 'B', local: null });
    await a.load();
    await b.load();
    await a.set('show_main', 'ctrl+1');
    await b.load();
    expect(b.get('show_main' as HotkeySlot).format).toBe('ctrl+`');
  });
});

describe('录制服务（Port 抽象 + 广播）', () => {
  function make() {
    const f = createFakeCube({ windows: ['background', 'main', 'trick'] });
    const broker = createBroker(f.cube);
    const port = createMemoryRecorderPort(['x264', 'nvenc']);
    const rec = createRecorder({ cube: f.cube, port, broker, getOwner: () => 'u1', local: null });
    return { f, broker, rec };
  }

  it('start/stop 状态机 + 广播 recordStateChanged', async () => {
    const { f, rec, broker } = make();
    await rec.load();
    expect(rec.state().isRecord).toBe(false);
    const started = await rec.start();
    expect(started.isRecord).toBe(true);
    expect(started.file).toContain('fps');
    expect(f.sent.filter((s) => s.command === 'recordStateChanged').length).toBeGreaterThan(0);

    const stopped = await rec.stop();
    expect(stopped.isRecord).toBe(false);
    expect(stopped.lastMedia).toBeTruthy();
    expect(f.sent.some((s) => s.command === 'recordMediaChanged')).toBe(true);
    broker.dispose();
  });

  it('设置持久化 + 直播列表', async () => {
    const { f, rec, broker } = make();
    await rec.load();
    const next = await rec.setSettings({ quality: 'high', fps: 120, baseDir: 'D:/rec' });
    expect(next.quality).toBe('high');
    expect(JSON.parse(f.store.get('tftbot:record:u1')!).fps).toBe(120);

    await rec.setLiveList(['rtmp://a', 'rtmp://b']);
    expect(await rec.liveList()).toEqual(['rtmp://a', 'rtmp://b']);
    broker.dispose();
  });

  it('默认录制设置可注入', async () => {
    const f = createFakeCube();
    const rec = createRecorder({
      cube: f.cube,
      port: createMemoryRecorderPort(),
      getOwner: () => 'u',
      defaults: { fps: 30, quality: 'low' },
    });
    await rec.load();
    expect(rec.getSettings().fps).toBe(30);
    expect(rec.getSettings().quality).toBe('low');
    expect(DEFAULT_RECORD_SETTINGS.fps).toBe(60);
  });

  it('编码器列表来自 Port', async () => {
    const { rec, broker } = make();
    expect(await rec.encoders()).toEqual(['x264', 'nvenc']);
    broker.dispose();
  });
});
