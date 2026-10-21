import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeatureService } from '../src/core/feature-service';
import { createSettingsStore } from '../src/core/settings-store';
import { createBroker } from '../src/core/broker';
import { DEFAULT_FEATURES } from '../src/core/features';
import { createFakeCube } from './helpers/fakeCube';
import { HexApiClient } from '../src/core/hexapi';

function apiWith(responses: Array<any>) {
  let i = 0;
  return new HexApiClient({
    getToken: () => '',
    getDeviceId: () => '',
    fetchImpl: (async () => {
      const body = responses[Math.min(i++, responses.length - 1)];
      return { status: 200, text: async () => JSON.stringify(body) };
    }) as any,
  });
}

const locked = { code: 200, data: { features: DEFAULT_FEATURES, membership: { plan: null } } };
const unlocked = {
  code: 200,
  data: {
    features: DEFAULT_FEATURES.map((f) => ({ ...f, unlocked: true })),
    membership: { plan: 'vip', isPermanent: true, expireAt: Number.MAX_SAFE_INTEGER },
    unlockLevel: 4,
  },
};

describe('feature-service（拉取→缓存→广播→自动勾开）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('拉到状态后缓存并广播 featureUnlockChanged / syncMembershipUpdated', async () => {
    const f = createFakeCube({ windows: ['background', 'main', 'trick'] });
    const broker = createBroker(f.cube);
    const svc = createFeatureService({ cube: f.cube, api: apiWith([unlocked]), broker, policy: 'server' });
    const snap = await svc.refresh();
    expect(snap.features.every((x) => x.unlocked)).toBe(true);
    expect(svc.cached()).toBe(snap);
    const cmds = f.sent.map((s) => s.command);
    expect(cmds).toContain('featureUnlockChanged');
    expect(cmds).toContain('syncMembershipUpdated');
    expect(f.sent.filter((s) => s.command === 'featureUnlockChanged').length).toBe(2); // main + trick
    svc.dispose();
    broker.dispose();
  });

  it('接口失败时给降级快照，不抛', async () => {
    const f = createFakeCube();
    const svc = createFeatureService({ cube: f.cube, api: apiWith([{ code: 500 }]), policy: 'server' });
    const snap = await svc.refresh();
    expect(snap.features.length).toBe(4);
    expect(snap.features.every((x) => !x.unlocked)).toBe(true);
    svc.dispose();
  });

  it('always 策略下即使接口失败也全解锁', async () => {
    const f = createFakeCube();
    const svc = createFeatureService({ cube: f.cube, api: apiWith([{ code: 500 }]), policy: 'always' });
    const snap = await svc.refresh();
    expect(snap.features.every((x) => x.unlocked)).toBe(true);
    expect(snap.membership.displayStatus).toBe('permanent');
    svc.dispose();
  });

  it('解锁后自动勾开 settings 里对应开关', async () => {
    const f = createFakeCube();
    const settings = createSettingsStore({ cube: f.cube, getOwner: () => 'u1', local: null });
    await settings.load();
    // 先手动关掉一个
    await settings.patch({ showCardTracker: false }, { userAction: true });
    const svc = createFeatureService({ cube: f.cube, api: apiWith([unlocked]), settings, policy: 'server' });
    await svc.refresh();
    const s = settings.get();
    expect(s.showThreeMark).toBe(true);
    expect(s.showWarning).toBe(true);
    // 用户主动关掉的保持关闭
    expect(s.showCardTracker).toBe(false);
    svc.dispose();
  });

  it('并发 refresh 只发一次请求', async () => {
    const f = createFakeCube();
    let calls = 0;
    const api = new HexApiClient({
      fetchImpl: (async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return { status: 200, text: async () => JSON.stringify(unlocked) };
      }) as any,
    });
    const svc = createFeatureService({ cube: f.cube, api });
    await Promise.all([svc.refresh(), svc.refresh(), svc.refresh()]);
    expect(calls).toBe(1);
    svc.dispose();
  });
});
