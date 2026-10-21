import {createPoolKernel} from './pool-kernel';
import type {PoolTarget} from './pool-budget';
export interface UpgradeRaceInput {
  /** The first core copies are already retained OUTSIDE this pool. Only the
   * remaining one/two purchases needed to reach two stars belong to targets. */
  targets:PoolTarget[];tierRemaining:Record<number,number>;tierOdds:Record<number,number>;
  refreshPrice:number;heroSlotsCycle:number[];maxStates?:number;
}
/** Exact committed-route race: reach ANY one key 2-star. Unmerged extra first
 * copies may be sold at their purchase price before a refresh, or after seeing
 * its shop to fund another core's upgrade. The first retained core copy is never
 * sold. No 2-star resale rule is needed: the process ends at its first upgrade.
 * This makes the practical intermediate milestone distinct from BOTH cores 2*. */
export function createUpgradeRace(input:UpgradeRaceInput){
  const {targets,heroSlotsCycle:cycle}=input,cap=input.maxStates??100000;
  if(!targets.length||targets.length>4||targets.some(t=>t.needed>2)||!Number.isSafeInteger(input.refreshPrice)||input.refreshPrice<1||!cycle.length||cycle.length>4||cycle.some(s=>!Number.isInteger(s)||s<1||s>5))throw Error('Invalid upgrade race');
  const kernel=createPoolKernel(input),{root,strides,decode}=kernel,memo=new Map<string,number>();let states=0;
  function sales(code:number){
    const left=decode(code),options:Array<{code:number;refund:number}>=[{code,refund:0}];
    targets.forEach((target,i)=>{
      // Nonterminal states have acquired at most ONE unmerged additional copy.
      const acquired=target.needed-left[i];if(acquired!==1)return;
      for(const old of options.slice())options.push({code:old.code+strides[i],refund:old.refund+target.price});
    });return options;
  }
  function value(code:number,cash:number,phase:number):number{
    const left=decode(code);if(left.some(n=>n===0))return 1;
    const key=code+':'+cash+':'+phase,hit=memo.get(key);if(hit!==undefined)return hit;
    if(++states>cap)throw Error('Upgrade race state budget exceeded');
    let best=0;
    // Every recursive call follows a PAID refresh. Cash + refundable extra-copy
    // value therefore falls strictly, even when an optional copy is liquidated.
    for(const before of sales(code)){
      const after=cash+before.refund-input.refreshPrice;if(after<0)continue;
      const prior=decode(before.code);let expected=0;
      for(const draw of kernel.outcomes(before.code,cycle[phase])){
        const all=decode(draw.next),offered=prior.map((n,i)=>n-all[i]);let shopBest=0;
        for(const retained of sales(before.code)){
          const needs=decode(retained.code),money=after+retained.refund;
          function buy(index:number,next:number,spent:number){
            if(spent>money)return;
            if(index===targets.length){shopBest=Math.max(shopBest,value(next,money-spent,(phase+1)%cycle.length));return;}
            for(let count=0;count<=Math.min(offered[index],needs[index]);count++)buy(index+1,next-count*strides[index],spent+count*targets[index].price);
          }
          buy(0,retained.code,0);if(shopBest===1)break;
        }
        expected+=draw.probability*shopBest;
      }
      best=Math.max(best,expected);if(best>=1-1e-12){best=1;break;}
    }
    memo.set(key,best);return best;
  }
  return {probability:(budget:number)=>{
    if(!Number.isSafeInteger(budget)||budget<0||budget>500)throw Error('Invalid upgrade budget');
    return value(root,budget,0);
  },get states(){return states;},get transitions(){return kernel.transitionCount;}};
}
