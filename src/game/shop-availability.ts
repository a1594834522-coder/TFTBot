import type {ReaderStatus} from '../recognition/status';
import {normalizeShopHero,shopCatalog} from './shop-mechanics';
const costs=new Map(shopCatalog.map(h=>[h.character_id,h.cost]));
export const freshReader=(status:ReaderStatus|null,now=Date.now())=>status?.phase==='receiving'&&status.lastFrameAt!==null&&Number.isFinite(status.lastFrameAt)&&now-status.lastFrameAt>=0&&now-status.lastFrameAt<=15000;
/** Seeing a copy does not require knowing the whole lobby or the level. The
 * price is explicitly the normal unit price; native shop discounts are not read. */
export function shopAvailability(status:ReaderStatus|null,id:string,now=Date.now()){
  if(!freshReader(status,now)||!status!.cards.shopReady||status!.cards.shop.length!==5)return null;
  const canonical=normalizeShopHero(id),price=costs.get(canonical);
  if(!price)return null;
  const count=status!.cards.shop.filter(c=>c?.known&&c.kind!=='wisp'&&normalizeShopHero(c.id)===canonical).length;
  if(!count)return null;
  const gold=status!.cards.gold,walletKnown=Number.isSafeInteger(gold)&&gold!>=0;
  return {count,price,affordableCount:walletKnown?Math.min(count,Math.floor(gold!/price)):null,
    missingGold:walletKnown?Math.max(0,price-gold!):null,hidden:status!.cards.shopVisible===false};
}
