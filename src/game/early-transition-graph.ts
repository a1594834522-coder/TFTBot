import {normalizeShopHero} from './shop-mechanics';

/** These weights are fractional aggregates, NOT independent games or effective sample sizes. */
export interface TransitionStats {
  battleWeight?:number;
  battleWinRate?:number;
  hpDelta?:number;
  finishWeight?:number;
  avgPlace?:number;
  firstRate?:number;
  avgHp?:number;
}
export interface TransitionNode {
  id:string; stage:number; cluster:string; units:string[];
  current:TransitionStats;
  /** Separate scope: detail unit/item/round slices have no current-patch counterpart. */
  fullWindow:{
    stars:Record<string,Record<string,TransitionStats>>;
    items:Record<string,{stats:TransitionStats;holders:Record<string,TransitionStats>}>;
    variations:Array<{units:string[];stats:TransitionStats}>;
    rounds:Record<string,Record<string,TransitionStats>>;
  };
}
export interface TransitionEdge {
  from:string;to:string;
  /** Overview weights drive the website's displayed route share. Scope is not labeled by API. */
  overviewWeight:number;
  current:TransitionStats|null;
  fullWindow:TransitionStats|null;
}
export interface EarlyTransitionGraph {
  meta:{set:string;clusteringId:number;source:string;overviewUpdated:unknown;startedAt?:string;completedAt?:string;detailUpdates:unknown[];semantics:string};
  nodes:TransitionNode[];edges:TransitionEdge[];
  exits:Array<{from:string;current:TransitionStats|null;fullWindow:TransitionStats|null}>;
}
const finite=(n:unknown):number|undefined=>typeof n==='number'&&Number.isFinite(n)?n:undefined;
const bounded=(n:unknown,min:number,max=Infinity)=>{const v=finite(n);return v!==undefined&&v>=min&&v<=max?v:undefined;};
export function transitionStats(raw:any):TransitionStats {
  return {battleWeight:bounded(raw?.matchup_count,0),battleWinRate:bounded(raw?.matchup_winrate,0,1),hpDelta:finite(raw?.matchup_avg_hp_delta),finishWeight:bounded(raw?.final_place_count,0),avgPlace:bounded(raw?.final_place_avg,1,8),firstRate:bounded(raw?.final_place_winrate,0,1),avgHp:bounded(raw?.avg_hp,0)};
}
const units=(name:unknown)=>typeof name==='string'?[...new Set(name.split(',').map(s=>normalizeShopHero(s.trim())).filter(Boolean))]:[];
const key=(stage:number,cluster:string)=>`early-${stage}-${cluster}`;
function object(raw:any):Record<string,any>{return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};}
function scopedStats(raw:any):TransitionStats|null{return raw&&typeof raw==='object'?transitionStats(raw):null;}

/** Build by original API array positions BEFORE sorting. Never join different clustering IDs. */
export function buildEarlyTransitionGraph(overview:any,details:Array<{stage:number;cluster:string;data:any}>):EarlyTransitionGraph {
  if(overview?.tft_set!=='TFTSet18'||!Number.isInteger(overview?.clustering_id))throw new Error('Unsupported transition season/cluster');
  const graph:EarlyTransitionGraph={meta:{set:overview.tft_set,clusteringId:overview.clustering_id,source:'https://api.metatft.com/tft-early-comps/',overviewUpdated:overview.lastUpdated,detailUpdates:[],semantics:'observational weighted aggregates; overview route weights have unspecified patch scope; current edges use transition_to_stats_latest only; full-window marginals remain separate'},nodes:[],edges:[],exits:[]};
  const lookup=new Map<string,any>();
  for(const detail of details){
    const d=detail.data,id=key(detail.stage,detail.cluster);
    if(d?.tft_set!==overview.tft_set||d?.clustering_id!==overview.clustering_id||String(d?.comps_full?.cluster)!==detail.cluster||lookup.has(id))throw new Error(`Mismatched/duplicate detail: ${id}`);
    lookup.set(id,d.comps_full);graph.meta.detailUpdates.push(d.lastUpdated);
  }
  const seen=new Set<string>();
  for(const [stageKey,value] of Object.entries(object(overview.comps_overview))){
    if(!/^stage-[2-5]$/.test(stageKey))continue;
    const stage=Number(stageKey.split('-')[1]);
    for(const board of (value as any).comps??[]){
      const id=key(stage,String(board.cluster)),full=lookup.get(id);
      if(seen.has(id)||!full)throw new Error(`Duplicate/missing board: ${id}`);
      seen.add(id);
      const stars:TransitionNode['fullWindow']['stars']={};
      for(const [unit,slices]of Object.entries(object(full.units))){
        const normalized=normalizeShopHero(unit);stars[normalized]={};
        for(const [tier,stats]of Object.entries(object(slices)))if(/^[1-4]-star$/.test(tier))stars[normalized][tier]=transitionStats(stats);
      }
      const items:TransitionNode['fullWindow']['items']={};
      for(const [item,data]of Object.entries(object(full.items)))items[item]={stats:transitionStats(data),holders:Object.fromEntries(Object.entries(object(data.units)).map(([u,s])=>[normalizeShopHero(u),transitionStats(s)]))};
      const rounds=Object.fromEntries(Object.entries(object(full.num_units)).map(([level,s])=>[level,Object.fromEntries(Object.entries(object(s.rounds)).map(([round,stats])=>[round,transitionStats(stats)]))]));
      graph.nodes.push({id,stage,cluster:String(board.cluster),units:units(board.name),current:transitionStats(full.latest_stats),fullWindow:{stars,items,rounds,variations:(full.variations??[]).map((v:any)=>({units:units(v.units),stats:transitionStats(v)}))}});
      const next=overview.comps_overview?.[`stage-${stage+1}`]?.comps;
      const links=board.forwards_links??[];
      if(stage<5&&(!Array.isArray(next)||!Array.isArray(links)||links.length!==next.length))throw new Error(`Transition dimension mismatch: ${id}`);
      if(stage===5&&links.length)throw new Error(`Unexpected outgoing stage 5 links: ${id}`);
      for(let index=0;index<links.length;index++){
        const weight=bounded(links[index],0);
        if(weight===undefined)throw new Error(`Invalid transition weight: ${id}/${index}`);
        // Include a conditional edge even if its overview weight rounded to zero.
        const current=scopedStats(full.transition_to_stats_latest?.[index]);
        const historical=scopedStats(full.transition_to_stats?.[index]);
        if(weight>0||current||historical)graph.edges.push({from:id,to:key(stage+1,String(next[index].cluster)),overviewWeight:weight,current,fullWindow:historical});
      }
      const current=scopedStats(full.transition_to_stats_latest?.['-1']),historical=scopedStats(full.transition_to_stats?.['-1']);
      if(current||historical)graph.exits.push({from:id,current,fullWindow:historical});
    }
  }
  if(seen.size!==lookup.size)throw new Error('Unreferenced transition detail');
  graph.meta.detailUpdates=[...new Set(graph.meta.detailUpdates)];
  graph.nodes.sort((a,b)=>a.stage-b.stage||Number(a.cluster)-Number(b.cluster));
  return graph;
}

export interface RouteEvidence {
  nodes:string[];
  steps:Array<{from:string;to:string;weight:number;share:number;avgPlace?:number;battleWinRate?:number;avgHp?:number}>;
  /** Modelled Markov path mass among current weighted outgoing edges, NOT route win probability. */
  markovMass:number;
}
/** Evidence explorer, not a policy: no overlap filter, no invented edges, no marginal outcome substitution. */
export function observedRoutes(graph:EarlyTransitionGraph,from:string,toStage:number,options:{minimumWeight?:number;beam?:number}={}):RouteEvidence[]{
  const minimumWeight=options.minimumWeight??10,beam=options.beam??50;
  if(!Number.isFinite(minimumWeight)||minimumWeight<0||!Number.isInteger(beam)||beam<1)throw new Error('Invalid route search bounds');
  const node=graph.nodes.find(n=>n.id===from);
  if(!node||!Number.isInteger(toStage)||toStage<=node.stage||toStage>5)return [];
  let routes:RouteEvidence[]=[{nodes:[from],steps:[],markovMass:1}];
  for(let stage=node.stage;stage<toStage;stage++){
    const next:RouteEvidence[]=[];
    for(const route of routes){
      const id=route.nodes.at(-1)!;
      const outgoing=graph.edges.filter(e=>e.from===id&&e.current?.battleWeight!==undefined&&e.current.battleWeight>0);
      const exit=graph.exits.find(e=>e.from===id)?.current?.battleWeight??0;
      // Denominator includes ALL known outgoing weights, including those pruned for weak support, and exits.
      const total=outgoing.reduce((n,e)=>n+e.current!.battleWeight!,exit);
      for(const edge of outgoing){
        const stats=edge.current!,weight=stats.battleWeight!;
        if(weight<minimumWeight)continue;
        const share=weight/total;
        next.push({nodes:[...route.nodes,edge.to],steps:[...route.steps,{from:id,to:edge.to,weight,share,avgPlace:stats.avgPlace,battleWinRate:stats.battleWinRate,avgHp:stats.avgHp}],markovMass:route.markovMass*share});
      }
    }
    routes=next.sort((a,b)=>b.markovMass-a.markovMass||a.nodes.join('|').localeCompare(b.nodes.join('|'))).slice(0,beam);
  }
  return routes;
}
