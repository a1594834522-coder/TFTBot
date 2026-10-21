import {describe,it,expect} from 'vitest';
import {strategicAdvice} from '../src/decision/strategic-advisor';
import type {StrategicInput} from '../src/decision/strategic-input';
import type {TransitionLibrary} from '../src/decision/transition-goals';
import type {TradingRules} from '../src/decision/shop-ledger';
const rules:TradingRules={version:'test',provisional:true,heroes:Object.fromEntries(['A','B','C','D'].map(id=>[id,{cost:1,maxStar:3,sellValues:{1:1,2:3,3:9}}])),benchCapacity:9,itemRackCapacity:10,interestStep:10,interestCap:5,victoryGoldBeforeInterest:1};
function input():Extract<StrategicInput,{ready:true}>{return {ready:true,stage:2,gaps:[],state:{gold:29,level:4,boardCapacity:4,itemRack:[],offers:[{slot:0,id:'B',price:1}],units:[{key:'a',id:'A',star:1,area:'board',slot:0,items:[]}]},pool:{complete:true,remaining:{A:20,B:20,C:20,D:20},tierRemaining:{1:200,2:100,3:100,4:100,5:100},tierOdds:{1:1,2:0,3:0,4:0,5:0},heroSlotsCycle:[4],refreshPrice:2}};}
function library():TransitionLibrary{
  const core={scope:'full-window-marginals' as const,targets:[{id:'B',copies:1},{id:'C',copies:1}],evidence:[]};
  return {meta:{set:'TFTSet18',clusteringId:1,source:'test',overviewUpdated:1},nodes:[{id:'source',stage:2,units:['A'],current:{}},{id:'next',stage:3,units:['B','C','D'],current:{},coreTemplate:core},{id:'variant',stage:3,units:['B','C'],current:{},coreTemplate:{...core,targets:[...core.targets].reverse()}}],edges:[{from:'source',to:'next',current:{battleWeight:100,avgPlace:4}},{from:'source',to:'variant',current:{battleWeight:80,avgPlace:3.8}}],exits:[]};
}
describe('observed-route decision frontier',()=>{
  it('keeps zero-overlap futures, deduplicates identical core decisions, and preserves every route',async()=>{
    const r=await strategicAdvice(input(),library(),rules);if(!r.ready)throw Error(r.reason);
    expect(r.rows).toHaveLength(1);expect(r.rows[0].goal.id).toBe('variant:core');expect(r.rows[0].alternativeGoals).toHaveLength(1);
    expect(r.rows[0].observedPlace).toBe(3.8);expect(r.rows[0].option.choice.completion.probability).toBeGreaterThan(0);
    expect(r.rows[0].optimisticProbability!).toBeGreaterThanOrEqual(r.rows[0].option.choice.completion.probability);
    expect(r.currentCashFloor).toBe(29);expect(r.rows[0].option.choice.buySlots).toEqual([]);
  });
  it('does not average or fill missing source-specific route outcomes',async()=>{
    const l=library();l.nodes[0].units=['A','D'];l.nodes.push({id:'possible',stage:2,units:['A','B'],current:{}});
    const r=await strategicAdvice(input(),l,rules);if(!r.ready)throw Error(r.reason);
    expect(r.sources).toHaveLength(2);expect(r.rows[0].observedPlace).toBeNull();
  });
  it('rejects obsolete work and passes through explicit waiting states',async()=>{
    expect(await strategicAdvice(input(),library(),rules,{cancelled:()=>true})).toEqual({ready:false,reason:'局面已变化'});
    expect(await strategicAdvice({ready:false,reason:'waiting'},library(),rules)).toEqual({ready:false,reason:'waiting'});
  });
});
