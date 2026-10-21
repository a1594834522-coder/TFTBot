import type {DirectionAdvice} from './direction-advisor';
/** Startup retention focuses on the compared cores. Full eight-unit variant
 * lists remain available on desktop; they must not turn every speculative
 * utility champion into an automatic in-game buy highlight. */
export function withSearchHolds(advice:DirectionAdvice):DirectionAdvice{
  if(!advice.ready)return advice;
  const search=advice.search;
  if(!search?.ready&&advice.milestone!=='roll-down')return advice;
  const routes=new Map<string,Set<string>>(),targets=new Map<string,number>(),support=new Map<string,Set<string>>();
  const chosen=search?.ready?search.keyUpgradePortfolio&&search.keyUpgradePortfolio.completionProbability>0?search.keyUpgradePortfolio:search.upgradePortfolio&&search.upgradePortfolio.completionProbability>0?search.upgradePortfolio:search.portfolio:undefined;
  if(search?.ready&&search.phase==='reinforce'&&advice.rows[0]){
    const row=advice.rows[0];for(const [id,target]of [[row.carry,9],[row.tank,3]] as const){targets.set(id,target);routes.set(id,new Set([row.name]));}
  }
  if(search?.ready&&search.phase!=='flex'){
    for(const goal of search.goals)for(const target of goal.targets){
      targets.set(target.id,Math.max(targets.get(target.id)??0,target.copies));
      const names=routes.get(target.id)??new Set<string>();names.add(goal.name);routes.set(target.id,names);
    }
  }else for(const row of advice.rows){
    if(row.regime==='reroll'&&!(advice.mode==='selected'&&row.id===advice.focusId))continue;
    for(const id of [row.carry,row.tank]){
      targets.set(id,row.regime==='reroll'&&id===row.carry?9:3);const names=routes.get(id)??new Set<string>();names.add(row.name);routes.set(id,names);
      const sources=support.get(id)??new Set<string>();sources.add(row.id);support.set(id,sources);
    }
  }
  if(!targets.size)return advice;
  const cards=[...targets].map(([id,target])=>{
    const owned=advice.owned[id]??0,shopSlots=advice.shop.filter(c=>c.id===id).map(c=>c.slot),quantity=Math.min(shopSlots.length,Math.max(0,target-owned));
    const shared=(support.get(id)?.size??routes.get(id)?.size??0)>1,preferred=chosen?.keep.includes(id)||chosen?.buy.includes(id);
    return {id,owned,shopSlots,quantity,priority:preferred?3:shared?2:1,
      reason:target===9?owned>=9?'三星已成':'核心追三':owned%3+shopSlots.length>=3&&owned<target?'可升二星':shared?'多路线核心':'搜牌核心',routes:[...routes.get(id)??[]]};
  }).sort((a,b)=>b.priority-a.priority||b.owned-a.owned||a.id.localeCompare(b.id));
  return {...advice,holds:{...advice.holds,cards}};
}
