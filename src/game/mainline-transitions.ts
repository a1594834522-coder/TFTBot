import catalogFile from '../../data/metatft-direction-catalog.json';
import type {DirectionCatalog} from '../decision/direction-catalog';
import type {AdvisorInput} from './comp-advisor';
import {normalizeShopHero,shopCatalog} from './shop-mechanics';
import {transitionRouteName,type SelectedComp,type TransitionRoute} from './selected-comp';
const catalog=catalogFile as unknown as DirectionCatalog,known=new Set(shopCatalog.map(h=>h.character_id));
type Assets=Pick<AdvisorInput,'units'|'level'|'localComplete'>;
const cache=new WeakMap<DirectionCatalog,Map<string,TransitionRoute[]>>();
const fingerprint=(level:number,units:string[])=>level+':'+units.slice().sort().join('|');
function stableId(value:string){
  let hash=0xcbf29ce484222325n;for(let i=0;i<value.length;i++)hash=BigInt.asUintN(64,(hash^BigInt(value.charCodeAt(i)))*0x100000001b3n);
  return 'mainline-'+hash.toString(16).padStart(16,'0');
}
function observedRoutes(base:SelectedComp,source:DirectionCatalog):TransitionRoute[]|null{
  const profile=source.profiles.find(p=>'metatft:'+p.key===base.key);if(!profile)return null;
  let byProfile=cache.get(source);if(!byProfile){byProfile=new Map();cache.set(source,byProfile);}
  const existing=byProfile.get(base.key);if(existing)return existing;
  const dedup=new Map<string,TransitionRoute>(),ids=new Map<string,string>();
  for(const board of profile.early){
    const units=[...new Set(board.poolUnits.map(normalizeShopHero))];
    if(board.count<30||board.level<4||board.level>7||units.length<3||units.length>board.level+2||units.some(id=>!known.has(id)))continue;
    const key=fingerprint(board.level,units),id=stableId(base.key+'|'+key);
    if(ids.has(id)&&ids.get(id)!==key)throw Error('过渡路线标识冲突，暂停选择');ids.set(id,key);
    const route:TransitionRoute={id,name:transitionRouteName(units,board.level,source.traitThresholds),level:board.level,units,keepCount:0,count:board.count,
      ...(board.avg===null?{}:{avgPlace:board.avg}),...(board.battleWinRate===null?{}:{battleWinRate:board.battleWinRate}),source:'metatft-aggregate'};
    if((dedup.get(key)?.count??0)<board.count)dedup.set(key,route);
  }
  const routes=[...dedup.values()];byProfile.set(base.key,routes);return routes;
}

/** Rank only observed associations to THIS final family, never by overlap with
 * its final units. A selected route remains pinned as population/holdings change.
 * IDs describe content, not list indices, so stale clicks remain verifiable. */
export function withMainlineTransitions(base:SelectedComp|null,assets:Assets,requested?:string|null,source:DirectionCatalog=catalog):SelectedComp|null{
  if(!base)return null;
  if(requested!==undefined&&requested!==null&&!requested)throw Error('过渡路线标识无效');
  const observed=observedRoutes(base,source);
  if(observed===null){
    const chosen=requested===undefined?base.transitionId??null:requested,route=base.transitions?.find(t=>t.id===chosen);
    if(chosen&&!route)throw Error('当前主线没有此过渡路线');
    return {...base,transitionId:chosen,highlightedUnits:[...new Set([...base.units,...route?.units??[]])]};
  }
  const decorate=(route:TransitionRoute):TransitionRoute=>({...route,units:[...route.units],keepCount:route.units.filter(id=>base.units.includes(id)).length,
    ...(assets.localComplete?{heldCount:route.units.filter(id=>assets.units[id]>0).length,upgradedCount:route.units.filter(id=>assets.units[id]>=3).length,
      missingUnits:route.units.filter(id=>!assets.units[id])}:{})});
  const routes=observed.map(decorate);
  let chosen=requested===undefined?base.transitionId??null:requested;
  if(chosen&&!routes.some(t=>t.id===chosen)){
    // Migrate an old stored early-level-index choice only by matching content.
    const legacy=base.transitions?.find(t=>t.id===chosen||stableId(base.key+'|'+fingerprint(t.level,t.units.map(normalizeShopHero)))===chosen);
    const match=legacy&&routes.find(t=>fingerprint(t.level,t.units)===fingerprint(legacy.level,legacy.units.map(normalizeShopHero)));
    if(match)chosen=match.id;
    else if(legacy&&legacy.level>=4&&legacy.level<=7&&legacy.units.length>=3&&legacy.units.length<=legacy.level+2&&legacy.units.map(normalizeShopHero).every(id=>known.has(id))){
      // A player-selected current-season comp reference can outlive the top-N
      // aggregate window. Retain the explicit choice, label the weaker source,
      // and do not invent support counts or historical combat probabilities.
      const units=[...new Set(legacy.units.map(normalizeShopHero))],id=stableId(base.key+'|'+fingerprint(legacy.level,units));
      routes.push(decorate({id,name:legacy.name,level:legacy.level,units,keepCount:0,source:'comp-reference'}));chosen=id;
    }
    else if(requested!==undefined)throw Error('当前主线没有此已验证过渡路线');
    else chosen=null;
  }
  const target=Number.isInteger(assets.level)&&assets.level!>=1&&assets.level!<=11?assets.level!:4;
  routes.sort((a,b)=>Math.abs(a.level-target)-Math.abs(b.level-target)||
    (assets.localComplete?(b.heldCount??0)-(a.heldCount??0)||(b.upgradedCount??0)-(a.upgradedCount??0):0)||
    (b.count??0)-(a.count??0)||a.id.localeCompare(b.id));
  const pinned=routes.find(t=>t.id===chosen),selected=[...(pinned?[pinned]:[]),...routes.filter(t=>t.id!==chosen)].slice(0,3);
  return {...base,transitions:selected,transitionId:chosen,highlightedUnits:[...new Set([...base.units,...pinned?.units??[]])]};
}
