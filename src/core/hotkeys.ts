/**
 * 热键模型 + 仓库。
 *
 * 热键对象结构：
 *   { name:'show_main', code:'`', vkCode:192, isShift:false, isCtrl:true, isAlt:false,
 *     hold:false, passthrough:false, format:'ctrl+`' }
 * 六个命令：get/setShowMainHotkey、ShowTrackerHotkey、showOverallRecordHotkey，
 * 以及录制用的 Start/StopRecordHotkey。这里统一成 HotkeyStore，一把 key 存一份。
 */
import type { Cube } from './cube';
import type { Hotkey } from './settings';

export type HotkeySlot = 'show_main' | 'show_tracker' | 'show_overall_record' | 'start_record' | 'stop_record';

export const HOTKEY_SLOTS: HotkeySlot[] = ['show_main', 'show_tracker', 'show_overall_record', 'start_record', 'stop_record'];

/** 每个槽的默认值（默认值） */
export const DEFAULT_HOTKEYS: Record<HotkeySlot, Hotkey> = {
  show_main: { name: 'show_main', code: '`', vkCode: 192, isShift: false, isCtrl: true, isAlt: false, hold: false, passthrough: false, format: 'ctrl+`' },
  show_tracker: { name: 'show_tracker', code: '`', vkCode: 192, isShift: false, isCtrl: false, isAlt: false, hold: false, passthrough: false, format: '`' },
  show_overall_record: { name: 'show_overall_record', code: 'f8', vkCode: 119, isShift: false, isCtrl: false, isAlt: false, hold: false, passthrough: false, format: 'F8' },
  start_record: { name: 'start_record', code: 'f9', vkCode: 120, isShift: false, isCtrl: false, isAlt: false, hold: false, passthrough: false, format: 'F9' },
  stop_record: { name: 'stop_record', code: 'f10', vkCode: 121, isShift: false, isCtrl: false, isAlt: false, hold: false, passthrough: false, format: 'F10' },
};

const MODIFIER_KEYS = new Set(['ctrl', 'shift', 'alt', 'win', 'meta', 'cmd']);

/** 'ctrl+`' → { code:'`', isCtrl:true, format:'ctrl+`' } */
export function parseHotkey(input: string, opts: Partial<Hotkey> = {}): Hotkey {
  const raw = String(input ?? '').trim();
  const parts = raw
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const mods = new Set(parts.filter((p) => MODIFIER_KEYS.has(p.toLowerCase())).map((p) => p.toLowerCase()));
  const keyPart = parts.find((p) => !MODIFIER_KEYS.has(p.toLowerCase())) ?? '';
  const code = keyPart || String(opts.code ?? '');
  const isCtrl = mods.has('ctrl') || mods.has('cmd') || mods.has('meta');
  const isShift = mods.has('shift');
  const isAlt = mods.has('alt');
  const normalizedCode = code.length === 1 ? code.toLowerCase() : code.toLowerCase();
  return {
    name: opts.name ?? '',
    code: normalizedCode,
    vkCode: opts.vkCode ?? vkCodeOf(normalizedCode),
    isShift,
    isCtrl,
    isAlt,
    hold: opts.hold ?? false,
    passthrough: opts.passthrough ?? false,
    format: formatHotkey({ code: normalizedCode, isShift, isCtrl, isAlt }),
  };
}

/** 序列化成可读形式：ctrl+shift+` / F8 / a */
export function formatHotkey(h: Pick<Hotkey, 'code' | 'isCtrl' | 'isShift' | 'isAlt'>): string {
  const parts: string[] = [];
  if (h.isCtrl) parts.push('ctrl');
  if (h.isShift) parts.push('shift');
  if (h.isAlt) parts.push('alt');
  const code = h.code || '';
  parts.push(/^f\d{1,2}$/.test(code) ? code.toUpperCase() : code);
  return parts.join('+');
}

/** 常见键 → Windows VK（只覆盖热键面板会出现的键；未知返回 0） */
const VK: Record<string, number> = {
  '`': 192,
  '-': 189,
  '=': 187,
  '[': 219,
  ']': 221,
  '\\': 220,
  ';': 186,
  "'": 222,
  ',': 188,
  '.': 190,
  '/': 191,
  ' ': 32,
  tab: 9,
  esc: 27,
  escape: 27,
  enter: 13,
  backspace: 8,
};

export function vkCodeOf(code: string): number {
  const c = String(code || '').toLowerCase();
  if (VK[c] != null) return VK[c];
  if (/^f\d{1,2}$/.test(c)) return 112 + (Number(c.slice(1)) - 1);
  if (/^[a-z]$/.test(c)) return c.toUpperCase().charCodeAt(0);
  if (/^\d$/.test(c)) return 48 + Number(c);
  return 0;
}

export interface HotkeyStoreDeps {
  cube: Pick<Cube, 'io'>;
  getOwner: () => Promise<string> | string;
  local?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** 覆盖默认值（测试/自定义） */
  defaults?: Partial<Record<HotkeySlot, Hotkey>>;
}

export const HOTKEY_KEY = 'tftbot:hotkeys';

export interface HotkeyStore {
  load(): Promise<Record<HotkeySlot, Hotkey>>;
  get(slot: HotkeySlot): Hotkey;
  /** 接受字符串或对象；返回落地后的热键 */
  set(slot: HotkeySlot, value: string | Partial<Hotkey>): Promise<Hotkey>;
  all(): Record<HotkeySlot, Hotkey>;
}

export function createHotkeyStore(deps: HotkeyStoreDeps): HotkeyStore {
  const defaults = { ...DEFAULT_HOTKEYS, ...(deps.defaults ?? {}) } as Record<HotkeySlot, Hotkey>;
  let cache: Record<HotkeySlot, Hotkey> | null = null;
  let owner = '';

  const key = () => `${HOTKEY_KEY}:${owner}`;

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

  return {
    async load() {
      try {
        owner = String((await deps.getOwner()) ?? '');
      } catch {
        owner = '';
      }
      const raw = await read();
      const parsed: any = raw ? safeJson(raw) : {};
      const out = {} as Record<HotkeySlot, Hotkey>;
      for (const slot of HOTKEY_SLOTS) {
        const saved = parsed?.[slot];
        out[slot] = saved ? parseHotkey(saved.format ?? saved.code ?? defaults[slot].format, { ...defaults[slot], ...saved }) : { ...defaults[slot] };
      }
      cache = out;
      return out;
    },

    get(slot) {
      return (cache ?? defaults)[slot] ?? { ...defaults[slot] };
    },

    async set(slot, value) {
      if (!cache) await this.load();
      const base = { ...defaults[slot] };
      const next =
        typeof value === 'string'
          ? parseHotkey(value, base)
          : parseHotkey(String(value.format ?? value.code ?? base.format), { ...base, ...value });
      next.name = slot;
      cache![slot] = next;
      await write(JSON.stringify(cache));
      return next;
    },

    all() {
      return cache ?? { ...defaults };
    },
  };
}

function safeJson(v: string): any {
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}
