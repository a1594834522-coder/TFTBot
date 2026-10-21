import {createPoolKernel} from './pool-kernel';
import type {PoolTarget} from './pool-budget';

export interface SearchDistributionInput {
  targets:PoolTarget[];owned:number[];
  goals:Array<{id:string;targets:string[]}>;
  tierRemaining:Record<number,number>;tierOdds:Record<number,number>;
  cash:number;refreshPrice:number;heroSlots:number;
  visible:Array<{id:string;price:number}>;
  maxStates?:number;
  /** Indices in visible, explicitly chosen BEFORE any future shop is known.
   * Undefined keeps the reference auto-purchase rule; [] skips this shop. */
  initialPurchase?:number[];
}
export interface SearchLanding {acquired:number[];cash:number;probability:number;completed:string[]}
export type SearchDistribution={cancelled:true}|{
  cancelled:false;landings:SearchLanding[];unresolved:number;states:number;
  completion:{lower:number;upper:number};expectedCash:{lower:number;upper:number};
  initialBuy:string[];
};
interface FutureStep {code:number;spend:number;probability:number}
/** Per-comparison scratch cache, not a policy/value cache. Every counterfactual
 * retains its own expansion cap and original probability mass. Reuse only the
 * same physical pool and non-clairvoyant future decision transitions. */
export class SearchDistributionCache {
  private pools=new Map<string,ReturnType<typeof createPoolKernel>>();
  private future=new Map<string,Map<string,FutureStep[]>>();
  bind(input:SearchDistributionInput){
    const poolKey=JSON.stringify([input.targets,input.tierRemaining,input.tierOdds]);
    let kernel=this.pools.get(poolKey);if(!kernel){kernel=createPoolKernel(structuredClone(input));this.pools.set(poolKey,kernel);if(this.pools.size>8)this.pools.delete(this.pools.keys().next().value!);}
    const policyKey=JSON.stringify([poolKey,input.owned,input.goals,input.refreshPrice,input.heroSlots]);
    let steps=this.future.get(policyKey);if(!steps){steps=new Map();this.future.set(policyKey,steps);if(this.future.size>16)this.future.delete(this.future.keys().next().value!);}
    return {kernel,steps};
  }
}
/** Forward distribution of ONE declared, non-clairvoyant pursuit policy.
 * Each revealed shop buys a completable upgrade first, then the hero closest
 * to its next upgrade, then declared target order. No future-shop information
 * enters that choice. Stop on any complete core or when cash cannot refresh.
 * All purchases consume cash and physical pool copies. No assumed sales,
 * income, XP, equipment moves or hidden success-only conditioning. */
export async function searchDistribution(input:SearchDistributionInput,options:{cancelled?:()=>boolean;yield?:()=>Promise<void>;cache?:SearchDistributionCache}={}):Promise<SearchDistribution>{
  const {targets}=input,integer=(n:number,min=0)=>Number.isSafeInteger(n)&&n>=min;
  if(!integer(input.cash)||input.cash>200||!integer(input.refreshPrice,1)||!integer(input.heroSlots,1)||input.heroSlots>5||
    input.owned.length!==targets.length||input.owned.some(n=>!integer(n))||!input.goals.length||
    new Set(input.goals.map(g=>g.id)).size!==input.goals.length||input.goals.some(g=>!g.id||!g.targets.length||g.targets.some(id=>!targets.some(t=>t.id===id)))||
    input.visible.some(o=>!integer(o.price))||input.initialPurchase!==undefined&&(!Array.isArray(input.initialPurchase)||new Set(input.initialPurchase).size!==input.initialPurchase.length||input.initialPurchase.some(i=>!integer(i)||i>=input.visible.length)))throw Error('Invalid search-distribution input');
  const cap=input.maxStates??20000;if(!integer(cap,1))throw Error('Invalid search-distribution state limit');
  const bound=options.cache?.bind(input),kernel=bound?.kernel??createPoolKernel(input),byId=new Map(targets.map((t,i)=>[t.id,i]));
  const completed=(code:number)=>{const need=kernel.decode(code);return input.goals.filter(g=>g.targets.every(id=>need[byId.get(id)!]===0)).map(g=>g.id);};
  function purchase(code:number,cash:number,offers:Array<{index:number;price:number}>){
    const left=offers.slice(),bought:string[]=[];let next=code;
    if(completed(code).length)return {code,cash,bought};
    while(left.length){
      const need=kernel.decode(next),available=left.filter(o=>need[o.index]>0&&o.price<=cash);
      if(!available.length)break;
      const rank=(i:number)=>{
        const have=input.owned[i]+targets[i].needed-need[i],gap=have<3?3-have:have<9?3-have%3:1;
        const completing=available.filter(o=>o.index===i).length>=gap&&available.filter(o=>o.index===i).sort((a,b)=>a.price-b.price).slice(0,gap).reduce((n,o)=>n+o.price,0)<=cash;
        return {completing,gap};
      };
      available.sort((a,b)=>Number(rank(b.index).completing)-Number(rank(a.index).completing)||rank(a.index).gap-rank(b.index).gap||a.index-b.index||a.price-b.price);
      const offer=available[0];
      if(targets[offer.index].needed-need[offer.index]>=targets[offer.index].remaining)throw Error('Visible purchase exceeds physical pool');
      cash-=offer.price;next-=kernel.strides[offer.index];bought.push(targets[offer.index].id);left.splice(left.indexOf(offer),1);
      if(completed(next).length)break;
    }
    return {code:next,cash,bought};
  }
  let initial:{code:number;cash:number;bought:string[]};
  if(input.initialPurchase===undefined)initial=purchase(kernel.root,input.cash,input.visible.flatMap(o=>{const index=byId.get(o.id);return index===undefined?[]:[{index,price:o.price}];}));
  else{
    initial={code:kernel.root,cash:input.cash,bought:[]};
    for(const slot of input.initialPurchase){
      const offer=input.visible[slot],index=byId.get(offer.id);
      if(index===undefined||kernel.decode(initial.code)[index]<=0||offer.price>initial.cash||targets[index].needed-kernel.decode(initial.code)[index]>=targets[index].remaining)throw Error('Initial purchase is not an affordable declared target');
      initial.code-=kernel.strides[index];initial.cash-=offer.price;initial.bought.push(offer.id);
    }
  }
  // Money strictly decreases on a refresh. Process by descending cash so all
  // routes to a state are merged before that state is expanded.
  const layers=Array.from({length:input.cash+1},()=>new Map<number,number>());layers[initial.cash].set(initial.code,1);
  const finished=new Map<string,SearchLanding>();let states=0,unresolved=0,unresolvedCash=0;
  function finish(code:number,cash:number,probability:number){
    const key=code+':'+cash,old=finished.get(key);if(old){old.probability+=probability;return;}
    const need=kernel.decode(code);finished.set(key,{acquired:need.map((n,i)=>targets[i].needed-n),cash,probability,completed:completed(code)});
  }
  for(let cash=input.cash;cash>=0;cash--){
    for(const [code,mass]of layers[cash]){
      if(options.cancelled?.())return {cancelled:true};
      if(completed(code).length||cash<input.refreshPrice){finish(code,cash,mass);continue;}
      if(states>=cap){unresolved+=mass;unresolvedCash+=mass*cash;continue;}
      states++;
      // Above the price of an entire revealed shop, extra cash cannot change
      // the purchase decision. Cache SPEND, not absolute resulting cash.
      const decisionCash=Math.min(cash,input.refreshPrice+input.heroSlots*Math.max(0,...targets.map(t=>t.price)));
      const transitionKey=code+':'+decisionCash;let steps=bound?.steps.get(transitionKey);
      if(!steps){
        const combined=new Map<string,FutureStep>();
        for(const draw of kernel.outcomes(code,input.heroSlots)){
          const current=kernel.decode(code),next=kernel.decode(draw.next),offers=current.flatMap((n,i)=>Array.from({length:n-next[i]},()=>({index:i,price:targets[i].price})));
          const after=purchase(code,cash-input.refreshPrice,offers),spend=cash-after.cash,id=after.code+':'+spend,old=combined.get(id);
          if(old)old.probability+=draw.probability;else combined.set(id,{code:after.code,spend,probability:draw.probability});
        }
        steps=[...combined.values()];
        if(bound){bound.steps.set(transitionKey,steps);if(bound.steps.size>16384)bound.steps.delete(bound.steps.keys().next().value!);}
      }
      for(const step of steps){const nextCash=cash-step.spend;layers[nextCash].set(step.code,(layers[nextCash].get(step.code)??0)+mass*step.probability);}
      if(states%64===0)await options.yield?.();
    }
    layers[cash].clear();
  }
  const landings=[...finished.values()],known=landings.reduce((n,l)=>n+l.probability,0);
  if(Math.abs(known+unresolved-1)>1e-7)throw Error('Search landing distribution lost probability mass');
  const completion=landings.reduce((n,l)=>n+(l.completed.length?l.probability:0),0),expectedCash=landings.reduce((n,l)=>n+l.cash*l.probability,0);
  return {cancelled:false,landings,unresolved:Math.max(0,unresolved),states,completion:{lower:completion,upper:Math.min(1,completion+unresolved)},
    expectedCash:{lower:expectedCash,upper:expectedCash+unresolvedCash},initialBuy:initial.bought};
}
