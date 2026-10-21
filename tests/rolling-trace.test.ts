import {describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRollingTrace} from '../src/desktop/rolling-trace';
import {traceFiles,traceLines,decisionRecord} from '../scripts/lib/trace-files.mjs';
const run=promisify(execFile);
async function withDirectory(test:(dir:string)=>Promise<void>){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-ring-'));
  try{await test(dir);}finally{
    const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(dir));
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Test cleanup outside temporary root');
    await fs.rm(dir,{recursive:true,force:true});
  }
}
async function entries(dir:string){
  const result:any[]=[];for await(const line of traceLines(await traceFiles(dir))){if(typeof line.text!=='string')throw Error(line.error);result.push(JSON.parse(line.text));}return result;
}
describe('bounded trace retention and replay',()=>{
  it('retains a contiguous newest suffix of complete records in chronological archive order and continues after restart',async()=>withDirectory(async dir=>{
    await fs.writeFile(path.join(dir,'keep.txt'),'unrelated user file');
    const writer=createRollingTrace(dir,{maxFileBytes:512,maxArchives:2});
    await Promise.all(Array.from({length:30},(_,n)=>writer.append(JSON.stringify({n,payload:'x'.repeat(65)})+'\n')));
    const first=await entries(dir),files=await traceFiles(dir);
    expect(files.length).toBeLessThanOrEqual(3);expect(files.reduce((n,f)=>n+f.bytes,0)).toBeLessThanOrEqual(1536);
    expect(first.map(e=>e.n)).toEqual(Array.from({length:first.length},(_,i)=>30-first.length+i));
    const restarted=createRollingTrace(dir,{maxFileBytes:512,maxArchives:2});await restarted.append(JSON.stringify({n:30,payload:'x'.repeat(65)})+'\n');await restarted.flush();
    expect((await entries(dir)).at(-1).n).toBe(30);expect(await fs.readFile(path.join(dir,'keep.txt'),'utf8')).toBe('unrelated user file');
  }));
  it('reports oversized records instead of emitting invalid partial JSON and still accepts the next entry',async()=>withDirectory(async dir=>{
    const writer=createRollingTrace(dir,{maxFileBytes:512,maxArchives:1});await writer.append(JSON.stringify({n:0,payload:'x'.repeat(2000)})+'\n');await writer.append('{"n":1}\n');
    const records=await entries(dir);expect(records[0]).toMatchObject({type:'trace-entry-omitted',reason:'entry-exceeds-segment'});expect(records[1]).toEqual({n:1});
  }));
  it('reads an inventoried active prefix and detects replacement instead of silently reading a different segment',async()=>withDirectory(async dir=>{
    const writer=createRollingTrace(dir,{maxFileBytes:512,maxArchives:1});await writer.append('{"n":0}\n');const snapshot=await traceFiles(dir);await writer.append('{"n":1}\n');
    const rows=[];for await(const line of traceLines(snapshot))rows.push(line);expect(rows).toHaveLength(1);expect(rows[0].text).toBe('{"n":0}');
    const before=await traceFiles(dir);await writer.append(JSON.stringify({n:2,payload:'x'.repeat(490)})+'\n');await writer.append('{"n":3}\n');
    const changed=[];for await(const line of traceLines(before))changed.push(line);expect(changed.some(line=>line.error?.includes('changed'))).toBe(true);
  }));
  it('never removes a reserved directory or follows it as an owned trace file',async()=>withDirectory(async dir=>{
    await fs.mkdir(path.join(dir,'events.1.jsonl'));const writer=createRollingTrace(dir,{maxFileBytes:512,maxArchives:1});
    await expect(writer.append('{"n":0}\n')).rejects.toThrow(/regular file/);expect((await fs.stat(path.join(dir,'events.1.jsonl'))).isDirectory()).toBe(true);
  }));
  it('exports rotated decision inputs with their captured clock while rejecting test-mode and invalid records',async()=>withDirectory(async dir=>{
    const writer=createRollingTrace(dir,{maxFileBytes:1024,maxArchives:3}),base={phase:'receiving',message:'synthetic audit fixture',transport:'original-native',testMode:false,frames:1,lastFrameAt:1000,cards:{shop:[],augments:[],pickedAugment:null,shopReady:false,augmentsReady:false}};
    for(let n=0;n<6;n++)await writer.append(JSON.stringify({at:new Date(1000+n).toISOString(),type:'decision-state',schema:1,status:{...base,frames:n+1}})+'\n');
    const files=await traceFiles(dir);expect(files.length).toBeGreaterThan(1);
    const out=path.join(dir,'export/frames.jsonl');await run(process.execPath,['scripts/replay-live-trace.mjs',dir,out],{cwd:process.cwd()});
    const replay=(await fs.readFile(out,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
    expect(replay.at(-1)).toMatchObject({clock:1005,status:{frames:6,lastFrameAt:1000}});expect(replay.every((r,i)=>!i||r.clock>replay[i-1].clock)).toBe(true);
    expect(decisionRecord({at:new Date().toISOString(),type:'decision-state',schema:1,status:{...base,testMode:true}})).toBeNull();
    expect(decisionRecord({at:'invalid-date',type:'decision-state',schema:1,status:base})).toBeNull();
  }));
  it('refuses input/output aliases and report collisions before truncating any captured evidence',async()=>withDirectory(async dir=>{
    const input=path.join(dir,'input.jsonl'),content='{"type":"monitor-start"}\n';await fs.writeFile(input,content);
    const alias=process.platform==='win32'?input.toUpperCase():input;
    await expect(run(process.execPath,['scripts/replay-live-trace.mjs',input,alias],{cwd:process.cwd()})).rejects.toThrow(/not overwrite/);
    expect(await fs.readFile(input,'utf8')).toBe(content);
    const report=path.join(dir,'export.report.json');await fs.writeFile(report,content);
    await expect(run(process.execPath,['scripts/replay-live-trace.mjs',report,path.join(dir,'export.jsonl')],{cwd:process.cwd()})).rejects.toThrow(/not overwrite/);
    expect(await fs.readFile(report,'utf8')).toBe(content);
  }));
});
