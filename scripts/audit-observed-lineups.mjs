import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{mixedLineupFixture}=require('./mixed-lineup-fixture.cjs');
const out=path.resolve('dist/mixed-lineup-audit');await fs.mkdir(out,{recursive:true});
await build({stdin:{resolveDir:process.cwd(),contents:`
export {loadBattleModel} from './src/decision/battle-model';
export {shoppingTactics,mainlineTacticalReference} from './src/decision/shopping-tactics';
export {tacticalLineupTemplates} from './src/decision/observed-lineups';
export {createOriginalRecognition} from './src/recognition/original-events';
export {shoppingInput,tradingRules} from './src/decision/shopping-input';
export {strategicInput} from './src/decision/strategic-input';
export {battleRequest} from './src/game/battle-forecast';
export {directionInput} from './src/decision/direction-input';
export {directionAdvice} from './src/decision/direction-advisor';
export {battleTacticalContext} from './src/decision/battle-tactical-context';
export {encodeBattleBoard} from './src/game/battle-model-encoding';
`},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(out,'runtime.mjs')});
const runtime=await import(pathToFileURL(path.join(out,'runtime.mjs'))),fixture=mixedLineupFixture(),reader=runtime.createOriginalRecognition();
for(const [key,value]of fixture.events)if(!reader.accept(JSON.stringify({type:'info',category:'game_info',key,value:JSON.stringify(value)})))throw Error('Fixture event rejected '+key);
const status={phase:'receiving',lastFrameAt:Date.now(),frames:1,testMode:true,transport:'original-native',message:'Synthetic mixed lineup audit',cards:reader.view(),tracker:reader.tracker()},shopping=runtime.shoppingInput(status),request=runtime.battleRequest(status);
if(!shopping.ready||!request)throw Error('Incomplete fixture');
const read=async file=>JSON.parse(await fs.readFile('data/'+file+'.json','utf8')),[catalog,gear]=await Promise.all(['metatft-direction-catalog','metatft-gear-model'].map(read));
const direction={...runtime.directionInput(status),intent:fixture.intent},advice=runtime.directionAdvice(direction,catalog,gear),model=await runtime.loadBattleModel(path.resolve('data/metatft-model'));
try{
 const context=runtime.battleTacticalContext(request,shopping.state,model.lookup);if(!context.ready)throw Error(context.reason);
 const options={yield:()=>new Promise(resolve=>setImmediate(resolve)),reference:runtime.mainlineTacticalReference(advice),supportsBoard:b=>runtime.encodeBattleBoard(b,model.lookup,'player').unknown.length===0,auxiliary:context.auxiliary,acceptsLineup:context.accepts};
 const before=JSON.stringify(shopping.state),start=performance.now(),narrow=await runtime.shoppingTactics(shopping.state,runtime.tradingRules,context.request,model.predictCachedBatch,options),narrowMs=performance.now()-start;
 const templates=runtime.tacticalLineupTemplates(advice,shopping.state.boardCapacity),next=performance.now(),mixed=await runtime.shoppingTactics(shopping.state,runtime.tradingRules,context.request,model.predictCachedBatch,{...options,observedLineups:{templates}}),mixedMs=performance.now()-next;
 if(JSON.stringify(shopping.state)!==before||!mixed.ready||!mixed.deploymentSearch.observedBoards)throw Error('Mixed candidates missing or mutated physical input');
 const worker={request,shopping,strategy:{ready:false,reason:'Isolated current-board projection, no fabricated future pool'},direction,searchBudget:null};
 const cold=await runtime.loadBattleModel(path.resolve('data/metatft-model'));let coldMixedMs;
 try{const t=performance.now();await runtime.shoppingTactics(shopping.state,runtime.tradingRules,context.request,cold.predictCachedBatch,{...options,observedLineups:{templates}});coldMixedMs=performance.now()-t;}finally{cold.dispose();}
 const report={scope:'Synthetic native-contract assets and actual local MetaTFT model; not a real match or ranked calibration',timing:'narrow and mixed share a cache; coldMixed uses a separate model cache, not a worst-case guarantee',profile:fixture.profile,model:model.version,narrowMs,mixedMs,coldMixedMs,templates,status,narrow,mixed,cache:model.cacheMetrics()};
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(out,'worker-fixture.json'),JSON.stringify(worker,null,2));
 console.log(JSON.stringify({profile:fixture.profile,narrowMs,mixedMs,coldMixedMs,narrow:narrow.ready?{boards:narrow.searchedBoards,best:Math.max(...narrow.choices.map(c=>c.knownWin))}:narrow,mixed:{boards:mixed.searchedBoards,search:mixed.deploymentSearch,choices:mixed.choices.map(c=>({mode:c.id,buy:c.buy,win:c.winRate,incoming:c.incoming.length,outgoing:c.outgoing.length,sources:c.observedSources}))}},null,2));
}finally{model.dispose();}
