import { utilityProcess, type UtilityProcess } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createOriginalRecognition, ORIGINAL_TFT_CHANNEL } from '../recognition/original-events';
import type { ReaderStatus } from '../recognition/status';
import { prepareOriginalAssets } from './original-assets';

/** A read-only subscriber. Loading/injecting the original game provider is a separate prerequisite. */
export function createNativeReader(onChange: (status: ReaderStatus) => void, options: { channel?: string; testMode?: boolean; cacheRoot: string; onPacket?: (payload: Uint8Array, accepted: boolean) => void; onNativeLog?: (message: string) => void }) {
  const reducer = createOriginalRecognition();
  let process: UtilityProcess | null = null;
  let disposed = false;
  let lastFrameAt: number | null = null;
  let frames = 0, scoreboardFrames = 0;
  let scoreboardStatus = '';
  let scoreboardProcess:UtilityProcess|null=null;
  let scoreboardGeneration=0;
  let scoreboard:NonNullable<ReaderStatus['scoreboard']>={phase:'stopped',message:'全场记牌尚未启动',frames:0,lastFrameAt:null};
  let gameBounds: ReaderStatus['gameBounds'] = null;
  let phase: ReaderStatus['phase'] = 'stopped';
  let message = '未连接原版采集';
  let closing: Promise<void> = Promise.resolve();
  let starting = false;
  let generation = 0;
  const snapshot = (): ReaderStatus => {
    if(scoreboard.phase==='receiving' && scoreboard.lastFrameAt!==null && Date.now()-scoreboard.lastFrameAt>12000)scoreboard={...scoreboard,phase:'waiting',message:'全场快照已过期，等待更新'};
    return ({ phase, message, transport: 'original-native', testMode: !!options.testMode, frames, lastFrameAt, cards: reducer.view(), scoreboard:{...scoreboard}, tracker: reducer.tracker(), gameBounds });
  };
  const publish = () => { if (!disposed) onChange(snapshot()); };
  function stopScoreboard(){
    scoreboardGeneration++;const child=scoreboardProcess;scoreboardProcess=null;
    if(child){try{child.postMessage('stop');}catch{child.kill();}const timer=setTimeout(()=>child.kill(),2000);child.once('exit',()=>clearTimeout(timer));}
    reducer.clearScoreboard();scoreboard={phase:'stopped',message:'全场记牌已停止',frames:0,lastFrameAt:null};
  }
  function startScoreboard(file:string,worker:UtilityProcess,pid:number){
    stopScoreboard();const epoch=scoreboardGeneration;
    scoreboard={phase:'waiting',message:'正在启动独立记牌进程',frames:0,lastFrameAt:null};publish();
    const channelFile=Number.isSafeInteger(pid)&&pid>0?path.join(options.cacheRoot,`scoreboard-channel-${pid}.txt`):'';
    const calibrationFile=Number.isSafeInteger(pid)&&pid>0?path.join(options.cacheRoot,`scoreboard-calibration-${pid}.json`):'';
    let savedCalibration='';
    if(calibrationFile)void fs.readFile(calibrationFile,'utf8').then(text=>{
      if(disposed||epoch!==scoreboardGeneration||process!==worker)return;
      const record=JSON.parse(text);
      if(Date.now()-record.at<12*60*60*1000 && record.at<=Date.now()){reducer.restoreScoreboardCalibration(record.value);savedCalibration=JSON.stringify(reducer.scoreboardCalibration());}
    }).catch(()=>{});
    const child=utilityProcess.fork(path.join(__dirname,'scoreboard-worker.cjs'),[file,channelFile],{serviceName:'TFTBot scoreboard reader',stdio:'pipe'});scoreboardProcess=child;
    child.on('message',event=>{
      if(disposed||scoreboardProcess!==child||epoch!==scoreboardGeneration||process!==worker)return;
      if(event?.type==='invoke'){worker.postMessage({type:'scoreboard-invoke',id:`${epoch}:${event.id}`,method:event.method,value:event.value});return;}
      if(event?.type==='scoreboard-frame'){
        scoreboardFrames++;if(scoreboardFrames<=2)options.onNativeLog?.(`scoreboard-frame ${JSON.stringify(event.value).slice(0,24000)}`);
        const error=reducer.acceptScoreboard(event.value);
        if(error){scoreboard={...scoreboard,phase:'waiting',message:error};}
        else {
          scoreboard={phase:'receiving',message:'正在接收全场持牌（已核对本方持牌）',frames:scoreboard.frames+1,lastFrameAt:Date.now()};
          const value=reducer.scoreboardCalibration(),text=JSON.stringify(value);
          if(calibrationFile && value && text!==savedCalibration){savedCalibration=text;void fs.writeFile(calibrationFile,JSON.stringify({at:Date.now(),value}),'utf8').catch(error=>options.onNativeLog?.(`scoreboard-calibration-cache ${error.message}`));}
        }
      }else if(event?.type==='scoreboard-status'){
        if(event.phase!=='receiving'){
          if(event.phase==='error'||event.phase==='stopped')reducer.clearScoreboard();
          const detail=String(event.message);
          scoreboard={...scoreboard,phase:event.phase,message:detail.includes('UE5 object walker initialization failed')?'原版记分板模块初始化失败；全场持牌尚不可用':detail};
        }
        const next=`scoreboard-status ${event.phase}: ${event.message}`;
        if(next!==scoreboardStatus){scoreboardStatus=next;options.onNativeLog?.(next);}
      }else return;
      publish();
    });
    child.on('exit',code=>{if(scoreboardProcess!==child)return;scoreboardProcess=null;reducer.clearScoreboard();scoreboard={...scoreboard,phase:'error',message:`全场记牌进程已退出 (${code})`};publish();});
  }
  function stop() {
    stopScoreboard();
    generation++;
    const previous = process; process = null;
    if (previous) closing = new Promise<void>(resolve => {
      const timeout = setTimeout(() => { previous.kill(); resolve(); }, 2000);
      previous.once('exit', () => { clearTimeout(timeout); resolve(); });
      try { previous.postMessage('stop'); } catch { previous.kill(); clearTimeout(timeout); resolve(); }
    });
    gameBounds = null; reducer.reset(); frames = 0; lastFrameAt = null; phase = 'stopped'; message = '采集连接已停止'; publish();
  }
  return {
    snapshot,
    async start() {
      if (disposed || starting) return snapshot();
      if (process && phase === 'error') stop();
      starting = true;
      const epoch = ++generation;
      try {
        await closing;
        if (disposed || epoch !== generation || process) return snapshot();
        const nativeFile = 'E:\\amumu\\resources\\win64\\node-native.node';
        await fs.access(nativeFile);
        const pluginFile = options.testMode ? '' : await prepareOriginalAssets(options.cacheRoot);
        if (disposed || epoch !== generation) return snapshot();
        phase = 'waiting'; message = '正在启动原版原生采集服务'; publish();
        const worker = utilityProcess.fork(path.join(__dirname, 'native-reader-worker.cjs'), [nativeFile, options.channel ?? ORIGINAL_TFT_CHANNEL, pluginFile], { serviceName: 'TFTBot native reader', stdio: 'pipe' });
        process = worker;
        worker.on('message', event => {
          if (process !== worker) return;
          if(event?.type==='scoreboard-ready')startScoreboard(String(event.file),worker,Number(event.pid));
          else if(event?.type==='scoreboard-stop'){stopScoreboard();publish();}
          else if(event?.type==='scoreboard-invoke-result'){
            const [epoch,id]=String(event.id).split(':');
            if(Number(epoch)===scoreboardGeneration)scoreboardProcess?.postMessage({...event,type:'invoke-result',id:Number(id)});
          }
          else if (event?.type === 'provider-log') { const message=String(event.message);console.log('[native-overlay]',message);options.onNativeLog?.(message); }
          else if (event?.type === 'window-bounds') { const b = event.bounds; gameBounds = b && ['x','y','width','height'].every(k => Number.isFinite(b[k])) && b.width > 0 && b.height > 0 ? {x:b.x,y:b.y,width:b.width,height:b.height} : null; publish(); }
          else if (event?.type === 'frame' && event.payload instanceof Uint8Array) {
            const accepted = reducer.accept(event.payload); options.onPacket?.(event.payload, accepted);
            if (!accepted) return;
            frames++; lastFrameAt = Date.now(); phase = 'receiving'; message = options.testMode ? '协议测试数据 · 非真实对局' : '正在接收原版 GEP 事件'; publish();
          } else if (event?.type === 'connect') { phase = 'connected'; message = '原生 IPC 已连接，等待商店/海克斯事件'; publish(); }
          else if (event?.type === 'disconnect') { stopScoreboard(); gameBounds = null; reducer.reset(); lastFrameAt = null; phase = 'waiting'; message = '原版采集已断开，等待重连'; publish(); }
          else if (event?.type === 'error') { stopScoreboard(); gameBounds = null; reducer.reset(); lastFrameAt = null; phase = 'error'; message = String(event.message); publish(); }
          else if (event?.type === 'provider-status') { if (event.reset || event.error) { stopScoreboard();gameBounds = null; reducer.reset(); lastFrameAt = null; } if (phase === 'error' && !event.error) return; if (event.error) phase = 'error'; message = String(event.message); console.log('[native-provider]', message); publish(); }
        });
        worker.on('exit', code => { if (process === worker) { stopScoreboard();process = null; gameBounds = null; reducer.reset(); lastFrameAt = null; phase = 'error'; message = `原生采集进程已退出 (${code})`; publish(); } });
        return snapshot();
      } catch (error) { if (!disposed && epoch === generation) { phase = 'error'; message = (error as Error).message; publish(); } return snapshot(); }
      finally { starting = false; }
    },
    stop,
    async dispose() { disposed = true; stop(); await closing; },
  };
}
