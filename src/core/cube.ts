/**
 * 平台注入的 cube.* —— 从 tftbot 2.2.0/2.2.7 窗口暴露的接口对外接口约定。
 * 详细版本见仓库 dev/types/cube.d.ts；这里只放核心需要的部分。
 */

export type WindowName =
  | 'background'
  | 'main'
  | 'tracker'
  | 'trick'
  | 'tgd'
  | 'adwin'
  | 'overallrecord'
  | 'hexmsg'
  | 'kf'
  | 'sidewin'
  | 'characterwin'
  | 'settings';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GameEventMessage {
  key: string;
  /** 原始 JSON 字符串（服务端/原生层都按字符串传） */
  value: string;
  feature?: string;
  category?: string;
}

export interface RunningGame {
  handle?: number;
  width: number;
  height: number;
  game: { classId: number; name?: string };
}

/** 81 个 IPC 命令，字符串值就是线上协议 */
export type IpcCommand =
  | 'setCurrentSet' | 'setPinCompsInfo' | 'pinCompsChanged' | 'setSettings' | 'settingsChanged'
  | 'setMyTeamComps' | 'myTeamCompsChanged' | 'deleteMyTeamComps' | 'currentSetChanged'
  | 'showMainPage' | 'setCurLocale' | 'setShowTrackerHotkey' | 'showTrackerHotkeyChanged'
  | 'setShowMainHotkey' | 'showMainHotkeyChanged' | 'setOverallRecordHotkey'
  | 'showOverallRecordHotkeyChanged' | 'setRecordBaseSetting' | 'setTFTHighlight'
  | 'setStartRecordHotkey' | 'setStopRecordHotkey' | 'recordStateChanged' | 'recordMediaChanged'
  | 'closeAdWindow' | 'setLiveList' | 'setInviteCount' | 'setIc' | 'icChanged'
  | 'setHexOrderStatus' | 'setHexOrderRes' | 'setHexGamePlayBegan' | 'showHexPredict'
  | 'showHexPredictRecharge' | 'showHexPredictAdvancedApply' | 'showHexOrderResult'
  | 'showHexPredictCompactReturn' | 'pauseHexmsgFollow' | 'summonerIdChanged'
  | 'featureUnlockChanged' | 'showOrHideCharacterwin' | 'requireEmailBind'
  | 'requireEmailRegistration' | 'requestEmailBindProbe' | 'tftbotMigrationDebug'
  | 'getSupportSets' | 'getCurrentSet' | 'getCharacters' | 'getItems' | 'getTraits' | 'getComps'
  | 'getPinCompsInfo' | 'getSettings' | 'getMyTeamComps' | 'getUnitsItems' | 'getCurLocale'
  | 'getHexArguments' | 'getRankData' | 'checkGpuEnable' | 'getShowTrackerHotkey'
  | 'getShowMainHotkey' | 'getshowOverallRecordHotkey' | 'getRecordBaseSetting'
  | 'getTFTHighlight' | 'getObsState' | 'stopObs' | 'getVideoEncoders' | 'getStartRecordHotkey'
  | 'getStopRecordHotkey' | 'deleteRecordMedia' | 'getLiveList' | 'getInviteCount'
  | 'getHexStatus' | 'getHexOrderStatus' | 'getHexOrderRes' | 'getHexGamePlayBegan' | 'syncHexOrderLifecycle'
  | 'probeEmailBindStatus' | 'resetHexOrderForAccountChange' | 'getFeaturesList'
  | 'syncMembershipUpdated' | 'forceLogoutCleanup' | 'rebuildGameinWindows';

export interface Cube {
  windows: {
    current: { id(): string; isOffscreen(): boolean; dragMove(cb?: () => void): void };
    getMainWindow(): Promise<{ id: string }>;
    getCurrentWindow(): Promise<{ id: string; maximized: boolean }>;
    getWindowByName(name: WindowName, offscreen?: boolean): Promise<{ id: string }>;
    getWindowInfo(id: string): Promise<{ show: boolean } & Partial<Rect>>;
    obtainDeclaredWindow(name: WindowName): Promise<{ id: string }>;
    show(id: string): void;
    hide(id: string): void;
    close(id: string): void;
    minimize(id: string): void;
    maximize(id: string): void;
    unmaximize(id: string): void;
    setSize(id: string, width: number, height: number): void;
    setBounds(id: string, rect: Rect): void;
    setPosition(id: string, x: number, y: number): void;
    on(event: 'maximize' | 'unmaximize', cb: (windowId: string) => void): () => void;
    message: {
      invoke<T = any>(windowId: string, command: IpcCommand, payload?: string): Promise<T>;
      send(windowId: string, command: IpcCommand | string, payload?: any): void;
      /** send 的接收侧：cmd + payload */
      on(event: 'received', cb: (command: string, payload: any) => void): () => void;
      /** invoke 的接收侧（background 页注册命令用）：cmd + payload + 回包函数 */
      on(event: 'invoked', cb: (command: string, payload: any, reply: (value: any) => void) => void): () => void;
      on(event: string, cb: (...args: any[]) => void): () => void;
    };
  };
  io: {
    localStorage: {
      getItem(key: string): Promise<string>;
      setItem(key: string, value: string): Promise<void>;
      removeItem(key: string): Promise<void>;
    };
  };
  games: {
    getRunningGame(): Promise<RunningGame | null>;
    on(event: 'size' | 'stopped', cb: (...args: any[]) => void): () => void;
    launchers: {
      events: { on(event: string, cb: (...a: any[]) => void): () => void };
      invokeLEP(classId: number, method: 'lcuRequest', params: { method: string; uri: string; args?: any }): Promise<any>;
    };
    events: {
      on(event: 'update-info', cb: (handle: any, msg: GameEventMessage) => void): () => void;
      on(event: 'trigger-event', cb: (handle: any, name: string, payload: any) => void): () => void;
      getInfo(): Promise<any>;
      provider: {
        loadGEP(dllPath: string, dllName: string, gameId: number): Promise<string>;
        updateInfo(gameId: number, msg: { feature: string; category: string; key: string; value: string }): void;
        triggerEvent(gameId: number, category: string, name: string, data: any): void;
      };
    };
  };
  utils: {
    openUrlInDefaultBrowser(url: string): void;
    placeOnClipboard(text: string): void;
    getFromClipboard(): Promise<string>;
    openPath(path: string): void;
    showItemInFolder(path: string): void;
    showOpenDialog(options: any): Promise<string[] | null>;
    getAllDisplays(): Promise<{ id: number; bounds: Rect; scaleFactor?: number }[]>;
    getPrimaryDisplay(): Promise<{ id: number; bounds: Rect; scaleFactor?: number }>;
    getWindowRect(id: string): Promise<Rect>;
    screenToDipRect(rect: Rect): Rect;
    getMachineGuid(): Promise<string>;
    getPath(name: 'userData' | 'appData' | 'exe' | string): Promise<string>;
  };
  net: { sendHttpRequest(o: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> };
  node: { require(module: 'fs' | 'path' | 'child_process' | string): any };
  extensions: { current: { getManifest(): { meta: { name: string; version: string }; data: any } } };
  settings: { setGeneralSetting(key: string, value: any): void };
}

declare global {
  interface Window {
    cube: Cube;
  }
}
