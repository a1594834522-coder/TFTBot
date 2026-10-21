import {utilityProcess,type UtilityProcess} from 'electron';
import path from 'node:path';
import type {ReaderStatus} from '../recognition/status';
import {battleRequest,emptyBattleForecast,type BattleForecast,type BattleRequest} from '../game/battle-forecast';
import {shoppingInput,type ShoppingInput} from '../decision/shopping-input';
import {strategicInput,type StrategicInput} from '../decision/strategic-input';
import {directionInput} from '../decision/direction-input';
import type {DirectionInput,DirectionIntent} from '../decision/direction-advisor';

/** Latest-state-only scheduling. Model work never blocks the native reader or UI event loop. */
export function createBattleService(publish:(forecast:BattleForecast)=>void){
  let child:UtilityProcess|null=null,current=emptyBattleForecast(),disposed=false;
  let request:BattleRequest|null=null,key='',sentKey='',serial=0,pendingId=0;
  let shopping:ShoppingInput={ready:false,reason:'等待商店'};
  let strategy:StrategicInput={ready:false,reason:'等待全场持牌'};
  let direction:DirectionInput|null=null;
  let searchBudget:number|null=null;
  let crashes=0,retryAt=0;
  let timer:ReturnType<typeof setTimeout>|null=null;
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
    worker.on('message',message=>{
      if(disposed||child!==worker)return;
      if(message?.type==='result'&&message.id===pendingId&&sentKey===key){crashes=0;retryAt=0;set(message.forecast);}
      else if(message?.type==='error'&&message.id===pendingId&&sentKey===key){set({...emptyBattleForecast(String(message.message)),phase:'error'});}
      else if(message?.type==='load-error'){set({...emptyBattleForecast('胜率模型加载失败：'+message.message),phase:'error',direction:current.direction});}
    });
    worker.on('exit',code=>{
      if(disposed||child!==worker)return;child=null;sentKey='';pendingId=++serial;
      retryAt=Date.now()+[500,2000,10000,30000][Math.min(crashes++,3)];
      set({...emptyBattleForecast(`计算进程已退出 (${code})，正在恢复`),phase:'error',direction:refreshing()});
      if(!timer&&(request||direction?.assets.localComplete))timer=setTimeout(dispatch,retryAt-Date.now());
    });
  }
  function dispatch(){
    timer=null;if(disposed||!request&&!direction?.assets.localComplete)return;
    if(Date.now()<retryAt){timer=setTimeout(dispatch,retryAt-Date.now());return;}
    spawn();if(!child||key===sentKey)return;
    pendingId=++serial;sentKey=key;
    set({...emptyBattleForecast('正在计算'),phase:'loading',round:request?.round??direction?.round??null,weightSource:request?.weightSource??'uniform',direction:refreshing()});
    child.postMessage({type:'evaluate',id:pendingId,request,shopping,strategy,direction,searchBudget});
  }
  return {
    snapshot:()=>structuredClone(current),
    update(status:ReaderStatus,manualItems:string[]=[],budget:number|null=null,intent:DirectionIntent|null=null){
      if(disposed)return;
      let next:BattleRequest|null;
      try{next=battleRequest(status);}catch{next=null;}
      shopping=shoppingInput(status);
      strategy=strategicInput(status,shopping);
      direction=directionInput(status,manualItems);
      direction.intent=intent;
      searchBudget=budget;
      const nextKey=next||direction.assets.localComplete?JSON.stringify([next,shopping,strategy,direction,searchBudget]):'';
      if(nextKey===key)return;
      key=nextKey;request=next;
      if(!next&&!direction.assets.localComplete){sentKey='';pendingId=++serial;if(timer){clearTimeout(timer);timer=null;}set(emptyBattleForecast());return;}
      // Invalidate visible numbers immediately, even while old inference is still in flight.
      set({...emptyBattleForecast('正在更新局面'),phase:'loading',round:next?.round??direction.round,weightSource:next?.weightSource??'uniform',direction:refreshing()});
      if(!timer)timer=setTimeout(dispatch,120);
    },
    dispose(){disposed=true;if(timer)clearTimeout(timer);timer=null;if(child){const worker=child;child=null;try{worker.postMessage('stop');}catch{worker.kill();}const t=setTimeout(()=>worker.kill(),1500);worker.once('exit',()=>clearTimeout(t));}},
  };
}
