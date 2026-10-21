import {desktopCapturer,utilityProcess,type UtilityProcess} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {ReaderStatus} from '../recognition/status';
import {visionStrip,VisionConsensus,type VisionCalibration,type VisionRows} from '../recognition/opponent-vision';
import type {OpponentPrior} from '../game/battle-forecast';
export interface VisionState {round:string|null;at:number;rows:Array<{id:string;y:number}>;candidates:string[];message:string}
export const visionLobbyKey=(status:ReaderStatus)=>createHash('sha256').update(JSON.stringify((status.tracker?.snapshot?.players??[]).map(p=>[p.index,p.name,!!p.isLocal]).sort((a,b)=>Number(a[0])-Number(b[0])))).digest('hex');
/** Opt-in, current-lobby calibration only. No automatic identity assumptions or game operations. */
export function createOpponentVisionPilot(configFile:string,snapshot:()=>ReaderStatus,changed:()=>void,trace:(data:unknown)=>void){
  let config:VisionCalibration|null=null,worker:UtilityProcess|null=null,busy=false,disposed=false,serial=0;
  let round:string|null=null,preparation=false,lastSample=0;
  let value:VisionState={round:null,at:0,rows:[],candidates:[],message:'等待视觉校准'};
  const consensus=new VisionConsensus();
  function clear(message:string){const had=value.rows.length>0||value.candidates.length>0;value={round,at:0,rows:[],candidates:[],message};consensus.update('',round??'',null,Date.now());if(had)changed();}
  const active=(s:ReaderStatus)=>(s.tracker?.snapshot?.players??[]).filter(p=>p.health>0&&!p.isLocal).map(p=>p.index).sort((a,b)=>a-b);
  const valid=(s:ReaderStatus)=>!!config&&!disposed&&!s.testMode&&s.phase==='receiving'&&s.cards.round===round&&Date.now()<=config.expiresAt&&visionLobbyKey(s)===config.lobbyKey&&!!s.tracker?.snapshot?.players.some(p=>p.isLocal&&p.health>0)&&active(s).length>0&&active(s).every(index=>config!.references.some(r=>r.index===index))&&s.gameBounds?.width===2560&&s.gameBounds.height===1440;
  void fs.readFile(configFile,'utf8').then(text=>{
    const parsed=JSON.parse(text.replace(/^\uFEFF/,'')) as VisionCalibration;
    if(parsed.schema!==1||parsed.width!==2560||parsed.height!==1440||!/^\d+$/.test(parsed.windowId)||!Array.isArray(parsed.mask)||!Array.isArray(parsed.references)||Date.now()>parsed.expiresAt)throw Error('视觉校准无效');
    if(disposed)return;config=parsed;
    worker=utilityProcess.fork(path.join(__dirname,'opponent-vision-worker.cjs'),[],{serviceName:'TFTBot opponent vision',stdio:'pipe'});
    worker.postMessage({type:'init',calibration:config});
    worker.on('message',message=>{
      if(message?.id!==serial||disposed)return;busy=false;
      const status=snapshot();if(!valid(status)||!preparation||message.round!==round||Date.now()-message.at>4000){clear('等待当前回合画面');return;}
      const result=message.result as VisionRows|null;
      if(!result){clear('玩家列表不可辨认');trace({event:'rejected',round});return;}
      const players=status.tracker!.snapshot!.players;
      const rows=result.rows.map(row=>({id:players.find(p=>p.index===row.index)?.name??'',y:(row.y-15)/1440}));
      const ids=result.candidates.map(index=>players.find(p=>p.index===index&&!p.isLocal&&p.health>0)?.name??'');
      if(rows.some(r=>!r.id)||ids.some(id=>!id)||result.rows.some(row=>!active(status).includes(row.index))||result.rows.length!==active(status).length){clear('头像身份未齐');return;}
      const confirmed=consensus.update(config!.lobbyKey+'|'+active(status).join(','),round!,result.candidates,message.at);
      value={round,at:message.at,rows,candidates:confirmed?ids:[],message:confirmed?'视觉候选已确认':'正在确认候选'};
      trace({event:'sample',round,at:message.at,confirmed,candidateIndices:result.candidates,rows:result.rows});changed();
    });
    worker.on('exit',()=>{worker=null;busy=false;clear('视觉进程已退出');});
    trace({event:'calibrated',windowId:config.windowId,expiresAt:config.expiresAt});
  }).catch(error=>{clear(String(error.message));trace({event:'configuration-error',message:String(error.message)});});
  async function tick(){
    if(disposed)return;
    const status=snapshot();if(!valid(status)||!preparation){clear('等待备战阶段');return;}
    if(value.at&&Date.now()-value.at>6000)clear('视觉快照过期');
    if(busy){if(Date.now()-lastSample>6000){busy=false;serial++;clear('视觉采集超时');}return;}
    if(!worker||!config)return;
    busy=true;lastSample=Date.now();const id=++serial,capturedRound=round;
    try{
      const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:2560,height:1440},fetchWindowIcons:false});
      if(disposed||id!==serial)return;
      const matches=sources.filter(s=>s.name==='TFT  '&&s.id.split(':')[1]===config!.windowId);
      if(matches.length!==1||matches[0].thumbnail.getSize().width!==2560||matches[0].thumbnail.getSize().height!==1440)throw Error('游戏窗口或尺寸不符');
      if(capturedRound!==round||!preparation||!valid(snapshot())){busy=false;clear('回合已变化');return;}
      worker!.postMessage({type:'frame',id,round:capturedRound,at:lastSample,activeIndices:active(snapshot()),frame:{...visionStrip,data:new Uint8Array(matches[0].thumbnail.crop(visionStrip).toBitmap())}});
    }catch(error){if(id===serial){busy=false;clear(String((error as Error).message));trace({event:'capture-error',message:String(error)});}}
  }
  const timer=setInterval(()=>void tick(),1500);
  return {
    packet(payload:Uint8Array){try{const p=JSON.parse(new TextDecoder().decode(payload));let v=p.value;try{v=JSON.parse(v);}catch{}
      if(p.key==='tft_round'&&v?.stage!==round){round=v.stage;preparation=/DA_Round_(Combat|Augment)/.test(v.round_type??'');serial++;busy=false;clear('回合已变化');}
      if(p.key==='tft_combat'&&v==='combat_begin'){preparation=false;serial++;busy=false;clear('交战阶段');}
    }catch{}},
    state(){if(!valid(snapshot())||Date.now()-value.at>6000)return {...value,rows:[],candidates:[]};return structuredClone(value);},
    prior(status:ReaderStatus):OpponentPrior|undefined{
      if(!valid(status)||!preparation||value.round!==status.cards.round||Date.now()-value.at>6000||!value.candidates.length||value.candidates.some(id=>!status.tracker!.snapshot!.players.some(p=>p.name===id&&p.health>0&&!p.isLocal)))return;
      return {round:value.round!,source:'vision',weights:Object.fromEntries(value.candidates.map(id=>[id,1]))};
    },
    dispose(){disposed=true;clearInterval(timer);worker?.kill();worker=null;},
  };
}
