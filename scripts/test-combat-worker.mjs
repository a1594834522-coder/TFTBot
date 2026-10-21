import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),out=path.resolve('dist/combat-worker-smoke');await fs.mkdir(out,{recursive:true});
await build({stdin:{resolveDir:process.cwd(),contents:`
import {createOriginalRecognition} from './src/recognition/original-events';
import {battleRequest} from './src/game/battle-forecast';
import fixture from './tests/fixtures/native-scoreboard-s18.json';
export function work(){const r=createOriginalRecognition();const send=(key,value)=>r.accept(JSON.stringify({type:'info',category:'game_info',key,value:JSON.stringify(value)}));
send('tft_roster',fixture.roster);send('tft_board',fixture.board);send('tft_bench',fixture.bench);send('tft_round','4-1');r.acceptScoreboard(fixture.frame);
const s={phase:'receiving',lastFrameAt:Date.now(),cards:r.view(),tracker:r.tracker()},request=battleRequest(s);request.weightSource='vision';request.targets.forEach((t,i)=>t.weight=i===0?1:0);
return {type:'evaluate',id:1,request,shopping:{ready:false,reason:'smoke'},strategy:{ready:false,reason:'smoke'},direction:{},searchBudget:null};}
`},outfile:path.join(out,'fixture.cjs'),platform:'node',format:'cjs',bundle:true});
await fs.writeFile(path.join(out,'run.cjs'),`
const {app,utilityProcess}=require('electron'),assert=require('node:assert/strict'),{work}=require('./fixture.cjs');
app.whenReady().then(()=>{const child=utilityProcess.fork(${JSON.stringify(path.resolve('dist/desktop/battle-worker.cjs'))},[],{stdio:'pipe'});
const timer=setTimeout(()=>{console.error('COMBAT_WORKER_TIMEOUT');child.kill();app.exit(1)},15000);
child.on('message',message=>{if(message.type!=='result'||message.forecast?.phase!=='ready')return;try{const f=message.forecast;assert.equal(f.weightSource,'vision');assert(f.opponents.length>1);assert(f.opponents.every(o=>typeof o.winRate==='number'));assert.equal(f.winRate,f.opponents.find(o=>o.weight===1).winRate);assert.equal(f.direction,undefined);assert.equal(f.strategy,undefined);console.log('COMBAT_WORKER_VISION_PASS '+JSON.stringify({opponents:f.opponents.length,winRate:f.winRate,source:f.weightSource}));clearTimeout(timer);child.kill();app.exit(0)}catch(e){console.error(e);clearTimeout(timer);child.kill();app.exit(1)}});child.postMessage(work());});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(out,'run.cjs')],{env,windowsHide:true,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
