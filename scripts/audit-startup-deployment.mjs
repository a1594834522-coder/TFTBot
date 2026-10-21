// Synthetic level-8 load/consistency audit using the real shipped MetaTFT model.
// This is not a match replay, calibration or evidence of ranked-game benefit.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const out=path.resolve('dist/startup-deployment-audit');await fs.mkdir(out,{recursive:true});
await build({stdin:{resolveDir:process.cwd(),contents:`export {loadBattleModel} from './src/decision/battle-model';export {shoppingTactics} from './src/decision/shopping-tactics';export {encodeBattleBoard} from './src/game/battle-model-encoding';`},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(out,'runtime.mjs')});
const {loadBattleModel,shoppingTactics,encodeBattleBoard}=await import(pathToFileURL(path.join(out,'runtime.mjs')));
const catalog=JSON.parse(await fs.readFile('data/metatft-direction-catalog.json','utf8')),rules=JSON.parse(await fs.readFile('data/decision-trading-rules.json','utf8'));
const model=await loadBattleModel(path.resolve('data/metatft-model'));
try{
  const known=id=>model.lookup.unit_encodings[id]!==undefined&&rules.heroes[id];
  const profile=catalog.profiles.find(p=>p.regime.primary==='four-cost'&&p.pairs[0]?.templates[0].poolUnits.length===8),pair=profile.pairs[0];
  const target=pair.templates[0].poolUnits,cores=[pair.carry,pair.tank];
  const workers=Object.keys(catalog.roles).filter(id=>known(id)&&catalog.roles[id].cost<=2&&!target.includes(id)).slice(0,2);
  const board=[...target.filter(id=>!cores.includes(id)),...workers];
  const bench=[...cores,...Object.keys(catalog.roles).filter(id=>known(id)&&!board.includes(id)&&!cores.includes(id)&&catalog.roles[id].cost===4).slice(0,5)];
  const worn=['DA_InfinityEdge','DA_GuinsoosRageblade'].filter(id=>model.lookup.item_encodings[id]!==undefined);
  const unit=(id,area,slot)=>({key:area+':'+slot,id,area,slot,star:area==='board'?2:1,items:id===workers[0]?worn.map((id,index)=>({id,key:'worn:'+index})):[],equipmentKnown:true});
  const state={gold:40,level:8,boardCapacity:8,units:[...board.map((id,i)=>unit(id,'board',i)),...bench.map((id,i)=>unit(id,'bench',i))],offers:[...cores,...bench.slice(2,4)].map((id,slot)=>({id,slot,price:rules.heroes[id].cost})),itemRack:[]};
  const opponents=catalog.profiles.filter(p=>p.pairs[0]?.templates[0].poolUnits.length===8).slice(0,7).map(p=>({units:p.pairs[0].templates[0].poolUnits.map(id=>({id,star:2,items:[]})),augments:[]}));
  const request={round:'4-2',local:{units:state.units.filter(u=>u.area==='board').map(u=>({id:u.id,star:u.star,items:u.items.map(i=>i.id)})),augments:[]},localGaps:[],weightSource:'uniform',targets:opponents.map((board,i)=>({id:'synthetic-'+i,name:'示例对手'+i,weight:1/opponents.length,board,gaps:[]}))};
  const report={fixture:'Synthetic level-8 state; real model inference, no live game',model:model.version,reference:profile.name,levels:[]};
  for(const maxSwaps of [1,2]){
    const before=JSON.stringify(state),start=performance.now();
    const result=await shoppingTactics(state,rules,request,model.predictCachedBatch,{maxSwaps,reference:{cores},supportsBoard:b=>encodeBattleBoard(b,model.lookup,'player').unknown.length===0});
    if(!result.ready)throw Error(result.reason);
    if(JSON.stringify(state)!==before)throw Error('Search mutated the real input');
    for(const choice of result.choices){
      if(choice.goldAfter<0||choice.onBoard.length>8||new Set(choice.onBoardKeys).size!==choice.onBoardKeys.length||choice.onBoardItems.flat().some(id=>!worn.includes(id)))throw Error('Impossible deployment');
      const equipped=choice.onBoard.flatMap((id,i)=>choice.onBoardItems[i].map(item=>[id,item]));
      if(equipped.some(([id])=>id!==workers[0]))throw Error('Worker equipment teleported to a new carry');
      if(choice.id!=='mainline'&&choice.delta< -1e-6)throw Error('No-op baseline was lost');
    }
    report.levels.push({maxSwaps,milliseconds:performance.now()-start,cache:model.cacheMetrics(),...result});
  }
  const [one,two]=report.levels;
  if(two.searchedBoards<=one.searchedBoards||Math.max(...two.choices.filter(c=>c.id!=='mainline').map(c=>c.knownWin))+1e-6<Math.max(...one.choices.filter(c=>c.id!=='mainline').map(c=>c.knownWin)))throw Error('Broader search regressed the observed frontier');
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({fixture:report.fixture,model:report.model,reference:report.reference,levels:report.levels.map(r=>({maxSwaps:r.maxSwaps,milliseconds:Math.round(r.milliseconds),boards:r.searchedBoards,plans:r.searchedPlans,choices:r.choices.map(c=>({title:c.title,delta:c.delta,incoming:c.incoming.map(u=>u.id),outgoing:c.outgoing.map(u=>u.id)}))}))},null,2));
}finally{model.dispose();}
