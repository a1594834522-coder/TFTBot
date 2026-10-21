import type { ReaderStatus } from '../recognition/status';
import { analyzePool, type Cost } from './cardTracker';
import { currentPool, normalizeShopHero, shopCatalog, tierOdds } from './shop-mechanics';
import { estimateRoll } from './roll-odds';
import { dataset } from './tft-data';
export function overlayModel(status:ReaderStatus|null) {
  const snapshot=status?.tracker?.snapshot;
  const alive=snapshot?.players.filter(p=>p.health>0)??[];
  const complete=!!alive.length && status?.phase==='receiving' && alive.every(p=>p.placements!==undefined && p.coverage!=='partial' && p.champions.every(c=>shopCatalog.some(h=>h.character_id===normalizeShopHero(c.name))));
  const pool=analyzePool(snapshot?.ownedByName??{},shopCatalog,{pool:currentPool,normalizeName:normalizeShopHero});
  return {complete,level:status?.cards.level,card(id:string){
    const canonical=normalizeShopHero(id),hero=dataset.characterById(canonical);
    const row=pool.find(r=>r.champion===canonical);
    const ready=complete && !!status?.cards.level && !!row?.cost;
    const result=ready?estimateRoll({tierProbability:tierOdds(status!.cards.level!,row!.cost as Cost),remaining:row!.remaining,tierRemaining:pool.filter(r=>r.cost===row!.cost).reduce((sum,r)=>sum+r.remaining,0),inShop:status?.cards.shop.some(c=>c && normalizeShopHero(c.id)===canonical)}):null;
    return {id:canonical,name:hero?.display_name??'名称待更新',image:hero?.image_path,cost:hero?.cost??0,remaining:complete?row?.remaining:undefined,result};
  }};
}
