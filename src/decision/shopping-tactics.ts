import type {BattleBoard} from '../game/battle-model-encoding';
import type {BattleRequest} from '../game/battle-forecast';
import {enumerateShoppingPlans,interest,type ShopState,type TradingRules,type ShoppingPlan,type TradeAction} from './shop-ledger';
import {lineupCandidates,battleBoardKey,type LineupCandidate} from './lineup-search';

export interface TacticalChoice {
  id:'economy'|'tempo';title:string;
  buy:Array<{id:string;slots:number[];quantity:number}>;
  actions:TradeAction[];onBoard:string[];onBoardKeys:string[];onBoardStars:number[];
  goldAfter:number;interestIfLose:number;interestIfWin:number;
  winRate:number|null;knownWin:number;coverage:number;delta:number|null;
}
export type ShoppingTactics={ready:false;reason:string}|{
  ready:true;choices:TacticalChoice[];baseline:number|null;coverage:number;
  searchedPlans:number;searchedBoards:number;maxSwaps:number;provisional:boolean;
  rulesVersion:string;gaps:string[];
  weightSource:BattleRequest['weightSource'];
};
export type BatchPredictor=(pairs:Array<{player:BattleBoard;opponent:BattleBoard}>)=>Array<{winRate:number}>;
/** Current-shop tactical frontier, not a final-placement policy. No preselected comp,
 * arbitrary gold-to-win conversion, or automatic game input. Future bench option value
 * stays with the strategic adviser, so default search never sells existing assets. */
export async function shoppingTactics(state:ShopState,rules:TradingRules,request:BattleRequest,predict:BatchPredictor,options:{cancelled?:()=>boolean;yield?:()=>Promise<void>;maxSwaps?:number}={}):Promise<ShoppingTactics>{
  const maxSwaps=options.maxSwaps??1;
  const search=enumerateShoppingPlans(state,rules,{sellCandidates:[]});
  const candidates=new Map<string,LineupCandidate>();
  const byPlan=search.plans.map(plan=>{
    const lineups=lineupCandidates(plan.state,request.local.augments,maxSwaps);
    for(const candidate of lineups)candidates.set(candidate.key,candidate);
    return {plan,lineups};
  });
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
  const best=byPlan.flatMap(({plan,lineups})=>{
    const ordered=lineups.sort((a,b)=>(scores.get(b.key)??-1)-(scores.get(a.key)??-1)||a.key.localeCompare(b.key));
    return ordered[0]?[{plan,lineup:ordered[0],win:scores.get(ordered[0].key)!}]:[];
  });
  const sort=(a:typeof best[number],b:typeof best[number])=>(Math.abs(b.win-a.win)>1e-6?b.win-a.win:0)||b.plan.state.gold-a.plan.state.gold||a.plan.actions.length-b.plan.actions.length;
  best.sort(sort);
  const floorLose=interest(state.gold,rules),floorWin=interest(state.gold+rules.victoryGoldBeforeInterest,rules);
  const economic=best.filter(p=>p.plan.interestIfLose>=floorLose&&p.plan.interestIfWin>=floorWin).sort(sort)[0];
  const strongest=best[0],baseline=scores.get(baselineKey)!;
  function choice(row:typeof best[number],id:TacticalChoice['id']):TacticalChoice{
    const buy=new Map<string,{id:string;slots:number[];quantity:number}>();
    for(const slot of row.plan.buySlots){const offer=state.offers[slot]!;const group=buy.get(offer.id)??{id:offer.id,slots:[],quantity:0};group.slots.push(slot);group.quantity++;buy.set(offer.id,group);}
    return {id,title:id==='economy'?'保经济':'提战力',buy:[...buy.values()],actions:row.plan.actions,onBoard:row.lineup.units.map(u=>u.id),onBoardKeys:row.lineup.units.map(u=>u.key),onBoardStars:row.lineup.units.map(u=>u.star),goldAfter:row.plan.state.gold,interestIfLose:row.plan.interestIfLose,interestIfWin:row.plan.interestIfWin,knownWin:row.win,winRate:coverage>=1-1e-7?row.win:null,coverage,delta:coverage>=1-1e-7?row.win-baseline:null};
  }
  const choices:TacticalChoice[]=[];
  if(economic)choices.push(choice(economic,'economy'));
  if(strongest&&(!economic||Math.abs(strongest.win-economic.win)>1e-6||strongest.plan.state.gold!==economic.plan.state.gold))choices.push(choice(strongest,'tempo'));
  return {ready:true,choices,baseline:coverage>=1-1e-7?baseline:null,coverage,searchedPlans:search.plans.length,searchedBoards:boards.size,maxSwaps,provisional:rules.provisional,rulesVersion:rules.version,weightSource:request.weightSource,gaps:[...new Set([...request.localGaps,...request.targets.filter(t=>t.weight>0).flatMap(t=>t.gaps)])]};
}
