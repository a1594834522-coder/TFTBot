import type {BattleBoard} from '../game/battle-model-encoding';
import type {BattleRequest} from '../game/battle-forecast';

export interface CombatAction {id:string;board:BattleBoard}
export interface CombatActionValue {
  id:string;before:number|null;after:number|null;knownDelta:number;lowerDelta:number;upperDelta:number;coverage:number;
}
/** Single-fight counterfactual value only, not final placement/LP or affordability.
 * Every comparison uses the SAME opponent weights. Unknown opponents retain [-1,+1]
 * delta uncertainty, so a partial sample cannot masquerade as a guaranteed upgrade. */
export function compareCombatActions(request:BattleRequest,actions:CombatAction[],predict:(player:BattleBoard,opponent:BattleBoard)=>number|null):CombatActionValue[]{
  if(new Set(actions.map(a=>a.id)).size!==actions.length)throw new Error('Duplicate combat action ID');
  const valid=(p:number|null)=>p!==null&&Number.isFinite(p)&&p>=0&&p<=1;
  const baseline=new Map(request.targets.map(t=>[t.id,t.board?predict(request.local,t.board):null]));
  return actions.map(action=>{
    let knownDelta=0,coverage=0,before=0,after=0;
    for(const target of request.targets){
      if(target.weight<=0)continue;
      const a=baseline.get(target.id)??null,b=target.board?predict(action.board,target.board):null;
      if(!valid(a)||!valid(b))continue;
      coverage+=target.weight;before+=target.weight*a!;after+=target.weight*b!;
      knownDelta+=target.weight*(b!-a!);
    }
    const missing=Math.max(0,1-coverage),complete=missing<1e-7;
    return {id:action.id,before:complete?before:null,after:complete?after:null,knownDelta,lowerDelta:Math.max(-1,knownDelta-missing),upperDelta:Math.min(1,knownDelta+missing),coverage};
  });
}
