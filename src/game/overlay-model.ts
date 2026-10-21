import type { ReaderStatus } from '../recognition/status';
import { analyzePool, type Cost } from './cardTracker';
import { currentPool, normalizeShopHero, shopCatalog, tierOdds } from './shop-mechanics';
import { estimateRoll } from './roll-odds';
import { dataset } from './tft-data';
import {freshReader,shopAvailability} from './shop-availability';
export function overlayModel(status:ReaderStatus|null,now=Date.now()) {
  const snapshot=status?.tracker?.snapshot;
  const alive=snapshot?.players.filter(p=>p.health>0)??[];
  const fresh=freshReader(status,now);
  const complete=!!alive.length && fresh && alive.every(p=>p.placements!==undefined && p.coverage!=='partial' && p.champions.every(c=>shopCatalog.some(h=>h.character_id===normalizeShopHero(c.name))));
  const pool=analyzePool(snapshot?.ownedByName??{},shopCatalog,{pool:currentPool,normalizeName:normalizeShopHero});
  const level=Number.isInteger(status?.cards.level)&&status!.cards.level!>=1&&status!.cards.level!<=11?status!.cards.level:null;
  return {complete,fresh,level,card(id:string){
    const canonical=normalizeShopHero(id),hero=dataset.characterById(canonical);
    const row=pool.find(r=>r.champion===canonical);
    const availability=shopAvailability(status,canonical,now),ready=complete&&!!level&&!!row?.cost;
    const request=ready?{tierProbability:tierOdds(level!,row!.cost as Cost),remaining:row!.remaining,tierRemaining:pool.filter(r=>r.cost===row!.cost).reduce((sum,r)=>sum+r.remaining,0)}:null;
    const result=availability?estimateRoll({tierProbability:0,remaining:0,tierRemaining:0,inShop:true}):request?estimateRoll(request):null;
    const fourSlotResult=!availability&&request?estimateRoll({...request,heroSlots:4}):result;
    return {id:canonical,name:hero?.display_name??'名称待更新',image:hero?.image_path,cost:hero?.cost??0,remaining:complete?row?.remaining:undefined,availability,result,fourSlotResult};
  }};
}
