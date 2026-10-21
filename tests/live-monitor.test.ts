import {describe,it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createLiveMonitor} from '../src/desktop/live-monitor';
import {advisorDemo} from '../src/desktop/advisor-demo';
import {decisionFingerprint} from '../src/desktop/trace-fingerprint';
describe('local replay evidence',()=>{
  it('retries a meaningful decision snapshot after a full writer queue drains instead of deduplicating an unwritten state forever',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-dev-pressure-'));
    try{
      const monitor=createLiveMonitor(dir,{detailed:true,maxQueuedRecords:1}),status=advisorDemo('ap');status.testMode=false;status.frames=10;
      monitor.status(status);await monitor.flush();monitor.status(status);await monitor.flush();
      const entries=(await fs.readFile(path.join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));
      expect(entries.some(e=>e.type==='trace-backpressure')).toBe(true);expect(entries.filter(e=>e.type==='decision-state')).toHaveLength(1);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  it('captures every changed development packet with exact raw text beyond the standard sampling window, while coalescing identical repeats',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-21T04:00:00Z'));const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-dev-trace-'));
    try{
      const monitor=createLiveMonitor(dir,{detailed:true}),packet=(n:number)=>new TextEncoder().encode(JSON.stringify({type:'info',category:'game_info',key:'synthetic_dev',value:JSON.stringify({n})}));
      for(let n=0;n<15;n++)monitor.packet(packet(n),false);
      monitor.packet(packet(14),false);monitor.packet(packet(14),false);vi.setSystemTime(Date.now()+5001);monitor.packet(packet(14),false);
      monitor.packet(packet(14),true);await monitor.flush();
      const entries=(await fs.readFile(path.join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s)),raw=entries.filter(e=>e.type==='native-packet-detailed');
      expect(raw).toHaveLength(17);expect(raw.slice(0,15).map(e=>JSON.parse(JSON.parse(e.raw).value).n)).toEqual(Array.from({length:15},(_,n)=>n));
      expect(raw[15]).toMatchObject({unchangedSinceLast:2,truncated:false});expect(raw[16].accepted).toBe(true);
      expect(entries[0]).toMatchObject({detailed:true,decisionIntervalMs:100,retention:{maxTotalBytes:450_000_000}});
    }finally{vi.useRealTimers();await fs.rm(dir,{recursive:true,force:true});}
  });
  it('marks oversized and malformed development packets explicitly and preserves their bounded original bytes',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-dev-bytes-'));
    try{
      const monitor=createLiveMonitor(dir,{detailed:true}),payload=new TextEncoder().encode(JSON.stringify({key:'synthetic_big',value:'x'.repeat(300000)}));
      monitor.packet(payload,false);monitor.packet(Uint8Array.from([255,254,0]),false);await monitor.flush();
      const entries=(await fs.readFile(path.join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s)),big=entries.find(e=>e.type==='native-packet-detailed'),invalid=entries.find(e=>e.type==='invalid-native-packet');
      expect(big.truncated).toBe(true);expect(Buffer.from(big.prefixBase64,'base64')).toEqual(Buffer.from(payload.subarray(0,256000)));expect(big.raw).toBeUndefined();
      expect(Buffer.from(invalid.prefixBase64,'base64')).toEqual(Buffer.from([255,254,0]));expect(invalid.truncated).toBe(false);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  it('writes unknown native fields to dedicated contract evidence without using the native parser to approve them',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-probe-'));
    try{
      const monitor=createLiveMonitor(dir);monitor.packet(new TextEncoder().encode(JSON.stringify({type:'info',category:'game_info',key:'synthetic_new_field',value:'{"flag":true}'})),false);await monitor.flush();
      const entries=(await fs.readFile(path.join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));
      expect(entries.find(e=>e.type==='opponent-signal-probe')).toMatchObject({key:'synthetic_new_field',accepted:false,fields:{'$.flag':'boolean'},interpretation:'unverified-contract-only'});
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  it('records reconstructable physical decision state while keeping test channels out',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-trace-'));
    try{
      const monitor=createLiveMonitor(dir),status=advisorDemo('ap');status.frames=10;status.testMode=false;
      monitor.status(status);await monitor.flush();
      const entries=(await fs.readFile(path.join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));
      const replay=entries.find(e=>e.type==='decision-state');expect(replay.schema).toBe(1);expect(replay.status.cards).toEqual(status.cards);expect(replay.status.tracker).toEqual(status.tracker);
      const other=createLiveMonitor(dir);other.status({...status,testMode:true});await other.flush();
      const after=(await fs.readFile(path.join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));expect(after.filter(e=>e.type==='decision-state')).toHaveLength(1);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  it('rotates a legacy full file across restart and continues recording without discarding it',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-trace-')),file=path.join(dir,'events.jsonl');
    try{
      const handle=await fs.open(file,'w');await handle.truncate(50_000_000);await handle.close();
      const monitor=createLiveMonitor(dir);monitor.note('test',{});await monitor.flush();expect((await fs.stat(file)).size).toBeLessThan(16_000_000);expect((await fs.stat(path.join(dir,'events.1.jsonl'))).size).toBe(50_000_000);
      const entries=(await fs.readFile(file,'utf8')).trim().split('\n').map(s=>JSON.parse(s));expect(entries.some(e=>e.type==='test')).toBe(true);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  it('deduplicates timestamp/revision churn but records meaningful content and freshness changes',()=>{
    const status=advisorDemo('ap'),now=status.lastFrameAt!;status.testMode=false;status.cards.battleBoards={local:{at:now,units:[]},opponents:{peer:{at:now,units:[]}}};
    const first=decisionFingerprint(status,now),other=structuredClone(status);other.frames++;other.tracker!.revision++;other.lastFrameAt=now+1000;other.cards.goldAt=now+1000;other.cards.itemBenchesAt=now+1000;other.cards.battleBoards!.local!.at=now+1000;other.cards.battleBoards!.opponents.peer.at=now+1000;
    expect(decisionFingerprint(other,now+1000)).toBe(first);
    other.cards.gold=(other.cards.gold??0)+1;expect(decisionFingerprint(other,now+1000)).not.toBe(first);
    other.cards.gold=status.cards.gold;other.lastFrameAt=now+17000;expect(decisionFingerprint(other,now+17000)).not.toBe(first);
    other.cards.battleBoards!.opponents.peer.at=now+17000;expect(decisionFingerprint(other,now+17000)).toBe(first);
  });
  it('stores one physical decision state for repeated native clock updates, then records a changed round',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-churn-'));
    try{
      const monitor=createLiveMonitor(dir),status=advisorDemo('ap');status.testMode=false;status.frames=10;
      status.cards.battleBoards={local:{at:Date.now(),units:[]},opponents:{}};monitor.status(status);await monitor.flush();
      for(let n=0;n<40;n++){status.frames++;status.tracker!.revision++;status.lastFrameAt=Date.now();status.cards.goldAt=Date.now();status.cards.itemBenchesAt=Date.now();status.cards.battleBoards.local!.at=Date.now();monitor.status(status);}
      await monitor.flush();let entries=(await fs.readFile(path.join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));expect(entries.filter(e=>e.type==='decision-state')).toHaveLength(1);
      status.cards.round='5-1';monitor.status(status);await monitor.flush();entries=(await fs.readFile(path.join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));
      expect(entries.filter(e=>e.type==='decision-state')).toHaveLength(2);expect(entries.filter(e=>e.type==='decision-state')[1].status.cards.goldAt).toBe(status.cards.goldAt);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  it('flushes the latest coalesced snapshot including reader stop, without recording later caller mutations',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-21T04:00:00Z'));const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-final-frame-'));
    try{
      const monitor=createLiveMonitor(dir),status=advisorDemo('ap');status.testMode=false;status.frames=10;monitor.status(status);await monitor.flush();
      vi.setSystemTime(Date.now()+100);status.cards.gold=12;monitor.status(status);status.cards.gold=99;await monitor.flush();
      let entries=(await fs.readFile(path.join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s)).filter(e=>e.type==='decision-state');
      expect(entries).toHaveLength(2);expect(entries[1].status.cards.gold).toBe(12);expect(entries[1].status.message).toBe(status.message);
      monitor.status({...status,phase:'stopped',frames:0,lastFrameAt:null});await monitor.flush();
      entries=(await fs.readFile(path.join(dir,'events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s)).filter(e=>e.type==='decision-state');
      expect(entries.at(-1).status).toMatchObject({phase:'stopped',frames:0,lastFrameAt:null});expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();await fs.rm(dir,{recursive:true,force:true});}
  });
});
