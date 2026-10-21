import type {BattleBoard} from '../game/battle-model-encoding';
import type {ShopState,OwnedUnit} from './shop-ledger';

export interface LineupCandidate {key:string;units:OwnedUnit[];board:BattleBoard;bench:OwnedUnit[]}
export const battleBoardKey=(board:BattleBoard)=>JSON.stringify([board.units.map(u=>[u.id,u.star,[...u.items].sort()]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),[...board.augments].sort(),[...(board.charms??[])].sort()]);
/** Exact within the declared number of original-board removals, then fill available slots.
 * Bench units never contribute to a fight unless explicitly selected for deployment. */
export function lineupCandidates(state:ShopState,augments:string[],maxSwaps=1):LineupCandidate[]{
  if(!Number.isInteger(maxSwaps)||maxSwaps<0||maxSwaps>2)throw new Error('Invalid tactical swap bound');
  const current=state.units.filter(u=>u.area==='board'),size=Math.min(state.boardCapacity,state.units.length),output=new Map<string,LineupCandidate>();
  function add(units:OwnedUnit[]){
    const selected=new Set(units.map(u=>u.key)),board:BattleBoard={units:units.map(u=>({id:u.id,star:u.star,items:u.items.map(i=>i.id)})),augments};
    const key=battleBoardKey(board);if(!output.has(key))output.set(key,{key,units,board,bench:state.units.filter(u=>!selected.has(u.key))});
  }
  // Retaining the actual board is always a valid counterfactual, even with empty
  // deployment slots. An imperfect model must not force a predicted deterioration.
  add(current);
  function choose<T>(list:T[],count:number,visit:(selection:T[])=>void){
    const picked:T[]=[];
    function next(start:number){if(picked.length===count){visit([...picked]);return;}for(let i=start;i<=list.length-(count-picked.length);i++){picked.push(list[i]);next(i+1);picked.pop();}}
    if(count>=0&&count<=list.length)next(0);
  }
  for(let remove=0;remove<=Math.min(maxSwaps,current.length);remove++)choose(current,remove,removed=>{
    const gone=new Set(removed.map(u=>u.key)),kept=current.filter(u=>!gone.has(u.key)),keys=new Set(kept.map(u=>u.key));
    const available=state.units.filter(u=>!keys.has(u.key));
    choose(available,size-kept.length,fill=>{
      add([...kept,...fill]);
    });
  });
  return [...output.values()];
}
