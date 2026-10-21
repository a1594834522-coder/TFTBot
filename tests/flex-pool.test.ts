import {describe,it,expect} from 'vitest';
import {flexPool,type FlexPoolInput} from '../src/decision/flex-pool';
function fixture():FlexPoolInput{return {cards:['A','B','C','D'].map(id=>({id,cost:1,remaining:1,price:1,resale:1})),goals:[{id:'AB',units:['A','B']},{id:'CD',units:['C','D']}],tierRemaining:{1:6,2:10,3:10,4:10,5:10},tierOdds:{1:1,2:0,3:0,4:0,5:0},held:[],cash:6,refreshPrice:2,heroSlotsCycle:[1]};}
describe('adaptive first-copy flex portfolio',()=>{
  it('values whichever route actually arrives instead of choosing the best route with hindsight',()=>{
    const input=fixture(),flex=flexPool(input),fixed=flexPool({...input,goals:[input.goals[0]]});
    // Two one-card refreshes leave exactly enough cash for a two-card core.
    // Four winning ordered trajectories out of 6*5: AB, BA, CD, DC.
    expect(flex.completionProbability).toBeCloseTo(4/30,12);expect(fixed.completionProbability).toBeCloseTo(2/30,12);
    expect(flex.next).toBe('refresh');expect(flex.completionProbability).toBe(flex.value);
  });
  it('matches a separate physical-card oracle with cash-constrained liquidation and post-shop choices',()=>{
    const input=fixture();input.held=['A'];input.cash=5;
    const initial=['A','B','C','D','X','X'];
    const subsets=(a:string[])=>Array.from({length:1<<a.length},(_,mask)=>a.filter((_,i)=>mask&(1<<i)));
    const memo=new Map<string,number>();
    function brute(held:string[],wealth:number):number{
      if(held.includes('A')&&held.includes('B')||held.includes('C')&&held.includes('D'))return 1;
      if(wealth<2)return 0;const key=held.slice().sort().join('')+wealth;if(memo.has(key))return memo.get(key)!;
      let best=0;const after=wealth-2;
      for(const before of subsets(held).filter(s=>s.length<=after)){
        const pool=initial.filter(id=>!before.includes(id));let sum=0;
        for(const id of pool){const available=[...new Set([...before,...(id==='X'?[]:[id])])];sum+=Math.max(...subsets(available).filter(s=>s.length<=after).map(s=>brute(s,after)));}
        best=Math.max(best,sum/pool.length);
      }
      memo.set(key,best);return best;
    }
    expect(flexPool(input).completionProbability).toBeCloseTo(brute(['A'],6),12);
  });
  it('counts known offers once and preserves cash for buying the goal rather than rerolling it away',()=>{
    const input=fixture();input.cash=2;input.visible=['A','A','B'];const result=flexPool(input);
    expect(result.completionProbability).toBe(1);expect(result.buy.sort()).toEqual(['A','B']);expect(result.next).toBe('core-collected');expect(result.expectedCashAtExit).toBe(0);
    expect(flexPool({...input,cash:1}).completionProbability).toBe(0);
  });
  it('can retain a complete good-enough core while deciding whether a better-valued alternative is worth searching',()=>{
    const input=fixture();input.held=['A','B'];input.cash=0;input.baselineValue=.3;input.goals[0].value=.7;input.goals[1].value=.9;
    const result=flexPool(input);expect(result.value).toBe(.7);expect(result.completionProbability).toBe(1);expect(result.next).toBe('core-collected');
    const stop=flexPool({...input,held:[],cash:2,goals:input.goals.map(g=>({...g,value:.2}))});expect(stop.value).toBe(.3);expect(stop.next).toBe('hold');
  });
  it('rejects merged/non-refundable assumptions and bounds expensive portfolios explicitly',()=>{
    const input=fixture();expect(()=>flexPool({...input,cards:input.cards.map((c,i)=>({...c,resale:i?1:0}))})).toThrow(/refundable/);
    expect(()=>flexPool({...input,maxStates:1})).toThrow(/state budget/);
    expect(()=>flexPool({...input,goals:[{id:'bad',units:['unknown']}]})).toThrow(/Unknown/);
  });
  it('can delay commitment when the declared upgrade continuation is better on another route',()=>{
    const input=fixture();input.held=['A','B'];input.cash=6;
    const first=flexPool(input);expect(first.completionProbability).toBe(1);
    const upgraded=flexPool({...input,continuation:(g,cash)=>({value:g.id==='AB'?.1:cash>=2?.9:0,completionProbability:g.id==='AB'?.1:cash>=2?.9:0})});
    expect(upgraded.value).toBeGreaterThan(.1);expect(upgraded.next).toBe('refresh');
    expect(upgraded.value).toBe(upgraded.completionProbability);
  });
  it('reports the same liquidation assumed by the terminal budget',()=>{
    const input=fixture();input.held=['A','B','C'];input.cash=0;
    const result=flexPool(input);expect(result.keep.sort()).toEqual(['A','B']);expect(result.sell).toEqual(['C']);expect(result.expectedCashAtExit).toBe(1);
  });
});
