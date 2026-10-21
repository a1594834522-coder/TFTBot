import type {BattleRequest} from '../game/battle-forecast';
import type {BattleBoard} from '../game/battle-model-encoding';
import type {DirectionAdvice} from './direction-advisor';
import type {ShoppingInput} from './shopping-input';
import {trade,enumerateShoppingPlans,type TradingRules,type OwnedUnit} from './shop-ledger';
import {battleBoardKey,lineupCandidates,type LineupCandidate} from './lineup-search';
import {portableItem,equipmentAllocations,type EquipmentRules,type EquipMove} from './equipment-ledger';
import {gearAffinity,type GearModel} from './gear-affinity';
import type {BatchPredictor,TacticalOptions,TacticalUnit} from './shopping-tactics';
export interface HandoffChoice {
  sold:TacticalUnit[];bought:Array<{id:string;slot:number}>;moves:EquipMove[];
  recipients:TacticalUnit[];lineup:TacticalUnit[];goldAfter:number;refund:number;spent:number;
  winRate:number|null;gain:number|null;lowerGain:number;upperGain:number;
  requiredRackSlots:number;conditionalRack:boolean;
}
export type EquipmentHandoffs={ready:false;reason:string}|{
  ready:true;baseline:number|null;baselineGold:number;coverage:number;choices:HandoffChoice[];
  weightSource:BattleRequest['weightSource'];boards:number;limited:boolean;gaps:string[];
};
const view=(u:OwnedUnit):TacticalUnit=>({key:u.key,id:u.id,combatId:u.combatId,star:u.star,items:u.items.map(i=>i.id)});
/** Read-only sale -> purchase -> physical equipment allocation -> deployment
 * comparisons. Free equipment allocations and current purchases are evaluated
 * FIRST without any sale, so their gains cannot be misattributed to liquidation.
 * Search candidates are bounded/affinity-ordered; only the combat model ranks
 * the final alternatives. Never claims complete equipment/global lineup search. */
export async function equipmentHandoffs(input:ShoppingInput,rules:TradingRules,equipment:EquipmentRules,advice:DirectionAdvice|undefined,request:BattleRequest,predict:BatchPredictor,gear:GearModel,options:TacticalOptions&{maxBoards?:number;maxSaleCases?:number;maxAllocations?:number}={}):Promise<EquipmentHandoffs>{
  if(!input.ready)return input;
  if(!advice?.ready||advice.updating||advice.mode!=='selected')return {ready:false,reason:'选择主线后比较装备承接'};
  if(request.localGaps.includes('海克斯未齐'))return {ready:false,reason:'等待已选海克斯以核对出售规则'};
  if(request.local.augments.some(id=>equipment.source.blockedAugments[id]))return {ready:false,reason:'当前海克斯改变出售规则，暂不比较普通接装'};
  if(input.gaps.includes('装备栏未齐'))return {ready:false,reason:'等待装备栏明细，避免漏掉无需出售的接装方案'};
  const main=advice.rows.find(r=>r.id===advice.focusId);if(!main)return {ready:false,reason:'等待所选主线核心'};
  const state=input.state,cores=new Set([main.carry,main.tank]),auxiliary=options.auxiliary??[];
  const physical:BattleBoard={...request.local,units:[...state.units.filter(u=>u.area==='board').map(u=>({id:u.combatId??u.id,star:u.star,items:u.items.map(i=>i.id)})),...auxiliary]};
  if(battleBoardKey(physical)!==battleBoardKey(request.local)||state.units.some(u=>u.area==='board'&&u.equipmentKnown===false))return {ready:false,reason:'等待本方棋盘与装备帧同步'};
  const total=request.targets.reduce((n,t)=>n+t.weight,0);
  if(Math.abs(total-1)>1e-7||new Set(request.targets.map(t=>t.id)).size!==request.targets.length||request.targets.some(t=>!Number.isFinite(t.weight)||t.weight<0))throw Error('Invalid handoff opponent weights');
  const targets=request.targets.filter(t=>t.weight>0&&t.board),coverage=targets.reduce((n,t)=>n+t.weight,0);if(!coverage)return {ready:false,reason:'等待对手场上棋盘'};
  const profile=main.key.startsWith('metatft:')?main.key.slice(8):main.key;
  const affinity=(u:OwnedUnit)=>{const fit=gearAffinity(gear,profile,u.id,u.items.map(i=>({id:i.id})));return fit.coreItemLift+fit.componentLift;};
  const donors=state.units.filter(u=>!cores.has(u.id)&&u.equipmentKnown!==false&&u.items.length&&u.items.every(t=>portableItem(t.id,equipment)));
  const uncoveredDonors=state.units.filter(u=>!cores.has(u.id)&&u.items.length&&!donors.includes(u)).length;
  const groups:OwnedUnit[][]=[[]];for(let i=0;i<donors.length;i++){groups.push([donors[i]]);for(let j=i+1;j<donors.length;j++)groups.push([donors[i],donors[j]]);}
  const original=new Set(state.units.filter(u=>u.area==='board').map(u=>u.key)),boards=new Map<string,BattleBoard>();
  type Candidate={sold:OwnedUnit[];refund:number;spent:number;gold:number;bought:Array<{id:string;slot:number}>;moves:EquipMove[];lineup:LineupCandidate;requiredRackSlots:number;conditionalRack:boolean};
  const candidateMap=new Map<string,Candidate>();
  let limited=false,examined=0;const issues=new Set<string>(uncoveredDonors?['部分持装英雄包含临时或未覆盖装备，不参与普通出售接装']:[]);
  const scopedOffers=state.offers.map(o=>o&&cores.has(o.id)?o:null);
  for(const sold of groups){
    if(options.cancelled?.())return {ready:false,reason:'局面已变化'};
    if(examined++>=(options.maxSaleCases??12)){limited=true;break;}
    const requiredRackSlots=sold.reduce((n,u)=>n+u.items.length,0),conditionalRack=rules.itemRackCapacity===null&&requiredRackSlots>0;
    const scenarioRules=conditionalRack?{...rules,itemRackCapacity:state.itemRack.length+requiredRackSlots}:rules;
    let after={...state,offers:scopedOffers},refund=0,legal=true;
    for(const unit of sold){const next=trade(after,{type:'sell',key:unit.key},scenarioRules);if(!next.ok){legal=false;break;}refund+=next.state.gold-after.gold;after=next.state;}
    if(!legal){issues.add('部分出售需先腾出装备栏空间');continue;}
    const plans=enumerateShoppingPlans(after,scenarioRules,{sellCandidates:[],stageToFreeBench:false}).plans;
    for(const plan of plans){
      const recipients=plan.state.units.filter(u=>cores.has(u.id)&&u.equipmentKnown!==false).sort((a,b)=>b.star-a.star||a.key.localeCompare(b.key)).slice(0,4).map(u=>u.key);
      const allocations=equipmentAllocations(plan.state,recipients,equipment,affinity,options.maxAllocations??24);
      for(const allocation of allocations){
        if(sold.some(unit=>{const released=new Set(unit.items.map(t=>t.key));return !allocation.moves.some(m=>released.has(m.token.key)||m.consumed.some(t=>released.has(t.key)));}))continue;
        for(const lineup of lineupCandidates(allocation.state,request.local.augments,2,request.local.charms,auxiliary)){
          const selected=new Set(lineup.units.map(u=>u.key));
          if(allocation.moves.some(m=>!selected.has(m.to))||[...original].filter(k=>!selected.has(k)).length>2||options.acceptsLineup&&!options.acceptsLineup(lineup)||lineup.units.some(u=>u.equipmentKnown===false))continue;
          if(options.supportsBoard&&!options.supportsBoard(lineup.board)){issues.add('部分承接棋盘的模型特征待覆盖');continue;}
          if(!boards.has(lineup.key)&&boards.size>=(options.maxBoards??16000)){limited=true;continue;}
          boards.set(lineup.key,lineup.board);
          const id=sold.map(u=>u.key).sort().join('|')+'|'+lineup.key,old=candidateMap.get(id);
          if(!old&&candidateMap.size>=100000){limited=true;continue;}
          if(!old||allocation.state.gold>old.gold||allocation.state.gold===old.gold&&allocation.moves.length<old.moves.length)candidateMap.set(id,{sold,refund,spent:plan.spent,gold:allocation.state.gold,bought:plan.buySlots.map(slot=>({id:state.offers[slot]!.id,slot})),moves:allocation.moves,lineup,requiredRackSlots,conditionalRack});
        }
      }
      await options.yield?.();
    }
  }
  const baselineBoard=battleBoardKey(request.local);boards.set(baselineBoard,request.local);
  const jobs=[...boards].flatMap(([key,player])=>targets.map(t=>({key,weight:t.weight,player,opponent:t.board!}))),scores=new Map<string,number>();
  for(let offset=0;offset<jobs.length;offset+=128){
    if(options.cancelled?.())return {ready:false,reason:'局面已变化'};
    const batch=jobs.slice(offset,offset+128),values=predict(batch);
    if(values.length!==batch.length||values.some(v=>!Number.isFinite(v.winRate)||v.winRate<0||v.winRate>1))throw Error('Invalid handoff model result');
    batch.forEach((job,i)=>scores.set(job.key,(scores.get(job.key)??0)+job.weight*values[i].winRate));await options.yield?.();
  }
  const candidates=[...candidateMap.values()];
  const order=(a:Candidate,b:Candidate)=>{const difference=scores.get(b.lineup.key)!-scores.get(a.lineup.key)!;return (Math.abs(difference)>1e-6?difference:0)||a.sold.length-b.sold.length||b.gold-a.gold||a.moves.length-b.moves.length;};
  const free=candidates.filter(c=>!c.sold.length).sort(order)[0],baseline=Math.max(scores.get(baselineBoard)!,free?scores.get(free.lineup.key)!:0);
  const transfers=candidates.filter(c=>c.sold.length).sort(order),chosen:typeof transfers=[];
  // More cash alone must not promote a large immediate deterioration. If no
  // handoff improves the compared free choices, retain ONE honest comparison.
  const eligible=transfers[0]&&scores.get(transfers[0].lineup.key)!>baseline+1e-6?transfers.filter(c=>scores.get(c.lineup.key)!>baseline+1e-6):transfers.slice(0,1);
  const seen=new Set<string>();for(const row of eligible){const id=row.sold.map(u=>u.key).sort().join('|')+'|'+row.lineup.key;if(seen.has(id))continue;seen.add(id);
    if(chosen.some(c=>c.gold>=row.gold&&scores.get(c.lineup.key)!>=scores.get(row.lineup.key)!-1e-6))continue;chosen.push(row);if(chosen.length===2)break;}
  const missing=1-coverage;
  return {ready:true,baseline:coverage>=1-1e-7?baseline:null,baselineGold:free?.gold??state.gold,coverage,weightSource:request.weightSource,boards:boards.size,limited,
    choices:chosen.map(row=>{const win=scores.get(row.lineup.key)!,gain=win-baseline;return {sold:row.sold.map(view),bought:row.bought,moves:row.moves,recipients:row.lineup.units.filter(u=>cores.has(u.id)).map(view),lineup:row.lineup.units.map(view),goldAfter:row.gold,refund:row.refund,spent:row.spent,winRate:coverage>=1-1e-7?win:null,gain:coverage>=1-1e-7?gain:null,lowerGain:Math.max(-1,gain-missing),upperGain:Math.min(1,gain+missing),requiredRackSlots:row.requiredRackSlots,conditionalRack:row.conditionalRack};}),
    gaps:[...new Set([...request.localGaps,...request.targets.filter(t=>t.weight>0).flatMap(t=>t.gaps),...issues,...(rules.provisional||equipment.provisional?['S18 PBE装备与出售表参考，正式服特殊规则待核对']:[]),'装备分配按MetaTFT兼容频率限量生成，结果仅是已比较方案；不是最优接装或长期名次收益','当前最多出售两名持装英雄，并保持最多两名原上场英雄离场；未模拟装备历史叠层',...(limited?['候选搜索达到限额']:[])])]};
}
