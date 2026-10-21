import fs from 'node:fs/promises';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const out=path.resolve('dist/comp-profile-analysis/direction-audit-runtime.mjs');
await build({stdin:{contents:`export {directionAdvice} from './src/decision/direction-advisor';export {directionInput} from './src/decision/direction-input';export {directionSearch} from './src/decision/direction-search';export {shoppingInput,tradingRules} from './src/decision/shopping-input';export {strategicInput} from './src/decision/strategic-input';export {advisorDemo} from './src/desktop/advisor-demo';export {earlyStages} from './src/game/metatft-early';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:out});
const {directionAdvice,directionInput,directionSearch,shoppingInput,strategicInput,tradingRules,advisorDemo,earlyStages}=await import(pathToFileURL(out));
const catalog=JSON.parse(await fs.readFile('data/metatft-direction-catalog.json','utf8')),gear=JSON.parse(await fs.readFile('data/metatft-gear-model.json','utf8'));
const results=[];
for(const scenario of ['ap','ad','partial']){
 const status=advisorDemo(scenario),input=directionInput(status),start=performance.now();
 const result=directionAdvice(input,catalog,gear,earlyStages(18));
 results.push({scenario,ms:performance.now()-start,...result});
 console.log(JSON.stringify({scenario,ms:results.at(-1).ms,ready:result.ready,mode:result.mode,rows:result.rows?.map(r=>({name:r.name,carry:r.carry,regime:r.regime,gear:[r.gear.componentLift,r.gear.coreItemLift],retained:r.early?.retained})),holds:result.holds?.cards.length}));
}
await fs.writeFile('dist/comp-profile-analysis/direction-audit.json',JSON.stringify(results,null,2));
if(process.argv.includes('--startup')){
 const status=JSON.parse(await fs.readFile('dist/native-recognition-smoke/recognition.json','utf8'));
 status.lastFrameAt=Date.now();status.cards.round='4-2';status.cards.stage=4;status.cards.level=8;status.cards.gold=40;
 const input=directionInput(status),result=directionAdvice(input,catalog,gear,earlyStages(18)),strategy=strategicInput(status,shoppingInput(status));
 const start=performance.now(),search=directionSearch(result,strategy,tradingRules);
 await fs.writeFile('dist/comp-profile-analysis/startup-audit.json',JSON.stringify({input,result,search},null,2));
 console.log(JSON.stringify({startup:true,ms:performance.now()-start,strategyReady:strategy.ready,rows:result.rows?.map(r=>({name:r.name,carry:r.carry,tank:r.tank})),search}));
}
