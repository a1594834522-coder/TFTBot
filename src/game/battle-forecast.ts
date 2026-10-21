import type {BattleBoard} from './battle-model-encoding';
import type {ReaderStatus} from '../recognition/status';
import type {ChampionPlacement} from '../core/events';
import {normalizeShopHero} from './shop-mechanics';
import {isGeneratedUnit} from './shop-mechanics';
import {combatHeroId} from './combat-unit-identity';
import type {ShoppingTactics} from '../decision/shopping-tactics';
import type {StrategicAdvice} from '../decision/strategic-advisor';
import type {DirectionAdvice} from '../decision/direction-advisor';
import type {SearchLandings} from '../decision/search-landings';
import type {EquipmentHandoffs} from '../decision/equipment-handoffs';
import type {CurrentPursuit} from '../decision/current-pursuit';

export interface OpponentPrior {round:string;source:'native'|'manual'|'vision';weights:Record<string,number>}
export interface BattleTarget {id:string;name:string;weight:number;board:BattleBoard|null;gaps:string[]}
export interface BattleRequest {round:string|null;local:BattleBoard;localGaps:string[];targets:BattleTarget[];weightSource:'uniform'|'native'|'manual'|'vision'}
export interface BattleForecast {
  phase:'waiting'|'loading'|'ready'|'error';message:string;at:number;round:string|null;
  weightSource:'uniform'|'native'|'manual'|'vision';winRate:number|null;lower:number;upper:number;coverage:number;
  approximate:boolean;gaps:string[];modelVersion?:string;
  opponents:Array<{id:string;name:string;weight:number;winRate:number|null;gaps:string[]}>;
  tactics?:ShoppingTactics;
  strategy?:StrategicAdvice;
  direction?:DirectionAdvice;
  landings?:SearchLandings;
  handoffs?:EquipmentHandoffs;
  pursuit?:CurrentPursuit;
}
export const emptyBattleForecast=(message='等待场上棋盘'):BattleForecast=>({phase:'waiting',message,at:Date.now(),round:null,weightSource:'uniform',winRate:null,lower:0,upper:1,coverage:0,approximate:true,gaps:[],opponents:[]});

/** Use only explicit candidate evidence for exclusions; tft_opp is NOT proof of next opponent. */
export function opponentWeights(ids:string[],round:string|null,prior?:OpponentPrior):{source:BattleRequest['weightSource'];weights:Record<string,number>} {
  const unique=[...new Set(ids)];
  if(!unique.length)return {source:'uniform',weights:{}};
  if(prior&&prior.round===round){
    if(Object.entries(prior.weights).some(([id,n])=>!unique.includes(id)||!Number.isFinite(n)||n<0))throw new Error('Invalid opponent prior');
    const total=unique.reduce((n,id)=>n+(prior.weights[id]??0),0);
    if(total<=0)throw new Error('Empty opponent prior');
    return {source:prior.source,weights:Object.fromEntries(unique.map(id=>[id,(prior.weights[id]??0)/total]))};
  }
  return {source:'uniform',weights:Object.fromEntries(unique.map(id=>[id,1/unique.length]))};
}
function unitItems(c:ChampionPlacement):{items:string[];known:boolean}{
  if(Array.isArray(c.items))return {items:[...c.items],known:true};
  const known=['item_1','item_2','item_3'].every(k=>typeof c[k]==='string');
  return {items:[c.item_1,c.item_2,c.item_3].filter((x):x is string=>typeof x==='string'&&!!x),known};
}
function boardFromUnits(units:ChampionPlacement[],augments:string[]|undefined):{board:BattleBoard;gaps:string[]}|null{
  const gaps=new Set<string>();
  const mapped=units.map(c=>{
    const star=isGeneratedUnit(c.name)?Number(c.level)||1:Number(c.level),gear=unitItems(c);
    if(!gear.known)gaps.add('装备未齐');
    return {id:combatHeroId(c.name),star,items:gear.items};
  });
  if(mapped.some(u=>!Number.isInteger(u.star)||u.star<1||u.star>4||u.items.length>3))return null;
  if(augments===undefined)gaps.add('海克斯未齐');
  return {board:{units:mapped,augments:augments??[]},gaps:[...gaps]};
}
function boardOnly(units:ChampionPlacement[]|undefined):ChampionPlacement[]|null{
  if(!units||units.some(c=>c.area!=='board'&&c.area!=='bench'&&!Number.isInteger(c.position)))return null;
  return units.filter(c=>c.area==='board'||c.area!=='bench'&&c.position!==undefined&&c.position>=0&&c.position<28);
}
const signature=(units:ChampionPlacement[])=>units.map(c=>`${normalizeShopHero(c.name)}:${Number(c.level)}`).sort().join('|');
function compatibleObservedForms(current:ChampionPlacement[],observed:ChampionPlacement[]):boolean{
  const available=observed.map(c=>`${combatHeroId(c.name)}:${Number(c.level)}`);
  for(const unit of current){
    if(combatHeroId(unit.name)===normalizeShopHero(unit.name))continue;
    const index=available.indexOf(`${combatHeroId(unit.name)}:${Number(unit.level)}`);
    if(index<0)return false;available.splice(index,1);
  }
  return true;
}

/** Build a bounded, personal-data-minimal worker request. Player names never leave this machine. */
export function battleRequest(status:ReaderStatus|null,now=Date.now(),prior?:OpponentPrior):BattleRequest|null{
  if(status?.phase!=='receiving'||status.lastFrameAt===null||now-status.lastFrameAt<0||now-status.lastFrameAt>15000)return null;
  const players=status.tracker?.snapshot?.players??[],locals=players.filter(p=>p.isLocal&&p.health>0);
  if(locals.length!==1)return null;
  const local=locals[0],round=status.cards.round??null,observations=status.cards.battleBoards;
  const own=observations?.local?.units??boardOnly(local.placements);
  if(!own)return null;
  const ownBoard=boardFromUnits(own,status.cards.pickedAugmentsComplete?status.cards.pickedAugments:undefined);
  if(!ownBoard)return null;
  const opponents=players.filter(p=>!p.isLocal&&p.health>0);
  const weights=opponentWeights(opponents.map(p=>p.name),round,prior);
  const targets=opponents.map(p=>{
    const observed=observations?.opponents[p.name];
    const current=boardOnly(p.placements);
    const age=observed?now-observed.at:Infinity;
    // Observed equipment is never transferred to a changed native board. Scouting ages are explicit.
    const usable=observed&&age>=0&&age<=60000&&(!current||signature(current)===signature(observed.units)&&compatibleObservedForms(current,observed.units));
    const units=usable?observed.units:current;
    const parsed=units?boardFromUnits(units,undefined):null;
    const gaps=parsed?.gaps??['场上棋盘未齐'];
    if(usable&&age>15000)gaps.push('侦察快照较旧');
    return {id:p.name,name:p.summoner,weight:weights.weights[p.name]??0,board:parsed?.board??null,gaps};
  });
  if(!targets.length)return null;
  return {round,local:ownBoard.board,localGaps:ownBoard.gaps,targets,weightSource:weights.source};
}

/** Missing mass remains unknown [0,1]. Never normalize away an unobserved opponent. */
export function aggregateBattleForecast(request:BattleRequest,predictions:Record<string,number|null>,modelVersion:string,at=Date.now()):BattleForecast{
  let lower=0,coverage=0;
  const opponents=request.targets.map(t=>{
    const p=predictions[t.id],valid=t.board!==null&&p!==null&&p!==undefined&&Number.isFinite(p)&&p>=0&&p<=1;
    if(valid){lower+=t.weight*p;coverage+=t.weight;}
    return {id:t.id,name:t.name,weight:t.weight,winRate:valid?p:null,gaps:t.gaps};
  });
  const total=request.targets.reduce((n,t)=>n+t.weight,0);
  if(Math.abs(total-1)>1e-7||request.targets.some(t=>!Number.isFinite(t.weight)||t.weight<0))throw new Error('Opponent weights must sum to one');
  coverage=Math.min(1,coverage);
  const gaps=[...new Set([...request.localGaps,...opponents.filter(o=>o.weight>0).flatMap(o=>o.gaps)])];
  return {phase:'ready',message:request.weightSource==='uniform'?'MetaTFT 全场等权参考，下一场候选未识别':'MetaTFT 候选对手加权参考',at,round:request.round,weightSource:request.weightSource,winRate:coverage>=1-1e-7?lower:null,lower,upper:Math.min(1,lower+(1-coverage)),coverage,approximate:gaps.length>0,gaps,modelVersion,opponents};
}
