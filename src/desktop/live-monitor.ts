import fs from 'node:fs/promises';
import path from 'node:path';
import { parseGameEvent } from '../core/events';
import type { ReaderStatus } from '../recognition/status';
import {createOpponentSignalProbe} from '../recognition/opponent-signal-probe';
/** Local bounded diagnostics. No game input, screenshots, credentials or network writes. */
export function createLiveMonitor(directory: string) {
  const file=path.join(directory,'events.jsonl');
  let bytes = 0, lastStatus = '', lastWrite = 0,lastDecision='',lastDecisionWrite=0;
  let queue = fs.mkdir(directory, {recursive:true}).then(async()=>{bytes=(await fs.stat(file).catch(()=>null))?.size??0;});
  const keys: Record<string,{received:number;accepted:number;lastAt:string}> = {};
  const opponentProbe=createOpponentSignalProbe();
  function write(entry:unknown) {
    const line=JSON.stringify({at:new Date().toISOString(),...entry as object})+'\n';
    queue=queue.then(async()=>{const size=Buffer.byteLength(line);if(bytes+size>50_000_000)return;bytes+=size;await fs.appendFile(file,line,'utf8');}).catch(e=>{console.error('[monitor]',e.message);});
  }
  write({type:'monitor-start',testMode:false});
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
        if(probe)write({type:'opponent-signal-probe',...probe});
        // Keep the first few contract samples and periodic examples, not an unbounded replay.
        if(count.received<=8 || count.received%250===0) {
          const raw=typeof packet.value==='string'?packet.value:'';
          const validation=raw?parseGameEvent(key,raw):null;
          write({type:'native-packet',packetType:packet.type,category,key,accepted,bytes:payload.byteLength,validationError:validation?.error,sample:raw.slice(0,24000)});
        }
      } catch { write({type:'invalid-native-packet',bytes:payload.byteLength,accepted}); }
    },
    status(status:ReaderStatus,force=false) {
      // Replay actual decision inputs, not just UI health. Test channels never
      // enter a real-game trace; no external upload or screenshots.
      if(status.frames>0&&!status.testMode&&Date.now()-lastDecisionWrite>=250){
        const state={phase:status.phase,transport:status.transport,testMode:false,cards:status.cards,tracker:status.tracker};
        const fingerprint=JSON.stringify(state);
        if(fingerprint!==lastDecision){write({type:'decision-state',schema:1,status:{...state,frames:status.frames,lastFrameAt:status.lastFrameAt}});lastDecision=fingerprint;lastDecisionWrite=Date.now();}
      }
      const summary={phase:status.phase,message:status.message,frames:status.frames,scoreboard:status.scoreboard,level:status.cards.level,shopReady:status.cards.shopReady,augmentsReady:status.cards.augmentsReady,shop:status.cards.shop,augments:status.cards.augments,gameBounds:status.gameBounds,alive:status.tracker?.snapshot?.alive,missingPlayers:status.tracker?.snapshot?.players.filter(p=>p.health>0 && (p.placements===undefined || p.coverage==='partial')).map(p=>p.name),owned:status.tracker?.snapshot?.ownedByName,keys};
      const fingerprint=JSON.stringify([status.phase,status.message,status.cards.shopReady,status.cards.augmentsReady,!!status.gameBounds]);
      if(force || fingerprint!==lastStatus || Date.now()-lastWrite>2000){write({type:'reader-status',...summary});lastStatus=fingerprint;lastWrite=Date.now();}
    },
    note(type:string,data:unknown){write({type,data});},
    flush:()=>queue,
  };
}
