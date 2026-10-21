/**
 * 设置仓库（background 侧）—— 行为约定：
 *   存储键：`tftbot:settings:${owner}`（owner = 当前登录用户 uuid，未登录时为空串）
 *   双写：cube.io.localStorage（宿主侧持久化）+ window.localStorage（页面侧快取）
 *   读取顺序：localStorage → cube.io.localStorage → 默认值
 *   另有「用户主动改过」的键集合，用于「解锁后自动勾开」时不覆盖用户选择
 *
 * 另有一处 `tftbot:settings:user-customized:${owner}`（主进程页面在用），
 * 这里统一由一个 store 管，避免两处各写一份。
 */
import type { Cube } from './cube';
import { DEFAULT_SETTINGS, SETTING_FEATURE_MAP, normalizeSettings, type GatedSettingKey, type Settings } from './settings';

export const SETTINGS_PREFIX = 'tftbot:settings:';
export const CUSTOMIZED_PREFIX = 'tftbot:settings:user-customized:';

export interface SettingsStoreDeps {
  cube: Pick<Cube, 'io'>;
  /** 取当前用户 uuid；未登录返回 '' */
  getOwner: () => Promise<string> | string;
  /** 页面侧 localStorage（测试可注入） */
  local?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export interface SettingsStore {
  load(): Promise<Settings>;
  get(): Settings;
  /** 接收其它窗口的完整快照；只更新缓存，不重播或回写宿主。 */
  sync(next: Partial<Settings>): void;
  save(next: Settings): Promise<void>;
  /** 合并式更新（会记录“用户主动改过”的键） */
  patch(partial: Partial<Settings>, opts?: { userAction?: boolean }): Promise<Settings>;
  /** 某设置项是否被用户主动改过 */
  isCustomized(key: keyof Settings | GatedSettingKey): Promise<boolean>;
  /** 功能状态解锁后自动勾开对应开关（尊重用户主动关闭过的那一项） */
  applyUnlockedFeatures(features: Array<{ key: string; unlocked?: boolean }>, opts?: { force?: boolean }): Promise<Settings>;
  /** 当前存储键（调试用） */
  storageKey(): Promise<string>;
  /** 订阅设置变化（save/patch 后触发），返回退订函数 */
  subscribe(cb: (s: Settings) => void): () => void;
}

function memLocal(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {}
  return null;
}

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStore {
  const local = deps.local ?? memLocal();
  let cache: Settings | null = null;
  let owner = '';

  const key = () => `${SETTINGS_PREFIX}${owner}`;
  const customizedKey = () => `${CUSTOMIZED_PREFIX}${owner}`;

  const listeners = new Set<(s: Settings) => void>();
  function emit() {
    const s = cache;
    if (!s) return;
    for (const cb of listeners) {
      try {
        cb(s);
      } catch {}
    }
  }

  async function resolveOwner() {
    try {
      owner = String((await deps.getOwner()) ?? '');
    } catch {
      owner = '';
    }
    return owner;
  }

  async function readRaw(k: string): Promise<string> {
    try {
      const v = local?.getItem(k);
      if (v) return String(v);
    } catch {}
    try {
      const v = await deps.cube.io.localStorage.getItem(k);
      if (v) return String(v);
    } catch {}
    return '';
  }

  async function writeRawNow(k: string, v: string) {
    try {
      await deps.cube.io.localStorage.setItem(k, v);
    } catch {}
    try {
      local?.setItem(k, v);
    } catch {}
  }

  let writes = Promise.resolve();
  function writeRaw(k: string, v: string) {
    const pending = writes.then(() => writeRawNow(k, v));
    writes = pending.catch(() => {});
    return pending;
  }

  async function readCustomized(): Promise<string[]> {
    const raw = await readRaw(customizedKey());
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return [];
    }
  }

  let customized: string[] = [];

  return {
    async load() {
      await resolveOwner();
      const raw = await readRaw(key());
      let parsed: Partial<Settings> = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = {};
        }
      }
      customized = await readCustomized();
      cache = normalizeSettings(parsed);
      return cache;
    },

    get() {
      return cache ?? normalizeSettings(DEFAULT_SETTINGS);
    },

    sync(next) {
      if (!next || typeof next !== 'object' || Array.isArray(next)) return;
      const normalized = normalizeSettings(next);
      if (JSON.stringify(cache) === JSON.stringify(normalized)) return;
      cache = normalized;
      try { local?.setItem(key(), JSON.stringify(cache)); } catch {}
      emit();
    },

    async save(next) {
      cache = normalizeSettings(next);
      await writeRaw(key(), JSON.stringify(cache));
      emit();
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async patch(partial, opts = {}) {
      const cur = cache ?? (await this.load());
      const next = normalizeSettings({ ...cur, ...partial });
      // 在首次异步写入前更新内存，连续点击不会基于旧快照覆盖彼此。
      cache = next;
      if (opts.userAction !== false) {
        const touched = Object.keys(partial);
        const set = new Set(customized);
        for (const k of touched) set.add(k);
        customized = [...set];
        await writeRaw(customizedKey(), JSON.stringify(customized));
      }
      await writeRaw(key(), JSON.stringify(cache));
      emit();
      return cache;
    },

    async isCustomized(k) {
      if (!customized.length) customized = await readCustomized();
      return customized.includes(String(k));
    },

    async applyUnlockedFeatures(features, opts = {}) {
      const cur = cache ?? (await this.load());
      const patch: Partial<Settings> = {};
      for (const [settingKey, featureKey] of Object.entries(SETTING_FEATURE_MAP) as Array<[GatedSettingKey, string]>) {
        const flag = features.find((f) => f.key === featureKey);
        if (!flag?.unlocked && opts.force !== true) continue;
        // 用户主动关掉的，不强行打开（本实现同样尊重）
        if (!opts.force && (await this.isCustomized(settingKey))) continue;
        (patch as any)[settingKey] = true;
      }
      if (!Object.keys(patch).length) return cur;
      return this.patch(patch, { userAction: false });
    },

    async storageKey() {
      await resolveOwner();
      return key();
    },
  };
}
