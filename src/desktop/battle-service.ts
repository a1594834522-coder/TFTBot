import {utilityProcess,type UtilityProcess} from 'electron';
import path from 'node:path';
import type {ReaderStatus} from '../recognition/status';
import {battleRequest,emptyBattleForecast,type BattleForecast,type BattleRequest,type OpponentPrior} from '../game/battle-forecast';
import {shoppingInput,type ShoppingInput} from '../decision/shopping-input';
import {strategicInput,type StrategicInput} from '../decision/strategic-input';
import {directionInput} from '../decision/direction-input';
import type {DirectionInput,DirectionIntent} from '../decision/direction-advisor';
import type {PursuitMode} from '../decision/pursuit-policy';

/** Latest-state-only scheduling. Model work never blocks the native reader or UI event loop. */
export function createBattleService(publish:(forecast:BattleForecast)=>void,diagnostic?:(event:Record<string,unknown>)=>void){
  let child:UtilityProcess|null=null,current=emptyBattleForecast(),disposed=false;
  let request:BattleRequest|null=null,key='',sentKey='',serial=0,pendingId=0;
  let shopping:ShoppingInput={ready:false,reason:'等待商店'};
  let strategy:StrategicInput={ready:false,reason:'等待全场持牌'};
  let direction:DirectionInput|null=null;
  let searchBudget:number|null=null;
  let pursuitMode:PursuitMode='upgrade-first';
  let crashes=0,retryAt=0;
  let timer:ReturnType<typeof setTimeout>|null=null;
  const started=new Map<number,number>();
  const trace=(event:string,data:Record<string,unknown>={})=>{try{diagnostic?.({event,...data});}catch{/* Diagnostics never stop decision updates. */}};
  function set(value:BattleForecast){current=value;publish(structuredClone(current));}
  function refreshing(){
    const old=current.direction;if(!old?.ready)return old;
    const owned=direction?.assets.units??{},shop=direction?.shop??[];
    return {...old,updating:true,owned:{...owned},shop:shop.map(c=>({...c})),holds:{...old.holds,
      cards:old.holds.cards.map(c=>({...c,owned:owned[c.id]??0,shopSlots:[],quantity:0})),
      boards:old.holds.boards.map(b=>({...b,held:b.units.filter(id=>owned[id]>0),missing:b.units.filter(id=>!owned[id])}))}};
  }
  function spawn(){
    if(child||disposed)return;
    const worker=utilityProcess.fork(path.join(__dirname,'battle-worker.cjs'),[],{serviceName:'TFTBot battle model',stdio:'pipe'});child=worker;
    trace('worker-start');
    if(diagnostic)worker.stderr?.on('data',chunk=>trace('worker-stderr',{text:String(chunk).slice(0,16000)}));
    worker.on('message',message=>{
      if(disposed||child!==worker)return;
      if(message?.type==='result')trace('result',{id:message.id,currentId:pendingId,accepted:message.id===pendingId&&sentKey===key,elapsedMs:started.has(message.id)?Date.now()-started.get(message.id)!:null,phase:message.forecast?.phase,
        tactics:message.forecast?.tactics?.ready,pursuit:message.forecast?.pursuit?.ready,pursuitMode:message.forecast?.pursuit?.mode,handoffs:message.forecast?.handoffs?.ready,landings:message.forecast?.landings?.ready});
      else trace('worker-message',{type:message?.type,id:message?.id,message:message?.message,version:message?.version});
      if(message?.type==='result'&&message.id===pendingId&&sentKey===key){crashes=0;retryAt=0;set(message.forecast);}
      else if(message?.type==='error'&&message.id===pendingId&&sentKey===key){set({...emptyBattleForecast(String(message.message)),phase:'error'});}
      else if(message?.type==='load-error'){set({...emptyBattleForecast('胜率模型加载失败：'+message.message),phase:'error',direction:current.direction});}
    });
    worker.on('exit',code=>{
      if(disposed||child!==worker)return;child=null;sentKey='';pendingId=++serial;
      retryAt=Date.now()+[500,2000,10000,30000][Math.min(crashes++,3)];
      trace('worker-exit',{code,retryAt});
      set({...emptyBattleForecast(`计算进程已退出 (${code})，正在恢复`),phase:'error',direction:refreshing()});
      if(!timer&&(request||direction?.assets.localComplete))timer=setTimeout(dispatch,retryAt-Date.now());
    });
  }
  function dispatch(){
    timer=null;if(disposed||!request&&!direction?.assets.localComplete)return;
    if(Date.now()<retryAt){timer=setTimeout(dispatch,retryAt-Date.now());return;}
    spawn();if(!child||key===sentKey)return;
    pendingId=++serial;sentKey=key;started.set(pendingId,Date.now());if(started.size>64)started.delete(started.keys().next().value!);
    trace('dispatch',{id:pendingId,round:request?.round??direction?.round,gold:direction?.assets.gold,budget:searchBudget,pursuitMode,shopReady:shopping.ready,poolReady:strategy.ready});
    set({...emptyBattleForecast('正在计算'),phase:'loading',round:request?.round??direction?.round??null,weightSource:request?.weightSource??'uniform',direction:refreshing()});
    child.postMessage({type:'evaluate',id:pendingId,request,shopping,strategy,direction,searchBudget,pursuitMode});
  }
  return {
    snapshot:()=>structuredClone(current),
    update(status:ReaderStatus,manualItems:string[]=[],budget:number|null=null,intent:DirectionIntent|null=null,mode:PursuitMode='upgrade-first',prior?:OpponentPrior){
      if(disposed)return;
      let next:BattleRequest|null;
      try{next=battleRequest(status,Date.now(),prior);}catch{next=null;}
      shopping=shoppingInput(status);
      strategy=strategicInput(status,shopping);
      direction=directionInput(status,manualItems);
      direction.intent=intent?{key:intent.key,directionId:intent.directionId,units:intent.units?[...intent.units]:undefined}:null;
      searchBudget=budget;
      pursuitMode=mode;
      const nextKey=next||direction.assets.localComplete?JSON.stringify([next,shopping,strategy,direction,searchBudget,pursuitMode]):'';
      if(nextKey===key)return;
      trace('invalidate',{id:pendingId,round:next?.round??direction.round,hasBoard:!!next,localComplete:direction.assets.localComplete});
      key=nextKey;request=next;
      if(!next&&!direction.assets.localComplete){sentKey='';pendingId=++serial;if(timer){clearTimeout(timer);timer=null;}set(emptyBattleForecast());return;}
      // Invalidate visible numbers immediately, even while old inference is still in flight.
      set({...emptyBattleForecast('正在更新局面'),phase:'loading',round:next?.round??direction.round,weightSource:next?.weightSource??'uniform',direction:refreshing()});
      if(!timer)timer=setTimeout(dispatch,120);
    },
    dispose(){disposed=true;if(timer)clearTimeout(timer);timer=null;if(child){const worker=child;child=null;try{worker.postMessage('stop');}catch{worker.kill();}const t=setTimeout(()=>worker.kill(),1500);worker.once('exit',()=>clearTimeout(t));}},
  };
}
