import type {EarlyHoldAdvice} from './comp-advisor';
import type {DirectionAdvice} from '../decision/direction-advisor';
import type {AdvisorPreferences} from './advisor-preferences';
import {shopCatalog} from './shop-mechanics';
const known=new Set(shopCatalog.map(h=>h.character_id));
export function directionBoardUnits(id:string|null):string[]|null{
  if(typeof id!=='string'||!id.startsWith('direction:')||id.length>2048)return null;
  const units=id.slice(10).split('|');
  return units.length>=3&&units.length<=12&&new Set(units).size===units.length&&units.every(u=>known.has(u))?units:null;
}

/** All three surfaces (desktop, compact HUD, shop anchors) resolve the same
 * recommendation. Explicit stage/board choices retain precedence. */
export function resolveHoldAdvice(direction:DirectionAdvice|undefined,legacy:EarlyHoldAdvice,preferences:AdvisorPreferences):EarlyHoldAdvice{
  if(direction&&!direction.ready&&direction.unsupported)return {...legacy,ready:false,cards:[],boards:[],directions:[]};
  if(!direction?.ready||preferences.stage!==null&&preferences.stage!==direction.holds.stage)return legacy;
  if(preferences.boardId===null)return direction.holds;
  const exact=direction.holds.boards.find(b=>b.id===preferences.boardId),units=directionBoardUnits(preferences.boardId);
  if(!exact&&!units)return legacy;
  const board=exact??{id:preferences.boardId,units:units!,held:units!.filter(id=>direction.owned[id]>0),missing:units!.filter(id=>!direction.owned[id]),score:0};
  const cards=board.units.flatMap(id=>{
    const owned=direction.owned[id]??0,shopSlots=direction.shop.filter(c=>c.id===id).map(c=>c.slot),quantity=Math.min(shopSlots.length,Math.max(0,3-owned));
    return owned||quantity?[{id,owned,shopSlots,quantity,priority:1,reason:'已选过渡',routes:['已选过渡']}]:[];
  });
  return {...direction.holds,boards:[board,...direction.holds.boards.filter(b=>b.id!==board.id)].slice(0,3),cards};
}
