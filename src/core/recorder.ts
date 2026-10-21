/**
 * 录制 / OBS 服务（background 侧）—— 对应 getObsState / stopObs / getVideoEncoders /
 * getRecordBaseSetting / setRecordBaseSetting / getLiveList / setLiveList /
 * recordStateChanged / recordMediaChanged。
 *
 * 本实现把 OBS 当成一个外部进程（resources/apps/obs.bin + win64 的 overlay），
 * background 只是「读状态 + 转命令 + 广播」。所以这里用 Port 抽象：
 *   真机实现走宿主/子进程；测试用内存 Port。
 */
import type { Cube } from './cube';
import type { Broker } from './broker';

export interface ObsState {
  isRecord: boolean;
  isReplay: boolean;
  /** 开始录制的时间戳 */
  startedAt?: number | null;
  /** 当前录制文件 */
  file?: string;
  /** 上次产生的媒体文件 */
  lastMedia?: string;
}

export interface RecordSettings {
  /** 输出目录 */
  baseDir: string;
  /** 画质：录制/直播共用 */
  quality: 'low' | 'medium' | 'high';
  fps: number;
  /** 编码器 id（见 getVideoEncoders） */
  encoder: string;
  /** 直播列表（当前平台的推流地址集合） */
  liveList: string[];
}

export const DEFAULT_RECORD_SETTINGS: RecordSettings = {
  baseDir: '',
  quality: 'medium',
  fps: 60,
  encoder: '',
  liveList: [],
};

/** 与外部进程的边界；真机实现可换成 spawn(obs)/IPC */
export interface RecorderPort {
  state(): ObsState;
  start(settings: RecordSettings): Promise<ObsState>;
  stop(): Promise<ObsState>;
  encoders(): Promise<string[]>;
}

export interface RecorderDeps {
  cube: Pick<Cube, 'io'>;
  port: RecorderPort;
  broker?: Broker;
  getOwner?: () => Promise<string> | string;
  local?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** 覆盖默认录制设置 */
  defaults?: Partial<RecordSettings>;
}

export const RECORD_KEY = 'tftbot:record';

export interface RecorderService {
  load(): Promise<RecordSettings>;
  state(): ObsState;
  getSettings(): RecordSettings;
  setSettings(patch: Partial<RecordSettings>): Promise<RecordSettings>;
  start(): Promise<ObsState>;
  stop(): Promise<ObsState>;
  encoders(): Promise<string[]>;
  /** 直播列表（等价 getLiveList） */
  liveList(): Promise<string[]>;
  setLiveList(list: string[]): Promise<string[]>;
}

export function createRecorder(deps: RecorderDeps): RecorderService {
  const defaults = { ...DEFAULT_RECORD_SETTINGS, ...(deps.defaults ?? {}) };
  let settings: RecordSettings = { ...defaults };
  let owner = '';

  const key = () => `${RECORD_KEY}:${owner}`;

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

  const notifyState = async (state: ObsState) => {
    await deps.broker?.broadcast('recordStateChanged', state).catch(() => null);
  };

  return {
    async load() {
      try {
        owner = String((await deps.getOwner?.()) ?? '');
      } catch {
        owner = '';
      }
      const raw = await read();
      if (raw) {
        try {
          settings = { ...defaults, ...JSON.parse(raw) };
        } catch {
          settings = { ...defaults };
        }
      }
      return settings;
    },

    state: () => deps.port.state(),

    getSettings: () => settings,

    async setSettings(patch) {
      settings = { ...settings, ...patch, liveList: patch.liveList ?? settings.liveList };
      await write(JSON.stringify(settings));
      return settings;
    },

    async start() {
      const state = await deps.port.start(settings);
      await notifyState(state);
      return state;
    },

    async stop() {
      const state = await deps.port.stop();
      await notifyState(state);
      if (state.lastMedia) {
        await deps.broker?.broadcast('recordMediaChanged', { file: state.lastMedia }).catch(() => null);
      }
      return state;
    },

    encoders: () => deps.port.encoders(),

    async liveList() {
      return settings.liveList;
    },

    async setLiveList(list) {
      settings = { ...settings, liveList: [...list] };
      await write(JSON.stringify(settings));
      return settings.liveList;
    },
  };
}

/** 测试/无 OBS 环境用的内存实现 */
export function createMemoryRecorderPort(encoders = ['x264', 'nvenc']): RecorderPort {
  let state: ObsState = { isRecord: false, isReplay: false, startedAt: null };
  return {
    state: () => ({ ...state }),
    async start(settings) {
      state = { isRecord: true, isReplay: false, startedAt: Date.now(), file: `record-${settings.fps}fps.mp4` };
      return { ...state };
    },
    async stop() {
      const last = state.file;
      state = { isRecord: false, isReplay: false, startedAt: null, file: '', lastMedia: last };
      return { ...state };
    },
    async encoders() {
      return [...encoders];
    },
  };
}
