// Explicit synthetic native-contract fixture, no game process or network.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const out=path.resolve('dist/equipment-handoff-audit');await fs.mkdir(out,{recursive:true});
await build({stdin:{resolveDir:process.cwd(),contents:`
export {loadBattleModel} from './src/decision/battle-model';
export {equipmentHandoffs} from './src/decision/equipment-handoffs';
export {createOriginalRecognition} from './src/recognition/original-events';
export {shoppingInput,tradingRules} from './src/decision/shopping-input';
export {battleRequest} from './src/game/battle-forecast';
export {directionInput} from './src/decision/direction-input';
export {directionAdvice} from './src/decision/direction-advisor';
export {battleTacticalContext} from './src/decision/battle-tactical-context';
export {encodeBattleBoard} from './src/game/battle-model-encoding';
`},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(out,'runtime.mjs')});
const runtime=await import(pathToFileURL(path.join(out,'runtime.mjs'))),read=async name=>JSON.parse(await fs.readFile('data/'+name+'.json','utf8'));
const [catalog,gear,equipment]=await Promise.all(['metatft-direction-catalog','metatft-gear-model','equipment-rules'].map(read));
const profile=catalog.profiles.find(p=>p.pairs.some(pair=>pair.regime==='four-cost'&&![pair.carry,pair.tank].some(id=>['DA_18_Akali_AD','DA_18_Leona','DA_18_Rakan','DA_18_Varus','DA_18_Shen'].includes(id)))),pair=profile.pairs.find(p=>p.regime==='four-cost');
const reader=runtime.createOriginalRecognition(),send=(key,value)=>{if(!reader.accept(JSON.stringify({type:'info',category:'game_info',key,value:JSON.stringify(value)})))throw Error('Synthetic event rejected '+key);};
const board=['DA_18_Akali_AD','DA_18_Leona','DA_18_Rakan','DA_18_Varus','DA_18_Shen'].map((name,i)=>({name,level:i<2?2:1,items:i===0?['DA_InfinityEdge','DA_GuinsoosRageblade']:i===1?['DA_WarmogsArmor']:[]}));
const opponent=['DA_18_Xayah','DA_18_Shen','DA_18_Rakan','DA_18_Varus'].map(name=>({name,level:2,area:'board',items:[]}));
send('tft_roster',[{summoner:'本方示例',tag_line:'demo',health:60,index:0,is_locale:true},{summoner:'对手示例',tag_line:'demo',health:70,index:1}]);
send('tft_board',Object.fromEntries(board.map((u,i)=>['cell_'+(i+1),{name:u.name,level:u.level,item_1:u.items[0]??'',item_2:u.items[1]??'',item_3:u.items[2]??''}])));send('tft_bench',{});
send('players_info',[{summoner:'本方示例',tag_line:'demo',champions:board.map(u=>({...u,area:'board'}))},{summoner:'对手示例',tag_line:'demo',champions:opponent}]);
send('tft_xp',{xp_level:8,xp_progress:0,xp_progress_max:80});send('tft_gold',12);send('tft_round','4-2');
send('tft_shop',[pair.carry,pair.tank,'Sold','Sold','DA_18_LostTravelers'].map(name=>({name})));
send('tft_item_bench',[{summoner:'本方示例',tag_line:'demo',bench_items:[{name:'DA_Component_BFSword',count:1},{name:'DA_Component_SparringGloves',count:1}]}]);
send('tft_picked_augment',{slot_1:{name:'DA_TradeSector'},slot_2:{name:''},slot_3:{name:''},slot_4:{name:''}});
const status={phase:'receiving',lastFrameAt:Date.now(),frames:1,testMode:true,transport:'original-native',message:'Synthetic equipment handoff audit',cards:reader.view(),tracker:reader.tracker()},shopping=runtime.shoppingInput(status),request=runtime.battleRequest(status);
if(!shopping.ready||!request)throw Error('Synthetic equipment state incomplete');
const advice=runtime.directionAdvice({...runtime.directionInput(status),intent:{key:'metatft:'+profile.key,directionId:pair.id,units:pair.templates[0].poolUnits}},catalog,gear);
const model=await runtime.loadBattleModel(path.resolve('data/metatft-model'));
try{
 const context=runtime.battleTacticalContext(request,shopping.state,model.lookup);if(!context.ready)throw Error(context.reason);
 const start=performance.now(),result=await runtime.equipmentHandoffs(shopping,runtime.tradingRules,equipment,advice,context.request,model.predictCachedBatch,gear,{yield:()=>new Promise(resolve=>setImmediate(resolve)),auxiliary:context.auxiliary,acceptsLineup:context.accepts,supportsBoard:b=>runtime.encodeBattleBoard(b,model.lookup,'player').unknown.length===0});
 const report={scope:'Synthetic assets and real local MetaTFT model; not ranked calibration.',milliseconds:performance.now()-start,status,advice,result};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({milliseconds:report.milliseconds,...(result.ready?{boards:result.boards,baseline:result.baseline,limited:result.limited,choices:result.choices.map(c=>({sold:c.sold.map(u=>u.id),bought:c.bought,moves:c.moves.length,goldAfter:c.goldAfter,gain:c.gain,conditionalRack:c.conditionalRack}))}:{reason:result.reason})},null,2));
}finally{model.dispose();}
