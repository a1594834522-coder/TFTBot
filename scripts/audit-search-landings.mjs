// Explicit synthetic full-roster state; never connects to a game or provider.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const current=process.argv.includes('--current-purchases');
const out=path.resolve(current?'dist/current-pursuit-audit':'dist/search-landing-audit');await fs.mkdir(out,{recursive:true});
await build({stdin:{resolveDir:process.cwd(),contents:`
export {loadBattleModel} from './src/decision/battle-model';
export {searchLandings} from './src/decision/search-landings';
export {currentPursuit} from './src/decision/current-pursuit';
export {createOriginalRecognition} from './src/recognition/original-events';
export {shoppingInput,tradingRules} from './src/decision/shopping-input';
export {strategicInput} from './src/decision/strategic-input';
export {battleRequest} from './src/game/battle-forecast';
export {directionInput} from './src/decision/direction-input';
export {directionAdvice} from './src/decision/direction-advisor';
export {battleTacticalContext} from './src/decision/battle-tactical-context';
export {encodeBattleBoard} from './src/game/battle-model-encoding';
export {earlyStages} from './src/game/metatft-early';
`},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(out,'runtime.mjs')});
const runtime=await import(pathToFileURL(path.join(out,'runtime.mjs'))),catalog=JSON.parse(await fs.readFile('data/metatft-direction-catalog.json','utf8')),gear=JSON.parse(await fs.readFile('data/metatft-gear-model.json','utf8'));
const profile=catalog.profiles.find(p=>p.regime.primary==='four-cost'&&p.pairs.length&&p.early.some(b=>b.level===7&&b.poolUnits.length===7));
if(!profile)throw Error('No observed seven-unit transition fixture');
const pair=profile.pairs[0],early=profile.early.find(b=>b.level===7&&b.poolUnits.length===7),names=new Map(JSON.parse(await fs.readFile('data/tft-sets.json','utf8')).characters['18'].map(c=>[c.character_id,c.display_name]));
const piece=(name,level=1,items=[])=>({name,level,item_1:items[0]??'',item_2:items[1]??'',item_3:items[2]??''});
const board=early.poolUnits.map((id,i)=>piece(id,i<2?2:1,i===0?['DA_InfinityEdge']:i===1?['DA_WarmogsArmor']:[])),bench=[];
const opponent=['DA_18_Rakan','DA_18_Xayah','DA_18_Shen','DA_18_Leona','DA_18_Varus','DA_18_Rengar','DA_18_Caitlyn'].map((id,i)=>piece(id,i<3?2:1,i===0?['DA_WarmogsArmor']:[]));
const reader=runtime.createOriginalRecognition(),send=(key,value)=>{if(!reader.accept(JSON.stringify({type:'info',category:'game_info',key,value:JSON.stringify(value)})))throw Error('Fixture event rejected: '+key);};
send('tft_roster',[{summoner:'本方示例',tag_line:'demo',health:50,index:0,is_locale:true},{summoner:'对手示例',tag_line:'demo',health:65,index:1}]);
send('tft_board',Object.fromEntries(board.map((u,i)=>['cell_'+(i+1),u])));send('tft_bench',{});
const reportUnits=(units,area)=>units.map(u=>({...u,area,items:[u.item_1,u.item_2,u.item_3].filter(Boolean)}));
send('players_info',[{summoner:'本方示例',tag_line:'demo',champions:[...reportUnits(board,'board'),...reportUnits(bench,'bench')]},{summoner:'对手示例',tag_line:'demo',champions:reportUnits(opponent,'board')}]);
send('tft_xp',{xp_level:8,xp_progress:0,xp_progress_max:80});send('tft_gold',Number(process.env.TFTBOT_AUDIT_BUDGET??20));send('tft_round','4-2');
send('tft_shop',[pair.carry,'Sold','Sold','Sold','DA_18_LostTravelers'].map(name=>({name})));
const status={phase:'receiving',lastFrameAt:Date.now(),frames:1,testMode:true,transport:'original-native',message:'Synthetic search landing audit',cards:reader.view(),tracker:reader.tracker()},shopping=runtime.shoppingInput(status),strategy=runtime.strategicInput(status,shopping),request=runtime.battleRequest(status);
if(!shopping.ready||!strategy.ready||!request)throw Error('Fixture not coherent: '+JSON.stringify(strategy));
const advice=runtime.directionAdvice({...runtime.directionInput(status),intent:{key:'metatft:'+profile.key,directionId:pair.id,units:pair.templates[0].poolUnits}},catalog,gear,runtime.earlyStages(18));
if(!advice.ready||advice.mode!=='selected')throw Error('Selected mainline not retained');
if(current){
 const cores=[...new Set(advice.rows.filter(r=>r.regime===advice.rows.find(r=>r.id===advice.focusId).regime).slice(0,3).flatMap(r=>[r.carry,r.tank]))];
 const offers=[...cores.slice(0,4),cores[0]].slice(0,5);
 shopping.state.offers=offers.map((id,slot)=>({slot,id,price:runtime.tradingRules.heroes[id].cost}));
}
const model=await runtime.loadBattleModel(path.resolve('data/metatft-model'),process.env.TFTBOT_AUDIT_NO_PAIR_CACHE?{pairCacheLimit:0}:{});
try{
  const context=runtime.battleTacticalContext(request,shopping.state,model.lookup);if(!context.ready)throw Error(context.reason);
  const phases={},start=performance.now(),result=await runtime[current?'currentPursuit':'searchLandings'](advice,strategy,runtime.tradingRules,context.request,model.predictCachedBatch,{mode:process.env.TFTBOT_AUDIT_POLICY??'upgrade-first',scoreReuse:!process.env.TFTBOT_AUDIT_NO_SCORE_CACHE,trace:(name,ms)=>{phases[name]=ms;},...(process.env.TFTBOT_AUDIT_BOARDS?{maxBoards:Number(process.env.TFTBOT_AUDIT_BOARDS)}:{}),...(process.env.TFTBOT_AUDIT_STATES?{maxStates:Number(process.env.TFTBOT_AUDIT_STATES)}:{}),yield:()=>new Promise(resolve=>setImmediate(resolve)),auxiliary:context.auxiliary,acceptsLineup:context.accepts,supportsBoard:b=>runtime.encodeBattleBoard(b,model.lookup,'player').unknown.length===0});
  const report={scope:'Synthetic native-contract fixture and real local model. Not a real match or calibration.',milliseconds:performance.now()-start,phases,cache:model.cacheMetrics(),modelVersion:model.version,mainline:profile.name??profile.key,status,shopping,advice,result};
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({milliseconds:report.milliseconds,model:model.version,ready:result.ready,...(result.ready?current?{evaluations:result.evaluations,paths:result.paths.map(p=>({buy:p.buy.map(t=>names.get(t.id)),spent:p.spent,bands:p.bands.map(b=>({slots:b.heroSlots,coverage:b.evaluatedMass,completion:b.completion,combat:b.combat,gold:b.expectedGold}))}))}:{baseline:result.baseline,plans:result.plans.map(p=>({name:p.name,targets:p.targets.map(t=>({...t,name:names.get(t.id)})),bands:p.bands.map(b=>({slots:b.heroSlots,states:b.states,coverage:b.coverage,completion:b.completion,combat:b.combat,failureCombat:b.failureCombat,gaps:b.gaps}))}))}:{reason:result.reason})},null,2));
}finally{model.dispose();}
