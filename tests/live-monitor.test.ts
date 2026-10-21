import {describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createLiveMonitor} from '../src/desktop/live-monitor';
import {advisorDemo} from '../src/desktop/advisor-demo';
describe('local replay evidence',()=>{
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
  it('respects the existing file cap across restarts',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-trace-')),file=path.join(dir,'events.jsonl');
    try{
      const handle=await fs.open(file,'w');await handle.truncate(50_000_000);await handle.close();
      const monitor=createLiveMonitor(dir);monitor.note('test',{});await monitor.flush();expect((await fs.stat(file)).size).toBe(50_000_000);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
});
