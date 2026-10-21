import {describe,it,expect} from 'vitest';
import {shoppingTactics,mainlineTacticalReference} from '../src/decision/shopping-tactics';
import {lineupCandidates} from '../src/decision/lineup-search';
import type {TradingRules,ShopState,OwnedUnit} from '../src/decision/shop-ledger';
import type {BattleRequest} from '../src/game/battle-forecast';
import type {DirectionAdvice} from '../src/decision/direction-advisor';
const rules:TradingRules={version:'test',provisional:false,heroes:{A:{cost:1,maxStar:3,sellValues:{1:1,2:3,3:9}},B:{cost:2,maxStar:3,sellValues:{1:2,2:5,3:17}},C:{cost:3,maxStar:3,sellValues:{1:3,2:8,3:26}},D:{cost:4,maxStar:3,sellValues:{1:4,2:11,3:35}}},benchCapacity:9,itemRackCapacity:10,interestStep:10,interestCap:5,victoryGoldBeforeInterest:1};
const unit=(key:string,id='A',area:'board'|'bench'='board',slot=0):OwnedUnit=>({key,id,star:1,area,slot,items:[]});
const state=():ShopState=>({gold:30,level:1,boardCapacity:1,units:[unit('a'),unit('b','A','bench')],offers:[{slot:0,id:'A',price:1}],itemRack:[]});
const request=():BattleRequest=>({round:'2-2',weightSource:'native',local:{units:[{id:'A',star:1,items:[]}],augments:[]},localGaps:[],targets:[{id:'opp',name:'对手',weight:1,board:{units:[{id:'B',star:1,items:[]}],augments:[]},gaps:[]}]});
const predict=(pairs:Parameters<Parameters<typeof shoppingTactics>[3]>[0])=>pairs.map(({player})=>({winRate:player.units.some(u=>u.id==='A'&&u.star>=2)?.8:player.units.some(u=>u.id==='B')?.9:.3}));
describe('current-shop constrained tactical decisions',()=>{
  it('exposes the real interest/upgrade tradeoff without inventing an exchange rate',async()=>{
    const result=await shoppingTactics(state(),rules,request(),predict);expect(result.ready).toBe(true);if(!result.ready)return;
    expect(result.baseline).toBe(.3);expect(result.choices).toHaveLength(2);
    const economic=result.choices.find(c=>c.id==='economy')!,tempo=result.choices.find(c=>c.id==='tempo')!;
    expect(economic.buy).toEqual([]);expect(economic.goldAfter).toBe(30);expect(economic.winRate).toBe(.3);
    expect(tempo.buy[0]).toMatchObject({id:'A',quantity:1});expect(tempo.goldAfter).toBe(29);expect(tempo.winRate).toBe(.8);expect(tempo.delta).toBe(.5);
  });
  it('buys only the copies needed for the same strongest board, not every duplicate offer',async()=>{
    const s=state();s.gold=35;s.offers=[0,1,2].map(slot=>({slot,id:'A',price:1}));
    const result=await shoppingTactics(s,rules,request(),predict);expect(result.ready).toBe(true);if(result.ready){expect(result.choices).toHaveLength(1);expect(result.choices[0].buy[0].quantity).toBe(1);expect(result.choices[0].goldAfter).toBe(34);}
  });
  it('finds free bench-to-board improvements before paying for an upgrade',async()=>{
    const s=state();s.units[1].id='B';s.offers=[];
    const result=await shoppingTactics(s,rules,request(),predict);if(!result.ready)throw Error(result.reason);
    expect(result.choices[0].onBoard).toEqual(['B']);expect(result.choices[0].buy).toEqual([]);expect(result.choices[0].delta).toBeCloseTo(.6);
  });
  it('always includes the actual no-op board when forced filling would worsen model value',async()=>{
    const s=state();s.boardCapacity=5;s.offers=[];
    const result=await shoppingTactics(s,rules,request(),pairs=>pairs.map(({player})=>({winRate:player.units.length===1?.8:.2})));
    if(!result.ready)throw Error(result.reason);
    expect(result.baseline).toBe(.8);expect(result.choices[0].winRate).toBe(.8);expect(result.choices[0].delta).toBe(0);
    expect(result.choices[0].onBoardKeys).toEqual(['a']);
  });
  it('preserves both win and loss interest branches at the 29-gold breakpoint',async()=>{
    const s=state();s.gold=29;
    const result=await shoppingTactics(s,rules,request(),predict);if(!result.ready)throw Error(result.reason);
    expect(result.choices.find(c=>c.id==='economy')!.buy).toEqual([]);
    expect(result.choices.find(c=>c.id==='tempo')!.interestIfWin).toBe(2);
  });
  it('keeps missing opponent mass unknown and cancels obsolete computation',async()=>{
    const r=request();r.targets[0].weight=.75;r.targets.push({id:'missing',name:'未采集',weight:.25,board:null,gaps:['场上棋盘未齐']});
    const result=await shoppingTactics(state(),rules,r,predict);if(!result.ready)throw Error(result.reason);
    expect(result.coverage).toBe(.75);expect(result.baseline).toBeNull();expect(result.choices[0].delta).toBeNull();
    const cancelled=await shoppingTactics(state(),rules,r,predict,{cancelled:()=>true});expect(cancelled).toEqual({ready:false,reason:'局面已变化'});
  });
  it('enumerates every lineup within the declared swap scope and no unit appears twice',()=>{
    const s=state();s.boardCapacity=2;s.units=[unit('a','A','board',0),unit('b','B','board',1),unit('c','C','bench',0),unit('d','D','bench',1)];
    const one=lineupCandidates(s,[],1),all=lineupCandidates(s,[],2);
    expect(one).toHaveLength(5);expect(all).toHaveLength(6);
    for(const c of all){expect(c.units).toHaveLength(2);expect(new Set(c.units.map(u=>u.key)).size).toBe(2);expect(c.bench).toHaveLength(2);}
    expect(one.some(c=>c.units.every(u=>u.area==='bench'))).toBe(false);
  });
  it('finds a two-unit synergy whose individual swaps both lose, matching an independent full combination oracle',async()=>{
    const s=state();s.boardCapacity=2;s.offers=[];s.units=[unit('a','A','board',0),unit('b','B','board',1),unit('c','C','bench',0),unit('d','D','bench',1)];
    const r=request();r.local.units=s.units.filter(u=>u.area==='board').map(u=>({id:u.id,star:1,items:[]}));
    const value=(ids:string[])=>ids.includes('C')&&ids.includes('D')?.9:ids.includes('A')&&ids.includes('B')?.5:.4;
    const model:Parameters<typeof shoppingTactics>[3]=pairs=>pairs.map(p=>({winRate:value(p.player.units.map(u=>u.id))}));
    const one=await shoppingTactics(s,rules,r,model,{maxSwaps:1}),two=await shoppingTactics(s,rules,r,model);
    if(!one.ready||!two.ready)throw Error();
    expect(one.choices[0].winRate).toBe(.5);expect(two.maxSwaps).toBe(2);
    const oracle:number[]=[];for(let i=0;i<s.units.length;i++)for(let j=i+1;j<s.units.length;j++)oracle.push(value([s.units[i].id,s.units[j].id]));
    expect(two.choices[0].winRate).toBe(Math.max(...oracle));expect(two.choices[0].onBoard).toEqual(['C','D']);
    expect(two.choices[0].incoming?.map(u=>u.key)).toEqual(['c','d']);expect(two.choices[0].outgoing?.map(u=>u.key)).toEqual(['a','b']);
    expect(two.choices[0].actions).toEqual([]); // Read-only deployment scenario, no fabricated sales.
  });
  it('separates mainline entry from the stronger equipped worker and never teleports its items',async()=>{
    const s=state();s.offers=[];s.units[0].items=[{key:'physical-ie',id:'IE'}];s.units[1].id='B';
    const r=request();r.local.units[0].items=['IE'];const original=JSON.stringify(s);
    const result=await shoppingTactics(s,rules,r,pairs=>pairs.map(({player})=>({winRate:player.units.some(u=>u.id==='A'&&u.items.includes('IE'))?.9:.2})),{reference:{cores:['B']}});
    if(!result.ready)throw Error(result.reason);
    expect(result.choices[0]).toMatchObject({onBoard:['A'],winRate:.9});
    const entry=result.choices.find(c=>c.id==='mainline')!;
    expect(entry).toMatchObject({onBoard:['B'],onBoardItems:[[]],winRate:.2,mainlineCores:['B']});expect(entry.delta).toBeCloseTo(-.7);
    expect(entry.outgoing?.[0]).toMatchObject({id:'A',items:['IE']});expect(entry.incoming?.[0].items).toEqual([]);
    expect(JSON.stringify(s)).toBe(original);
  });
  it('reports a real merge as an upgrade while preserving equipment, not as a bench swap',async()=>{
    const s=state();s.units[0].items=[{key:'physical-ie',id:'IE'}];const r=request();r.local.units[0].items=['IE'];
    const result=await shoppingTactics(s,rules,r,predict);if(!result.ready)throw Error(result.reason);
    const upgrade=result.choices.find(c=>c.buy.length)!;
    expect(upgrade.upgraded).toEqual([{id:'A',before:1,after:2}]);expect(upgrade.incoming).toEqual([]);expect(upgrade.outgoing).toEqual([]);
    expect(upgrade.onBoardItems).toEqual([['IE']]);
  });
  it('retains an explicit mainline alternative when the strongest immediate swap would bench existing cores',async()=>{
    const s=state();s.boardCapacity=2;s.offers=[];s.units=[unit('a','A','board',0),unit('b','B','board',1),unit('c','C','bench',0),unit('d','D','bench',1)];
    const r=request();r.local.units=s.units.slice(0,2).map(u=>({id:u.id,star:1,items:[]}));
    const result=await shoppingTactics(s,rules,r,pairs=>pairs.map(({player})=>({winRate:player.units.every(u=>['C','D'].includes(u.id))?.9:player.units.every(u=>['A','B'].includes(u.id))?.7:.5})),{reference:{cores:['A','B']}});
    if(!result.ready)throw Error(result.reason);
    expect(result.choices[0].onBoard).toEqual(['C','D']);
    expect(result.choices.find(c=>c.id==='mainline')).toMatchObject({title:'主线保留',onBoard:['A','B'],delta:0,mainlineCores:['A','B']});
  });
  it('rejects a stale or differently equipped baseline before producing any apparent improvement',async()=>{
    const s=state(),r=request();let predictions=0;const model:Parameters<typeof shoppingTactics>[3]=pairs=>{predictions+=pairs.length;return predict(pairs);};
    r.local.units[0].star=2;
    expect(await shoppingTactics(s,rules,r,model)).toMatchObject({ready:false,reason:expect.stringContaining('帧同步')});
    r.local.units[0].star=1;r.local.units[0].items=['IE'];
    expect(await shoppingTactics(s,rules,r,model)).toMatchObject({ready:false,reason:expect.stringContaining('帧同步')});
    r.local.units[0].items=[];s.units[0].equipmentKnown=false;
    expect(await shoppingTactics(s,rules,r,model)).toMatchObject({ready:false,reason:expect.stringContaining('装备明细')});expect(predictions).toBe(0);
  });
  it('excludes an unknown bench holder without treating it as naked or blocking the valid current board',async()=>{
    const s=state();s.offers=[];s.units[1].id='B';s.units[1].equipmentKnown=false;
    const result=await shoppingTactics(s,rules,request(),pairs=>{expect(pairs.every(p=>p.player.units.every(u=>u.id==='A'))).toBe(true);return predict(pairs);});
    if(!result.ready)throw Error(result.reason);expect(result.choices[0].onBoard).toEqual(['A']);expect(result.gaps).toContain('部分备选英雄装备明细未齐');
  });
  it('skips unsupported bench scenarios while retaining valid comparisons, and preserves charms on every board',async()=>{
    const s=state();s.offers=[];s.units[1].id='B';const r=request();r.local.charms=['known-charm'];let checked=0;
    const result=await shoppingTactics(s,rules,r,pairs=>{
      for(const p of pairs){expect(p.player.charms).toEqual(['known-charm']);expect(p.player.units.every(u=>u.id!=='B')).toBe(true);checked++;}return predict(pairs);
    },{supportsBoard:b=>b.units.every(u=>u.id!=='B')});
    if(!result.ready)throw Error(result.reason);expect(checked).toBeGreaterThan(0);expect(result.choices[0].onBoard).toEqual(['A']);expect(result.gaps).toContain('部分备选棋盘有模型未覆盖特征');
  });
  it('keeps missing opponent delta uncertainty and can cancel during candidate generation',async()=>{
    const r=request();r.targets[0].weight=.75;r.targets.push({id:'missing',name:'未采集',weight:.25,board:null,gaps:[]});
    const result=await shoppingTactics(state(),rules,r,predict);if(!result.ready)throw Error(result.reason);
    expect(result.choices.find(c=>c.id==='tempo')).toMatchObject({delta:null,lowerDelta:expect.closeTo(.125),upperDelta:expect.closeTo(.625)});
    let obsolete=false,calls=0;
    const cancelled=await shoppingTactics(state(),rules,request(),pairs=>{calls++;return predict(pairs);},{cancelled:()=>obsolete,yield:async()=>{obsolete=true;}});
    expect(cancelled).toEqual({ready:false,reason:'局面已变化'});expect(calls).toBe(0);
  });
  it('compares every board with identical opponent weights and does not duplicate an already stronger mainline choice',async()=>{
    const s=state();s.offers=[];s.units[1].id='B';const r=request();r.targets[0].weight=.8;
    r.targets.push({id:'other',name:'另一对手',weight:.2,board:{units:[{id:'D',star:2,items:[]}],augments:[]},gaps:[]});
    const result=await shoppingTactics(s,rules,r,pairs=>pairs.map(({player,opponent})=>({winRate:player.units[0].id==='B'?(opponent.units[0].id==='B'?.9:.1):.6})),{reference:{cores:['B']}});
    if(!result.ready)throw Error(result.reason);
    expect(result.baseline).toBeCloseTo(.6);expect(result.choices).toHaveLength(1);expect(result.choices[0].winRate).toBeCloseTo(.74);expect(result.choices[0].delta).toBeCloseTo(.14);
    expect(result.choices[0].mainlineCores).toEqual(['B']);
  });
  it('does not silently delete a generated combat unit from every prospective board',async()=>{
    const r=request();r.local.units.push({id:'generated-summon',star:1,items:[]});
    expect(await shoppingTactics(state(),rules,r,()=>{throw Error('Must not predict a fabricated summon-free board');})).toMatchObject({ready:false,reason:expect.stringContaining('非商店单位')});
  });
  it('only exposes a mainline reference after an explicit selection reaches startup or late game',()=>{
    const base={ready:true,mode:'selected',milestone:'roll-down',focusId:'picked',rows:[{id:'picked',carry:'A',tank:'B'}]} as Extract<DirectionAdvice,{ready:true}>;
    expect(mainlineTacticalReference(base)).toEqual({cores:['A','B']});
    expect(mainlineTacticalReference({...base,mode:'flex'})).toBeUndefined();
    expect(mainlineTacticalReference({...base,milestone:'opening'})).toBeUndefined();
    expect(mainlineTacticalReference({...base,updating:true})).toBeUndefined();
    expect(mainlineTacticalReference({ready:false,reason:'未同步'})).toBeUndefined();
  });
  it('measures a purchase against the best free deployment and excludes redundant bought cards',async()=>{
    const s=state();s.gold=15;s.units[1].id='B';s.offers=[{slot:0,id:'C',price:3}];
    const result=await shoppingTactics(s,rules,request(),predict);if(!result.ready)throw Error(result.reason);
    expect(result.baseline).toBe(.3);expect(result.purchaseBaseline).toBe(.9);
    expect(result.choices[0].delta).toBeCloseTo(.6);expect(result.purchases).toEqual([]);
  });
  it('retains affordable cost/strength alternatives and requires both members of a synergy bundle',async()=>{
    const s=state();s.gold=20;s.boardCapacity=2;s.units=[unit('a','A','board',0),unit('b','B','board',1)];
    s.offers=[{slot:0,id:'C',price:3},{slot:1,id:'D',price:4},{slot:2,id:'A',price:1}];
    const r=request();r.local.units=s.units.map(u=>({id:u.id,star:1,items:[]}));
    const value=(ids:string[])=>ids.includes('C')&&ids.includes('D')?.9:ids.includes('C')?.6:.4;
    const result=await shoppingTactics(s,rules,r,pairs=>pairs.map(p=>({winRate:value(p.player.units.map(u=>u.id))})));
    if(!result.ready)throw Error(result.reason);
    expect(result.purchaseBaseline).toBe(.4);
    expect(result.purchases.map(p=>({slots:p.choice.buy.flatMap(b=>b.slots),spend:p.spend,gain:p.gain}))).toEqual([
      {slots:[0],spend:3,gain:expect.closeTo(.2)},{slots:[0,1],spend:7,gain:.5}]);
    expect(result.purchases[1].choice.incoming.map(u=>u.id)).toEqual(['C','D']);
    expect(result.purchases.some(p=>p.choice.buy.some(b=>b.id==='A'))).toBe(false);
    // Independent all-pairs oracle over every affordable shop subset.
    const oracle:Array<{spent:number;win:number}>=[];
    for(let mask=0;mask<8;mask++){
      const bought=s.offers.filter((_,i)=>mask&(1<<i)),ids=[...s.units.map(u=>u.id),...bought.map(o=>o!.id)];
      let win=0;for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)win=Math.max(win,value([ids[a],ids[b]]));
      oracle.push({spent:bought.reduce((n,o)=>n+o!.price,0),win});
    }
    for(const p of result.purchases){expect(p.choice.knownWin).toBe(Math.max(...oracle.filter(o=>o.spent<=p.spend).map(o=>o.win)));}
  });
  it('keeps incomplete opponent mass uncertain relative to the free board too',async()=>{
    const r=request();r.targets[0].weight=.75;r.targets.push({id:'missing',name:'未知',weight:.25,board:null,gaps:[]});
    const result=await shoppingTactics(state(),rules,r,predict);if(!result.ready)throw Error(result.reason);
    expect(result.purchaseBaseline).toBeNull();expect(result.purchases[0]).toMatchObject({gain:null,lowerGain:expect.closeTo(.125),upperGain:expect.closeTo(.625)});
  });
});
