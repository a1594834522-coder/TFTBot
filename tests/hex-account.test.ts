import { describe, expect, it } from 'vitest';
import { createHexOrderService, IDLE_ORDER } from '../src/core/hex-order';
import { createAccountService, deriveBindPhase, EMPTY_ACCOUNT } from '../src/core/account';
import { createBroker } from '../src/core/broker';
import { createFakeCube } from './helpers/fakeCube';

function hexStore() {
  const f = createFakeCube({ windows: ['background', 'main', 'hexmsg'] });
  const broker = createBroker(f.cube);
  const svc = createHexOrderService({ cube: f.cube, broker, getOwner: () => 'u1', local: null, now: () => 1000 });
  return { f, broker, svc };
}

describe('Hex 订单状态机', () => {
  it('默认 idle', async () => {
    const { svc, broker } = hexStore();
    await svc.load();
    expect(svc.current()).toEqual(IDLE_ORDER);
    broker.dispose();
  });

  it('合法迁移 idle → pending → placed → settled', async () => {
    const { svc, f, broker } = hexStore();
    await svc.load();
    await svc.transition({ phase: 'pending', amountCents: 1000, odds: 1.85 });
    expect(svc.current().phase).toBe('pending');
    await svc.transition({ phase: 'placed', orderId: 'A1' });
    expect(svc.current().orderId).toBe('A1');
    await svc.setResult({ result: 'win', refundCents: 1850 });
    expect(svc.current().phase).toBe('settled');
    expect(svc.current().result).toBe('win');
    expect(svc.current().refundCents).toBe(1850);
    // 每次迁移都会广播给所有开着的窗口（这里 main + hexmsg）
    const statusMsgs = f.sent.filter((s) => s.command === 'setHexOrderStatus');
    expect(new Set(statusMsgs.map((s) => s.windowId))).toEqual(new Set(['main', 'hexmsg']));
    expect(statusMsgs.length).toBe(3 * 2);
    broker.dispose();
  });

  it('非法迁移被拒绝且记录原因（不抛）', async () => {
    const { svc, broker } = hexStore();
    await svc.load();
    await svc.transition({ phase: 'settled' }); // idle → settled 不允许
    expect(svc.current().phase).toBe('idle');
    expect(svc.current().lastError).toMatch(/illegal transition/);
    broker.dispose();
  });

  it('setStatus 接受 JSON 字符串；setHexGamePlayBegan 布尔化', async () => {
    const { svc, broker } = hexStore();
    await svc.load();
    await svc.setStatus('{"phase":"pending"}');
    expect(svc.current().phase).toBe('pending');
    await svc.markGameStarted(true);
    expect(svc.current().gameStarted).toBe(true);
    broker.dispose();
  });

  it('reset 清空并广播；sync 按状态通知不同窗口', async () => {
    const { svc, f, broker } = hexStore();
    await svc.load();
    await svc.transition({ phase: 'pending' });
    await svc.reset('switch-account');
    expect(svc.current().phase).toBe('idle');
    expect(svc.current().lastError).toBe('switch-account');

    await svc.transition({ phase: 'pending' });
    await svc.transition({ phase: 'placed', orderId: 'B' });
    await svc.sync();
    expect(f.sent.some((s) => s.command === 'setHexOrderRes')).toBe(true);

    await svc.setResult({ result: 'lose' });
    await svc.sync();
    expect(f.sent.some((s) => s.command === 'showHexOrderResult')).toBe(true);
    broker.dispose();
  });

  it('持久化：换实例能读回', async () => {
    const f = createFakeCube();
    const s1 = createHexOrderService({ cube: f.cube, getOwner: () => 'u1', local: null });
    await s1.load();
    await s1.transition({ phase: 'pending', amountCents: 500 });
    const s2 = createHexOrderService({ cube: f.cube, getOwner: () => 'u1', local: null });
    const loaded = await s2.load();
    expect(loaded.phase).toBe('pending');
    expect(loaded.amountCents).toBe(500);
  });
});

describe('账号 / 邮箱绑定', () => {
  it('deriveBindPhase 纯函数规则', () => {
    expect(deriveBindPhase({ hasAccount: true, hasEmail: true, skipped: false, dismissed: false })).toBe('bound');
    expect(deriveBindPhase({ hasAccount: true, hasEmail: false, skipped: false, dismissed: false })).toBe('need-bind');
    expect(deriveBindPhase({ hasAccount: false, hasEmail: false, skipped: false, dismissed: false })).toBe('need-register');
    expect(deriveBindPhase({ hasAccount: true, hasEmail: false, skipped: true, dismissed: false })).toBe('skipped');
    expect(deriveBindPhase({ hasAccount: false, hasEmail: false, skipped: false, dismissed: true })).toBe('skipped');
  });

  function acc(probe?: () => Promise<{ bound: boolean; email?: string | null }>) {
    const f = createFakeCube({ windows: ['background', 'main'] });
    const broker = createBroker(f.cube);
    const svc = createAccountService({ cube: f.cube, broker, getOwner: () => 'u1', local: null, probe, now: () => 10 });
    return { f, broker, svc };
  }

  it('无账号 → need-register；绑邮箱后 → bound', async () => {
    const { svc, broker } = acc();
    await svc.load();
    expect(svc.state().phase).toBe('need-register');
    expect(svc.requirement()).toBe('register');
    await svc.setSummoner('123');
    expect(svc.state().phase).toBe('need-bind');
    expect(svc.requirement()).toBe('bind');
    await svc.setEmail('a@b.c');
    expect(svc.state().phase).toBe('bound');
    expect(svc.requirement()).toBe('none');
    broker.dispose();
  });

  it('probe 注入：后端说已绑则直接 bound', async () => {
    const { svc, broker } = acc(async () => ({ bound: true, email: 'x@y.z' }));
    await svc.load();
    expect(svc.state().email).toBe('x@y.z');
    await svc.setSummoner('777');
    expect(svc.state().phase).toBe('bound');
    broker.dispose();
  });

  it('skipped / dismissed 抑制弹窗；可恢复', async () => {
    const { svc, broker } = acc();
    await svc.load();
    await svc.setSummoner('1');
    await svc.setSkipped(true);
    expect(svc.state().phase).toBe('skipped');
    expect(svc.requirement()).toBe('none');
    await svc.setSkipped(false);
    expect(svc.state().phase).toBe('need-bind');
    await svc.dismiss();
    expect(svc.requirement()).toBe('none');
    broker.dispose();
  });

  it('广播 summonerIdChanged；migrationDebug 持久化', async () => {
    const { f, svc, broker } = acc();
    await svc.load();
    await svc.setSummoner('42');
    expect(f.sent.some((s) => s.command === 'summonerIdChanged' && s.payload === '42')).toBe(true);
    await svc.setMigrationDebug(true);
    expect(svc.state().migrationDebug).toBe(true);
    broker.dispose();
  });

  it('初始状态为空对象语义', () => {
    expect(EMPTY_ACCOUNT.phase).toBe('unknown');
    expect(EMPTY_ACCOUNT.email).toBeNull();
  });
});
