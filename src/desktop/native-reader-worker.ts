import path from 'node:path';
import { createRequire } from 'node:module';
import { startOriginalProvider } from './original-provider';
const requireNative = createRequire(__filename);
const [nativeFile, channel, pluginFile] = process.argv.slice(2);
const send = (message: unknown) => process.parentPort?.postMessage(message);
let client: { connect(): void; destroy(): void } | undefined;
let invokeScoreboard: ((method:string,value:unknown)=>Promise<{success:boolean;message:string}>) | undefined;
const stopScoreboard=()=>{invokeScoreboard=undefined;send({type:'scoreboard-stop'});};
let provider: ReturnType<typeof startOriginalProvider> | undefined;
try {
  const native = requireNative(nativeFile);
  client = new native.IpcConnection(channel, false, (event: string, value?: { payload?: Uint8Array }) => {
    if (event === 'received' && value?.payload) send({ type: 'frame', payload: new Uint8Array(value.payload) });
    else if (event === 'connect' || event === 'disconnect') send({ type: event });
  });
  client!.connect(); send({ type: 'started' });
  if (pluginFile) {
    // Original trick page polls getWindowRect every 500 ms, then converts screen pixels to DIP.
    setInterval(() => {
      try {
        const game = native.getWndList().find((w: { title: string; class: string }) => w.title === 'TFT  ' && w.class === 'UnrealWindow');
        const rect = game ? native.getWindowRect(game.hwnd) : null;
        const bounds = rect && rect.width > 0 && rect.height > 0 && rect.x > -30000 && rect.y > -30000 ? rect : null;
        send({ type: 'window-bounds', bounds });
      } catch { send({ type: 'window-bounds', bounds: null }); }
    }, 500);
  }
  if (pluginFile) provider = startOriginalProvider(native, pluginFile, (message, error, reset, diagnostic) => send({ type: diagnostic ? 'provider-log' : 'provider-status', message, error, reset }), {
    stopped:stopScoreboard,
    ready:context=>{
      stopScoreboard();
      invokeScoreboard=context.invoke;
      send({type:'scoreboard-ready',pid:context.pid,file:path.join(path.dirname(pluginFile),'tft.node')});
    }
  });
} catch (error) { send({ type: 'error', message: (error as Error).message }); process.exitCode = 1; }
process.parentPort?.on('message', event => {
  if (event.data?.type === 'scoreboard-invoke') {
    const {id,method,value}=event.data;
    const invoke=invokeScoreboard;
    Promise.resolve().then(()=>{if(!invoke)throw new Error('全场记牌通道已停止');if(method!=='sgd')throw new Error('未知的记牌请求');return invoke(method,value);}).then(result=>send({type:'scoreboard-invoke-result',id,...result}),error=>send({type:'scoreboard-invoke-result',id,success:false,message:String(error.message)}));
  }
  else if (event.data === 'stop') { provider?.dispose(); client?.destroy(); process.exit(0); }
});
