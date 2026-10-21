import type {DirectionInput,DirectionRow} from './direction-advisor';
import type {UnitRole} from './comp-profiles';
import type {GearAssignment} from './pair-gear-affinity';

export interface RouteProgress {
  targetLevel:number;populationGap:number|null;
  onBoard:string[];heldAside:string[];missing:string[];
  /** Standard first-copy purchase prices, not rolling/XP or net pivot cost. */
  firstCopiesBaseGold:number|null;
  cores:Array<{id:string;targetCopies:number;missingCopies:number;baseGold:number|null}>;
  gear:null|{bound:number;loose:number;transfers:GearAssignment[];protected:number;unassigned:number;ambiguous:number};
}

/** A factual path to ONE observed board. Board overlap is descriptive only:
 * it neither ranks transitions nor asks the player to sell their current board.
 * Bench copies count toward ownership, not toward current combat strength. */
export function routeProgress(input:DirectionInput,row:DirectionRow,targetLevel:number,roles:Record<string,UnitRole>):RouteProgress|null{
  const owned=input.assets.units;
  if(!input.assets.localComplete||!Number.isInteger(targetLevel)||targetLevel<1||targetLevel>11||
    Object.values(owned).some(n=>!Number.isSafeInteger(n)||n<0))return null;
  const target=[...new Set(row.units)],board=new Set(input.board);
  const onBoard=target.filter(id=>board.has(id)),heldAside=target.filter(id=>!board.has(id)&&(owned[id]??0)>0),missing=target.filter(id=>!(owned[id]>0));
  const cost=(id:string)=>{const n=roles[id]?.cost;return Number.isInteger(n)&&n>=1&&n<=5?n:null;};
  const prices=missing.map(cost),allocation=row.gearAllocation;
  const level=input.assets.level;
  const cores=[...new Set([row.carry,row.tank])].map(id=>{
    const targetCopies=row.regime==='reroll'&&id===row.carry?9:3;
    const missingCopies=Math.max(0,targetCopies-(owned[id]??0)),price=cost(id);
    return {id,targetCopies,missingCopies,baseGold:missingCopies===0?0:price===null?null:missingCopies*price};
  });
  const gear=input.assets.inventoryComplete&&allocation?{
    bound:allocation.assignments.filter(a=>!!a.holder&&!a.transfer).length,
    loose:allocation.assignments.filter(a=>!a.holder).length,
    transfers:allocation.assignments.filter(a=>a.transfer).map(a=>({...a})),
    protected:allocation.protected.length,unassigned:allocation.unassigned.length,ambiguous:allocation.ambiguous.length
  }:null;
  return {targetLevel,populationGap:level!==null&&level!==undefined&&Number.isInteger(level)&&level>=1&&level<=11?Math.max(0,targetLevel-level):null,
    onBoard,heldAside,missing,firstCopiesBaseGold:prices.some(p=>p===null)?null:prices.reduce<number>((n,p)=>n+p!,0),cores,gear};
}
