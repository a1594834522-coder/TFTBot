import type {StrategicInput} from './strategic-input';
import {strategicOptions,type StrategicOption} from './strategic-options';
import {transitionGoals,transitionSources,type TransitionLibrary,type TransitionGoal,type SourceMatch} from './transition-goals';
import {interest,type TradingRules} from './shop-ledger';
export interface StrategicRow {goal:TransitionGoal;alternativeGoals:TransitionGoal[];option:Extract<StrategicOption,{ready:true}>;optimisticProbability:number|null;observedPlace:number|null;labels:string[]}
export type StrategicAdvice={ready:false;reason:string}|{
  ready:true;stage:number;wallet:number;currentCashFloor:number;sources:SourceMatch[];
  rows:StrategicRow[];goals:number;frontier:number;gaps:string[];provisional:boolean;
};
/** Separate incomparable evidence instead of folding cash, observed ranks and combat
 * probability into an uncalibrated weighted score. The frontier shows distinct choices. */
export async function strategicAdvice(input:StrategicInput,library:TransitionLibrary,rules:TradingRules,options:{cancelled?:()=>boolean;yield?:()=>Promise<void>}={}):Promise<StrategicAdvice>{
  if(!input.ready)return input;
  const {state,pool}=input,sources=transitionSources(library,input.stage,state.units.filter(u=>u.area==='board').map(u=>u.id));
  if(!sources.length)return {ready:false,reason:'等待当前过渡棋盘'};
  const goals=transitionGoals(library,sources.map(s=>s.id),30,'core');
  if(!goals.length)return {ready:false,reason:'该过渡暂无足够支持的后续路径'};
  const currentCashFloor=Math.max(interest(state.gold,rules)*rules.interestStep,interest(state.gold+rules.victoryGoldBeforeInterest,rules)*rules.interestStep-rules.victoryGoldBeforeInterest);
  const low=await strategicOptions(state,rules,goals,pool,{reserveGold:0,currentCashFloor,retention:true,...options});
  if(options.cancelled?.())return {ready:false,reason:'局面已变化'};
  const high=await strategicOptions(state,rules,goals,{...pool,heroSlotsCycle:[5]},{reserveGold:0,currentCashFloor,...options});
  if(options.cancelled?.())return {ready:false,reason:'局面已变化'};
  const variants:StrategicRow[]=low.flatMap(option=>{
    if(!option.ready)return [];
    const goal=goals.find(g=>g.id===option.id)!,upper=high.find(r=>r.id===option.id),places=goal.evidence.map(e=>e.stats.avgPlace);
    // Source membership is uncertain when several clusters match. Do not average their
    // outcomes with made-up weights; use the worst available conditional mean for ordering.
    const observedPlace=places.length&&sources.every(s=>goal.evidence.some(e=>e.source===s.id))&&places.every(p=>p!==undefined)?Math.max(...places as number[]):null;
    return [{goal,alternativeGoals:[],option,optimisticProbability:upper?.ready?upper.choice.completion.probability:null,observedPlace,labels:[]}];
  });
  if(!variants.length)return {ready:false,reason:low.find(r=>!r.ready)?.reason??'后续目标暂不可计算'};
  // Distinct full boards often have the same two core requirements. Show the
  // purchase decision once, retaining every observed route as an alternative.
  const grouped=new Map<string,StrategicRow[]>();
  for(const row of variants){const key=row.goal.targets.map(t=>t.id+':'+t.copies).sort().join('|');grouped.set(key,[...grouped.get(key)??[],row]);}
  const rows=[...grouped.values()].map(group=>{
    group.sort((a,b)=>(a.observedPlace??8)-(b.observedPlace??8)||a.goal.id.localeCompare(b.goal.id));
    return {...group[0],alternativeGoals:group.slice(1).map(r=>r.goal)};
  });
  const probability=(r:StrategicRow)=>r.option.choice.completion.probability,place=(r:StrategicRow)=>r.observedPlace??8;
  const dominates=(a:StrategicRow,b:StrategicRow)=>(a.observedPlace===null)===(b.observedPlace===null)&&probability(a)>=probability(b)-1e-12&&place(a)<=place(b)&&a.option.choice.spendNow<=b.option.choice.spendNow&&(probability(a)>probability(b)+1e-12||place(a)<place(b)||a.option.choice.spendNow<b.option.choice.spendNow);
  const frontier=rows.filter(r=>!rows.some(other=>other!==r&&dominates(other,r))),selected:StrategicRow[]=[];
  function pick(row:StrategicRow|undefined,label:string){if(!row)return;row.labels.push(label);if(!selected.includes(row))selected.push(row);}
  pick([...frontier].sort((a,b)=>probability(b)-probability(a)||place(a)-place(b))[0],'更易补齐');
  pick([...frontier].filter(r=>probability(r)>0&&r.observedPlace!==null).sort((a,b)=>place(a)-place(b)||probability(b)-probability(a))[0],'后续表现');
  pick([...frontier].filter(r=>!selected.includes(r)).sort((a,b)=>a.option.choice.spendNow-b.option.choice.spendNow||probability(b)-probability(a))[0],'少花当前金币');
  return {ready:true,stage:input.stage,wallet:state.gold,currentCashFloor,sources,rows:selected,goals:goals.length,frontier:frontier.length,gaps:[...input.gaps,...(sources.some(s=>!s.exact)?['当前聚类按相近棋盘匹配']:[]),'核心星级来自完整窗口边际统计','补齐概率不含未来收入与升级，也不是战斗胜率'],provisional:rules.provisional};
}
