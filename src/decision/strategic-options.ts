import {poolBudget,type PoolBudgetInput,type PoolBudgetResult} from './pool-budget';
import {enumerateShoppingPlans,trade,validateShopState,type ShopState,type TradingRules,type TradeAction} from './shop-ledger';

/** Explicit copy requirements. Collecting one copy is NOT a completed combat build. */
export interface StrategicGoal {id:string;targets:Array<{id:string;copies:number}>}
export interface StrategicPool {
  complete:boolean;remaining:Record<string,number>;tierRemaining:Record<number,number>;
  tierOdds:Record<number,number>;heroSlotsCycle:number[];refreshPrice:number;
}
export interface StrategicChoice {
  actions:TradeAction[];buySlots:number[];goldAfter:number;
  completion:PoolBudgetResult;
  spendNow:number;totalGold50:number|null;totalGold80:number|null;totalGold90:number|null;
}
export interface RetentionValue {
  key:string;id:string;star:number;sellGold:number;
  keepProbability:number;sellProbability:number;delta:number;
}
export type StrategicOption={id:string;ready:false;reason:string}|{
  id:string;ready:true;reserveGold:number;choice:StrategicChoice;
  baseline:PoolBudgetResult;retention:RetentionValue[];
};
const copies=(state:ShopState)=>{
  const counts:Record<string,number>={};for(const u of state.units)counts[u.id]=(counts[u.id]??0)+3**(u.star-1);return counts;
};
const canonicalEntities=(copies:number,maxStar:number)=>{let n=0;for(let star=1;star<maxStar;star++){n+=copies%3;copies=Math.floor(copies/3);}return n+copies;};

/** Counterfactual future option value, not a combined final-placement policy.
 * It compares legal current purchases and one bench sale, then optimizes future
 * target purchases under fixed level, pool, reserve and normal merge/storage rules.
 * No arbitrary gold-to-victory conversion or causal use of observed route outcomes. */
export async function strategicOptions(state:ShopState,rules:TradingRules,goals:StrategicGoal[],pool:StrategicPool,options:{reserveGold:number;currentCashFloor?:number;modelStorage?:boolean;retention?:boolean;maxShops?:number;cancelled?:()=>boolean;yield?:()=>Promise<void>}):Promise<StrategicOption[]>{
  validateShopState(state,rules);
  if(!Number.isSafeInteger(options.reserveGold)||options.reserveGold<0||options.reserveGold>state.gold)throw new Error('Invalid strategic cash reserve');
  const currentCashFloor=options.currentCashFloor??options.reserveGold;
  if(!Number.isSafeInteger(currentCashFloor)||currentCashFloor<options.reserveGold||currentCashFloor>state.gold)throw new Error('Invalid current cash floor');
  if(new Set(goals.map(g=>g.id)).size!==goals.length)throw new Error('Duplicate strategic goal');
  if(!pool.complete)return goals.map(g=>({id:g.id,ready:false,reason:'全场持牌未齐，暂不计算联合搜牌概率'}));
  const original=copies(state),memo=new Map<string,PoolBudgetResult>();
  const initialPlans=enumerateShoppingPlans(state,rules,{sellCandidates:[]}).plans;
  const sales=options.retention?state.units.filter(u=>u.area==='bench').flatMap(unit=>{
    const sold=trade(state,{type:'sell',key:unit.key},rules);return sold.ok?[{unit,state:sold.state,plans:enumerateShoppingPlans(sold.state,rules,{sellCandidates:[]}).plans}]:[];
  }):[];
  function evaluate(after:ShopState,goal:StrategicGoal):PoolBudgetResult{
    const owned=copies(after),tierRemaining={...pool.tierRemaining},remaining={...pool.remaining};
    for(const id of new Set([...Object.keys(original),...Object.keys(owned)])){
      const delta=(owned[id]??0)-(original[id]??0),hero=rules.heroes[id];
      if(delta){if(!Number.isSafeInteger(remaining[id]))throw new Error('英雄牌池明细未齐');remaining[id]-=delta;tierRemaining[hero.cost]-=delta;}
    }
    const active=goal.targets.filter(t=>t.copies>(owned[t.id]??0));
    const targetIds=new Set(active.map(t=>t.id));
    const targets=active.map(target=>{
      const hero=rules.heroes[target.id],physical=after.units.filter(u=>u.id===target.id),have=owned[target.id]??0;
      if(!hero||!Number.isSafeInteger(remaining[target.id])||remaining[target.id]<0)throw new Error('目标英雄或剩余牌池待核对');
      if(canonicalEntities(have,hero.maxStar)!==physical.length)throw new Error('等待目标英雄合成同步');
      // Newly bought copies carry no gear. More than one existing geared source,
      // or unknown gear, requires rules not established by this normal-merge model.
      if(target.copies>have&&target.copies>=3&&(physical.some(u=>u.equipmentKnown===false)||physical.filter(u=>u.items.length>0).length>1))throw new Error('目标升星的装备合并规则待核对');
      return {id:target.id,cost:hero.cost,needed:target.copies-have,remaining:remaining[target.id],price:hero.cost};
    });
    const input:PoolBudgetInput={targets,tierRemaining,tierOdds:pool.tierOdds,budget:after.gold-options.reserveGold,refreshPrice:pool.refreshPrice,heroSlotsCycle:pool.heroSlotsCycle,maxShops:options.maxShops,
      storage:options.modelStorage?{capacity:after.boardCapacity+rules.benchCapacity,fixedUnits:after.units.filter(u=>!targetIds.has(u.id)).length,owned:Object.fromEntries(active.map(t=>[t.id,{copies:owned[t.id]??0,maxStar:rules.heroes[t.id].maxStar as 1|2|3|4}]))}:undefined};
    const key=JSON.stringify(input);let result=memo.get(key);if(!result){result=poolBudget(input);memo.set(key,result);}return result;
  }
  function best(plans:typeof initialPlans,goal:StrategicGoal):StrategicChoice{
    let best:StrategicChoice|undefined;
    for(const plan of plans){
      if(plan.state.gold<currentCashFloor)continue;
      const completion=evaluate(plan.state,goal),spendNow=plan.buySlots.reduce((sum,slot)=>sum+state.offers[slot]!.price,0),total=(n:number|null)=>n===null?null:n+spendNow;
      const candidate={actions:plan.actions,buySlots:plan.buySlots,goldAfter:plan.state.gold,completion,spendNow,totalGold50:total(completion.gold50),totalGold80:total(completion.gold80),totalGold90:total(completion.gold90)};
      if(!best||completion.probability>best.completion.probability+1e-12||Math.abs(completion.probability-best.completion.probability)<=1e-12&&(candidate.goldAfter>best.goldAfter||candidate.goldAfter===best.goldAfter&&candidate.actions.length<best.actions.length))best=candidate;
    }
    if(!best)throw new Error('No reserve-preserving current plan');return best;
  }
  const results:StrategicOption[]=[];
  for(const goal of goals){
    if(options.cancelled?.())return results;
    try{
      if(!goal.id||!goal.targets.length||new Set(goal.targets.map(t=>t.id)).size!==goal.targets.length||goal.targets.some(t=>!rules.heroes[t.id]||!Number.isSafeInteger(t.copies)||t.copies<1||t.copies>9))throw new Error('目标必须声明唯一英雄及 1–9 张需求');
      const baseline=evaluate(state,goal),choice=best(initialPlans,goal),retention:RetentionValue[]=[];
      for(const sale of sales){
        // A sale is an explicit comparison, never an instruction or a hidden refund.
        const sold=best(sale.plans,goal);
        retention.push({key:sale.unit.key,id:sale.unit.id,star:sale.unit.star,sellGold:sale.state.gold-state.gold,keepProbability:choice.completion.probability,sellProbability:sold.completion.probability,delta:choice.completion.probability-sold.completion.probability});
      }
      results.push({id:goal.id,ready:true,reserveGold:options.reserveGold,baseline,choice,retention});
    }catch(error){results.push({id:goal.id,ready:false,reason:(error as Error).message});}
    await options.yield?.();
  }
  return results;
}
