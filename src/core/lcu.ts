/**
 * LCU 访问 + 游戏事件订阅（TS 版）—— 对应 lcu-*.js 与各页面的 cube.* 用法。
 * 真机上 invokeLEP 由宿主转发到本地 LCU；浏览器里可以用 dev shim 或 HTTP 版本替换。
 */
import type { Cube, GameEventMessage } from './cube';
import { parseUpdateInfo, type ParsedGameEvent } from './events';

export const LOL_LAUNCHER_CLASS_ID = 10902;
export const TFT_GAME_CLASS_ID = 5426;
/** 原生采集 DLL 使用的 gameId */
export const GEP_GAME_ID = 54262;

export interface LcuEndpoints {
  currentSummoner: string;
  gamemode: string;
  session: string;
  champSelect: string;
  gameflowPhase: string;
  matchDetail: string;
  summoner: string;
  regionLocale: string;
}

export const LCU: LcuEndpoints = {
  currentSummoner: '/lol-summoner/v1/current-summoner',
  gamemode: '/lol-lobby/v1/parties/gamemode',
  session: '/lol-gameflow/v1/session',
  champSelect: '/lol-champ-select/v1/session',
  gameflowPhase: '/lol-gameflow/v1/gameflow-phase',
  matchDetail: '/lol-match-history/v1/games/',
  summoner: '/lol-summoner/v1/summoners',
  regionLocale: '/riotclient/region-locale',
};

export type LcuMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

export interface LcuLike {
  invoke(method: LcuMethod, uri: string, args?: any): Promise<any>;
}

/** 用 cube 造一个 LCU 客户端 */
export function createLcu(cube: Pick<Cube, 'games'>): LcuLike {
  return {
    invoke(method, uri, args) {
      return cube.games.launchers
        .invokeLEP(LOL_LAUNCHER_CLASS_ID, 'lcuRequest', { method, uri, args })
        .then((r: any) => r)
        .catch((e: any) => e);
    },
  };
}

export interface SummonerInfo {
  summonerId?: string;
  puuid?: string;
  displayName?: string;
  gameName?: string;
  internalName?: string;
}

export async function getCurrentSummoner(lcu: LcuLike): Promise<SummonerInfo | null> {
  const s = await lcu.invoke('get', LCU.currentSummoner).catch(() => null);
  if (!s || !s.puuid) return null;
  return {
    ...s,
    displayName: s.gameName || s.displayName || s.internalName || '',
  };
}

export async function getGameflowPhase(lcu: LcuLike): Promise<string> {
  const p = await lcu.invoke('get', LCU.gameflowPhase).catch(() => null);
  return typeof p === 'string' ? p : '';
}

/* ---------------- 事件订阅 ---------------- */

export type GameEventHandler = (evt: ParsedGameEvent, raw: GameEventMessage) => void;

export interface SubscribeOptions {
  /** 是否把解析失败的事件也抛给 handler（默认 false；诊断用 onInvalid） */
  includeInvalid?: boolean;
  onInvalid?: (r: ReturnType<typeof parseUpdateInfo>) => void;
}

/**
 * 订阅 update-info，并直接给出「已解析」的强类型事件。
 * 返回解绑函数。
 */
export function subscribeGameEvents(
  cube: Pick<Cube, 'games'>,
  handler: GameEventHandler,
  opts: SubscribeOptions = {},
): () => void {
  const includeInvalid = opts.includeInvalid ?? false;
  return cube.games.events.on('update-info', (_handle, msg) => {
    if (!msg || typeof msg.key !== 'string') return;
    const res = parseUpdateInfo({ key: msg.key, value: String(msg.value ?? '') });
    if (!res.ok) {
      opts.onInvalid?.(res);
      if (!includeInvalid) return;
    }
    handler(res.data, msg);
  });
}

/** 订阅窗口广播（settingsChanged / featureUnlockChanged …），返回解绑函数 */
export function subscribeIpc<T = any>(cube: Pick<Cube, 'windows'>, command: string, handler: (payload: T) => void): () => void {
  return cube.windows.message.on('received', (cmd, payload) => {
    if (cmd === command) handler(payload as T);
  });
}

/** 向主窗口（background）发命令 */
export async function callBg<T = any>(cube: Pick<Cube, 'windows'>, command: Parameters<Cube['windows']['message']['invoke']>[1], payload = ''): Promise<T> {
  const main = await cube.windows.getMainWindow();
  return cube.windows.message.invoke<T>(main.id, command, payload);
}

export { parseUpdateInfo };
