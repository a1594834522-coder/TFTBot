import {createPoolKernel} from './pool-kernel';
import type {PoolTarget} from './pool-budget';

export interface SearchDistributionInput {
  targets:PoolTarget[];owned:number[];
  goals:Array<{id:string;targets:string[]}>;
  tierRemaining:Record<number,number>;tierOdds:Record<number,number>;
  cash:number;refreshPrice:number;heroSlots:number;
  visible:Array<{id:string;price:number}>;
  maxStates?:number;
}
export interface SearchLanding {acquired:number[];cash:number;probability:number;completed:string[]}
export type SearchDistribution={cancelled:true}|{
  cancelled:false;landings:SearchLanding[];unresolved:number;states:number;
  completion:{lower:number;upper:number};expectedCash:{lower:number;upper:number};
  initialBuy:string[];
};
/** Forward distribution of ONE declared, non-clairvoyant pursuit policy.
 * Each revealed shop buys a completable upgrade first, then the hero closest
 * to its next upgrade, then declared target order. No future-shop information
 * enters that choice. Stop on any complete core or when cash cannot refresh.
 * All purchases consume cash and physical pool copies. No assumed sales,
 * income, XP, equipment moves or hidden success-only conditioning. */
export async function searchDistribution(input:SearchDistributionInput,options:{cancelled?:()=>boolean;yield?:()=>Promise<void>}={}):Promise<SearchDistribution>{
  const {targets}=input,integer=(n:number,min=0)=>Number.isSafeInteger(n)&&n>=min;
  if(!integer(input.cash)||input.cash>200||!integer(input.refreshPrice,1)||!integer(input.heroSlots,1)||input.heroSlots>5||
    input.owned.length!==targets.length||input.owned.some(n=>!integer(n))||!input.goals.length||
    new Set(input.goals.map(g=>g.id)).size!==input.goals.length||input.goals.some(g=>!g.id||!g.targets.length||g.targets.some(id=>!targets.some(t=>t.id===id)))||
    input.visible.some(o=>!integer(o.price)))throw Error('Invalid search-distribution input');
  const cap=input.maxStates??20000;if(!integer(cap,1))throw Error('Invalid search-distribution state limit');
  const kernel=createPoolKernel(input),byId=new Map(targets.map((t,i)=>[t.id,i]));
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
      const offer=available[0];cash-=offer.price;next-=kernel.strides[offer.index];bought.push(targets[offer.index].id);left.splice(left.indexOf(offer),1);
      if(completed(next).length)break;
    }
    return {code:next,cash,bought};
  }
  const initial=purchase(kernel.root,input.cash,input.visible.flatMap(o=>{const index=byId.get(o.id);return index===undefined?[]:[{index,price:o.price}];}));
  // Money strictly decreases on a refresh. Process by descending cash so all
  // routes to a state are merged before that state is expanded.
  const layers=Array.from({length:input.cash+1},()=>new Map<number,number>());layers[initial.cash].set(initial.code,1);
  const finished=new Map<string,SearchLanding>();let states=0,unresolved=0;
  function finish(code:number,cash:number,probability:number){
    const key=code+':'+cash,old=finished.get(key);if(old){old.probability+=probability;return;}
    const need=kernel.decode(code);finished.set(key,{acquired:need.map((n,i)=>targets[i].needed-n),cash,probability,completed:completed(code)});
  }
  for(let cash=input.cash;cash>=0;cash--){
    for(const [code,mass]of layers[cash]){
      if(options.cancelled?.())return {cancelled:true};
      if(completed(code).length||cash<input.refreshPrice){finish(code,cash,mass);continue;}
      if(states>=cap){unresolved+=mass;continue;}
      states++;
      for(const draw of kernel.outcomes(code,input.heroSlots)){
        const current=kernel.decode(code),next=kernel.decode(draw.next),offers=current.flatMap((n,i)=>Array.from({length:n-next[i]},()=>({index:i,price:targets[i].price})));
        const after=purchase(code,cash-input.refreshPrice,offers),chance=mass*draw.probability;
        layers[after.cash].set(after.code,(layers[after.cash].get(after.code)??0)+chance);
      }
      if(states%64===0)await options.yield?.();
    }
    layers[cash].clear();
  }
  const landings=[...finished.values()],known=landings.reduce((n,l)=>n+l.probability,0);
  if(Math.abs(known+unresolved-1)>1e-7)throw Error('Search landing distribution lost probability mass');
  const completion=landings.reduce((n,l)=>n+(l.completed.length?l.probability:0),0),expectedCash=landings.reduce((n,l)=>n+l.cash*l.probability,0);
  return {cancelled:false,landings,unresolved:Math.max(0,unresolved),states,completion:{lower:completion,upper:Math.min(1,completion+unresolved)},
    expectedCash:{lower:expectedCash,upper:expectedCash+unresolved*input.cash},initialBuy:initial.bought};
}
