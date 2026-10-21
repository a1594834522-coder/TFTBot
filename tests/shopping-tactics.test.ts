import {describe,it,expect} from 'vitest';
import {shoppingTactics} from '../src/decision/shopping-tactics';
import {lineupCandidates} from '../src/decision/lineup-search';
import type {TradingRules,ShopState,OwnedUnit} from '../src/decision/shop-ledger';
import type {BattleRequest} from '../src/game/battle-forecast';
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
});
