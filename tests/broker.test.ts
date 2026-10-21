import { describe, expect, it, vi } from 'vitest';
import { createBroker, BROADCAST_TARGETS } from '../src/core/broker';
import { createFakeCube } from './helpers/fakeCube';

describe('broker（background 命令注册/回包/广播）', () => {
  it('注册的命令能被 invoke 拿到返回值', async () => {
    const f = createFakeCube();
    const b = createBroker(f.cube);
    b.handle('getSettings', (payload) => ({ echo: payload, ok: true }));
    await expect(f.invoke('getSettings', 'hi')).resolves.toEqual({ echo: 'hi', ok: true });
    b.dispose();
  });

  it('异步 handler 也会等结果', async () => {
    const f = createFakeCube();
    const b = createBroker(f.cube);
    b.handle('getFeaturesList', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return [{ key: 'card_tracker', unlocked: true }];
    });
    const rows = await f.invoke('getFeaturesList');
    expect(rows[0].key).toBe('card_tracker');
    b.dispose();
  });

  it('未注册命令返回 undefined（不会挂死调用方）', async () => {
    const f = createFakeCube();
    const b = createBroker(f.cube);
    await expect(f.invoke('nope' as any)).resolves.toBeUndefined();
    b.dispose();
  });

  it('handler 抛错不影响后续调用，且回 undefined', async () => {
    const f = createFakeCube();
    const b = createBroker(f.cube);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    b.handle('getItems', () => {
      throw new Error('boom');
    });
    await expect(f.invoke('getItems')).resolves.toBeUndefined();
    b.handle('getTraits', () => ['t']);
    await expect(f.invoke('getTraits')).resolves.toEqual(['t']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    b.dispose();
  });

  it('解绑后命令不可用；has/commands 正确', async () => {
    const f = createFakeCube();
    const b = createBroker(f.cube);
    const off = b.handle('getComps', () => []);
    expect(b.has('getComps')).toBe(true);
    expect(b.commands()).toContain('getComps');
    off();
    expect(b.has('getComps')).toBe(false);
    b.dispose();
  });

  it('broadcast 只发给开着的窗口，且跳过不存在的', async () => {
    const f = createFakeCube({ windows: ['background', 'main'] });
    const b = createBroker(f.cube, BROADCAST_TARGETS);
    await b.broadcast('settingsChanged', { a: 1 });
    const targets = f.sent.map((s) => s.windowId);
    expect(targets).toEqual(['main']);
    expect(f.sent[0].command).toBe('settingsChanged');
    b.dispose();
  });
});
