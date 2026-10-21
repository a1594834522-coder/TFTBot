import path from 'node:path';
import {loadBattleModel} from '../decision/battle-model';
import {encodeBattleBoard} from '../game/battle-model-encoding';
import {aggregateBattleForecast,emptyBattleForecast,type BattleRequest} from '../game/battle-forecast';
import {shoppingTactics,mainlineTacticalReference} from '../decision/shopping-tactics';
import {tradingRules,type ShoppingInput} from '../decision/shopping-input';
import {strategicAdvice} from '../decision/strategic-advisor';
import type {StrategicInput} from '../decision/strategic-input';
import type {TransitionLibrary} from '../decision/transition-goals';
import libraryFile from '../../data/metatft-transition-library.json';
import catalogFile from '../../data/metatft-direction-catalog.json';
import gearFile from '../../data/metatft-gear-model.json';
import type {DirectionCatalog} from '../decision/direction-catalog';
import type {GearModel} from '../decision/gear-affinity';
import {directionAdvice,type DirectionInput} from '../decision/direction-advisor';
import {earlyStages} from '../game/metatft-early';
import {directionSearch} from '../decision/direction-search';
import {withSearchHolds} from '../decision/search-holds';
const catalog=catalogFile as unknown as DirectionCatalog,gearModel=gearFile as unknown as GearModel;
function searchAdvice(personal:ReturnType<typeof directionAdvice>,strategy:StrategicInput,budget:number|null){
  if(personal.ready){
    try{personal={...personal,search:directionSearch(personal,strategy,tradingRules,budget)};}
    catch(error){personal={...personal,search:{ready:false,reason:'搜牌目标暂不可用：'+(error as Error).message}};}
  }
  return withSearchHolds(personal);
}

type Work={id:number;request:BattleRequest|null;shopping:ShoppingInput;strategy:StrategicInput;direction:DirectionInput;searchBudget:number|null};
let runtime:Awaited<ReturnType<typeof loadBattleModel>>|null=null,loadError:string|null=null;
let pending:Work|null=null,latest:Work|null=null,latestId=0,running=false;
async function run(){
  if(running)return;
  running=true;
  try{while(pending){
    const {id,request:raw,shopping,strategy,direction,searchBudget}=pending;pending=null;
    const model=runtime;
    let request:BattleRequest|null=null,forecast=emptyBattleForecast();
    if(raw&&model){
      try{
        request={...raw,targets:raw.targets.map(t=>t.board&&encodeBattleBoard(t.board,model.lookup,'opponent').unknown.length?{...t,board:null,gaps:[...t.gaps,'模型特征未覆盖']}:t)};
        const local=encodeBattleBoard(request.local,model.lookup,'player');
        if(local.unknown.length)throw new Error('本方模型特征未覆盖：'+local.unknown.join('、'));
        const valid=request.targets.filter(t=>t.weight>0&&t.board),result=model.predictCachedBatch(valid.map(t=>({player:request!.local,opponent:t.board!})));
        forecast=aggregateBattleForecast(request,Object.fromEntries(valid.map((t,i)=>[t.id,result[i].winRate])),model.version);
      }catch(error){request=null;forecast={...emptyBattleForecast((error as Error).message),phase:'error'};}
    }else if(raw){forecast={...emptyBattleForecast(loadError?'胜率模型加载失败：'+loadError:'胜率模型加载中'),phase:loadError?'error':'loading',round:raw.round,weightSource:raw.weightSource};}
    // A full weighted combat estimate can support an XP path. Missing opponent
    // mass never becomes an optimistic reason to commit to a legendary endgame.
    try{forecast.direction=searchAdvice(directionAdvice({...direction,combatWinRate:forecast.winRate},catalog,gearModel,earlyStages(18)),strategy,searchBudget);}
    catch(error){forecast.direction={ready:false,unsupported:true,reason:'方向计算暂不可用：'+(error as Error).message};}
    forecast.tactics=shopping?.ready?{ready:false,reason:request&&model?'正在搜索当前商店':loadError?'胜率模型不可用，暂停战力比较':'等待可用对战棋盘'}:shopping??{ready:false,reason:'等待金币与实体棋盘'};
    forecast.strategy=strategy?.ready?{ready:false,reason:'正在比较后续路线'}:strategy??{ready:false,reason:'等待全场持牌'};
    process.parentPort?.postMessage({type:'result',id,forecast});
    if(shopping?.ready&&request&&model){
      try{const tactics=await shoppingTactics(shopping.state,tradingRules,request,model.predictCachedBatch,{cancelled:()=>id!==latestId,yield:()=>new Promise(resolve=>setImmediate(resolve)),reference:mainlineTacticalReference(forecast.direction),supportsBoard:board=>encodeBattleBoard(board,model.lookup,'player').unknown.length===0});
        if(id===latestId){forecast={...forecast,tactics:tactics.ready?{...tactics,gaps:[...new Set([...tactics.gaps,...shopping.gaps])]}:tactics};process.parentPort?.postMessage({type:'result',id,forecast});}
      }catch(error){if(id===latestId){forecast={...forecast,tactics:{ready:false,reason:'商店方案暂不可用：'+(error as Error).message}};process.parentPort?.postMessage({type:'result',id,forecast});}}
    }
    if(strategy?.ready&&id===latestId){
      try{const result=await strategicAdvice(strategy,libraryFile as TransitionLibrary,tradingRules,{cancelled:()=>id!==latestId,yield:()=>new Promise(resolve=>setImmediate(resolve))});
        if(id===latestId){forecast={...forecast,strategy:result};process.parentPort?.postMessage({type:'result',id,forecast});}
      }catch(error){if(id===latestId)process.parentPort?.postMessage({type:'result',id,forecast:{...forecast,strategy:{ready:false,reason:'后续路线暂不可用：'+(error as Error).message}}});}
    }
  }}finally{running=false;}
}
process.parentPort?.on('message',event=>{
  const data=event.data;
  if(data==='stop'){runtime?.dispose();process.exit(0);}
  if(data?.type==='evaluate'&&Number.isSafeInteger(data.id)){latestId=data.id;latest={id:data.id,request:data.request,shopping:data.shopping,strategy:data.strategy,direction:data.direction,searchBudget:data.searchBudget??null};pending=latest;void run();}
});
loadBattleModel(path.join(__dirname,'metatft-model')).then(value=>{
  runtime=value;process.parentPort?.postMessage({type:'ready',version:runtime.version});if(latest)pending=latest;void run();
}).catch(error=>{
  loadError=(error as Error).message;process.parentPort?.postMessage({type:'load-error',message:loadError});if(latest)pending=latest;void run();
});
