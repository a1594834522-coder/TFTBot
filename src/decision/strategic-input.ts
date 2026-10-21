import type {ReaderStatus} from '../recognition/status';
import {currentPool,normalizeShopHero,shopCatalog,tierOdds} from '../game/shop-mechanics';
import type {ShoppingInput} from './shopping-input';
import type {ShopState} from './shop-ledger';
import type {StrategicPool} from './strategic-options';
export type StrategicInput={ready:false;reason:string}|{ready:true;stage:number;state:ShopState;pool:StrategicPool;gaps:string[]};
/** Require coherent own physical and whole-lobby copy frames before subtracting stocks. */
export function strategicInput(status:ReaderStatus|null,shopping:ShoppingInput):StrategicInput{
  if(!shopping.ready)return shopping;
  const stage=status?.cards.stage;if(!Number.isInteger(stage)||!stage||stage<2||stage>9)return {ready:false,reason:'等待可识别的对局阶段'};
  const players=status?.tracker?.snapshot?.players.filter(p=>p.health>0)??[],locals=players.filter(p=>p.isLocal),known=new Map(shopCatalog.map(h=>[h.character_id,h]));
  if(locals.length!==1||players.length<2||players.some(p=>p.coverage==='partial'||p.placements===undefined||p.champions.some(c=>!known.has(normalizeShopHero(c.name)))))return {ready:false,reason:'等待全场持牌明细'};
  const physical:Record<string,number>={},reported:Record<string,number>={};
  for(const u of shopping.state.units)physical[u.id]=(physical[u.id]??0)+3**(u.star-1);
  for(const c of locals[0].champions){const id=normalizeShopHero(c.name);reported[id]=(reported[id]??0)+c.copies;}
  if([...new Set([...Object.keys(physical),...Object.keys(reported)])].some(id=>physical[id]!==reported[id]))return {ready:false,reason:'等待本方持牌帧同步'};
  const remaining=Object.fromEntries(shopCatalog.map(h=>[h.character_id,currentPool.poolByCost[h.cost as 1|2|3|4|5]]));
  for(const player of players)for(const unit of player.champions){const id=normalizeShopHero(unit.name);remaining[id]-=unit.copies;}
  if(Object.values(remaining).some(n=>!Number.isSafeInteger(n)||n<0))return {ready:false,reason:'等待牌池占用同步'};
  return {ready:true,stage,state:shopping.state,pool:{complete:true,remaining,tierRemaining:Object.fromEntries([1,2,3,4,5].map(cost=>[cost,shopCatalog.filter(h=>h.cost===cost).reduce((sum,h)=>sum+remaining[h.character_id],0)])),tierOdds:Object.fromEntries([1,2,3,4,5].map(cost=>[cost,tierOdds(shopping.state.level,cost as 1|2|3|4|5)])),heroSlotsCycle:[4],refreshPrice:2},gaps:[...shopping.gaps,'仙灵刷新阶段未同步，按每次四个英雄格参考']};
}
