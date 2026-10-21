/**
 * 功能状态服务（background 侧）—— 把「拉状态 → 缓存 → 广播 → 自动勾开关」串起来。
 * 相关命令：featureUnlockStatus 周期刷新 + featureUnlockChanged 广播 + syncMembershipUpdated。
 *
 * 与 features.ts 的分工：那边是纯解析/判定，这边是服务（IO、缓存、定时、广播）。
 */
import type { Cube } from './cube';
import { HexApiClient } from './hexapi';
import { parseFeatureUnlockResponse, type FeatureSnapshot, type UnlockPolicy } from './features';
import type { SettingsStore } from './settings-store';
import type { Broker } from './broker';

export interface FeatureServiceDeps {
  cube: Pick<Cube, 'windows'>;
  api?: HexApiClient;
  broker?: Broker;
  settings?: SettingsStore;
  policy?: UnlockPolicy;
  /** 刷新间隔（ms），默认 5 分钟；0 表示不自动刷新 */
  intervalMs?: number;
}

export interface FeatureService {
  /** 立即拉一次；失败时返回上次缓存或空快照 */
  refresh(): Promise<FeatureSnapshot>;
  /** 当前缓存（不触发 IO） */
  cached(): FeatureSnapshot | null;
  /** 启动定时刷新 + 首次拉取 */
  start(): Promise<FeatureSnapshot>;
  dispose(): void;
}

export function createFeatureService(deps: FeatureServiceDeps): FeatureService {
  const api = deps.api ?? new HexApiClient();
  const policy = deps.policy ?? 'server';
  const intervalMs = deps.intervalMs ?? 5 * 60 * 1000;
  let cache: FeatureSnapshot | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight: Promise<FeatureSnapshot> | null = null;

  async function doRefresh(): Promise<FeatureSnapshot> {
    const res = await api.featureUnlockStatus().catch(() => null);
    const snap = parseFeatureUnlockResponse(res && res.code === 200 ? res.data : null, policy);
    cache = snap;
    // 解锁状态 → 自动勾开设置里对应的开关（尊重用户主动改过的项）
    if (deps.settings) {
      await deps.settings.applyUnlockedFeatures(snap.features).catch(() => null);
    }
    // 广播：子窗口据此刷新 UI / 重新拉 features 列表
    if (deps.broker) {
      await deps.broker.broadcast('featureUnlockChanged', '').catch(() => null);
      await deps.broker.broadcast('syncMembershipUpdated', snap.membership).catch(() => null);
    }
    return snap;
  }

  return {
    refresh() {
      if (inflight) return inflight;
      inflight = doRefresh().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    cached: () => cache,
    async start() {
      const first = await this.refresh().catch(() => parseFeatureUnlockResponse(null, policy));
      if (intervalMs > 0 && !timer) {
        timer = setInterval(() => {
          this.refresh().catch(() => null);
        }, intervalMs);
        // 不阻塞进程退出（Node 场景）
        (timer as any)?.unref?.();
      }
      return first;
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
