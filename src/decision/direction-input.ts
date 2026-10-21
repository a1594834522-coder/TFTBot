import type {ReaderStatus} from '../recognition/status';
import {advisorInput} from '../game/comp-advisor';
import {normalizeShopHero} from '../game/shop-mechanics';
import type {DirectionInput} from './direction-advisor';

/** Personal direction evidence does not depend on complete opponent rosters,
 * gold/shop availability or the combat predictor being ready. */
export function directionInput(status:ReaderStatus|null,manualItems:string[]=[],now=Date.now()):DirectionInput{
  const assets=advisorInput(status,manualItems,now);
  assets.items.sort((a,b)=>a.id.localeCompare(b.id)||(a.holder??'').localeCompare(b.holder??''));
  assets.units=Object.fromEntries(Object.entries(assets.units).sort(([a],[b])=>a.localeCompare(b)));
  assets.opponents=Object.fromEntries(Object.entries(assets.opponents).sort(([a],[b])=>a.localeCompare(b)));
  const local=status?.tracker?.snapshot?.players.find(p=>p.isLocal);
  const placements=status?.cards.ownHoldings?.board??local?.placements?.filter(c=>c.area==='board'||c.position!==undefined&&c.position<28)??[];
  return {assets,round:status?.cards.round??null,
    augments:[...new Set(status?.cards.pickedAugments??[])],augmentsComplete:status?.cards.pickedAugmentsComplete===true,
    board:placements.map(c=>normalizeShopHero(c.name)),health:local?.health??null,
    shop:(status?.cards.shopReady?status.cards.shop:[]).flatMap((c,slot)=>c?.known&&c.kind!=='wisp'?[{id:normalizeShopHero(c.id),slot}]:[])};
}
