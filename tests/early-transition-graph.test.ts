import {describe,it,expect} from 'vitest';
import {buildEarlyTransitionGraph,observedRoutes,transitionStats,type EarlyTransitionGraph} from '../src/game/early-transition-graph';

const stats=(weight:number,avg=4)=>({matchup_count:weight,final_place_count:weight,matchup_winrate:.6,final_place_avg:avg});
function fixture(){
  const board=(cluster:string,name:string,links:number[]=[])=>({cluster,name,forwards_links:links});
  const overview={tft_set:'TFTSet18',clustering_id:7,lastUpdated:42,comps_overview:{'stage-2':{comps:[board('a','TFT18_Akali',[3,7])]},'stage-3':{comps:[board('z','TFT18_Kayle',[1]),board('b','TFT18_Rakan',[1])]},'stage-4':{comps:[board('c','TFT18_Varus',[1])]},'stage-5':{comps:[board('d','TFT18_Diana')]}}};
  const details=Object.entries(overview.comps_overview).flatMap(([s,v])=>v.comps.map(c=>({stage:Number(s.split('-')[1]),cluster:c.cluster,data:{tft_set:'TFTSet18',clustering_id:7,lastUpdated:42,comps_full:{...c,latest_stats:stats(100),transition_to_stats_latest:c.forwards_links.length?Object.fromEntries(c.forwards_links.map((w,i)=>[i,stats(w)])):undefined,transition_to_stats:{0:stats(900,1)},units:{},items:{},variations:[],num_units:{}}}})));
  return {overview,details};
}
describe('observed transition graph',()=>{
  it('resolves API link array positions before sorting, preserves zero-overlap transitions',()=>{
    const f=fixture(),g=buildEarlyTransitionGraph(f.overview,f.details);
    expect(g.edges.find(e=>e.from==='early-2-a'&&e.overviewWeight===3)?.to).toBe('early-3-z');
    expect(observedRoutes(g,'early-2-a',3,{minimumWeight:0})[0].nodes).toEqual(['early-2-a','early-3-b']);
    expect(g.nodes.find(n=>n.id==='early-2-a')?.units).toEqual(['DA_18_Akali_AD']);
  });
  it('keeps current conditional outcomes distinct from historical marginals; never fills absent current edges',()=>{
    const f=fixture();delete (f.details[0].data.comps_full as any).transition_to_stats_latest;
    const g=buildEarlyTransitionGraph(f.overview,f.details);
    expect(g.edges[0].current).toBeNull();
    expect(g.edges[0].fullWindow?.avgPlace).toBe(1);
    expect(observedRoutes(g,'early-2-a',3)).toEqual([]);
  });
  it('retains death and pruned-edge probability mass, rather than inflating surviving routes',()=>{
    const f=fixture();(f.details[0].data.comps_full.transition_to_stats_latest as any)['-1']=stats(10);
    const g=buildEarlyTransitionGraph(f.overview,f.details);
    const routes=observedRoutes(g,'early-2-a',3,{minimumWeight:5});
    expect(routes).toHaveLength(1);
    expect(routes[0].markovMass).toBeCloseTo(7/20);
    expect(routes[0].steps[0].weight).toBe(7);
  });
  it('does not invent a path by joining high-performing disconnected boards',()=>{
    const f=fixture(),g=buildEarlyTransitionGraph(f.overview,f.details);
    g.edges=g.edges.filter(e=>e.from!=='early-3-b');
    const routes=observedRoutes(g,'early-2-a',5,{minimumWeight:0});
    expect(routes).toHaveLength(1);
    expect(routes[0].nodes).toEqual(['early-2-a','early-3-z','early-4-c','early-5-d']);
    expect(routes[0].markovMass).toBeCloseTo(.3);
    expect(routes[0]).not.toHaveProperty('predictedWinRate');
  });
  it('rejects mixed season/cluster, incomplete coverage and malformed weights',()=>{
    const f=fixture();f.details[0].data.clustering_id=8;
    expect(()=>buildEarlyTransitionGraph(f.overview,f.details)).toThrow(/Mismatched/);
    expect(()=>buildEarlyTransitionGraph(f.overview,[])).toThrow(/missing/);
    f.details[0].data.clustering_id=7;f.overview.comps_overview['stage-2'].comps[0].forwards_links=[-1,7];
    expect(()=>buildEarlyTransitionGraph(f.overview,f.details)).toThrow(/Invalid/);
  });
  it('does not silently turn null, numeric strings, or invalid rates into useful evidence',()=>{
    expect(transitionStats({matchup_count:null,matchup_winrate:1.5,final_place_avg:'3',avg_hp:-1})).toEqual({});
    expect(transitionStats(stats(1.25))).toMatchObject({battleWeight:1.25});
  });
});
