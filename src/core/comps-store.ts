/**
 * 阵容仓库（background 侧）—— 负责 myTeamComps / pinComps 两条线：
 *   setMyTeamComps / getMyTeamComps / deleteMyTeamComps / myTeamCompsChanged
 *   setPinCompsInfo / getPinCompsInfo / pinCompsChanged
 *
 * 本实现把「我的阵容」存成本地 JSON，把「当前展示的阵容」做成一个 pin 记录
 * （`{ type, set, details }`，details 是 JSON 字符串）；这里做成类型化 store。
 */
import type { Cube } from './cube';

export type CompType = 'mycomps' | 'popular' | 'official' | 'blitz' | 'none';

export interface TeamCompUnit {
  character_id: string;
  /** 棋盘格索引（0..27），未上场为 undefined */
  position?: number;
  item_1?: string;
  item_2?: string;
  item_3?: string;
}

export interface TeamComp {
  id: string;
  name: string;
  /** 赛季（set number） */
  set: number;
  units: TeamCompUnit[];
  /** 备注/来源标签 */
  tags?: string[];
  updatedAt: number;
}

export interface PinnedComp {
  type: CompType;
  set: number;
  /** 原始 details（JSON 字符串，保留本实现兼容） */
  details: string;
}

export const COMPS_PREFIX = 'tftbot:comps:';
export const PIN_PREFIX = 'tftbot:pin:';

export interface CompsStoreDeps {
  cube: Pick<Cube, 'io'>;
  getOwner: () => Promise<string> | string;
  local?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
  /** 生成 id（默认时间戳+随机） */
  genId?: () => string;
}

export interface CompsStore {
  list(set?: number): Promise<TeamComp[]>;
  add(comp: Omit<TeamComp, 'id' | 'updatedAt'> & { id?: string }): Promise<TeamComp>;
  update(id: string, patch: Partial<Omit<TeamComp, 'id'>>): Promise<TeamComp | null>;
  remove(id: string): Promise<boolean>;
  /** 当前 pinned（本实现 getPinCompsInfo） */
  getPinned(): Promise<PinnedComp>;
  setPinned(p: Partial<PinnedComp> & { type: CompType }): Promise<PinnedComp>;
  clearPinned(): Promise<void>;
}

const EMPTY_PIN: PinnedComp = { type: 'none', set: 0, details: '' };

function memLocal(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {}
  return null;
}

export function createCompsStore(deps: CompsStoreDeps): CompsStore {
  const local = deps.local ?? memLocal();
  const now = deps.now ?? (() => Date.now());
  const genId = deps.genId ?? (() => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  let owner = '';
  let cache: TeamComp[] | null = null;

  const key = () => `${COMPS_PREFIX}${owner}`;
  const pinKey = () => `${PIN_PREFIX}${owner}`;

  async function resolveOwner() {
    try {
      owner = String((await deps.getOwner()) ?? '');
    } catch {
      owner = '';
    }
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

  async function writeRaw(k: string, v: string) {
    try {
      await deps.cube.io.localStorage.setItem(k, v);
    } catch {}
    try {
      local?.setItem(k, v);
    } catch {}
  }

  async function loadAll(): Promise<TeamComp[]> {
    if (cache) return cache;
    await resolveOwner();
    const raw = await readRaw(key());
    if (!raw) return (cache = []);
    try {
      const arr = JSON.parse(raw);
      cache = Array.isArray(arr) ? (arr as TeamComp[]) : [];
    } catch {
      cache = [];
    }
    return cache;
  }

  async function persist() {
    await writeRaw(key(), JSON.stringify(cache ?? []));
  }

  return {
    async list(set) {
      const all = await loadAll();
      const list = set == null ? all : all.filter((c) => c.set === set);
      return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async add(comp) {
      const all = await loadAll();
      const item: TeamComp = {
        id: comp.id ?? genId(),
        name: comp.name,
        set: comp.set,
        units: comp.units ?? [],
        tags: comp.tags ?? [],
        updatedAt: now(),
      };
      const idx = all.findIndex((c) => c.id === item.id);
      if (idx >= 0) all[idx] = item;
      else all.push(item);
      cache = all;
      await persist();
      return item;
    },

    async update(id, patch) {
      const all = await loadAll();
      const cur = all.find((c) => c.id === id);
      if (!cur) return null;
      const next: TeamComp = { ...cur, ...patch, id, updatedAt: now() };
      all[all.indexOf(cur)] = next;
      cache = all;
      await persist();
      return next;
    },

    async remove(id) {
      const all = await loadAll();
      const idx = all.findIndex((c) => c.id === id);
      if (idx < 0) return false;
      all.splice(idx, 1);
      cache = all;
      await persist();
      return true;
    },

    async getPinned() {
      await resolveOwner();
      const raw = await readRaw(pinKey());
      if (!raw) return { ...EMPTY_PIN };
      try {
        const p = JSON.parse(raw);
        return {
          type: (p?.type ?? 'none') as CompType,
          set: Number(p?.set ?? 0),
          details: String(p?.details ?? ''),
        };
      } catch {
        return { ...EMPTY_PIN };
      }
    },

    async setPinned(p) {
      await resolveOwner();
      const cur = await this.getPinned();
      const next: PinnedComp = {
        type: p.type ?? cur.type,
        set: p.set ?? cur.set,
        details: p.details ?? cur.details,
      };
      await writeRaw(pinKey(), JSON.stringify(next));
      return next;
    },

    async clearPinned() {
      await resolveOwner();
      await writeRaw(pinKey(), '');
    },
  };
}
