/**
 * hexapi 客户端（TS 版）—— 下注事件
 * 只保留“核心 + 功能状态 + 钱包”这些二次开发会用到的接口，签名与线上协议一致。
 */
import type { FeatureSnapshot } from './features';

export const HEX_BASE = 'https://tftbot.gg/hexapi';

export const ENDPOINTS = {
  walletRegister: `${HEX_BASE}/userWallet/register`,
  walletLogin: `${HEX_BASE}/userWallet/login`,
  walletUserProfile: `${HEX_BASE}/userWallet/profile`,
  walletBalance: `${HEX_BASE}/wallet/balance`,
  walletEmailBound: `${HEX_BASE}/userWallet/email-bound`,
  walletLinkLcuSkip: `${HEX_BASE}/userWallet/link-lcu/skip`,
  featureUnlock: `${HEX_BASE}/hex/feature-unlock`,
  accountStatus: `${HEX_BASE}/hex/account/status`,
  grayCheck: `${HEX_BASE}/hex/gray/check`,
  realModeApply: `${HEX_BASE}/hex/real-mode/apply`,
  realModeApplyStatus: `${HEX_BASE}/hex/real-mode/apply/status`,
  dailyGiftStatus: `${HEX_BASE}/hex/daily-gift/status`,
  dailyGiftClaim: `${HEX_BASE}/hex/daily-gift/claim`,
  betAmountConfig: `${HEX_BASE}/hex/config/bet-amounts`,
  order: `${HEX_BASE}/hex/order`,
  preOrder: `${HEX_BASE}/hex/preOrder`,
  orderResults: `${HEX_BASE}/hex/order/results`,
  gameReport: `${HEX_BASE}/gameReport/hex`,
} as const;

export interface HexResponse<T = any> {
  code: number;
  msg?: string;
  data?: T;
}

export interface HexClientOptions {
  baseUrl?: string;
  /** 读取 token（默认 localStorage['tftbot-accessToken']） */
  getToken?: () => string;
  /** 读取设备 id（默认 localStorage['tftbot:device:id']） */
  getDeviceId?: () => string;
  fetchImpl?: typeof fetch;
}

const TOKEN_KEY = 'tftbot-accessToken';
const DEVICE_KEY = 'tftbot:device:id';

export class HexApiClient {
  private baseUrl: string;
  private getToken: () => string;
  private getDeviceId: () => string;
  private fetchImpl: typeof fetch;

  constructor(opts: HexClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? HEX_BASE).replace(/\/$/, '');
    this.getToken = opts.getToken ?? (() => (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) ?? '' : ''));
    this.getDeviceId = opts.getDeviceId ?? (() => (typeof localStorage !== 'undefined' ? localStorage.getItem(DEVICE_KEY) ?? '' : ''));
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request<T = any>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<HexResponse<T>> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const token = this.getToken();
    const deviceId = this.getDeviceId();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'content-type': 'application/json',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    if (deviceId) headers['X-Device-Id'] = deviceId;

    try {
      const res = await this.fetchImpl(url, {
        method,
        headers,
        ...(method !== 'GET' && body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.status === 200 && json) return json as HexResponse<T>;
      return { code: Number(json?.code ?? res.status ?? 500), msg: json?.msg ?? `${res.status}`, data: json?.data };
    } catch (e: any) {
      return { code: 500, msg: '网络异常，请检查网络后重试', data: undefined };
    }
  }

  /* ---------- 功能状态 ---------- */
  featureUnlockStatus() {
    return this.request(ENDPOINTS.featureUnlock, 'GET');
  }

  featureUnlockUpdate(body: { inviteCount?: number }) {
    return this.request(ENDPOINTS.featureUnlock, 'POST', body ?? {});
  }

  /* ---------- 钱包 / 登录 ---------- */
  walletLogin(payload: { email?: string; summonerId?: string; summonerName?: string; deviceId?: string }) {
    return this.request(ENDPOINTS.walletLogin, 'POST', payload);
  }

  walletBalance() {
    return this.request(ENDPOINTS.walletBalance, 'GET');
  }

  /* ---------- 便捷：直接拿解析好的快照 ---------- */
  async fetchFeatureSnapshot<T = any>(): Promise<HexResponse<T>> {
    return this.request(ENDPOINTS.featureUnlock, 'GET');
  }
}

/** 从 JWT 里读 iss（本实现用来识别 pay-api token，避免拿错 token 打接口） */
export function readJwtIssuer(token: string): string {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return '';
    const payload = parts[1] + '==='.slice((parts[1].length + 3) % 4);
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return String(json?.iss ?? '');
  } catch {
    return '';
  }
}

export type { FeatureSnapshot };
