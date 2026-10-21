import type {ReaderStatus} from '../recognition/status';
import type {ChampionPlacement} from '../core/events';
import {normalizeShopHero} from '../game/shop-mechanics';
import rulesFile from '../../data/decision-trading-rules.json';
import {validateShopState,type EquipmentToken,type OwnedUnit,type ShopState,type TradingRules} from './shop-ledger';

export const tradingRules=rulesFile as TradingRules;
export type ShoppingInput={ready:false;reason:string}|{ready:true;state:ShopState;gaps:string[];rulesVersion:string;provisional:boolean};
export function shoppingInput(status:ReaderStatus|null,now=Date.now()):ShoppingInput{
  if(status?.phase!=='receiving'||status.lastFrameAt===null||now-status.lastFrameAt<0||now-status.lastFrameAt>15000)return {ready:false,reason:'等待实时对局'};
  const locals=status.tracker?.snapshot?.players.filter(p=>p.isLocal&&p.health>0)??[];
  if(locals.length!==1)return {ready:false,reason:'等待本方身份'};
  const local=locals[0],cards=status.cards,holdings=cards.ownHoldings;
  if(cards.pickedAugments?.includes('DA_NoScoutNoPivot'))return {ready:false,reason:'坚守阵容的上场锁定记录未齐，暂停换牌搜索'};
  if(cards.gold===undefined)return {ready:false,reason:'等待金币数据'};
  if(holdings?.board===null||holdings?.board===undefined||holdings?.bench===null||holdings?.bench===undefined)return {ready:false,reason:'等待本方棋盘与备战席'};
  if(!Number.isInteger(cards.level)||!cards.level)return {ready:false,reason:'等待等级数据'};
  if(!cards.shopReady||cards.shop.length!==5)return {ready:false,reason:'等待完整商店'};
  const gaps=new Set<string>();
  const convert=(unit:ChampionPlacement,area:'board'|'bench'):OwnedUnit=>{
    const slot=Number(unit.position)-(area==='bench'?28:0),key=area+':'+slot;
    const known=Array.isArray(unit.items)||[unit.item_1,unit.item_2,unit.item_3].every(i=>typeof i==='string');
    if(!known)gaps.add('装备明细未齐');
    const raw=unit.items??[unit.item_1,unit.item_2,unit.item_3].filter((i):i is string=>!!i);
    return {key,id:normalizeShopHero(unit.name),star:Number(unit.level),area,slot,items:raw.map((id,index)=>({id,key:`${key}:item:${index}`})),equipmentKnown:known};
  };
  const benches=cards.itemBenches?.filter(b=>b.summoner===local.summoner&&b.tag_line===local.tagLine);
  const rack:EquipmentToken[]=[];
  if(benches?.length===1){for(const [entryIndex,item]of benches[0].bench_items.entries())for(let index=0;index<item.count;index++)rack.push({id:item.name,key:`rack:${entryIndex}:${index}`});}
  else {gaps.add('装备栏未齐');}
  if(cards.shop.some(c=>c&&c.kind!=='wisp'&&(!c.known||!tradingRules.heroes[normalizeShopHero(c.id)])))return {ready:false,reason:'未知商店英雄'};
  const offers=cards.shop.map((c,slot)=>{
    if(!c||c.kind==='wisp')return null;
    const hero=tradingRules.heroes[normalizeShopHero(c.id)];
    return {slot,id:normalizeShopHero(c.id),price:hero.cost};
  });
  try{
    const state:ShopState={gold:cards.gold,level:cards.level,boardCapacity:cards.level,units:[...holdings.board.map(u=>convert(u,'board')),...holdings.bench.map(u=>convert(u,'bench'))],offers,itemRack:rack};
    validateShopState(state,tradingRules);
    // An in-flight merge is not a stable physical snapshot for trade planning.
    for(const id of new Set(state.units.map(u=>u.id)))for(let star=1;star<tradingRules.heroes[id].maxStar;star++)if(state.units.filter(u=>u.id===id&&u.star===star).length>=3)return {ready:false,reason:'等待合成状态同步'};
    return {ready:true,state,gaps:[...gaps],rulesVersion:tradingRules.version,provisional:tradingRules.provisional};
  }catch{return {ready:false,reason:'当前实体棋盘或特殊规则待核对'};}
}
