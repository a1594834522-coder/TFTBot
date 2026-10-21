import { decodeWire, field, fields, updateCurrentGameRule } from '../recognition/native-wire';

interface NativeConnection { connect(): void; destroy(): void; invoke(data: Buffer): number }
interface NativeModule {
  IpcConnection: new (name: string, server: boolean, handler: (event: string, data?: any) => void) => NativeConnection;
  AdminChildProcess: new (handler: (event: { event: string; code?: number; exitCode?: number }) => void) => { start(exe: string, args: string[]): boolean; terminate(): void; destroy(): void; getError(): unknown };
}
class Rpc {
  readonly connection: NativeConnection;
  connected = false;
  private pending = new Map<number, { resolve(value: Buffer): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(native: NativeModule, name: string, onEvent: (event: string, value?: any) => void) {
    this.connection = new native.IpcConnection(name, false, (event, value) => {
      if (event === 'connect') this.connected = true;
      if (event === 'disconnect') this.connected = false;
      if (event === 'result') {
        const pending = this.pending.get(value?.promiseId);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(value.promiseId); pending.resolve(Buffer.from(value.payload)); }
      } else onEvent(event, value);
    });
  }
  invoke(data: Buffer): Promise<Buffer> {
    if (!this.connected) return Promise.reject(new Error('原生服务尚未连接'));
    return new Promise((resolve, reject) => {
      const id = this.connection.invoke(data);
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('原生服务请求超时')); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
  destroy() { this.connection.destroy(); for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('原生服务已停止')); } this.pending.clear(); }
}
/** Headless original service bootstrap; no original frontend, account or membership code. */
export interface ProviderHooks {
  ready?(context: {pid:number; invoke(method:string,value:unknown):Promise<{success:boolean;message:string}>}): void;
  stopped?():void;
}
export function startOriginalProvider(native: NativeModule, pluginFile: string, notify: (message: string, error?: boolean, reset?: boolean, diagnostic?: boolean) => void, hooks: ProviderHooks = {}) {
  let disposed = false, activePid = 0, overlay: Rpc | undefined, ownsService = false;
  const serviceProcess = new native.AdminChildProcess(event => { if (!disposed && event.event === 'exit') notify(`原版采集服务已退出 (${event.code ?? event.exitCode ?? '无退出码'})`, true); });
  const fail = (error: unknown) => { if (!disposed) notify((error as Error).message ?? String(error), true); };
  const service = new Rpc(native, '{158ECE71-5D4B-4D60-8EE9-DCCA70294ED4}', (event, value) => {
    if (disposed) return;
    if (event === 'connect') {
      notify('已连接原生检测服务，正在登记云顶窗口规则');
      service.invoke(updateCurrentGameRule()).then(response => {
        if (decodeWire(response).get(1) !== 1) throw new Error('原版服务未接受云顶窗口规则');
        notify('原生检测服务已连接，等待当前赛季云顶窗口');
      }).catch(fail);
    } else if (event === 'received' && value?.payload) {
      try {
        const eventFields = decodeWire(value.payload);
        if (eventFields.has(4)) {
          const stopped = decodeWire(eventFields.get(4) as Buffer);
          if (stopped.get(1) === 5426) { hooks.stopped?.(); overlay?.destroy(); overlay = undefined; activePid = 0; notify('云顶对局已结束，等待下一局', false, true); }
        }
        if (!(eventFields.get(1) instanceof Buffer)) return;
        const game = decodeWire(eventFields.get(1) as Buffer);
        if (game.get(1) !== 5426 || game.get(2) !== 54262) return;
        const pid = Number(game.get(4)), tid = Number(game.get(5));
        if (!(pid > 0 && tid > 0) || pid === activePid) return;
        hooks.stopped?.(); activePid = pid; overlay?.destroy();
        let loadRequested = false;
        overlay = new Rpc(native, `{83F77887-70E7-4AEF-A1C3-01A022AF31EF}_${pid}`, (overlayEvent, payload) => {
          if (disposed || pid !== activePid) return;
          if (overlayEvent === 'received' && payload?.payload) {
            const log = decodeWire(payload.payload).get(1);
            if(log instanceof Buffer)notify(log.toString('utf8').slice(0,8000),false,false,true);
          } else if (overlayEvent === 'connect' && !loadRequested) {
            loadRequested = true;
            notify('云顶进程已连接，正在加载原版 GEP');
            notify(`GEP 路径：${pluginFile}`,false,false,true);
            overlay!.invoke(field(4, fields(field(1, pluginFile), field(2, 'gep_tft.dll'), field(3, 5426)))).then(response => {
              const result = decodeWire(response), base = result.get(1);
              if (!(base instanceof Buffer) || !base.toString() || BigInt(base.toString()) === 0n) throw new Error(`GEP 加载失败，错误 ${result.get(2) ?? '未知'}`);
              notify('原版 GEP 已加载，等待真实商店和海克斯事件');
              hooks.ready?.({pid,invoke:async(method,value)=>{
                if(disposed || pid!==activePid || !overlay)throw new Error('对局采集连接已结束');
                const response=decodeWire(await overlay.invoke(field(3,fields(field(1,5426),field(2,method),field(3,JSON.stringify(value))))));
                return {success:response.get(1)===1,message:(response.get(2) as Buffer|undefined)?.toString('utf8')??''};
              }});
            }).catch(fail);
          } else if (overlayEvent === 'disconnect') { hooks.stopped?.(); notify('云顶进程采集连接已断开', false, true); }
        });
        overlay.connection.connect();
        service.invoke(field(3, fields(field(1, pid), field(2, tid)))).then(response => {
          if (decodeWire(response).get(1) !== 1) throw new Error('原版服务未能连接云顶进程');
        }).catch(fail);
      } catch (error) { fail(error); }
    } else if (event === 'disconnect') {hooks.stopped?.();notify('原生检测服务已断开', false, true);}
  });
  service.connection.connect();
  const launch = setTimeout(() => {
    if (!disposed && !service.connected) {
      const started = serviceProcess.start('E:/amumu/resources/win64/amumu.exe', []);
      ownsService = !!started;
      if (!started) notify(`原版采集服务启动失败：${String(serviceProcess.getError())}`, true);
      else notify('原版采集服务已启动，正在连接');
    }
  }, 500);
  return { dispose() { disposed = true; hooks.stopped?.(); clearTimeout(launch); overlay?.destroy(); service.destroy(); if (ownsService) serviceProcess.terminate(); serviceProcess.destroy(); } };
}
