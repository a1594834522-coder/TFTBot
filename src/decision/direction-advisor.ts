import type {AdvisorInput,EarlyHoldAdvice,EarlyBoardSuggestion} from '../game/comp-advisor';
import type {DirectionCatalog,DirectionProfile,CorePair,AugmentFact} from './direction-catalog';
import {gearOrientation,type GearModel,type GearAffinity} from './gear-affinity';
import {pairGearAffinity,type PairGearAffinity} from './pair-gear-affinity';
import type {StrategyRegime,ProfileEarly,ProfileBoard} from './comp-profiles';
import type {EarlyStage} from '../game/metatft-early';
import type {DirectionSearch} from './direction-search';

export interface DirectionIntent {key:string;directionId?:string;units?:string[]}
export interface DirectionInput {
  assets:AdvisorInput;round:string|null;augments:string[];augmentsComplete:boolean;
  board:string[];shop:Array<{id:string;slot:number}>;health:number|null;
  combatWinRate?:number|null;
  intent?:DirectionIntent|null;
}
export interface DirectionRow {
  id:string;key:string;name:string;regime:StrategyRegime;carry:string;tank:string;
  units:string[];gear:GearAffinity;early:{units:string[];retained:number;missing:number;count:number}|null;
  copies:number;traitSupport:string[];blocked:boolean;front:number;labels:string[];
  observedPlace:number;observations:number;
  mechanismSupport:string[];
  tankCopies:number;readyCores:number;hitOdds:number|null;support:number;
  tankGear?:GearAffinity;gearAllocation?:PairGearAffinity;
  rivalCopies?:number;tankRivalCopies?:number;poolComplete?:boolean;
  lateBoards?:ProfileBoard[];
}
export type DirectionAdvice={ready:false;reason:string;unsupported?:boolean}|{
  ready:true;unsupported?:false;updating?:boolean;round:string|null;milestone:'opening'|'second-augment'|'roll-down'|'late';
  mode:'flex'|'selected';regime:StrategyRegime|null;message:string;focusId?:string;
  orientation:'physical'|'magic'|'flex';rows:DirectionRow[];comparisonRows?:DirectionRow[];holds:EarlyHoldAdvice;
  augments:string[];gaps:string[];candidates:number;
  owned:Record<string,number>;shop:Array<{id:string;slot:number}>;
  search?:DirectionSearch;
};
const regimes:StrategyRegime[]=['reroll','four-cost','legendary'];
const stable=(a:DirectionRow,b:DirectionRow)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id);

/** Nearest OBSERVED early boards for a final family. No terminal-overlap term is
 * used here: a zero-overlap transition is an ordinary valid observation. Counts
 * remain support counts, never P(final | early). */
export function earlyAssociation(profile:DirectionProfile,input:DirectionInput):{board:ProfileEarly;retained:number;missing:number}|null{
  const owned=input.assets.units,level=input.assets.level??4;
  const available=profile.early.filter(b=>b.count>=30&&b.poolUnits.length>=Math.max(3,b.level-1)&&b.poolUnits.length<=b.level+2),distance=Math.min(...available.map(b=>Math.abs(b.level-level)));
  const scored=available.filter(b=>Math.abs(b.level-level)===distance).map(board=>({board,
    retained:board.poolUnits.reduce((n,id)=>n+Math.min(owned[id]??0,3),0),
    missing:board.poolUnits.filter(id=>!owned[id]).length}));
  scored.sort((a,b)=>b.retained-a.retained||a.missing-b.missing||b.board.count-a.board.count);
  return scored[0]??null;
}
function traitsFor(pair:CorePair,catalog:DirectionCatalog):Set<string>{
  // At least one actual joint variant must activate the trait. A union of
  // mutually exclusive variants cannot invent compatibility with an augment.
  const result=new Set<string>();
  for(const board of pair.templates){
    const counts:Record<string,number>={};for(const id of new Set(board.units))for(const trait of catalog.roles[id]?.traits??[])counts[trait]=(counts[trait]??0)+1;
    for(const [trait,count]of Object.entries(counts))if(count>=(catalog.traitThresholds[trait]??Infinity))result.add(trait);
  }
  return result;
}
function evidence(row:DirectionRow,early:boolean):number[]{
  return [row.gear.known?row.gear.componentLift:0,row.gear.known?row.gear.coreItemLift:0,row.tankGear?.componentLift??0,row.tankGear?.coreItemLift??0,
    row.gearAllocation?.matchedCompleted??0,row.gearAllocation?.matchedComponents??0,
    investment(row),Math.min(row.tankCopies,3),row.hitOdds??0,early?row.early?.retained??0:0,early?-(row.early?.missing??20):0,augmentCount(row),-row.observedPlace];
}
const augmentCount=(r:DirectionRow)=>new Set([...r.traitSupport,...r.mechanismSupport]).size;
// A natural upgraded core is evidence; a random single future carry is not a
// reason to discard a strong zero-overlap transition. This is goal progress,
// not a learned reward or a completion probability.
const investment=(r:DirectionRow)=>r.copies>=3?Math.min(1,r.copies/(r.regime==='reroll'?9:3)):0;
const dominates=(a:number[],b:number[])=>a.every((v,i)=>v>=b[i]-1e-10)&&a.some((v,i)=>v>b[i]+1e-10);

/** Compare aggregate evidence without making a commitment for the player.
 * Pareto layers and distinct recommendation reasons preserve alternatives.
 * Only explicit user intent selects the route used by search/highlights. */
export function directionAdvice(input:DirectionInput,catalog:DirectionCatalog,gearModel:GearModel,stages:EarlyStage[]=[]):DirectionAdvice{
  if(!input.assets.localComplete)return {ready:false,reason:'等待本方棋盘与备战席'};
  if(input.assets.items.length>128)return {ready:false,unsupported:true,reason:'装备实体数量异常，等待同步'};
  const stage=input.assets.stage??Number(input.round?.[0]??2),level=input.assets.level??4;
  const milestone=stage<=2?'opening':stage===3?'second-augment':stage===4?'roll-down':'late';
  const startup=milestone==='roll-down'&&level>=7;
  const facts=input.augments.map(id=>catalog.augments[id]).filter((v):v is AugmentFact=>!!v);
  if(facts.some(a=>a.moveLocked))return {ready:false,unsupported:true,reason:'已上场英雄的锁定记录待核对，暂停自动换牌与变阵建议'};
  const early=level<=6,rows:DirectionRow[]=[];
  const stocks=input.assets.poolComplete?Object.fromEntries(shopCatalog.map(h=>[h.character_id,poolSize(h.cost)-(input.assets.units[h.character_id]??0)-(input.assets.opponents[h.character_id]??0)])):null;
  const validStocks=stocks&&Object.values(stocks).every(n=>Number.isSafeInteger(n)&&n>=0);
  const tierTotals=validStocks?Object.fromEntries([1,2,3,4,5].map(cost=>[cost,shopCatalog.filter(h=>h.cost===cost).reduce((n,h)=>n+stocks[h.character_id],0)])):null;
  for(const profile of catalog.profiles){
    const association=earlyAssociation(profile,input);
    for(const pair of profile.pairs){
      // A three-cost reroll is an option at 2-1, never a locked opening plan.
      const activeTraits=traitsFor(pair,catalog),traitSupport=facts.filter(a=>a.traits.some(t=>activeTraits.has(t))).map(a=>a.id);
      if(facts.some(a=>a.incompatible.some(t=>activeTraits.has(t))))continue;
      const copies=input.assets.units[pair.carry]??0,cost=catalog.roles[pair.carry]?.cost??0;
      const role=catalog.roles[pair.carry],mechanismSupport=facts.filter(a=>a.focusCosts.includes(cost)||a.offense==='physical'&&role?.tags.includes('Role.Attack')||a.offense==='magic'&&role?.tags.includes('Role.Magic')).map(a=>a.id);
      const blocked=input.assets.poolComplete&&pair.regime==='reroll'&&(input.assets.opponents[pair.carry]??0)>0&&
        9>poolSize(cost)-(input.assets.opponents[pair.carry]??0);
      const units=pair.templates[0]?.poolUnits??[pair.carry,pair.tank];
      // A geared hero retained by this actual variant cannot simultaneously
      // donate those items to its new carry. Only genuine transition holders
      // outside the chosen terminal board are treated as transferable here.
      const gearAllocation=pairGearAffinity(gearModel,profile.key,pair.carry,pair.tank,input.assets.items,units),gear=gearAllocation.first,tankGear=gearAllocation.second;
      const planningLevel=Math.max(level,pair.regime==='reroll'?profile.regime.rollLevel:pair.regime==='legendary'?9:8);
      const obtainable=(id:string)=>(input.assets.units[id]??0)>0||input.shop.some(c=>c.id===id)&&(input.assets.gold??0)>=(catalog.roles[id]?.cost??Infinity);
      const readyCores=[pair.carry,pair.tank].filter(obtainable).length;
      const odds=tierTotals?[pair.carry,pair.tank].map(id=>{
        if(obtainable(id))return 1;const cost=catalog.roles[id].cost,stock=poolSize(cost)-(input.assets.units[id]??0)-(input.assets.opponents[id]??0);
        return stock>=0&&tierTotals[cost]>0?tierOdds(planningLevel,cost as 1|2|3|4|5)*stock/tierTotals[cost]:0;
      }):null;
      rows.push({id:pair.id,key:'metatft:'+profile.key,name:profile.name,regime:pair.regime,carry:pair.carry,tank:pair.tank,units,
        gear,tankGear,gearAllocation,lateBoards:pair.lateTemplates??[],early:association?{units:association.board.poolUnits,retained:association.retained,missing:association.missing,count:association.board.count}:null,
        copies,traitSupport,mechanismSupport,blocked,front:0,labels:[],observedPlace:profile.avg,observations:profile.count,
        rivalCopies:input.assets.opponents[pair.carry]??0,tankRivalCopies:input.assets.opponents[pair.tank]??0,poolComplete:input.assets.poolComplete,
        tankCopies:input.assets.units[pair.tank]??0,readyCores,hitOdds:odds?Math.min(...odds):null,support:pair.support});
    }
  }
  // The same two heroes can belong to different trait/gear contexts. Keep those
  // contexts through comparison; UI diversity is applied only AFTER ranking.
  // Early overlap must not erase an excellent zero-overlap late transition.
  const dedup=new Map<string,DirectionRow>();
  for(const row of rows)dedup.set(row.id,row);
  let pending=[...dedup.values()].filter(r=>!r.blocked),front=0;
  while(pending.length){const layer=pending.filter(r=>!pending.some(o=>o!==r&&o.gear.known===r.gear.known&&o.tankGear?.known===r.tankGear?.known&&dominates(evidence(o,early),evidence(r,early))));for(const row of layer)row.front=front;pending=pending.filter(r=>!layer.includes(r));front++;}
  const eligible=[...dedup.values()].filter(r=>!r.blocked);
  const difference=(n:number)=>Math.abs(n)>1e-9?n:0;
  const gearAxis=(a:DirectionRow,b:DirectionRow)=>Number(b.gear.known)-Number(a.gear.known)||
    (b.gearAllocation?.matchedCompleted??0)-(a.gearAllocation?.matchedCompleted??0)||(b.gearAllocation?.matchedComponents??0)-(a.gearAllocation?.matchedComponents??0)||
    difference((b.gearAllocation?.jointCoreLift??b.gear.coreItemLift)-(a.gearAllocation?.jointCoreLift??a.gear.coreItemLift))||difference((b.gearAllocation?.jointComponentLift??b.gear.componentLift)-(a.gearAllocation?.jointComponentLift??a.gear.componentLift));
  const assetAxis=(a:DirectionRow,b:DirectionRow)=>investment(b)-investment(a)||Math.min(b.tankCopies,3)-Math.min(a.tankCopies,3)||(early?(b.early?.retained??0)-(a.early?.retained??0)||(a.early?.missing??20)-(b.early?.missing??20):0);
  const pairOrder=(a:DirectionRow,b:DirectionRow)=>b.readyCores-a.readyCores||(a.hitOdds!==null&&b.hitOdds!==null?difference(b.hitOdds-a.hitOdds):0)||b.support-a.support||stable(a,b);
  const gearOrder=(a:DirectionRow,b:DirectionRow)=>gearAxis(a,b)||pairOrder(a,b);
  const assetOrder=(a:DirectionRow,b:DirectionRow)=>assetAxis(a,b)||gearOrder(a,b);
  eligible.sort((a,b)=>a.front-b.front||gearOrder(a,b)||assetOrder(a,b));
  const gearBest=[...eligible].filter(r=>r.gear.known).sort(gearOrder)[0];
  const traitMax=Math.max(0,...eligible.map(augmentCount));
  // Signals order recommendations; only an explicit user choice can establish
  // a reference route. Agreement never removes other strategy families.
  let mode:Extract<DirectionAdvice,{ready:true}>['mode']='flex',regime:StrategyRegime|null=null;
  // User intent is explicit, not statistical confidence. Keep an unavailable
  // chosen route visible with its pool warning, alongside feasible alternatives.
  const intent=input.intent,matching=[...dedup.values()].filter(r=>r.key===intent?.key&&(!intent.directionId||r.id===intent.directionId)&&(!intent.units?.length||[r.carry,r.tank].every(id=>intent.units!.includes(id))));
  const focused=matching.sort((a,b)=>{
    const fits=(r:DirectionRow)=>Number(!intent?.units?.length||[r.carry,r.tank].every(id=>intent.units!.includes(id)));
    return fits(b)-fits(a)||a.front-b.front||gearOrder(a,b);
  })[0];
  if(focused){mode='selected';regime=focused.regime;}
  const selected:DirectionRow[]=[];
  function pick(row:DirectionRow|undefined,label:string){if(!row)return;row.labels.push(label);if(!selected.some(r=>r.carry===row.carry&&r.regime===row.regime))selected.push(row);}
  pick(focused,'当前参考');
  const pool=focused?eligible.filter(r=>r.carry!==focused.carry||r.regime!==focused.regime):eligible;
  const preferMain=(a:DirectionRow,b:DirectionRow)=>focused?Number(b.regime===focused.regime)-Number(a.regime===focused.regime):0;
  if(traitMax)pick([...pool].sort((a,b)=>preferMain(a,b)||augmentCount(b)-augmentCount(a)||a.front-b.front||gearOrder(a,b))[0],'海克斯衔接');
  if(selected.length<3)pick([...pool].sort((a,b)=>preferMain(a,b)||(gearBest?.gear.known?gearOrder(a,b):assetOrder(a,b)))[0],gearBest?.gear.known?'装备方向':'数据备选');
  if(selected.length<3)pick([...pool].sort((a,b)=>preferMain(a,b)||assetOrder(a,b))[0],'过渡衔接');
  if(selected.length<3){
    const compatible=pool.filter(r=>!gearBest?.gear.known||r.gear.known&&r.gear.componentLift>=0&&r.gear.coreItemLift>=0);
    pick(compatible.sort((a,b)=>preferMain(a,b)||a.observedPlace-b.observedPlace||b.observations-a.observations||gearOrder(a,b))[0],'汇总表现');
  }
  if(!startup)for(const kind of regimes)if(selected.length<3&&!selected.some(r=>r.regime===kind))pick(pool.filter(r=>r.regime===kind).sort(gearBest?.gear.known?gearOrder:assetOrder)[0],'保留路线');
  for(const row of [...pool].sort(preferMain)){if(selected.length>=3)break;pick(row,'备选');}
  const chosen=selected.slice(0,3),comparisonRows:DirectionRow[]=[];
  for(const kind of regimes){
    const distinct:DirectionRow[]=[];
    for(const row of [...(focused?.regime===kind?[focused]:[]),...eligible.filter(r=>r.regime===kind)]){
      if(!distinct.some(r=>r.carry===row.carry))distinct.push(row);if(distinct.length===3)break;
    }
    comparisonRows.push(...distinct);
  }
  const holds=directionHolds(input,chosen,catalog,stages,focused?.regime==='reroll'?focused:undefined);
  return {ready:true,round:input.round,milestone,mode,regime,
    ...(focused?{focusId:focused.id}:{}),
    message:focused?focused.name:'候选阵容比较',
    orientation:gearOrientation(input.assets.items,gearModel),rows:chosen,comparisonRows,holds,augments:input.augments,candidates:dedup.size,owned:{...input.assets.units},shop:input.shop.map(c=>({...c})),
    gaps:[...(intent&&!focused?['已选阵容暂无适用的MetaTFT统计，下方为备选']:[]),...(!input.assets.inventoryComplete?['装备栏未齐，适配参考不完整']:[]),...(!input.augmentsComplete?['已选海克斯未齐']:[]),...(!input.assets.poolComplete?['同行牌池未齐']:[]),...(input.augments.some(id=>!catalog.augments[id])?['部分海克斯机制未覆盖']:[])]};
}
// Read from the verified current season pool instead of embedding patch values.
import {currentPool,shopCatalog,tierOdds} from '../game/shop-mechanics';
const poolSize=(cost:number)=>currentPool.poolByCost[cost as 1|2|3|4|5]??0;

function directionHolds(input:DirectionInput,rows:DirectionRow[],catalog:DirectionCatalog,stages:EarlyStage[],locked?:DirectionRow):EarlyHoldAdvice{
  const stage=input.assets.stage??2,owned=input.assets.units,boards:EarlyBoardSuggestion[]=[],routes=new Map<string,Set<string>>();
  const match=(a:string[],b:string[])=>a.length===b.length&&a.every(id=>b.includes(id));
  for(const row of rows){
    const ids=(input.assets.level??4)<=7?row.early?.units??[]:row.units;
    if(!ids.length)continue;
    const observed=stages.find(s=>s.stage===stage)?.boards.find(b=>match(b.units,ids));
    const key=observed?.id??'direction:'+ids.slice().sort().join('|');
    if(!boards.some(b=>b.id===key))boards.push({id:key,units:ids,held:ids.filter(id=>owned[id]>0),missing:ids.filter(id=>!owned[id]),score:0,
      battleWinRate:observed?.battleWinRate,matchupCount:observed?.matchupCount,count:observed?.count,avgPlace:observed?.avgPlace,associationCount:row.early?.count});
    for(const id of ids){if(catalog.roles[id]?.shop===false)continue;const set=routes.get(id)??new Set<string>();set.add(row.name);routes.set(id,set);}
  }
  if(locked)for(const id of [locked.carry,locked.tank]){const set=routes.get(id)??new Set<string>();set.add(locked.name);routes.set(id,set);}
  const cards=[...routes].flatMap(([id,names])=>{
    const count=owned[id]??0,slots=input.shop.filter(c=>c.id===id).map(c=>c.slot);
    // A transition needs a functional 2-star, not a speculative 3-star. Only an
    // explicitly committed reroll carry is allowed to keep accumulating to 9.
    const target=locked?.carry===id?9:3,quantity=Math.min(slots.length,Math.max(0,target-count));
    if(!count&&!quantity)return [];
    return [{id,owned:count,shopSlots:slots,quantity,priority:locked?.carry===id?3:names.size>1?2:1,reason:locked?.carry===id?'核心追三':names.size>1?'多路线共用':'过渡留牌',routes:[...names]}];
  }).sort((a,b)=>b.priority-a.priority||b.owned-a.owned||a.id.localeCompare(b.id));
  return {ready:true,cards,directions:rows.map(r=>({key:r.key,name:r.name})),boards:boards.slice(0,3),stage,stageEstimated:!input.assets.stage};
}
