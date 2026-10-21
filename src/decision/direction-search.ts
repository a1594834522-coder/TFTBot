import type {DirectionAdvice,DirectionRow} from './direction-advisor';
import type {StrategicInput} from './strategic-input';
import {poolBudget,type PoolBudgetResult} from './pool-budget';
import {flexPool,type FlexPoolResult} from './flex-pool';
import {unitCopyCounts,type TradingRules} from './shop-ledger';
import {createUpgradeRace} from './upgrade-race';
export interface SearchMilestone {id:string;name:string;targets:Array<{id:string;copies:number;owned:number}>;buyNow:string[];probability:number;optimisticProbability:number;gold50:number|null;gold80:number|null;reason:string|null}
export type DirectionSearch={ready:false;reason:string}|{
  ready:true;phase:'reroll'|'flex'|'upgrade'|'reinforce';level:number;budget:number;
  goals:SearchMilestone[];portfolio?:FlexPoolResult;optimisticProbability?:number;
  upgradePortfolio?:FlexPoolResult;optimisticUpgradeProbability?:number;
  keyUpgradePortfolio?:FlexPoolResult;optimisticKeyUpgradeProbability?:number;
  gaps:string[];
};
function fixedGoal(row:DirectionRow,targets:Array<{id:string;copies:number}>,input:Extract<StrategicInput,{ready:true}>,rules:TradingRules):SearchMilestone{
  const {state,pool}=input,owned=unitCopyCounts(state.units),remaining={...pool.remaining},totals={...pool.tierRemaining},counts={...owned},buyNow:string[]=[];
  let spent=0;
  // The visible shop is evidence, not another paid random draw. Purchases are
  // included in the declared wallet, and removed from the future physical pool.
  for(const target of targets)for(const offer of state.offers){if(!offer||offer.id!==target.id||(counts[target.id]??0)>=target.copies)continue;
    if(spent+offer.price>state.gold)continue;spent+=offer.price;buyNow.push(offer.id);counts[target.id]=(counts[target.id]??0)+1;remaining[target.id]--;totals[rules.heroes[target.id].cost]--;}
  const request={targets:targets.map(t=>({id:t.id,cost:rules.heroes[t.id].cost,needed:Math.max(0,t.copies-(counts[t.id]??0)),remaining:remaining[t.id],price:rules.heroes[t.id].cost})),
    tierRemaining:totals,tierOdds:pool.tierOdds,budget:state.gold-spent,refreshPrice:pool.refreshPrice,heroSlotsCycle:[4]};
  const low=poolBudget(request),high=poolBudget({...request,heroSlotsCycle:[5]});
  return {id:row.id+':'+targets.map(t=>t.id+'-'+t.copies).join('|'),name:row.name,targets:targets.map(t=>({...t,owned:owned[t.id]??0})),buyNow,
    probability:low.probability,optimisticProbability:high.probability,gold50:low.gold50===null?null:spent+low.gold50,gold80:low.gold80===null?null:spent+low.gold80,reason:low.reason};
}
/** Different search objectives by strategy: reroll copies, an adaptive first-core
 * portfolio, then upgrades. This is a fixed-level/wallet calculation; no future
 * income, XP or inferred combat value is hidden in a completion probability. */
export function directionSearch(advice:DirectionAdvice,input:StrategicInput,rules:TradingRules,budget:number|null=null):DirectionSearch{
  if(budget!==null&&(!Number.isSafeInteger(budget)||budget<0||budget>200))return {ready:false,reason:'搜牌预算无效'};
  if(!advice.ready)return {ready:false,reason:advice.reason};
  if(!input.ready)return {ready:false,reason:input.reason};
  if(budget!==null)input={...input,state:{...input.state,gold:Math.min(input.state.gold,budget)}};
  const {state,pool}=input,owned=unitCopyCounts(state.units),gaps=[...input.gaps,'概率仅指目标补齐，不是战斗胜率；按当前人口和现有金币，不含未来收入'];
  if(advice.regime==='reroll'&&advice.mode==='selected'){
    const row=advice.rows[0];if(!row)return {ready:false,reason:'等待赌狗核心'};
    if((owned[row.carry]??0)>=9){
      const goals=(owned[row.tank]??0)<3?[fixedGoal(row,[{id:row.tank,copies:3}],input,rules)]:[];
      return {ready:true,phase:'reinforce',level:state.level,budget:state.gold,goals,gaps};
    }
    const goals=[fixedGoal(row,[{id:row.carry,copies:9}],input,rules)];
    if(row.tank!==row.carry)goals.push(fixedGoal(row,[{id:row.carry,copies:9},{id:row.tank,copies:3}],input,rules));
    return {ready:true,phase:'reroll',level:state.level,budget:state.gold,goals,gaps};
  }
  if(input.stage<4||state.level<7)return {ready:false,reason:'选择参考阵容后查看追牌，启动阶段可比较多路线'};
  const rows=advice.rows.filter(r=>r.regime!=='reroll').slice(0,3);
  if(!rows.length)return {ready:false,reason:'等待可用启动路线'};
  if(advice.mode==='selected'){
    // Explicit commitment must not disappear merely because another route has
    // its first copies. Compare separate two-star targets, without presenting
    // this fixed-route comparison as an adaptive portfolio probability.
    const focused=rows.find(r=>r.id===advice.focusId)??rows[0];
    const ordered=[focused,...rows.filter(r=>r!==focused)];
    return {ready:true,phase:owned[focused.carry]&&owned[focused.tank]?'upgrade':'flex',level:state.level,budget:state.gold,
      goals:ordered.map(row=>fixedGoal(row,[{id:row.carry,copies:3},{id:row.tank,copies:3}],input,rules)),
      gaps:[...gaps,'已选方向优先，备选分别计算双核二星；这些单路线概率不能相加']};
  }
  const complete=rows.filter(row=>owned[row.carry]&&owned[row.tank]);
  if(complete.length){
    const goals=complete.map(row=>fixedGoal(row,[{id:row.carry,copies:3},{id:row.tank,copies:3}],input,rules));
    return {ready:true,phase:'upgrade',level:state.level,budget:state.gold,goals,gaps};
  }
  const goalIds=[...new Set(rows.flatMap(r=>[r.carry,r.tank]))],protectedIds=new Set<string>(),held:string[]=[];
  for(const id of goalIds){
    const entities=state.units.filter(u=>u.id===id);if(!entities.length)continue;
    const cost=rules.heroes[id]?.cost;
    if(entities.length===1&&entities[0].area==='bench'&&entities[0].star===1&&entities[0].items.length===0&&entities[0].equipmentKnown!==false&&rules.heroes[id]?.sellValues[1]===cost)held.push(id);
    else protectedIds.add(id);
  }
  const missingIds=goalIds.filter(id=>!protectedIds.has(id)),totals={...pool.tierRemaining};
  const cards=missingIds.map(id=>{
    const cost=rules.heroes[id].cost,add=Number(held.includes(id));totals[cost]+=add;
    return {id,cost,remaining:pool.remaining[id]+add,price:cost,resale:rules.heroes[id].sellValues[1]};
  });
  const goals=rows.map(row=>({id:row.id,units:[row.carry,row.tank].filter(id=>!protectedIds.has(id))}));
  const request={cards,goals,tierRemaining:totals,tierOdds:pool.tierOdds,held,visible:state.offers.flatMap(o=>o&&missingIds.includes(o.id)?[o.id]:[]),cash:state.gold,
    refreshPrice:pool.refreshPrice,heroSlotsCycle:[4],maxStates:60000};
  try{
    const portfolio=flexPool(request),high=flexPool({...request,heroSlotsCycle:[5]});
    const continuation=(slots:number,anyUpgrade=false)=>{
      const cache=new Map<string,number>(),races=new Map<string,ReturnType<typeof createUpgradeRace>>();
      return (goal:{id:string},cash:number)=>{
        const key=goal.id+':'+cash,hit=cache.get(key);if(hit!==undefined)return {value:hit,completionProbability:hit};
        const row=rows.find(r=>r.id===goal.id)!,goalUnits=[row.carry,row.tank],tierRemaining={...totals};
        const targets=goalUnits.map(id=>{
          const cost=rules.heroes[id].cost,retained=Number(!protectedIds.has(id));tierRemaining[cost]-=retained;
          const already=protectedIds.has(id)?owned[id]:1;
          return {id,cost,needed:Math.max(0,3-already),remaining:pool.remaining[id]+Number(held.includes(id))-retained,price:cost};
        });
        let probability:number;
        if(anyUpgrade){
          let race=races.get(goal.id);if(!race){race=createUpgradeRace({targets,tierRemaining,tierOdds:pool.tierOdds,refreshPrice:pool.refreshPrice,heroSlotsCycle:[slots]});races.set(goal.id,race);}
          probability=race.probability(cash);
        }else probability=poolBudget({targets,tierRemaining,tierOdds:pool.tierOdds,budget:cash,refreshPrice:pool.refreshPrice,heroSlotsCycle:[slots]}).probability;
        cache.set(key,probability);return {value:probability,completionProbability:probability};
      };
    };
    const upgradePortfolio=flexPool({...request,continuation:continuation(4)}),upgradeHigh=flexPool({...request,heroSlotsCycle:[5],continuation:continuation(5)});
    const keyUpgradePortfolio=flexPool({...request,continuation:continuation(4,true)}),keyUpgradeHigh=flexPool({...request,heroSlotsCycle:[5],continuation:continuation(5,true)});
    const fixed=rows.map(row=>fixedGoal(row,[{id:row.carry,copies:1},{id:row.tank,copies:1}],input,rules));
    return {ready:true,phase:'flex',level:state.level,budget:state.gold,goals:fixed,portfolio,optimisticProbability:high.completionProbability,
      upgradePortfolio,optimisticUpgradeProbability:upgradeHigh.completionProbability,
      keyUpgradePortfolio,optimisticKeyUpgradeProbability:keyUpgradeHigh.completionProbability,
      gaps:[...gaps,'关键二星指主C或前排任一升二星；并不等于战斗已稳定','先留首张、再定向追二星是受限策略，不是任意多副本摇摆的全局最优解','已保留核心副本不出售，仅新购未合成的多余副本可回售']};
  }catch(error){return {ready:false,reason:'多路线搜牌暂不可计算：'+(error as Error).message};}
}
