import {describe,it,expect} from 'vitest';
import {directionSearch} from '../src/decision/direction-search';
import type {DirectionAdvice,DirectionRow} from '../src/decision/direction-advisor';
import type {StrategicInput} from '../src/decision/strategic-input';
import {shopCatalog} from '../src/game/shop-mechanics';
import {tradingRules} from '../src/decision/shopping-input';
const ids=shopCatalog.filter(h=>h.cost===4).slice(0,4).map(h=>h.character_id);
function fixture(){
  const rows:DirectionRow[]=[[ids[0],ids[1]],[ids[2],ids[1]]].map(([carry,tank],i)=>({id:'route'+i,key:'key'+i,name:'路线'+i,regime:'four-cost',carry,tank,units:[carry,tank],copies:0,traitSupport:[],mechanismSupport:[],blocked:false,front:0,labels:[],early:null,observedPlace:4,observations:1000,tankCopies:0,readyCores:0,hitOdds:.02,support:100,
    gear:{componentLift:1,coreItemLift:1,damageComponents:1,supporting:[],known:true,buildWeight:100}}));
  const advice:Extract<DirectionAdvice,{ready:true}>={ready:true,round:'4-2',milestone:'roll-down',mode:'flex',regime:null,message:'',orientation:'flex',rows,owned:{},shop:[],augments:[],gaps:[],candidates:2,
    holds:{ready:true,cards:[],directions:[],boards:[],stage:4,stageEstimated:false}};
  const input:Extract<StrategicInput,{ready:true}>={ready:true,stage:4,state:{gold:40,level:8,boardCapacity:8,units:[],offers:[],itemRack:[]},gaps:[],pool:{complete:true,remaining:Object.fromEntries(ids.map(id=>[id,10])),tierRemaining:{1:150,2:150,3:150,4:150,5:150},tierOdds:{1:0,2:0,3:0,4:1,5:0},heroSlotsCycle:[4],refreshPrice:2}};
  return {advice,input};
}
describe('personal search phases and declared wallets',()=>{
  it('values adaptive routes and their declared two-star continuation separately',()=>{
    const {advice,input}=fixture(),result=directionSearch(advice,input,tradingRules);if(!result.ready)throw Error(result.reason);
    expect(result.phase).toBe('flex');expect(result.portfolio!.completionProbability).toBeGreaterThan(Math.max(...result.goals.map(g=>g.probability)));
    expect(result.upgradePortfolio!.completionProbability).toBeGreaterThan(0);
    expect(result.upgradePortfolio!.completionProbability).toBeLessThan(result.portfolio!.completionProbability);
    expect(result.optimisticUpgradeProbability!).toBeGreaterThanOrEqual(result.upgradePortfolio!.completionProbability);
    expect(result.keyUpgradePortfolio!.completionProbability).toBeGreaterThanOrEqual(result.upgradePortfolio!.completionProbability);
    expect(result.keyUpgradePortfolio!.completionProbability).toBeLessThanOrEqual(result.portfolio!.completionProbability);
  });
  it('includes duplicate known offers and actual purchases exactly once when upgrading',()=>{
    const {advice,input}=fixture();advice.rows=[advice.rows[0]];input.state.gold=8;
    input.state.units=[{key:'carry',id:ids[0],star:1,area:'board',slot:0,items:[]},{key:'tank',id:ids[1],star:2,area:'board',slot:1,items:[]}];
    input.state.offers=[{id:ids[0],price:4,slot:0},{id:ids[0],price:4,slot:1}];
    const result=directionSearch(advice,input,tradingRules);if(!result.ready)throw Error(result.reason);
    expect(result.phase).toBe('upgrade');expect(result.goals[0]).toMatchObject({probability:1,gold50:8,buyNow:[ids[0],ids[0]]});
    expect(result.goals[0].targets.map(t=>t.owned)).toEqual([1,3]);
  });
  it('clamps a user budget to real cash and leaves the source ledger untouched',()=>{
    const {advice,input}=fixture(),before=JSON.stringify(input);
    const low=directionSearch(advice,input,tradingRules,20),high=directionSearch(advice,input,tradingRules,60);
    if(!low.ready||!high.ready)throw Error();expect(low.budget).toBe(20);expect(high.budget).toBe(40);
    expect(low.portfolio!.completionProbability).toBeLessThan(high.portfolio!.completionProbability);expect(JSON.stringify(input)).toBe(before);
    expect(directionSearch(advice,input,tradingRules,-1)).toMatchObject({ready:false});
  });
  it('does not turn missing lobby evidence into zero probability',()=>{
    const {advice}=fixture();expect(directionSearch(advice,{ready:false,reason:'等待全场持牌明细'},tradingRules)).toEqual({ready:false,reason:'等待全场持牌明细'});
    const {input}=fixture();input.stage=3;expect(directionSearch(advice,input,tradingRules)).toMatchObject({ready:false});
  });
  it('never liquidates an equipped board holder for a first-copy portfolio',()=>{
    const {advice,input}=fixture();input.state.units=[{key:'protected',id:ids[0],star:1,area:'board',slot:0,items:[{key:'gear',id:'DA_RabadonsDeathcap'}]}];
    const result=directionSearch(advice,input,tradingRules);if(!result.ready)throw Error(result.reason);
    expect(result.portfolio!.sell).not.toContain(ids[0]);expect(result.goals[0].targets[0].owned).toBe(1);
  });
  it('moves a finished three-star core to reinforcement instead of repeatedly recommending its completed chase',()=>{
    const {advice,input}=fixture();advice.mode='carry';advice.regime='reroll';advice.rows=[{...advice.rows[0],regime:'reroll'}];
    input.state.units=[{key:'carry3',id:ids[0],star:3,area:'board',slot:0,items:[]}];
    const next=directionSearch(advice,input,tradingRules);if(!next.ready)throw Error();expect(next.phase).toBe('reinforce');expect(next.goals.flatMap(g=>g.targets.map(t=>t.id))).not.toContain(ids[0]);
    input.state.units.push({key:'tank2',id:ids[1],star:2,area:'board',slot:1,items:[]});
    expect(directionSearch(advice,input,tradingRules)).toMatchObject({ready:true,phase:'reinforce',goals:[]});
  });
  it('uses the manually selected reroll target even without an automatic carry lock',()=>{
    const {advice,input}=fixture();advice.mode='selected';advice.regime='reroll';advice.focusId=advice.rows[0].id;advice.rows[0].regime='reroll';
    const result=directionSearch(advice,input,tradingRules);if(!result.ready)throw Error(result.reason);
    expect(result.phase).toBe('reroll');expect(result.goals[0].targets).toMatchObject([{id:advice.rows[0].carry,copies:9}]);
  });
  it('never drops the selected missing route when another route already has first copies',()=>{
    const {advice,input}=fixture();advice.mode='selected';advice.focusId=advice.rows[0].id;
    const other=advice.rows[1];input.state.units=[other.carry,other.tank].map((id,slot)=>({key:'side'+slot,id,star:1,area:'bench',slot,items:[]}));
    const result=directionSearch(advice,input,tradingRules);if(!result.ready)throw Error(result.reason);
    expect(result.goals[0].targets.map(t=>t.id)).toEqual([advice.rows[0].carry,advice.rows[0].tank]);
    expect(result.goals[0].targets.every(t=>t.copies===3)).toBe(true);expect(result.portfolio).toBeUndefined();
  });
});
