import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const out=path.resolve('dist/direction-worker-smoke');await fs.mkdir(path.join(out,'broken'),{recursive:true});
await fs.copyFile('dist/desktop/battle-worker.cjs',path.join(out,'broken/battle-worker.cjs'));
await build({stdin:{resolveDir:process.cwd(),contents:`
import {advisorDemo} from './src/desktop/advisor-demo';
import {directionInput} from './src/decision/direction-input';
import {shoppingInput} from './src/decision/shopping-input';
import {strategicInput} from './src/decision/strategic-input';
import {battleRequest} from './src/game/battle-forecast';
export function fixtures(){
 const status=advisorDemo('ap'),local=status.tracker.snapshot.players.find(p=>p.isLocal),now=Date.now();
 status.cards.gold=40;status.cards.itemBenches=[{summoner:local.summoner,tag_line:local.tagLine,bench_items:[]}];
 const board=local.champions.map((u,slot)=>({name:u.name,level:u.copies===3?2:1,items:u.items,position:slot,area:'board'}));
 status.cards.ownHoldings={board,bench:[]};status.cards.battleBoards={local:{at:now,units:board},opponents:{}};
 const make=s=>{const shopping=shoppingInput(s);return {request:battleRequest(s),shopping,strategy:strategicInput(s,shopping),direction:directionInput(s),searchBudget:null};};
 const full=make(status),single=structuredClone(status);single.tracker.snapshot.players=single.tracker.snapshot.players.filter(p=>p.isLocal);
 return {full,single:make(single)};
}`},bundle:true,platform:'node',format:'cjs',outfile:path.join(out,'fixtures.cjs')});
const require=createRequire(import.meta.url),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.resolve('scripts/direction-worker-smoke.cjs')],{env,windowsHide:true,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
