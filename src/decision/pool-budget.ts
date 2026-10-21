import {createPoolKernel} from './pool-kernel';
/** Exact fixed-level, fixed-opponent-pool completion model. Cost rolls are independent;
 * cards of a cost are physical draws without replacement WITHIN a shop. Unbought
 * cards return before the next refresh; purchased cards remain removed. */
export interface PoolTarget {id:string;cost:number;needed:number;remaining:number;price:number}
export interface PoolStorage {
  /** Board + bench capacity. Existing non-targets are retained, never silently sold. */
  capacity:number;fixedUnits:number;
  /** Canonical, normally merged copies; special merge/equipment rules belong to the caller. */
  owned:Record<string,{copies:number;maxStar:1|2|3|4}>;
}
export interface PoolBudgetInput {
  targets:PoolTarget[];
  tierRemaining:Record<number,number>;
  tierOdds:Record<number,number>;
  budget:number;
  refreshPrice:number;
  /** Explicit schedule, e.g. [5,4] when every second shop contains a wisp. */
  heroSlotsCycle:number[];
  maxShops?:number;
  storage?:PoolStorage;
}
export interface PoolBudgetResult {
  probability:number;purchaseGold:number;maxPaidShops:number;limitedByShopCap:boolean;
  cdf:number[];gold50:number|null;gold80:number|null;gold90:number|null;
  /** Censored lower bound on refresh expenditure until success, not a guaranteed total price. */
  refreshGoldLowerBound:number;
  states:number;transitions:number;reason:string|null;
  storageConstrained:boolean;
}
const integer=(n:number,min=0)=>Number.isSafeInteger(n)&&n>=min;

export function poolBudget(input:PoolBudgetInput):PoolBudgetResult {
  const targets=input.targets,cycle=input.heroSlotsCycle,cap=input.maxShops??80;
  if(!integer(input.budget)||!integer(input.refreshPrice,1)||!integer(cap)||cap>100||!cycle.length||cycle.length>4||cycle.some(s=>!integer(s,1)||s>5)||targets.length>12||new Set(targets.map(t=>t.id)).size!==targets.length)throw new Error('Invalid pool-budget input');
  const purchaseGold=targets.reduce((n,t)=>n+t.needed*t.price,0),possibleShops=Math.max(0,Math.floor((input.budget-purchaseGold)/input.refreshPrice));
  const maxPaidShops=Math.min(cap,possibleShops),kernel=createPoolKernel(input);
  const {size,root,strides,decode,outcomes}=kernel;
  const base:PoolBudgetResult={probability:0,purchaseGold,maxPaidShops,limitedByShopCap:possibleShops>cap,cdf:[],gold50:null,gold80:null,gold90:null,refreshGoldLowerBound:0,states:0,transitions:0,reason:null,storageConstrained:!!input.storage};
  function finish(cdf:number[]):PoolBudgetResult{
    const quantile=(p:number)=>{const index=cdf.findIndex(v=>v>=p);return index<0?null:purchaseGold+index*input.refreshPrice;};
    return {...base,transitions:kernel.transitionCount,probability:cdf.at(-1)??0,cdf,gold50:quantile(.5),gold80:quantile(.8),gold90:quantile(.9),refreshGoldLowerBound:input.refreshPrice*cdf.slice(0,-1).reduce((sum,p)=>sum+1-p,0)};
  }
  const storage=input.storage;
  function entityCount(copies:number,maxStar:number){let entities=0;for(let star=1;star<maxStar;star++){entities+=copies%3;copies=Math.floor(copies/3);}return entities+copies;}
  if(storage){
    if(!integer(storage.capacity)||storage.capacity>40||!integer(storage.fixedUnits)||storage.fixedUnits>storage.capacity||Object.keys(storage.owned).length!==targets.length||targets.some(t=>!storage.owned[t.id]||!integer(storage.owned[t.id].copies)||storage.owned[t.id].copies>81||![1,2,3,4].includes(storage.owned[t.id].maxStar)))throw new Error('Invalid canonical storage');
    if(storage.fixedUnits+targets.reduce((n,t)=>n+entityCount(storage.owned[t.id].copies,storage.owned[t.id].maxStar),0)>storage.capacity)throw new Error('Initial storage exceeds capacity');
    if(storage.fixedUnits+targets.reduce((n,t)=>n+entityCount(storage.owned[t.id].copies+t.needed,storage.owned[t.id].maxStar),0)>storage.capacity){base.reason='保留现有非目标牌时，目标完成后仍无足够位置';return finish(Array(maxPaidShops+1).fill(0));}
  }
  if(!root)return finish(Array(maxPaidShops+1).fill(1));
  if(purchaseGold>input.budget){base.reason='预算不足以支付全部目标的购买费';return finish(Array(maxPaidShops+1).fill(0));}
  if(targets.some(t=>t.remaining<t.needed)){base.reason='当前已知牌池不足以补齐全部目标';return finish(Array(maxPaidShops+1).fill(0));}
  if(targets.some(t=>t.needed>0&&input.tierOdds[t.cost]===0)){base.reason='当前等级存在刷不到的目标费用';return finish(Array(maxPaidShops+1).fill(0));}
  const purchaseChoices=new Map<string,number[]>();
  function choices(code:number,allBought:number):number[]{
    if(!storage)return [allBought];
    const key=code+':'+allBought,cached=purchaseChoices.get(key);if(cached)return cached;
    const limit=decode(allBought),seen=new Set<number>([code]),queue=[code];
    // Explore physical purchase orders, not just final occupied slots. Buying a third
    // copy may merge immediately even when no temporary slot is free.
    for(let cursor=0;cursor<queue.length;cursor++){
      const current=queue[cursor],left=decode(current);
      for(let i=0;i<targets.length;i++)if(left[i]>limit[i]){
        const next=current-strides[i];if(seen.has(next))continue;
        const needs=decode(next),occupied=storage.fixedUnits+targets.reduce((n,t,j)=>n+entityCount(storage.owned[t.id].copies+t.needed-needs[j],storage.owned[t.id].maxStar),0);
        if(occupied<=storage.capacity){seen.add(next);queue.push(next);}
      }
    }
    purchaseChoices.set(key,queue);return queue;
  }
  const memo=new Float64Array((maxPaidShops+1)*size*cycle.length);memo.fill(NaN);
  function probability(shops:number,code:number,phase:number):number{
    if(!code)return 1;if(!shops)return 0;
    const key=(shops*cycle.length+phase)*size+code,hit=memo[key];if(!Number.isNaN(hit))return hit;
    const value=outcomes(code,cycle[phase]).reduce((sum,e)=>{
      let best=0;
      // Decisions depend on the revealed shop only, never future cards. Different
      // horizons may have different optimal policies; CDF entries optimize their own horizon.
      for(const next of choices(code,e.next)){best=Math.max(best,probability(shops-1,next,(phase+1)%cycle.length));if(best===1)break;}
      return sum+e.probability*best;
    },0);
    base.states++;memo[key]=Math.min(1,Math.max(0,value));return memo[key];
  }
  const cdf=Array.from({length:maxPaidShops+1},(_,shops)=>probability(shops,root,0));
  return finish(cdf);
}
