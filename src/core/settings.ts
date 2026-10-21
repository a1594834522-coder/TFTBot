/**
 * 设置模型 —— 默认值取自 index-8cf112f5.js 的初始 settings 对象（默认值）。
 * 本实现是 `let g = m({...})` 一大坨匿名对象，这里做成显式 interface，改逻辑时不会手滑。
 */

export interface Hotkey {
  name: string;
  code: string;
  vkCode: number;
  isShift: boolean;
  isCtrl: boolean;
  isAlt: boolean;
  hold: boolean;
  passthrough: boolean;
  format: string;
}

export interface Settings {
  /** 悬浮层：显示阵容/胜率面板 */
  showCompsWin: boolean;
  /** 悬浮层：显示记牌器入口 */
  showCompsTracker: boolean;
  /** 自动接受对局 */
  autoAcept: boolean;
  /** 棋盘高亮 */
  chessHighlight: boolean;
  /** 三星预警 */
  showWarning: boolean;
  /** 第 3 级警告开关（下标 1..6 对应人口） */
  level3Warning: boolean[];
  /** 记录 */
  showRecord: boolean;
  showLevel: boolean;
  showAugments: boolean;
  showHexPrediction: boolean;
  showItems: boolean;
  /** 装备面板停留秒数 */
  showItemsSeconds: number;
  showHecheng: boolean;
  showAoenShenqi: boolean;
  showFuzhu: boolean;
  showGuangming: boolean;
  /** 追三标记 */
  showThreeMark: boolean;
  /** 只对哪些费用追三 */
  threeMarkCosts: number[];
  /** 只看自己的棋子 */
  showOnlyMe: boolean;
  showOverallRecord: boolean;
  /** 记牌器 */
  showCardTracker: boolean;
  /** 默认阵容数据源（二次开发新增；本实现没有这个概念） */
  compsSource: CompsSourcePref;
}

/** 'all' = 内嵌 + MetaTFT 合并 */
export type CompsSourcePref = 'all' | 'official' | 'blitz' | 'metatft';
export const COMPS_SOURCE_PREFS: CompsSourcePref[] = ['all', 'official', 'blitz', 'metatft'];

export const DEFAULT_SETTINGS: Settings = {
  showCompsWin: true,
  showCompsTracker: false,
  autoAcept: true,
  chessHighlight: true,
  showWarning: true,
  level3Warning: [false, false, false, false, true, true, true],
  showRecord: true,
  showLevel: true,
  showAugments: true,
  showHexPrediction: true,
  showItems: true,
  showItemsSeconds: 20,
  showHecheng: true,
  showAoenShenqi: true,
  showFuzhu: true,
  showGuangming: true,
  showThreeMark: true,
  threeMarkCosts: [4, 5],
  showOnlyMe: true,
  showOverallRecord: true,
  showCardTracker: false,
  compsSource: 'metatft',
};

/** 设置项 → 功能状态 feature key（本实现 toggleSetting 的门禁映射） */
export const SETTING_FEATURE_MAP = {
  showThreeMark: 'three_mark',
  showWarning: 'three_star_warning',
  showCardTracker: 'card_tracker',
  showOverallRecord: 'overall_record',
} as const;

export type GatedSettingKey = keyof typeof SETTING_FEATURE_MAP;

/** 可在 UI 里改的布尔开关（顺序即展示顺序） */
export const TOGGLE_KEYS = [
  'showCompsWin',
  'showCompsTracker',
  'showCardTracker',
  'showThreeMark',
  'showWarning',
  'chessHighlight',
  'showOnlyMe',
  'showOverallRecord',
  'autoAcept',
  'showItems',
  'showAugments',
  'showLevel',
] as const;

export type ToggleKey = (typeof TOGGLE_KEYS)[number];

/** 单个开关取反（纯函数，UI 与测试共用） */
export function toggleSetting(s: Settings, key: ToggleKey): Settings {
  return normalizeSettings({ ...s, [key]: !s[key] });
}

/** 走「key + value」的通用改写（含 compsSource / threeMarkCosts） */
export function patchSetting(s: Settings, key: keyof Settings, value: unknown): Settings {
  if (key === 'level3Warning') {
    const arr = Array.isArray(value) ? value.map(Boolean) : s.level3Warning;
    return normalizeSettings({ ...s, level3Warning: arr });
  }
  if (key === 'threeMarkCosts') {
    const arr = Array.isArray(value) ? value.map(Number) : s.threeMarkCosts;
    return normalizeSettings({ ...s, threeMarkCosts: arr });
  }
  return normalizeSettings({ ...s, [key]: value } as Partial<Settings>);
}

/** 补齐/夹紧外部传入的设置（存档可能来自老版本） */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  s.threeMarkCosts = Array.isArray(s.threeMarkCosts) && s.threeMarkCosts.length ? s.threeMarkCosts.map(Number) : [...DEFAULT_SETTINGS.threeMarkCosts];
  const lv = Array.isArray(s.level3Warning) ? s.level3Warning : [];
  s.level3Warning = Array.from({ length: 7 }, (_, i) => Boolean(lv[i] ?? DEFAULT_SETTINGS.level3Warning[i]));
  s.showItemsSeconds = Math.max(1, Number(s.showItemsSeconds) || DEFAULT_SETTINGS.showItemsSeconds);
  if (!COMPS_SOURCE_PREFS.includes(s.compsSource)) s.compsSource = DEFAULT_SETTINGS.compsSource;
  return s;
}
