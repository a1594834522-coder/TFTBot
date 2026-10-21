import {describe,it,expect} from 'vitest';
import {strategicOptions,type StrategicPool} from '../src/decision/strategic-options';
import type {ShopState,TradingRules} from '../src/decision/shop-ledger';
const rules:TradingRules={version:'test',provisional:false,heroes:{A:{cost:1,maxStar:3,sellValues:{1:1,2:3,3:9}},B:{cost:1,maxStar:3,sellValues:{1:1,2:3,3:9}},C:{cost:2,maxStar:3,sellValues:{1:2,2:5,3:17}}},benchCapacity:9,itemRackCapacity:10,interestStep:10,interestCap:5,victoryGoldBeforeInterest:1};
const pool:StrategicPool={complete:true,remaining:{A:10,B:10,C:10},tierRemaining:{1:100,2:50,3:30,4:30,5:30},tierOdds:{1:.8,2:.2,3:0,4:0,5:0},heroSlotsCycle:[5],refreshPrice:2};
const state=():ShopState=>({gold:20,level:4,boardCapacity:4,units:[{key:'a',id:'A',star:1,area:'board',slot:0,items:[]},{key:'b',id:'A',star:1,area:'bench',slot:0,items:[]}],offers:[{id:'A',slot:0,price:1},{id:'B',slot:1,price:1}],itemRack:[]});
describe('future option value of a current purchase or bench hold',()=>{
  it('buys a known missing copy instead of paying to search for it again, without buying duplicates',async()=>{
    const s=state();s.offers.push({id:'A',slot:2,price:1});const [r]=await strategicOptions(s,rules,[{id:'upgrade',targets:[{id:'A',copies:3}]}],pool,{reserveGold:0});
    if(!r.ready)throw Error(r.reason);expect(r.choice.completion.probability).toBe(1);expect(r.choice.buySlots).toHaveLength(1);expect(r.choice.goldAfter).toBe(19);expect(r.baseline.probability).toBeLessThan(1);
    expect(s.gold).toBe(20);expect(s.units).toHaveLength(2);
  });
  it('separates a current interest floor from a hypothetical future search budget',async()=>{
    const [r]=await strategicOptions(state(),rules,[{id:'upgrade',targets:[{id:'A',copies:3}]}],pool,{reserveGold:0,currentCashFloor:20});
    if(!r.ready)throw Error(r.reason);expect(r.choice.buySlots).toEqual([]);expect(r.choice.completion.probability).toBeGreaterThan(0);
  });
  it('evaluates zero-overlap future goals without retaining existing final-comp heroes',async()=>{
    const [r]=await strategicOptions(state(),rules,[{id:'pivot',targets:[{id:'B',copies:1},{id:'C',copies:1}]}],pool,{reserveGold:0});
    if(!r.ready)throw Error(r.reason);expect(r.choice.buySlots).toEqual([1]);expect(r.choice.completion.probability).toBeGreaterThan(r.baseline.probability);expect(r.choice.actions.every(a=>a.type!=='sell')).toBe(true);
  });
  it('prices selling a pair by returning its copies and refunding its actual cash value',async()=>{
    const [r]=await strategicOptions(state(),rules,[{id:'upgrade',targets:[{id:'A',copies:3}]}],pool,{reserveGold:0,retention:true});
    if(!r.ready)throw Error(r.reason);const hold=r.retention.find(h=>h.key==='b')!;
    expect(hold.sellGold).toBe(1);expect(hold.keepProbability).toBe(1);expect(hold.sellProbability).toBeLessThan(1);expect(hold.delta).toBeGreaterThan(0);
  });
  it('does not pretend incomplete pool evidence is zero available copies, and can cancel stale goals',async()=>{
    const goals=[{id:'a',targets:[{id:'A',copies:3}]},{id:'b',targets:[{id:'B',copies:1}]}];
    expect(await strategicOptions(state(),rules,goals,{...pool,complete:false},{reserveGold:0})).toEqual(goals.map(g=>({id:g.id,ready:false,reason:expect.stringContaining('未齐')})));
    expect(await strategicOptions(state(),rules,goals,pool,{reserveGold:0,cancelled:()=>true})).toEqual([]);
  });
  it('leaves storage to the player by default, and models it only when requested',async()=>{
    const s=state();s.boardCapacity=1;s.units=s.units.slice(0,1);s.offers=[];const tiny={...rules,benchCapacity:0};
    const goals=[{id:'a',targets:[{id:'A',copies:3}]}];
    const [relaxed]=await strategicOptions(s,tiny,goals,pool,{reserveGold:0});
    const [bounded]=await strategicOptions(s,tiny,goals,pool,{reserveGold:0,modelStorage:true});
    if(!relaxed.ready||!bounded.ready)throw Error('expected available calculation');expect(relaxed.choice.completion.probability).toBeGreaterThan(0);expect(bounded.choice.completion.probability).toBe(0);
  });
});
