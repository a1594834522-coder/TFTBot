import { allComps, sourceOfComp } from './comps-sources';
import { CURRENT_SET } from './current-season';
import { normalizeShopHero } from './shop-mechanics';
import {shopCatalog} from './shop-mechanics';
import {dataset} from './tft-data';
import type {MetatftComp,MetatftEarlyOption} from './metatft-comps';
export interface TransitionRoute {id:string;name:string;level:number;units:string[];keepCount:number;avgPlace?:number}
export interface SelectedComp { key: string; name: string; units: string[]; transitions?:TransitionRoute[]; transitionId?:string|null; highlightedUnits?:string[];directionId?:string }
export const highlightedCompUnits=(comp:SelectedComp|null):string[]=>comp?.highlightedUnits??comp?.units??[];
const normalizeUnits=(ids:string[])=>[...new Set(ids.map(normalizeShopHero))];
function routeName(units:string[],level:number){
  const counts=new Map<string,number>();
  for(const id of units)for(const trait of dataset.characterById(id)?.trait_ids??[])counts.set(trait,(counts.get(trait)??0)+1);
  return [...counts].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([id])=>dataset.trait(id)?.display_name).filter(Boolean).join(' · ')||`${level}人口过渡`;
}
export function resolveSelectedComp(key: string | null,transitionId?:string|null): SelectedComp | null {
  if (key === null || !key) return null;
  const c = allComps({set:CURRENT_SET}).find(c=>`${sourceOfComp(c)}:${c.id}`===key);
  if (!c) throw new Error('当前赛季没有此阵容');
  const units=normalizeUnits(c.units.map(u=>u.character_id));
  const source:MetatftEarlyOption[]=(c as MetatftComp).details?.earlyOptions??(c.early_units?.length?[{level:c.early_units.length,units:c.early_units.map(u=>u.character_id)}]:[]);
  const seen=new Set<string>();
  const options=source.map(o=>({...o,units:normalizeUnits(o.units)})).filter(o=>{
    const fingerprint=[...o.units].sort().join('|');
    if(!o.units.length || o.units.some(id=>!shopCatalog.some(h=>h.character_id===id)) || seen.has(fingerprint))return false;
    seen.add(fingerprint);return true;
  }).sort((a,b)=>a.level-b.level||(a.avg??9)-(b.avg??9));
  const early=options.filter(o=>o.level<=5);
  const transitions:TransitionRoute[]=(early.length?early:options).slice(0,3).map((o,i)=>({id:`early-${o.level}-${i}`,name:routeName(o.units,o.level),level:o.level,units:o.units,keepCount:o.units.filter(id=>units.includes(id)).length,...(o.avg!==undefined?{avgPlace:o.avg}:{})}));
  const picked=transitionId===undefined?transitions[0]?.id??null:transitionId;
  if(picked!==null && !transitions.some(t=>t.id===picked))throw new Error('当前阵容没有此过渡路线');
  return {key,name:c.name,units,transitions,transitionId:picked,highlightedUnits:normalizeUnits([...units,...(transitions.find(t=>t.id===picked)?.units??[])])};
}
