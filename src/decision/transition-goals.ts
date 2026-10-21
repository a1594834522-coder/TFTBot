import type {EarlyTransitionGraph,TransitionStats} from '../game/early-transition-graph';
import type {StrategicGoal} from './strategic-options';

export interface TransitionLibrary {
  meta:Pick<EarlyTransitionGraph['meta'],'set'|'clusteringId'|'source'|'overviewUpdated'>;
  nodes:Array<{id:string;stage:number;units:string[];current:TransitionStats;coreTemplate?:{
    scope:'full-window-marginals';targets:Array<{id:string;copies:number}>;
    evidence:Array<{id:string;star:number;starWeight:number;gearWeight:number}>;
  }}>;
  edges:Array<{from:string;to:string;current:TransitionStats}>;
  exits:Array<{from:string;current:TransitionStats}>;
}
export interface SourceMatch {id:string;edits:number;exact:boolean}
export interface TransitionGoal extends StrategicGoal {
  kind:'collect'|'core';stage:number;units:string[];
  templateScope:'identity-only'|'full-window-marginals';
  evidence:Array<{source:string;weight:number;share:number;stats:TransitionStats}>;
}
/** Build-time projection. Historical item/star marginals are never relabeled current. */
export function transitionLibrary(graph:EarlyTransitionGraph):TransitionLibrary{
  if(graph.meta.set!=='TFTSet18'||!Number.isSafeInteger(graph.meta.clusteringId))throw new Error('Unsupported transition library');
  const ids=new Map(graph.nodes.map(n=>[n.id,n]));
  if(ids.size!==graph.nodes.length||graph.nodes.some(n=>n.stage<2||n.stage>5||!n.units.length||new Set(n.units).size!==n.units.length)||graph.edges.some(e=>!ids.has(e.from)||!ids.has(e.to)||ids.get(e.to)!.stage!==ids.get(e.from)!.stage+1)||graph.exits.some(e=>!ids.has(e.from)))throw new Error('Invalid transition graph topology');
  return {meta:{set:graph.meta.set,clusteringId:graph.meta.clusteringId,source:graph.meta.source,overviewUpdated:graph.meta.overviewUpdated},nodes:graph.nodes.map(n=>{
    // Gear frequency identifies heavily equipped units, not a causal importance weight.
    // Marginal modal stars define an explicit search target, not a claimed observed joint board.
    const evidence=n.units.flatMap(id=>{
      const stars=Object.entries(n.fullWindow?.stars?.[id]??{}).flatMap(([key,s])=>/^[1-4]-star$/.test(key)&&(s.battleWeight??0)>0?[{star:Number(key[0]),weight:s.battleWeight!}]:[]).sort((a,b)=>b.weight-a.weight||a.star-b.star);
      const gearWeight=Object.values(n.fullWindow?.items??{}).reduce((sum,item)=>sum+(item.holders?.[id]?.battleWeight??0),0);
      return stars[0]&&gearWeight>0?[{id,star:stars[0].star,starWeight:stars[0].weight,gearWeight}]:[];
    }).sort((a,b)=>b.gearWeight-a.gearWeight||a.id.localeCompare(b.id)).slice(0,2);
    return {id:n.id,stage:n.stage,units:n.units,current:n.current,coreTemplate:evidence.length===2?{scope:'full-window-marginals' as const,targets:evidence.map(e=>({id:e.id,copies:3**(e.star-1)})),evidence}:undefined};
  }),edges:graph.edges.flatMap(e=>e.current?[{from:e.from,to:e.to,current:e.current}]:[]),exits:graph.exits.flatMap(e=>e.current?[{from:e.from,current:e.current}]:[])};
}
/** Set-edit nearest neighbors identify possible source clusters, not probabilities.
 * Only the current board is matched; bench options are evaluated separately. */
export function transitionSources(library:TransitionLibrary,stage:number,onBoard:string[]):SourceMatch[]{
  if(!Number.isInteger(stage)||stage<2||stage>5||!onBoard.length)return [];
  const held=new Set(onBoard),candidates=library.nodes.filter(n=>n.stage===stage).map(n=>{
    const expected=new Set(n.units),edits=n.units.filter(id=>!held.has(id)).length+[...held].filter(id=>!expected.has(id)).length;
    return {id:n.id,edits,exact:edits===0};
  });
  const min=Math.min(...candidates.map(c=>c.edits));
  return candidates.filter(c=>c.edits===min).sort((a,b)=>a.id.localeCompare(b.id));
}
/** Adjacent observed routes, including zero shared champions. The displayed share
 * retains exits and weak edges in its denominator; it is NOT a win probability. */
export function transitionGoals(library:TransitionLibrary,sources:string[],minimumWeight=30,kind:'collect'|'core'='collect'):TransitionGoal[]{
  if(!Number.isFinite(minimumWeight)||minimumWeight<0)throw new Error('Invalid route support bound');
  const nodes=new Map(library.nodes.map(n=>[n.id,n])),goals=new Map<string,TransitionGoal>();
  for(const source of new Set(sources)){
    if(!nodes.has(source))continue;
    const edges=library.edges.filter(e=>e.from===source&&(e.current.battleWeight??0)>0);
    const total=edges.reduce((sum,e)=>sum+e.current.battleWeight!,0)+(library.exits.find(e=>e.from===source)?.current.battleWeight??0);
    for(const edge of edges){
      const weight=edge.current.battleWeight!;if(weight<minimumWeight)continue;
      const target=nodes.get(edge.to);if(!target)throw new Error('Dangling transition edge');
      if(kind==='core'&&!target.coreTemplate)continue;
      const id=target.id+(kind==='core'?':core':'');
      const goal=goals.get(id)??{id,kind,stage:target.stage,units:target.units,targets:kind==='core'?target.coreTemplate!.targets:target.units.map(id=>({id,copies:1})),templateScope:kind==='core'?'full-window-marginals':'identity-only',evidence:[]};
      goal.evidence.push({source,weight,share:weight/total,stats:edge.current});goals.set(id,goal);
    }
  }
  return [...goals.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
