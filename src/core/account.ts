/**
 * 账号 / 邮箱绑定 / 迁移（background 侧）
 *
 * 相关命令：requireEmailBind / requireEmailRegistration / requestEmailBindProbe /
 * probeEmailBindStatus / summonerIdChanged / tftbotMigrationDebug。
 *
 * 本实现把"当前该不该弹绑定 / 该弹注册"散在若干布尔与 localStorage 标记里；
 * 这里收敛成一个可推导的状态（deriveBindState），命令层只读状态、写事件。
 */
import type { Broker } from './broker';
import type { Cube } from './cube';

export type BindPhase =
  | 'unknown' // 还没探测
  | 'bound' // 已绑邮箱
  | 'need-bind' // 有账号，需补绑
  | 'need-register' // 无账号，需注册
  | 'skipped'; // 用户选择跳过

export interface AccountState {
  phase: BindPhase;
  email: string | null;
  summonerId: string | null;
  /** 用户在本次会话里是否已拒绝过弹窗（避免骚扰） */
  dismissed: boolean;
  /** 迁移调试标记（本实现 tftbotMigrationDebug） */
  migrationDebug: boolean;
  updatedAt: number;
}

export const EMPTY_ACCOUNT: AccountState = {
  phase: 'unknown',
  email: null,
  summonerId: null,
  dismissed: false,
  migrationDebug: false,
  updatedAt: 0,
};

const SKIP_KEY = 'tftbot:wallet:link-lcu-skipped';

export interface AccountServiceDeps {
  cube: Pick<Cube, 'io'>;
  broker?: Broker;
  getOwner: () => Promise<string> | string;
  local?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
  /** 探测邮箱绑定情况（真机走 hexapi；测试注入） */
  probe?: () => Promise<{ bound: boolean; email?: string | null }>;
}

export const ACCOUNT_KEY = 'tftbot:account';

export interface AccountService {
  load(): Promise<AccountState>;
  state(): AccountState;
  /** 依据已知信息推导 phase（纯函数式，便于测试） */
  derive(input: { hasAccount: boolean; hasEmail: boolean; skipped: boolean; dismissed: boolean }): BindPhase;
  setEmail(email: string | null): Promise<AccountState>;
  setSummoner(summonerId: string | null): Promise<AccountState>;
  /** 主动探测一次（本实现 probeEmailBindStatus） */
  probe(): Promise<AccountState>;
  setSkipped(skipped: boolean): Promise<AccountState>;
  dismiss(): Promise<AccountState>;
  setMigrationDebug(on: boolean): Promise<AccountState>;
  /** 由命令层调用：需要什么弹窗？ */
  requirement(): 'none' | 'bind' | 'register';
}

export function deriveBindPhase(input: { hasAccount: boolean; hasEmail: boolean; skipped: boolean; dismissed: boolean }): BindPhase {
  if (input.hasAccount && input.hasEmail) return 'bound';
  if (input.skipped || input.dismissed) return 'skipped';
  return input.hasAccount ? 'need-bind' : 'need-register';
}

export function createAccountService(deps: AccountServiceDeps): AccountService {
  const now = deps.now ?? (() => Date.now());
  let owner = '';
  let state: AccountState = { ...EMPTY_ACCOUNT };

  const key = () => `${ACCOUNT_KEY}:${owner}`;

  async function read(): Promise<string> {
    try {
      const v = deps.local?.getItem(key());
      if (v) return String(v);
    } catch {}
    try {
      return (await deps.cube.io.localStorage.getItem(key())) || '';
    } catch {
      return '';
    }
  }

  async function write(v: string) {
    try {
      await deps.cube.io.localStorage.setItem(key(), v);
    } catch {}
    try {
      deps.local?.setItem(key(), v);
    } catch {}
  }

  const persist = async (patch: Partial<AccountState>) => {
    state = { ...state, ...patch, updatedAt: now() };
    // phase 由数据推导，避免出现"绑了邮箱但 phase 还是 need-bind"的脏状态
    const skipped = (await isSkipped()) || state.dismissed;
    state.phase = deriveBindPhase({
      hasAccount: !!state.summonerId,
      hasEmail: !!state.email,
      skipped,
      dismissed: state.dismissed,
    });
    await write(JSON.stringify(state));
    await deps.broker?.broadcast('summonerIdChanged', state.summonerId).catch(() => null);
    return state;
  };

  async function isSkipped(): Promise<boolean> {
    try {
      const v = deps.local?.getItem(SKIP_KEY);
      if (v != null) return v === '1';
    } catch {}
    try {
      const v = await deps.cube.io.localStorage.getItem(SKIP_KEY);
      if (v) return v === '1';
    } catch {}
    return false;
  }

  return {
    async load() {
      try {
        owner = String((await deps.getOwner()) ?? '');
      } catch {
        owner = '';
      }
      const raw = await read();
      if (raw) {
        try {
          state = { ...EMPTY_ACCOUNT, ...JSON.parse(raw) };
        } catch {
          state = { ...EMPTY_ACCOUNT };
        }
      }
      return this.probe();
    },

    state: () => state,

    derive: deriveBindPhase,

    setEmail: (email) => persist({ email: email ? String(email) : null }),

    setSummoner: (summonerId) => persist({ summonerId: summonerId ? String(summonerId) : null }),

    async probe() {
      if (deps.probe) {
        const r = await deps.probe().catch(() => null);
        if (r) return persist({ email: r.bound ? String(r.email ?? '') : null });
      }
      // 无探测能力时，用本地已知信息重算 phase
      return persist({});
    },

    async setSkipped(skipped) {
      try {
        await deps.cube.io.localStorage.setItem(SKIP_KEY, skipped ? '1' : '0');
      } catch {}
      try {
        deps.local?.setItem(SKIP_KEY, skipped ? '1' : '0');
      } catch {}
      return persist({});
    },

    dismiss: () => persist({ dismissed: true }),

    setMigrationDebug: (on) => persist({ migrationDebug: !!on }),

    requirement() {
      switch (state.phase) {
        case 'need-bind':
          return 'bind';
        case 'need-register':
          return 'register';
        default:
          return 'none';
      }
    },
  };
}
