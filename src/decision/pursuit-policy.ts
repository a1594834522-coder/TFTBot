import type {createPoolKernel} from './pool-kernel';
import type {PoolTarget} from './pool-budget';
export type PursuitMode='upgrade-first'|'completion-first'|'key-upgrade';
export interface PursuitPolicyInput {
  targets:PoolTarget[];owned:number[];goals:Array<{id:string;targets:string[]}>;
  tierRemaining:Record<number,number>;tierOdds:Record<number,number>;refreshPrice:number;heroSlots:number;
}
export interface PursuitOffer {index:number;price:number}
export interface PursuitPurchase {code:number;cash:number;bought:string[]}
export interface PursuitPolicy {
  signature:string;
  buy:(code:number,cash:number,offers:PursuitOffer[])=>PursuitPurchase;
  refresh:(code:number,cash:number)=>boolean;
}
export const pursuitSignature=(input:PursuitPolicyInput)=>JSON.stringify([input.targets,input.owned,input.goals,input.tierRemaining,input.tierOdds,input.refreshPrice,input.heroSlots]);
/** Existing observable-shop rule, shared by the forward distribution and the
 * adaptive comparator. A policy cannot improve by silently changing its base. */
export function referencePursuit(input:PursuitPolicyInput,kernel:ReturnType<typeof createPoolKernel>){
  const {targets}=input,byId=new Map(targets.map((t,i)=>[t.id,i]));
  const completed=(code:number)=>{const need=kernel.decode(code);return input.goals.filter(g=>g.targets.every(id=>need[byId.get(id)!]===0)).map(g=>g.id);};
  function buy(code:number,cash:number,offers:PursuitOffer[]):PursuitPurchase{
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
  return {completed,buy};
}
