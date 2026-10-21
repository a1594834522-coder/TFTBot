import { parseGameEvent } from '../core/events';
import type { ReaderStatus } from '../recognition/status';
import {createOpponentSignalProbe} from '../recognition/opponent-signal-probe';
import {createRollingTrace,type TraceLimits} from './rolling-trace';
import {decisionFingerprint} from './trace-fingerprint';
/** Local bounded diagnostics. No game input, screenshots, credentials or network writes. */
export function createLiveMonitor(directory: string,limits:TraceLimits={}) {
  const trace=createRollingTrace(directory,limits);
  let lastStatus = '', lastWrite = 0,lastDecision='',lastDecisionWrite=0;
  let decisionTimer:ReturnType<typeof setTimeout>|null=null,pending:{status:ReaderStatus;at:number}|null=null;
  const keys: Record<string,{received:number;accepted:number;lastAt:string}> = {};
  const opponentProbe=createOpponentSignalProbe();
  function write(entry:unknown,at=Date.now()) {
    const line=JSON.stringify({at:new Date(at).toISOString(),...entry as object})+'\n';
    return trace.append(line).catch(e=>{console.error('[monitor]',e.message);throw e;});
  }
  function note(entry:unknown){void write(entry).catch(()=>{});}
  function recordDecision(){
    if(decisionTimer){clearTimeout(decisionTimer);decisionTimer=null;}
    const current=pending;pending=null;if(!current)return;
    const {status,at}=current,fingerprint=decisionFingerprint(status,at);
    if(fingerprint===lastDecision)return;
    const state={phase:status.phase,message:status.message,transport:status.transport,testMode:false,cards:status.cards,tracker:status.tracker};
    lastDecision=fingerprint;lastDecisionWrite=Date.now();
    void write({type:'decision-state',schema:1,status:{...state,frames:status.frames,lastFrameAt:status.lastFrameAt}},at).catch(()=>{if(lastDecision===fingerprint)lastDecision='';});
  }
  note({type:'monitor-start',testMode:false,retention:trace.limits});
  return {
    packet(payload:Uint8Array,accepted:boolean) {
      try {
        const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
        const key=typeof packet.key==='string'?packet.key:typeof packet.name==='string'?packet.name:'unknown';
        const category=typeof packet.category==='string'?packet.category:'';
        const id=`${category}:${key}`;
        const count=keys[id]??={received:0,accepted:0,lastAt:''};
        count.received++;count.accepted+=Number(accepted);count.lastAt=new Date().toISOString();
        const probe=opponentProbe.observe(packet,accepted);
        if(probe)note({type:'opponent-signal-probe',...probe});
        // Keep the first few contract samples and periodic examples, not an unbounded replay.
        if(count.received<=8 || count.received%250===0) {
          const raw=typeof packet.value==='string'?packet.value:'';
          const validation=raw?parseGameEvent(key,raw):null;
          note({type:'native-packet',packetType:packet.type,category,key,accepted,bytes:payload.byteLength,validationError:validation?.error,sample:raw.slice(0,24000)});
        }
      } catch { note({type:'invalid-native-packet',bytes:payload.byteLength,accepted}); }
    },
    status(status:ReaderStatus,force=false) {
      // Replay actual decision inputs, not just UI health. Test channels never
      // enter a real-game trace; no external upload or screenshots.
      if(!status.testMode&&(status.frames>0||lastDecision)){
        pending={status:structuredClone(status),at:Date.now()};
        if(Date.now()-lastDecisionWrite>=250)recordDecision();
        else if(!decisionTimer)decisionTimer=setTimeout(recordDecision,Math.max(0,Math.min(250,250-(Date.now()-lastDecisionWrite))));
      }else if(status.testMode){
        if(decisionTimer){clearTimeout(decisionTimer);decisionTimer=null;}pending=null;
      }
      const summary={phase:status.phase,message:status.message,testMode:status.testMode,frames:status.frames,lastFrameAt:status.lastFrameAt,scoreboard:status.scoreboard,level:status.cards.level,shopReady:status.cards.shopReady,augmentsReady:status.cards.augmentsReady,shop:status.cards.shop,augments:status.cards.augments,gameBounds:status.gameBounds,alive:status.tracker?.snapshot?.alive,missingPlayers:status.tracker?.snapshot?.players.filter(p=>p.health>0 && (p.placements===undefined || p.coverage==='partial')).map(p=>p.name),owned:status.tracker?.snapshot?.ownedByName,keys};
      const fingerprint=JSON.stringify([status.phase,status.message,status.cards.shopReady,status.cards.augmentsReady,!!status.gameBounds]);
      if(force || fingerprint!==lastStatus || Date.now()-lastWrite>2000){note({type:'reader-status',...summary});lastStatus=fingerprint;lastWrite=Date.now();}
    },
    note(type:string,data:unknown){note({type,data});},
    flush:()=>{recordDecision();return trace.flush();},
  };
}
