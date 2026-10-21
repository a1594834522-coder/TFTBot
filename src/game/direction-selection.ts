import catalogFile from '../../data/metatft-direction-catalog.json';
import type {DirectionCatalog} from '../decision/direction-catalog';
import type {SelectedComp} from './selected-comp';
import {shopCatalog} from './shop-mechanics';
const catalog=catalogFile as unknown as DirectionCatalog;
/** Resolve the selected OBSERVED variant on the trusted side. Choosing a flex
 * carry must not silently select a family default that omits that carry. */
export function applyDirectionSelection(base:SelectedComp|null,id:string|undefined):SelectedComp|null{
  if(!id)return base;
  if(!base)throw new Error('请先选择当前赛季阵容');
  const profile=catalog.profiles.find(p=>'metatft:'+p.key===base.key),pair=profile?.pairs.find(p=>p.id===id),units=pair?.templates[0]?.poolUnits;
  if(!pair||!units||!units.includes(pair.carry)||!units.includes(pair.tank)||units.some(id=>!shopCatalog.some(h=>h.character_id===id)))throw new Error('当前阵容没有此核心变体');
  const normalized=[...new Set(units)],transitions=base.transitions?.map(t=>({...t,keepCount:t.units.filter(id=>normalized.includes(id)).length}));
  const early=transitions?.find(t=>t.id===base.transitionId)?.units??[];
  return {...base,units:normalized,directionId:id,transitions,highlightedUnits:[...new Set([...normalized,...early])]};
}
