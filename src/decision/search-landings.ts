import type {BattleRequest} from '../game/battle-forecast';
import type {DirectionAdvice,DirectionRow} from './direction-advisor';
import type {StrategicInput} from './strategic-input';
import {materializeAcquisitions,unitCopyCounts,type TradingRules,type ShopState} from './shop-ledger';
import {shoppingTactics,type BatchPredictor,type TacticalOptions,type TacticalUnit} from './shopping-tactics';
import {searchDistribution} from './search-distribution';
import policy from '../../data/battle-unit-policy.json';
const formPools=new Set(Object.values(policy.forms).map(f=>f.poolId));

export interface LandingBand {
  heroSlots:4|5;coverage:number;completion:{lower:number;upper:number};
  combat:{lower:number;upper:number};weaker:{lower:number;upper:number};
  failureMass:number;failureCombat:{lower:number;upper:number}|null;
  examples:Array<{probability:number;cash:number;completed:string[];units:TacticalUnit[];winRate:number|null}>;
  states:number;gaps:string[];
}
export interface LandingPlan {id:string;name:string;alternative?:string[];targets:Array<{id:string;copies:number}>;bands:LandingBand[];buyNow:string[]}
export type SearchLandings={ready:false;reason:string}|{
  ready:true;budget:number;level:number;baseline:number|null;opponentCoverage:number;weightSource:BattleRequest['weightSource'];
  plans:LandingPlan[];gaps:string[];
};
export function landingDefinitions(advice:DirectionAdvice):Array<{id:string;name:string;rows:DirectionRow[];targets:Array<{id:string;copies:number}>}>{
  if(!advice.ready||advice.updating||advice.mode!=='selected')return [];
  const main=advice.rows.find(r=>r.id===advice.focusId);if(!main)return [];
  const groups=[[main],...(main.regime==='reroll'?[]:advice.rows.filter(r=>r!==main&&r.regime===main.regime).slice(0,2).map(r=>[main,r]))];
  return groups.map(rows=>{
    const targets=new Map<string,number>();for(const row of rows)for(const id of [row.carry,row.tank])targets.set(id,Math.max(targets.get(id)??0,row.regime==='reroll'&&id===row.carry?9:3));
    return {id:rows.map(r=>r.id).join('|'),name:rows.length===1?'主线优先':'兼留 · '+rows[1].name,rows,targets:[...targets].map(([id,copies])=>({id,copies}))};
  });
}
/** Compare declared pursuit policies by their WHOLE terminal distribution,
 * including failed rolls. Opponents remain frozen at the same observed board.
 * No claim of an optimal long-term policy, income forecast or item transfer. */
export async function searchLandings(advice:DirectionAdvice,input:StrategicInput,rules:TradingRules,request:BattleRequest,predict:BatchPredictor,options:TacticalOptions&{budget?:number|null;maxStates?:number;maxBoards?:number}={}):Promise<SearchLandings>{
  if(!input.ready)return input;
  const definitions=landingDefinitions(advice);if(!definitions.length)return {ready:false,reason:'选择主线后比较搜牌落点'};
  if(input.stage<4||input.state.level<7)return {ready:false,reason:'启动阶段比较预算落点'};
  const declared=options.budget??input.state.gold;if(!Number.isSafeInteger(declared)||declared<0||declared>200)return {ready:false,reason:'搜牌预算无效'};
  const budget=Math.min(input.state.gold,declared),owned=unitCopyCounts(input.state.units),reserve=input.state.gold-budget;
  if(definitions[0].targets.every(t=>(owned[t.id]??0)>=t.copies))return {ready:false,reason:'主线核心已齐，查看当前换牌与上限参考'};
  const original=await shoppingTactics({...input.state,offers:[]},rules,request,predict,options);
  if(!original.ready)return original;
  const baseline=original.choices.reduce((n,c)=>Math.max(n,c.knownWin),0),coverage=original.coverage;
  const cache=new Map<string,{win:number;units:TacticalUnit[]}|null>();
  const gaps=new Set([...input.gaps,...original.gaps,'固定当前人口与对手棋盘，不含未来收入、卖牌回收、接装或站位变化','购买策略为当前可完成升星优先，其次接近升星，再按主线顺序；非最优搜牌策略','落点部署最多两牌联动，未覆盖完整整体变阵']);
  const plans:LandingPlan[]=[];
  for(const definition of definitions){
    let evaluated=0;
    const targets=definition.targets.map(t=>{const hero=rules.heroes[t.id];if(!hero||!Number.isSafeInteger(input.pool.remaining[t.id]))throw Error('目标英雄牌池未齐');return {id:t.id,cost:hero.cost,needed:Math.max(0,t.copies-(owned[t.id]??0)),remaining:input.pool.remaining[t.id],price:hero.cost};});
    const goals=definition.rows.map(row=>({id:row.id,targets:[...new Set([row.carry,row.tank])]})),bands:LandingBand[]=[];let buyNow:string[]=[];
    for(const slots of [4,5] as const){
      const distribution=await searchDistribution({targets,owned:targets.map(t=>owned[t.id]??0),goals,tierRemaining:input.pool.tierRemaining,tierOdds:input.pool.tierOdds,cash:budget,refreshPrice:input.pool.refreshPrice,heroSlots:slots,
        visible:input.state.offers.flatMap(o=>o?[{id:o.id,price:o.price}]:[]),maxStates:options.maxStates??1500},options);
      if(distribution.cancelled)return {ready:false,reason:'局面已变化'};
      buyNow=distribution.initialBuy;
      let combatLower=0,combatUpper=distribution.unresolved,weakerLower=0,weakerUpper=distribution.unresolved,knownMass=0;
      let failureMass=0,failureLower=0,failureUpper=0;const examples:LandingBand['examples']=[],issues=new Set<string>();
      // More probable landings first make an explicit evaluation bound useful;
      // unscored branches keep their original mass and [0,1] uncertainty.
      const landings=distribution.landings.slice().sort((a,b)=>b.probability-a.probability);
      for(const landing of landings){
        if(options.cancelled?.())return {ready:false,reason:'局面已变化'};
        const acquired=targets.flatMap((t,i)=>landing.acquired[i]?[{id:t.id,copies:landing.acquired[i]}]:[]),key=JSON.stringify(acquired.slice().sort((a,b)=>a.id.localeCompare(b.id)));
        let value=cache.get(key);
        if(value===undefined&&evaluated<(options.maxBoards??96)){
          evaluated++;
          if(acquired.some(a=>formPools.has(a.id))){value=null;issues.add('未来英雄形态未确认');}
          else{
            const materialized=materializeAcquisitions(input.state,acquired,rules);
            if(!materialized.ok){value=null;issues.add(materialized.reason==='bench-full'?'部分落点需要玩家整理备战席':'部分落点合成或装备规则待覆盖');}
            else{
              const state:ShopState={...input.state,gold:reserve+landing.cash,offers:[],units:materialized.units};
              const local={...request.local,units:[...state.units.filter(u=>u.area==='board').map(u=>({id:u.combatId??u.id,star:u.star,items:u.items.map(i=>i.id)})),...(options.auxiliary??[])]};
              const result=await shoppingTactics(state,rules,{...request,local},predict,options);
              if(result.ready){const best=result.choices.reduce((a,b)=>b.knownWin>a.knownWin?b:a);value={win:best.knownWin,units:best.onBoard.map((id,i)=>({key:best.onBoardKeys[i],id,combatId:best.onBoardCombatIds[i],star:best.onBoardStars[i],items:best.onBoardItems[i]}))};result.gaps.forEach(g=>issues.add(g));}
              else{value=null;issues.add(result.reason);}
            }
          }
          cache.set(key,value);
        }
        const mass=landing.probability,known=value!==null&&value!==undefined,lower=known?value!.win:0,upper=known?value!.win+1-coverage:1;
        combatLower+=mass*lower;combatUpper+=mass*upper;if(known)knownMass+=mass;
        const delta=known?value!.win-baseline:0,missing=1-coverage;
        if(known&&delta+missing< -1e-6){weakerLower+=mass;weakerUpper+=mass;}
        else if(!known||delta-missing< -1e-6)weakerUpper+=mass;
        if(!landing.completed.length){failureMass+=mass;failureLower+=mass*lower;failureUpper+=mass*upper;}
        if(known)examples.push({probability:mass,cash:reserve+landing.cash,completed:landing.completed,units:value!.units,winRate:coverage>=1-1e-7?value!.win:null});
      }
      if(knownMass<1-distribution.unresolved-1e-7)issues.add('部分落点尚未评估，保留未知概率质量');
      if(distribution.unresolved>1e-7)issues.add('搜索状态达到限额，未展开分支保留为未知');
      const unknownFailure=distribution.unresolved;
      bands.push({heroSlots:slots,coverage:knownMass,completion:distribution.completion,combat:{lower:combatLower,upper:Math.min(1,combatUpper)},weaker:{lower:weakerLower,upper:Math.min(1,weakerUpper)},failureMass,
        failureCombat:failureMass+unknownFailure>0?{lower:failureLower/(failureMass+unknownFailure),upper:Math.min(1,(failureUpper+unknownFailure)/(failureMass+unknownFailure))}:null,
        examples:examples.filter(e=>!e.completed.length).slice(0,2),states:distribution.states,gaps:[...issues]});
    }
    plans.push({id:definition.id,name:definition.rows.length===1?'主线优先':'兼留备选',...(definition.rows[1]?{alternative:[definition.rows[1].carry,definition.rows[1].tank]}:{}),targets:definition.targets,bands,buyNow});
  }
  return {ready:true,budget,level:input.state.level,baseline:coverage>=1-1e-7?baseline:null,opponentCoverage:coverage,weightSource:request.weightSource,plans,gaps:[...gaps]};
}
