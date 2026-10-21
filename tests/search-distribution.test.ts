import {describe,it,expect} from 'vitest';
import {searchDistribution,type SearchDistributionInput} from '../src/decision/search-distribution';
import {poolBudget} from '../src/decision/pool-budget';
const fixture=():SearchDistributionInput=>({targets:[{id:'A',cost:1,needed:2,remaining:3,price:1},{id:'B',cost:1,needed:1,remaining:2,price:1}],owned:[1,2],goals:[{id:'AB',targets:['A','B']}],tierRemaining:{1:8,2:10,3:10,4:10,5:10},tierOdds:{1:1,2:0,3:0,4:0,5:0},cash:9,refreshPrice:2,heroSlots:1,visible:[]});
describe('budget landing distribution including failed pursuit',()=>{
  it('retains every failure landing, conserves cash/pool mass and matches an independent physical-card recursion',async()=>{
    const input=fixture(),result=await searchDistribution(input);if(result.cancelled)throw Error();
    const physical=['A','A','A','B','B','X','X','X'],oracle=new Map<string,number>();
    function enumerate(a:number,b:number,cash:number,mass:number){
      if(a===2&&b===1||cash<2){const key=[a,b,cash].join(':');oracle.set(key,(oracle.get(key)??0)+mass);return;}
      const deck=physical.slice();for(let n=0;n<a;n++)deck.splice(deck.indexOf('A'),1);for(let n=0;n<b;n++)deck.splice(deck.indexOf('B'),1);
      for(const id of deck){let nextA=a,nextB=b,money=cash-2;if(money&&id==='A'&&a<2){nextA++;money--;}else if(money&&id==='B'&&b<1){nextB++;money--;}
        enumerate(nextA,nextB,money,mass/deck.length);}
    }
    enumerate(0,0,input.cash,1);
    expect(result.unresolved).toBe(0);expect(result.landings.reduce((n,l)=>n+l.probability,0)).toBeCloseTo(1,12);
    expect(result.landings).toHaveLength(oracle.size);
    for(const l of result.landings)expect(l.probability).toBeCloseTo(oracle.get([...l.acquired,l.cash].join(':'))!,12);
    expect(result.landings.some(l=>!l.completed.length&&l.acquired.some(n=>n>0))).toBe(true);
    const fixed=poolBudget({...input,budget:input.cash,heroSlotsCycle:[1]});expect(result.completion.lower).toBeCloseTo(fixed.probability,12);
  });
  it('uses known offers without refresh fees and chooses an available upgrade before a speculative first copy',async()=>{
    const input=fixture();input.cash=1;input.targets[0].needed=1;input.owned[0]=2;input.owned[1]=0;input.targets[1].needed=3;
    input.visible=[{id:'B',price:1},{id:'A',price:1}];const result=await searchDistribution(input);if(result.cancelled)throw Error();
    expect(result.initialBuy).toEqual(['A']);expect(result.landings).toEqual([{acquired:[1,0],cash:0,probability:1,completed:[]}]);
    expect(result.completion.lower).toBe(0);
  });
  it('lets the route actually revealed finish first and does not buy more cards after an already completed goal',async()=>{
    const input=fixture();input.targets.forEach(t=>t.needed=1);input.goals=[{id:'A',targets:['A']},{id:'B',targets:['B']}];input.visible=[{id:'B',price:1},{id:'A',price:1}];
    const result=await searchDistribution(input);if(result.cancelled)throw Error();expect(result.initialBuy).toEqual(['B']);expect(result.completion).toEqual({lower:1,upper:1});
    input.targets[0].needed=0;const done=await searchDistribution(input);if(done.cancelled)throw Error();expect(done.initialBuy).toEqual([]);expect(done.landings[0].cash).toBe(input.cash);
  });
  it('preserves unexpanded mass as unknown bounds instead of silently renormalizing the successful subset',async()=>{
    const input=fixture(),exact=await searchDistribution(input),limited=await searchDistribution({...input,maxStates:1});if(exact.cancelled||limited.cancelled)throw Error();
    expect(limited.unresolved).toBeGreaterThan(0);expect(limited.completion.lower).toBeLessThanOrEqual(exact.completion.lower);expect(limited.completion.upper).toBeGreaterThanOrEqual(exact.completion.upper);
    expect(limited.landings.reduce((n,l)=>n+l.probability,0)+limited.unresolved).toBeCloseTo(1,12);
    expect(await searchDistribution(input,{cancelled:()=>true})).toEqual({cancelled:true});
  });
  it('models five-slot without-replacement shops and includes failed branches when no core is affordable',async()=>{
    const input=fixture();input.targets.forEach(t=>t.needed=1);input.owned=[2,2];input.cash=2;input.heroSlots=5;
    const result=await searchDistribution(input);if(result.cancelled)throw Error();expect(result.completion.lower).toBe(0);
    expect(result.landings).toEqual([{acquired:[0,0],cash:0,probability:expect.closeTo(1),completed:[]}]);
    input.cash=4;const hit=await searchDistribution(input);if(hit.cancelled)throw Error();
    // Both A and B must appear: P(no B)=C(6,5)/C(8,5), P(no A)=C(5,5)/C(8,5).
    expect(hit.completion.lower).toBeCloseTo(1-7/56,12);
  });
});
