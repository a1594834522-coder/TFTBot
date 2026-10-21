import {describe,it,expect} from 'vitest';
import {trade,validateShopState,enumerateShoppingPlans,unitCopyCounts,copies,interest,type OwnedUnit,type ShopState,type TradingRules} from '../src/decision/shop-ledger';
const hero=(cost:number,maxStar=3)=>({cost,maxStar,sellValues:Object.fromEntries(Array.from({length:maxStar},(_,i)=>[i+1,cost*3**i-(i&&cost>1?1:0)]))});
const rules=(overrides:Partial<TradingRules>={}):TradingRules=>({version:'test-explicit',provisional:false,heroes:{A:hero(1),B:hero(2),C:hero(3),D:hero(4),E:hero(5)},benchCapacity:9,itemRackCapacity:10,interestStep:10,interestCap:5,victoryGoldBeforeInterest:1,...overrides});
const unit=(key:string,id='A',star=1,area:'board'|'bench'='bench',slot=0):OwnedUnit=>({key,id,star,area,slot,items:[]});
const state=(overrides:Partial<ShopState>={}):ShopState=>({gold:20,level:5,boardCapacity:5,units:[],offers:[],itemRack:[],...overrides});
const allTokens=(s:ShopState)=>[...s.itemRack,...s.units.flatMap(u=>u.items)].map(t=>t.key).sort();
describe('physical trading ledger',()=>{
  it('charges the actual offer once, clears its slot, and does not mutate on failure',()=>{
    const s=state({gold:1,offers:[{slot:0,id:'B',price:1}]}),original=structuredClone(s);
    const buy=trade(s,{type:'buy',slot:0},rules());expect(buy.ok).toBe(true);
    if(!buy.ok)throw Error('buy');expect(buy.state.gold).toBe(0);expect(buy.state.offers[0]).toBeNull();
    expect(trade(buy.state,{type:'buy',slot:0},rules())).toMatchObject({ok:false,reason:'invalid-action'});
    expect(s).toEqual(original);expect(trade(s,{type:'buy',slot:4},rules()).ok).toBe(false);
  });
  it('allows an immediate third-copy merge on a full bench and retains board gear',()=>{
    const a=unit('a','A',1,'board'),b=unit('b','A',1,'bench',0);a.items=[{key:'sword',id:'IE'}];
    const s=state({gold:1,boardCapacity:1,units:[a,b,unit('c','C',1,'bench',1)],offers:[{slot:0,id:'A',price:1}]}),r=rules({benchCapacity:2});
    const result=trade(s,{type:'buy',slot:0},r);expect(result.ok).toBe(true);if(!result.ok)throw Error('merge');
    expect(result.state.units.find(u=>u.id==='A')).toMatchObject({star:2,area:'board',items:a.items});
    expect(result.state.units.filter(u=>u.area==='bench')).toHaveLength(1);
    expect(unitCopyCounts(result.state.units).A).toBe(3);expect(allTokens(result.state)).toEqual(['sword']);validateShopState(result.state,r);
  });
  it('cascades into three-star and supports an explicitly enabled four-star rule',()=>{
    const s=state({gold:1,units:[unit('a','A',2,'board'),unit('b','A',2,'bench',0),unit('c','A',1,'bench',1),unit('d','A',1,'bench',2)],offers:[{slot:0,id:'A',price:1}]});
    const result=trade(s,{type:'buy',slot:0},rules());expect(result.ok).toBe(true);if(!result.ok)throw Error('cascade');
    expect(result.state.units).toHaveLength(1);expect(result.state.units[0].star).toBe(3);expect(result.merges.map(m=>m.star)).toEqual([2,3]);
    const r=rules({heroes:{A:hero(1,4)}}),more=state({gold:1,units:[unit('a','A',3,'board'),unit('b','A',3,'bench',0),unit('c','A',2,'bench',1),unit('d','A',2,'bench',2),unit('e','A',1,'bench',3),unit('f','A',1,'bench',4)],offers:[{slot:0,id:'A',price:1}]});
    const fourth=trade(more,{type:'buy',slot:0},r);expect(fourth.ok).toBe(true);if(fourth.ok)expect(fourth.state.units.map(u=>u.star)).toEqual([4]);
  });
  it('finds the legal merge-first buy order instead of declaring the whole purchase subset impossible',()=>{
    const s=state({gold:4,boardCapacity:1,units:[unit('a','A',1,'board'),unit('b','A',1,'bench',0),unit('c','B',1,'bench',1)],offers:[{slot:0,id:'C',price:3},{slot:1,id:'A',price:1}]});
    const search=enumerateShoppingPlans(s,rules({benchCapacity:2}),{sellCandidates:[]});
    const plan=search.plans.find(p=>p.buySlots.length===2)!;
    expect(plan).toBeDefined();expect(plan.actions.filter(a=>a.type==='buy').map(a=>(a as any).slot)).toEqual([1,0]);expect(plan.state.gold).toBe(0);
  });
  it('stages an existing bench unit only if an actual board slot is available',()=>{
    const s=state({units:[unit('a')],offers:[{slot:0,id:'B',price:2}],boardCapacity:1}),r=rules({benchCapacity:1});
    const found=enumerateShoppingPlans(s,r,{sellCandidates:[]}).plans.find(p=>p.buySlots.length);
    expect(found?.actions.map(a=>a.type)).toEqual(['stage','buy']);validateShopState(found!.state,r);
    expect(enumerateShoppingPlans(s,r,{sellCandidates:[],stageToFreeBench:false}).plans.some(p=>p.buySlots.length)).toBe(false);
  });
  it('uses explicit star sale values and branches cash/interest for a win before interest',()=>{
    const s=state({gold:27,units:[unit('b','B',2)],offers:[{slot:0,id:'C',price:3}]});
    const plans=enumerateShoppingPlans(s,rules()).plans;
    const sale=plans.find(p=>p.sellKeys.includes('b')&&!p.buySlots.length)!;expect(sale.refund).toBe(5);expect(sale.state.gold).toBe(32);
    const buy=plans.find(p=>p.sellKeys.includes('b')&&p.buySlots.length)!;expect(buy.state.gold).toBe(29);expect(buy.interestIfLose).toBe(2);expect(buy.interestIfWin).toBe(3);
    expect(interest(99,rules())).toBe(5);
  });
  it('retains each equipment token through sales and excludes ambiguous merge/item-overflow branches',()=>{
    const a=unit('a','A',1,'board'),b=unit('b','A',1,'bench');a.items=[{key:'gear1',id:'IE'}];b.items=[{key:'gear2',id:'LW'}];
    const s=state({units:[a,b],offers:[{slot:0,id:'A',price:1}]});
    expect(trade(s,{type:'buy',slot:0},rules())).toEqual({ok:false,reason:'unsupported-merge-equipment'});
    expect(trade(s,{type:'sell',key:'a'},rules({itemRackCapacity:null}))).toEqual({ok:false,reason:'unsupported-item-overflow'});
    const result=trade(s,{type:'sell',key:'a'},rules());expect(result.ok).toBe(true);if(result.ok)expect(allTokens(result.state)).toEqual(['gear1','gear2']);
  });
  it('enumerates every declared subset and conserves independent gold, base copies and physical equipment',()=>{
    const r=rules({benchCapacity:20,heroes:{...rules().heroes,F:hero(1),G:hero(2),H:hero(3)}}),s=state({gold:100,units:[unit('ownA','F',1,'bench',0),unit('ownB','G',2,'bench',1),unit('ownC','H',1,'bench',2)],offers:['A','B','C','D','E'].map((id,slot)=>({slot,id,price:r.heroes[id].cost}))});
    const start=unitCopyCounts(s.units),search=enumerateShoppingPlans(s,r);
    expect(search.examined).toBe(8*32);expect(search.scope.exhaustiveSubsets).toBe(true);
    expect(search.plans).toHaveLength(8*32);
    for(const plan of search.plans){
      const expected={...start};let cost=0,refund=0;
      for(const key of plan.sellKeys){const u=s.units.find(u=>u.key===key)!;expected[u.id]-=copies(u.star);refund+=r.heroes[u.id].sellValues[u.star];}
      for(const slot of plan.buySlots){const o=s.offers[slot]!;expected[o.id]=(expected[o.id]??0)+1;cost+=o.price;}
      const actual=unitCopyCounts(plan.state.units);
      for(const id of Object.keys(r.heroes))expect(actual[id]??0).toBe(expected[id]??0);
      expect(plan.state.gold).toBe(s.gold-cost+refund);expect(plan.state.gold).toBeGreaterThanOrEqual(0);
      expect(allTokens(plan.state)).toEqual(allTokens(s));validateShopState(plan.state,r);
    }
    expect(search.plans.some(p=>p.buySlots.length===5&&p.sellKeys.length===3)).toBe(true);
  });
  it('rejects duplicate tokens, incomplete rule tables and invalid physical locations',()=>{
    const a=unit('a'),b=unit('b','B',1,'bench',1);a.items=[{key:'same',id:'IE'}];b.items=[{key:'same',id:'IE'}];
    expect(()=>validateShopState(state({units:[a,b]}),rules())).toThrow(/equipment/);
    expect(()=>validateShopState(state(),rules({heroes:{A:{cost:1,maxStar:3,sellValues:{1:1}}}}))).toThrow(/Incomplete/);
    expect(()=>enumerateShoppingPlans(state(),rules(),{sellCandidates:['missing']})).toThrow(/sale/);
  });
});
