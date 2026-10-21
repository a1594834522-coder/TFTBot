import policy from '../../data/battle-unit-policy.json';
import {encodeBattleBoard,type BattleBoard,type BattleLookups,type BattleUnit} from '../game/battle-model-encoding';
import {isGeneratedUnit} from '../game/shop-mechanics';
import type {BattleRequest} from '../game/battle-forecast';
import type {ShopState,OwnedUnit} from './shop-ledger';
import type {LineupCandidate} from './lineup-search';
interface AuxiliaryRule {name:string;augments:string[];contextTraits:string[];minimumTraits?:Record<string,number>}
const rules=policy.auxiliaries as Record<string,AuxiliaryRule>;
const formPools=new Set(Object.values(policy.forms).map(f=>f.poolId));
export const auxiliaryName=(id:string)=>rules[id]?.name??'独立单位';
export function modelBoardGaps(board:BattleBoard,lookup:BattleLookups):string[]{
  const gaps=encodeBattleBoard(board,lookup,'player').excludedUnits.length?['部分召唤单位未单独建模']:[];
  if(board.augments.includes('DA_Dummify'))gaps.push('假人历史属性未单独建模');
  if(board.units.some(u=>formPools.has(u.id)))gaps.push('部分英雄形态未确认');
  return gaps;
}
export type TacticalContext={ready:false;reason:string}|{ready:true;request:BattleRequest;auxiliary:BattleUnit[];accepts:(candidate:LineupCandidate)=>boolean;gaps:string[]};
/** Follow the observed model contract without making auxiliaries tradeable or
 * spending normal champion slots on them. Context-dependent summons remain only
 * for candidates preserving their actual source entities, stars and equipment. */
export function battleTacticalContext(request:BattleRequest,state:ShopState,lookup:BattleLookups):TacticalContext{
  const encoded=encodeBattleBoard(request.local,lookup,'player');
  if(encoded.unknown.length)return {ready:false,reason:'本方模型特征待覆盖'};
  if(encoded.excludedUnits.some(id=>lookup.unit_traits[id]?.length||lookup.charm_encodings[id]!==undefined))return {ready:false,reason:'召唤单位的额外羁绊联动待核对'};
  const auxiliary=encoded.modeledUnits.filter(u=>isGeneratedUnit(u.id)).map(u=>({...u,items:[...u.items]})),traits=new Set<string>(),gaps=modelBoardGaps(request.local,lookup);
  if(auxiliary.length&&request.localGaps.includes('装备未齐'))return {ready:false,reason:'等待独立单位装备明细'};
  for(const unit of auxiliary){
    const rule=rules[unit.id];
    if(!rule||!rule.augments.some(id=>request.local.augments.includes(id)))return {ready:false,reason:'独立单位的来源与换牌联动待核对'};
    if(Object.entries(rule.minimumTraits??{}).some(([trait,min])=>(encoded.traitCounts[trait]??0)<min))return {ready:false,reason:'等待伙伴羁绊与召唤者同步'};
    rule.contextTraits.forEach(t=>traits.add(t));
  }
  const related=(unit:OwnedUnit)=>(lookup.unit_traits[unit.combatId??unit.id]??[]).some(t=>traits.has(t))||unit.items.some(item=>traits.has(lookup.emblems[item.id]));
  const signature=(units:OwnedUnit[])=>JSON.stringify(units.filter(related).map(u=>[u.key,u.combatId??u.id,u.star,u.items.map(i=>[i.key,i.id]).sort()]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const source=signature(state.units.filter(u=>u.area==='board'));
  if(traits.size){
    if(!state.units.some(u=>u.area==='board'&&related(u)))return {ready:false,reason:'等待伙伴召唤者信息'};
    gaps.push('伙伴召唤物按当前骑乘条件保留');
  }
  return {ready:true,request:{...request,local:{...request.local,units:encoded.modeledUnits}},auxiliary,
    accepts:candidate=>!traits.size||signature(candidate.units)===source,gaps};
}
