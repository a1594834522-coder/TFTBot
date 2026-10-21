import type {BattleRequest} from '../game/battle-forecast';
import type {DirectionAdvice} from './direction-advisor';
import type {StrategicInput} from './strategic-input';
import {enumerateShoppingPlans,materializeAcquisitions,unitCopyCounts,type TradingRules,type ShoppingPlan} from './shop-ledger';
import {shoppingTactics,TacticalScoreCache,type BatchPredictor,type TacticalOptions} from './shopping-tactics';
import {SearchDistributionCache,searchDistribution,type SearchDistribution,type SearchDistributionInput} from './search-distribution';
import {tacticalLineupTemplates} from './observed-lineups';
import policy from '../../data/battle-unit-policy.json';
import {materializeLineup} from './lineup-search';
import type {OwnedUnit,ShopState} from './shop-ledger';
import {adaptivePursuit} from './adaptive-pursuit';
import type {PursuitMode,PursuitPolicy} from './pursuit-policy';

const formPools=new Set(Object.values(policy.forms).map(f=>f.poolId));
type Band={lower:number;upper:number};
export interface CurrentPursuitBand {
  heroSlots:4|5;combat:Band;completion:Band;expectedGold:Band;
  evaluatedMass:number;retainedFloorMass:number;unresolved:number;states:number;gaps:string[];
}
export interface CurrentPursuitPath {
  id:string;buy:Array<{id:string;slot:number}>;spent:number;goldAfter:number;bands:CurrentPursuitBand[];
}
export type CurrentPursuit={ready:false;reason:string;controls?:true}|{
  ready:true;budget:number;level:number;routes:Array<{id:string;name:string;cores:string[];targets:Array<{id:string;copies:number}>}>;
  paths:CurrentPursuitPath[];opponentCoverage:number;weightSource:BattleRequest['weightSource'];
  baseline:Band;gaps:string[];evaluations:number;mode:PursuitMode;
  milestone:{kind:'route-cores'|'new-two-star';label:string;targets:string[]};
  adaptive?:Array<{heroSlots:4|5;states:number;decisions:number;limited:boolean}>;
};
type Distribution=Extract<SearchDistribution,{cancelled:false}>;
interface Scenario {path:CurrentPursuitPath;plan:ShoppingPlan;slots:4|5;distribution:Distribution;landings:Distribution['landings']}

/** Compare every legal subset of CURRENT core offers, before seeing future
 * shops. Every root then follows the SAME declared observable purchase policy.
 * Adaptive policies optimize only their copy-count milestone, not combat.
 * Combat, completion and saved gold remain separate; no invented exchange rate. */
export async function currentPursuit(advice:DirectionAdvice,input:StrategicInput,rules:TradingRules,request:BattleRequest,predict:BatchPredictor,
  options:TacticalOptions&{mode?:PursuitMode;maxPolicyStates?:number;maxPolicyDecisions?:number;budget?:number|null;maxStates?:number;maxBoards?:number;scoreReuse?:boolean;trace?:(phase:string,milliseconds:number)=>void}={}):Promise<CurrentPursuit>{
  if(!input.ready)return input;
  const physical=input.state;
  const mode=options.mode??'upgrade-first';if(!['upgrade-first','completion-first','key-upgrade'].includes(mode))throw Error('Invalid pursuit mode');
  if(!advice.ready||advice.updating||advice.mode!=='selected')return {ready:false,reason:'选择主线后比较当前留牌'};
  if(input.stage<4||input.state.level<7)return {ready:false,reason:'启动阶段比较当前留牌'};
  const main=advice.rows.find(r=>r.id===advice.focusId);if(!main)return {ready:false,reason:'等待主线同步'};
  const owned=unitCopyCounts(input.state.units),rows=[main,...(main.regime==='reroll'?[]:advice.rows.filter(r=>r!==main&&r.regime===main.regime).slice(0,2))];
  const coreGoals=rows.map(r=>({id:r.id,targets:[...new Set([r.carry,r.tank])]})),desired=new Map<string,number>();
  for(const row of rows)for(const id of [row.carry,row.tank])desired.set(id,Math.max(desired.get(id)??0,mode!=='key-upgrade'&&row.regime==='reroll'&&id===row.carry?9:3));
  // A transient or special unmerged snapshot is not an attained star level.
  // Copy-count policies cannot repair this ambiguity by buying another copy.
  if([...desired].some(([id,copies])=>(owned[id]??0)>=copies&&!physical.units.some(u=>u.id===id&&3**(u.star-1)>=copies)))return {ready:false,controls:true,reason:'核心升星快照待同步'};
  if(coreGoals[0].targets.every(id=>(owned[id]??0)>=desired.get(id)!))return mode==='key-upgrade'?{ready:false,controls:true,reason:main.regime==='reroll'?'当前双核已二星，可切换追三目标':'主线双核已二星，查看当前补强'}:{ready:false,reason:'主线双核已成型，查看当前补强'};
  const goals=mode==='key-upgrade'?[...desired].filter(([id])=>(owned[id]??0)<3).map(([id])=>({id:'new-two-star:'+id,targets:[id]})):coreGoals;
  const milestone:Extract<CurrentPursuit,{ready:true}>['milestone']={kind:mode==='key-upgrade'?'new-two-star':'route-cores',label:mode==='key-upgrade'?'新增二星':[...desired.values()].some(n=>n===9)?'核心追三':'双核二星',targets:[...new Set(goals.flatMap(g=>g.targets))]};
  const declared=options.budget??input.state.gold;
  if(!Number.isSafeInteger(declared)||declared<0||declared>200)return {ready:false,reason:'搜牌预算无效'};
  const budget=Math.min(input.state.gold,declared),reserve=input.state.gold-budget;
  const targets=[...desired].map(([id,copies])=>{
    const hero=rules.heroes[id],remaining=input.pool.remaining[id];
    if(!hero||!Number.isSafeInteger(remaining))throw Error('目标英雄牌池未齐');
    return {id,cost:hero.cost,needed:Math.max(0,copies-(owned[id]??0)),remaining,price:hero.cost};
  });
  const visible=input.state.offers.filter(o=>o!==null),available=new Set(targets.filter(t=>t.needed>0).map(t=>t.id));
  if(!visible.some(o=>available.has(o.id)))return {ready:false,reason:'当前商店没有待补的主线或备选核心',...(mode==='key-upgrade'?{controls:true as const}:{})};
  // Budget is a TOTAL spend ceiling, including today's cards. Reserve is never
  // silently borrowed. No hypothetical sales or staging alter these roots.
  const search=enumerateShoppingPlans({...input.state,gold:budget,offers:input.state.offers.map(o=>o&&available.has(o.id)?o:null)},rules,{sellCandidates:[],stageToFreeBench:false});
  const plans=search.plans.filter(p=>{
    const count=unitCopyCounts(p.state.units);
    return targets.every(t=>(count[t.id]??0)-(owned[t.id]??0)<=t.needed);
  }).sort((a,b)=>a.spent-b.spent||a.buySlots.join('.').localeCompare(b.buySlots.join('.')));
  if(!plans.some(p=>p.buySlots.length))return {ready:false,reason:'当前预算或实体规则下无法保留核心牌'};
  const templates=tacticalLineupTemplates(advice,input.state.boardCapacity),deployment={...options,scoreCache:options.scoreCache??(options.scoreReuse===false?undefined:new TacticalScoreCache()),observedLineups:options.observedLineups??(templates.length?{templates}:undefined)};
  const original=await shoppingTactics({...input.state,offers:[]},rules,request,predict,deployment);
  if(!original.ready)return original;
  const coverage=original.coverage,baseline=Math.max(...original.choices.map(c=>c.knownWin)),missing=1-coverage;
  const opponents=request.targets.filter(t=>t.weight>0&&t.board),predictions=predict(opponents.map(t=>({player:request.local,opponent:t.board!})));
  if(predictions.length!==opponents.length||predictions.some(p=>!Number.isFinite(p.winRate)||p.winRate<0||p.winRate>1))throw Error('Invalid current-pursuit model result');
  const idle=predictions.reduce((n,p,i)=>n+p.winRate*opponents[i].weight,0);
  const signature=(u:OwnedUnit)=>JSON.stringify([u.id,u.combatId??u.id,u.star,u.items.map(i=>[i.key,i.id]).sort(),u.equipmentKnown??true]);
  const references=[{keys:input.state.units.filter(u=>u.area==='board').map(u=>u.key),win:idle},...original.choices.map(c=>({keys:c.onBoardKeys,win:c.knownWin}))]
    .map(r=>({...r,entities:r.keys.map(k=>({key:k,signature:signature(input.state.units.find(u=>u.key===k)!)}))}));
  function retainedFloor(state:ShopState):number|null{
    let floor:number|null=null;
    for(const reference of references){
      const units=reference.entities.map(e=>state.units.find(u=>u.key===e.key&&signature(u)===e.signature));
      if(units.some(u=>!u)||units.length>state.boardCapacity)continue;
      const lineup=materializeLineup(state,units as OwnedUnit[],request.local.augments,request.local.charms,options.auxiliary);
      if(options.acceptsLineup&&!options.acceptsLineup(lineup)||!(deployment.scoreCache?deployment.scoreCache.supports(lineup.key,lineup.board,options.supportsBoard):options.supportsBoard?.(lineup.board)??true))continue;
      floor=Math.max(floor??0,reference.win);
    }
    return floor;
  }
  const gaps=new Set([...input.gaps,...original.gaps,mode==='upgrade-first'?'各组合后续使用相同的升星优先、多路线购买规则，任一路双核达标即停止；不是自适应最优策略':mode==='key-upgrade'?'只计算当前未二星的核心，任一新增二星即停止；已有二星不重复计入。完成机会为先、余金为并列取舍，不是战力或名次最优':'各组合后续按已揭示商店调整购买，以补齐目标为先、余金为并列取舍；不是战力或名次最优策略',
    '预算包含当前买牌和后续刷新；不含收入、卖牌、接装、升级或对手后续变化',`未来每次刷新按${input.pool.refreshPrice}金，不含未确认的免费次数与价格变化`,'4与5英雄格是两个固定商店情景，不是置信区间',
    '仍可合法重放的当前已评分棋盘作为已知候选；未完整评分分支只给可实现的下界']);
  if(Object.keys(search.failures).length)gaps.add('未纳入不满足当前预算、备战席或已覆盖合成规则的购买组合');
  const cache=new SearchDistributionCache(),paths:CurrentPursuitPath[]=[],scenarios:Scenario[]=[];let phaseAt=performance.now();
  const policies=new Map<4|5,PursuitPolicy>(),adaptive:Extract<CurrentPursuit,{ready:true}>['adaptive']=[];
  if(mode!=='upgrade-first')for(const slots of [4,5] as const){
    const config={targets,owned:targets.map(t=>owned[t.id]??0),goals,tierRemaining:input.pool.tierRemaining,tierOdds:input.pool.tierOdds,cash:budget,refreshPrice:input.pool.refreshPrice,heroSlots:slots,visible};
    const {kernel}=cache.bind(config),roots=plans.map(plan=>{
      const held=unitCopyCounts(plan.state.units),code=kernel.root-targets.reduce((n,t,i)=>n+((held[t.id]??0)-(owned[t.id]??0))*kernel.strides[i],0);
      return {code,cash:budget-plan.spent};
    });
    const prepared=await adaptivePursuit(config,roots,{kernel,maxStates:options.maxPolicyStates,maxDecisions:options.maxPolicyDecisions,cancelled:options.cancelled,yield:options.yield});
    if(prepared.cancelled)return {ready:false,reason:'局面已变化'};
    policies.set(slots,prepared.policy);adaptive.push({heroSlots:slots,states:prepared.states,decisions:prepared.decisions,limited:prepared.limited});
    if(prepared.limited)gaps.add('补齐策略搜索达到限额，未能证明改进的决策沿用升星优先；不宣称全局最优');
  }
  options.trace?.('policy',performance.now()-phaseAt);phaseAt=performance.now();
  for(const plan of plans){
    if(options.cancelled?.())return {ready:false,reason:'局面已变化'};
    const path:CurrentPursuitPath={id:plan.buySlots.length?'keep:'+plan.buySlots.join('.'):'skip',buy:plan.buySlots.map(slot=>({id:input.state.offers[slot]!.id,slot})),spent:plan.spent,goldAfter:reserve+plan.state.gold,bands:[]};
    paths.push(path);
    const initialPurchase=plan.actions.flatMap(a=>a.type==='buy'?[visible.findIndex(o=>o.slot===a.slot)]:[]);
    for(const slots of [4,5] as const){
      const config:SearchDistributionInput={targets,owned:targets.map(t=>owned[t.id]??0),goals,tierRemaining:input.pool.tierRemaining,tierOdds:input.pool.tierOdds,
        cash:budget,refreshPrice:input.pool.refreshPrice,heroSlots:slots,visible,initialPurchase,maxStates:options.maxStates??20000};
      const distribution=await searchDistribution(config,{...options,cache,policy:policies.get(slots)});
      if(distribution.cancelled)return {ready:false,reason:'局面已变化'};
      scenarios.push({path,plan,slots,distribution,landings:distribution.landings.slice().sort((a,b)=>b.probability-a.probability)});
      await options.yield?.();
    }
  }
  options.trace?.('distributions',performance.now()-phaseAt);phaseAt=performance.now();
  const values=new Map<string,{win:number|null;gap?:string}>(),floors=new Map<string,number|null>(),attained=new Map<string,boolean|null>();let evaluations=0;
  const key=(s:Scenario,l:Distribution['landings'][number])=>JSON.stringify([s.path.id,l.acquired]);
  function materialize(scenario:Scenario,landing:Distribution['landings'][number]){
    const prefix=unitCopyCounts(scenario.plan.state.units),future=targets.flatMap((t,i)=>{
      const n=landing.acquired[i]-((prefix[t.id]??0)-(owned[t.id]??0));return n?[{id:t.id,copies:n}]:[];
    });
    if(future.some(t=>formPools.has(t.id))){attained.set(key(scenario,landing),null);return {ok:false as const,reason:'未来英雄形态未确认'};}
    const result=materializeAcquisitions(scenario.plan.state,future,rules);
    attained.set(key(scenario,landing),result.ok?goals.some(g=>g.targets.every(id=>result.units.some(u=>u.id===id&&3**(u.star-1)>=desired.get(id)!))):null);
    return result.ok?{ok:true as const,state:{...physical,units:result.units,offers:[],gold:reserve+landing.cash}}:
      {ok:false as const,reason:result.reason==='bench-full'?'部分落点需要整理备战席':'部分合成或装备规则待覆盖'};
  }
  // Equal turns across roots and shop scenarios avoid spending all model work on
  // the first option. No root's known mass is renormalized after the quota.
  const quota=options.maxBoards??384;
  if(!Number.isSafeInteger(quota)||quota<0)throw Error('Invalid current-pursuit model limit');
  const fair=scenarios.slice().sort((a,b)=>a.slots-b.slots||paths.indexOf(a.path)-paths.indexOf(b.path));
  for(let rank=0;fair.some(s=>rank<s.landings.length)&&evaluations<quota;rank++)for(const scenario of fair){
    if(options.cancelled?.())return {ready:false,reason:'局面已变化'};
    const landing=scenario.landings[rank];if(!landing)continue;
    const id=key(scenario,landing);if(values.has(id))continue;
    if(evaluations>=quota)break;evaluations++;
    const materialized=materialize(scenario,landing);
    if(!materialized.ok){values.set(id,{win:null,gap:materialized.reason});floors.set(id,null);continue;}
    const {state}=materialized,floor=retainedFloor(state);floors.set(id,floor);
    const local={...request.local,units:[...state.units.filter(u=>u.area==='board').map(u=>({id:u.combatId??u.id,star:u.star,items:u.items.map(i=>i.id)})),...(options.auxiliary??[])]};
    const result=await shoppingTactics(state,rules,{...request,local},predict,deployment);
    if(!result.ready){if(options.cancelled?.())return {ready:false,reason:'局面已变化'};values.set(id,{win:null,gap:result.reason});}
    else{values.set(id,{win:Math.max(floor??0,...result.choices.map(c=>c.knownWin))});result.gaps.forEach(g=>gaps.add(g));}
  }
  options.trace?.('models',performance.now()-phaseAt);phaseAt=performance.now();
  let assembled=0;
  for(const scenario of scenarios){
    const {distribution}=scenario;let scored=0,lower=0,known=0,retained=0,completedLower=0,completedUpper=distribution.unresolved;const issues=new Set<string>();
    for(const landing of scenario.landings){
      if(++assembled%128===0){await options.yield?.();if(options.cancelled?.())return {ready:false,reason:'局面已变化'};}
      const id=key(scenario,landing),value=values.get(id);
      if(value?.win!==null&&value?.win!==undefined){scored+=landing.probability*value.win;known+=landing.probability;}
      else{
        if(!floors.has(id)){const state=materialize(scenario,landing);floors.set(id,state.ok?retainedFloor(state.state):null);if(!state.ok)issues.add(state.reason);}
        const floor=floors.get(id);if(floor!==null&&floor!==undefined){lower+=landing.probability*floor;retained+=landing.probability;}
        if(value?.gap)issues.add(value.gap);
      }
      if(landing.completed.length){
        const physical=attained.get(id);
        if(physical===true){completedLower+=landing.probability;completedUpper+=landing.probability;}
        else if(physical===null||physical===undefined){completedUpper+=landing.probability;issues.add('部分升星落点的实体合成待覆盖，达标机会保留区间');}
      }
    }
    if(known<1-distribution.unresolved-1e-7)issues.add('部分落点未评分，保留未知概率质量');
    if(distribution.unresolved>1e-7)issues.add('搜索达到状态限额，未展开分支保留未知');
    lower=Math.max(0,Math.min(1,lower+scored));known=Math.max(0,Math.min(1,known));
    const completionLower=Math.max(0,Math.min(1,completedLower));
    scenario.path.bands.push({heroSlots:scenario.slots,combat:{lower,upper:Math.max(lower,Math.min(1,scored+(1-known)+missing*known))},completion:{lower:completionLower,upper:Math.max(completionLower,Math.min(1,completedUpper))},
      expectedGold:{lower:reserve+distribution.expectedCash.lower,upper:reserve+distribution.expectedCash.upper},evaluatedMass:known,retainedFloorMass:retained,unresolved:distribution.unresolved,states:distribution.states,gaps:[...issues]});
  }
  options.trace?.('bounds',performance.now()-phaseAt);
  return {ready:true,budget,level:input.state.level,routes:rows.map(r=>({id:r.id,name:r.name,cores:[...new Set([r.carry,r.tank])],targets:[...new Set([r.carry,r.tank])].map(id=>({id,copies:desired.get(id)!}))})),paths,
    opponentCoverage:coverage,weightSource:request.weightSource,baseline:{lower:baseline,upper:baseline+missing},gaps:[...gaps],evaluations,mode,milestone,...(mode!=='upgrade-first'?{adaptive}:{})};
}
