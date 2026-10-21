import type {BattleBoard} from '../game/battle-model-encoding';
import type {BattleRequest} from '../game/battle-forecast';
import {enumerateShoppingPlans,interest,type ShopState,type TradingRules,type TradeAction,type OwnedUnit} from './shop-ledger';
import {lineupCandidates,battleBoardKey,type LineupCandidate} from './lineup-search';
import type {DirectionAdvice} from './direction-advisor';

export interface TacticalChoice {
  id:'economy'|'tempo'|'mainline';title:string;
  buy:Array<{id:string;slots:number[];quantity:number}>;
  actions:TradeAction[];onBoard:string[];onBoardKeys:string[];onBoardStars:number[];
  goldAfter:number;interestIfLose:number;interestIfWin:number;
  winRate:number|null;knownWin:number;coverage:number;delta:number|null;
  incoming:TacticalUnit[];outgoing:TacticalUnit[];upgraded:Array<{id:string;before:number;after:number}>;
  onBoardItems:string[][];mainlineCores:string[];
  lowerDelta:number;upperDelta:number;
}
export interface TacticalUnit {key:string;id:string;star:number;items:string[]}
export interface TacticalReference {cores:string[]}
export interface TacticalOptions {
  cancelled?:()=>boolean;yield?:()=>Promise<void>;maxSwaps?:number;
  reference?:TacticalReference;supportsBoard?:(board:BattleBoard)=>boolean;
}
export type ShoppingTactics={ready:false;reason:string}|{
  ready:true;choices:TacticalChoice[];baseline:number|null;coverage:number;
  searchedPlans:number;searchedBoards:number;maxSwaps:number;provisional:boolean;
  rulesVersion:string;gaps:string[];
  weightSource:BattleRequest['weightSource'];
};
export type BatchPredictor=(pairs:Array<{player:BattleBoard;opponent:BattleBoard}>)=>Array<{winRate:number}>;
export function mainlineTacticalReference(advice:DirectionAdvice|undefined):TacticalReference|undefined{
  if(!advice?.ready||advice.updating||advice.mode!=='selected'||!['roll-down','late'].includes(advice.milestone))return undefined;
  const row=advice.rows.find(r=>r.id===advice.focusId);
  return row?{cores:[...new Set([row.carry,row.tank])]}:undefined;
}
/** Current-shop tactical frontier, not a final-placement policy. Explicit user
 * intent adds a separate core-preserving scenario, without auto-selecting it.
 * Future bench option value stays with the strategic adviser; existing assets
 * are not sold and worn equipment is never transferred by this search. */
export async function shoppingTactics(state:ShopState,rules:TradingRules,request:BattleRequest,predict:BatchPredictor,options:TacticalOptions={}):Promise<ShoppingTactics>{
  const maxSwaps=options.maxSwaps??2;
  if(options.cancelled?.())return {ready:false,reason:'局面已变化'};
  const physical:BattleBoard={units:state.units.filter(u=>u.area==='board').map(u=>({id:u.id,star:u.star,items:u.items.map(i=>i.id)})),augments:request.local.augments,charms:request.local.charms};
  if(battleBoardKey(physical)!==battleBoardKey(request.local))return {ready:false,reason:request.local.units.some(u=>!rules.heroes[u.id])?'非商店单位的换牌联动待覆盖，暂不比较上场':'等待本方场上棋盘与装备帧同步'};
  if(state.units.some(u=>u.area==='board'&&u.equipmentKnown===false))return {ready:false,reason:'等待本方场上英雄装备明细'};
  const total=request.targets.reduce((n,t)=>n+t.weight,0);
  if(Math.abs(total-1)>1e-7||new Set(request.targets.map(t=>t.id)).size!==request.targets.length||request.targets.some(t=>!Number.isFinite(t.weight)||t.weight<0))throw Error('Invalid tactical opponent weights');
  const search=enumerateShoppingPlans(state,rules,{sellCandidates:[]});
  const candidates=new Map<string,LineupCandidate>();
  const supported=new Map<string,boolean>();let unsupported=0,incompleteEquipment=false;
  const byPlan:Array<{plan:typeof search.plans[number];lineups:LineupCandidate[]}>=[];
  for(const plan of search.plans){
    if(options.cancelled?.())return {ready:false,reason:'局面已变化'};
    const lineups=lineupCandidates(plan.state,request.local.augments,maxSwaps,request.local.charms).filter(candidate=>{
      if(candidate.units.some(u=>u.equipmentKnown===false)){incompleteEquipment=true;return false;}
      let valid=supported.get(candidate.key);
      if(valid===undefined){valid=options.supportsBoard?.(candidate.board)??true;supported.set(candidate.key,valid);if(!valid)unsupported++;}
      if(valid)candidates.set(candidate.key,candidate);return valid;
    });
    byPlan.push({plan,lineups});await options.yield?.();
  }
  const baselineKey=battleBoardKey(request.local);
  const boards=new Map<string,BattleBoard>([...candidates].map(([key,c])=>[key,c.board]));boards.set(baselineKey,request.local);
  const targets=request.targets.filter(t=>t.weight>0&&t.board);
  const coverage=targets.reduce((n,t)=>n+t.weight,0);
  if(!coverage)return {ready:false,reason:'等待对手场上棋盘'};
  const scores=new Map<string,number>();
  const jobs=[...boards].flatMap(([key,board])=>targets.map(target=>({key,weight:target.weight,player:board,opponent:target.board!})));
  for(let offset=0;offset<jobs.length;offset+=128){
    if(options.cancelled?.())return {ready:false,reason:'局面已变化'};
    const batch=jobs.slice(offset,offset+128),results=predict(batch);
    if(results.length!==batch.length||results.some(p=>!Number.isFinite(p.winRate)||p.winRate<0||p.winRate>1))throw new Error('Invalid tactical model result');
    batch.forEach((job,i)=>scores.set(job.key,(scores.get(job.key)??0)+job.weight*results[i].winRate));
    await options.yield?.();
  }
  const originalKeys=new Set(state.units.filter(u=>u.area==='board').map(u=>u.key));
  const changes=(lineup:LineupCandidate)=>{
    const selected=new Set(lineup.units.map(u=>u.key));
    return lineup.units.filter(u=>!originalKeys.has(u.key)).length+[...originalKeys].filter(key=>!selected.has(key)).length;
  };
  const orderBoards=(a:LineupCandidate,b:LineupCandidate)=>(scores.get(b.key)??-1)-(scores.get(a.key)??-1)||changes(a)-changes(b)||a.key.localeCompare(b.key);
  const best=byPlan.flatMap(({plan,lineups})=>{
    const ordered=lineups.sort(orderBoards);
    return ordered[0]?[{plan,lineup:ordered[0],win:scores.get(ordered[0].key)!}]:[];
  });
  const sort=(a:typeof best[number],b:typeof best[number])=>(Math.abs(b.win-a.win)>1e-6?b.win-a.win:0)||b.plan.state.gold-a.plan.state.gold||a.plan.actions.length-b.plan.actions.length;
  best.sort(sort);
  if(!best.length)return {ready:false,reason:'当前备选棋盘的模型特征待覆盖'};
  const floorLose=interest(state.gold,rules),floorWin=interest(state.gold+rules.victoryGoldBeforeInterest,rules);
  const economic=best.filter(p=>p.plan.interestIfLose>=floorLose&&p.plan.interestIfWin>=floorWin).sort(sort)[0];
  const strongest=best[0],baseline=scores.get(baselineKey)!;
  const reference=[...new Set(options.reference?.cores??[])];
  const present=(lineup:LineupCandidate)=>reference.filter(id=>lineup.units.some(u=>u.id===id));
  const originalPresent=reference.filter(id=>request.local.units.some(u=>u.id===id)).length;
  // Preserve a separate route scenario, including a currently deployed core
  // that the strongest immediate board would bench. No route is auto-selected.
  const entering=reference.length?byPlan.flatMap(({plan,lineups})=>lineups.filter(c=>present(c).length>0).map(lineup=>({plan,lineup,win:scores.get(lineup.key)!}))):[];
  entering.sort((a,b)=>present(b.lineup).length-present(a.lineup).length||sort(a,b)||changes(a.lineup)-changes(b.lineup));
  function choice(row:typeof best[number],id:TacticalChoice['id']):TacticalChoice{
    const buy=new Map<string,{id:string;slots:number[];quantity:number}>();
    for(const slot of row.plan.buySlots){const offer=state.offers[slot]!;const group=buy.get(offer.id)??{id:offer.id,slots:[],quantity:0};group.slots.push(slot);group.quantity++;buy.set(offer.id,group);}
    const original=state.units.filter(u=>u.area==='board'),current=new Set(original.map(u=>u.key)),selected=new Set(row.lineup.units.map(u=>u.key));
    const view=(u:OwnedUnit):TacticalUnit=>({key:u.key,id:u.id,star:u.star,items:u.items.map(i=>i.id)});
    const consumed=new Set(row.plan.merges.flatMap(m=>m.consumed).filter(key=>!row.plan.state.units.some(u=>u.key===key)));
    const delta=Math.abs(row.win-baseline)<1e-6?0:row.win-baseline,missing=Math.max(0,1-coverage);
    return {id,title:id==='economy'?'保经济':id==='tempo'?'提战力':present(row.lineup).length>originalPresent?'主线接入':'主线保留',buy:[...buy.values()],actions:row.plan.actions,onBoard:row.lineup.units.map(u=>u.id),onBoardKeys:row.lineup.units.map(u=>u.key),onBoardStars:row.lineup.units.map(u=>u.star),onBoardItems:row.lineup.units.map(u=>u.items.map(i=>i.id)),goldAfter:row.plan.state.gold,interestIfLose:row.plan.interestIfLose,interestIfWin:row.plan.interestIfWin,knownWin:row.win,winRate:coverage>=1-1e-7?row.win:null,coverage,delta:coverage>=1-1e-7?delta:null,
      lowerDelta:Math.max(-1,delta-missing),upperDelta:Math.min(1,delta+missing),mainlineCores:present(row.lineup),
      incoming:row.lineup.units.filter(u=>!current.has(u.key)).map(view),outgoing:original.filter(u=>!selected.has(u.key)&&!consumed.has(u.key)).map(view),
      upgraded:row.lineup.units.flatMap(u=>{const old=original.find(p=>p.key===u.key);return old&&u.star>old.star?[{id:u.id,before:old.star,after:u.star}]:[]})};
  }
  const choices:TacticalChoice[]=[];
  const chosenBoards=new Set<string>();
  if(economic){choices.push(choice(economic,'economy'));chosenBoards.add(economic.lineup.key);}
  if(strongest&&(!economic||Math.abs(strongest.win-economic.win)>1e-6||strongest.plan.state.gold!==economic.plan.state.gold)){choices.push(choice(strongest,'tempo'));chosenBoards.add(strongest.lineup.key);}
  const mainline=entering[0];
  if(mainline&&!chosenBoards.has(mainline.lineup.key))choices.push(choice(mainline,'mainline'));
  return {ready:true,choices,baseline:coverage>=1-1e-7?baseline:null,coverage,searchedPlans:search.plans.length,searchedBoards:boards.size,maxSwaps,provisional:rules.provisional,rulesVersion:rules.version,weightSource:request.weightSource,gaps:[...new Set([...request.localGaps,...request.targets.filter(t=>t.weight>0).flatMap(t=>t.gaps),'模型不含站位；装备保留在当前英雄上，未模拟拆卸、重做或转移',...(unsupported?['部分备选棋盘有模型未覆盖特征']:[]),...(incompleteEquipment?['部分备选英雄装备明细未齐']:[])])]};
}
