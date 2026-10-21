import {describe,it,expect} from 'vitest';
import {poolBudget,type PoolBudgetInput} from '../src/decision/pool-budget';
const base=(targets:PoolBudgetInput['targets'],extra:Partial<PoolBudgetInput>={}):PoolBudgetInput=>({targets,tierRemaining:{1:20,2:20,3:20,4:20,5:20},tierOdds:{1:1,2:0,3:0,4:0,5:0},budget:12,refreshPrice:2,heroSlotsCycle:[2],...extra});
describe('joint completion under a finite refresh and purchase budget',()=>{
  it('matches an independent physical-card trajectory enumeration, including return of unbought cards',()=>{
    const initial=['A','A','B','X','X','X'];
    function brute(pool:string[],needA:number,needB:number,shops:number):number{
      if(!needA&&!needB)return 1;if(!shops)return 0;let value=0,count=0;
      for(let a=0;a<pool.length;a++)for(let b=a+1;b<pool.length;b++){
        count++;const chosen=[a,b],picked:string[]=[];
        if(needA&&chosen.some(i=>pool[i]==='A'))picked.push('A');if(needB&&chosen.some(i=>pool[i]==='B'))picked.push('B');
        const after=[...pool];for(const id of picked)after.splice(after.indexOf(id),1);
        value+=brute(after,needA-Number(picked.includes('A')),needB-Number(picked.includes('B')),shops-1);
      }
      return value/count;
    }
    const input=base([{id:'A',cost:1,needed:1,remaining:2,price:1},{id:'B',cost:1,needed:1,remaining:1,price:1}],{tierRemaining:{1:6,2:20,3:20,4:20,5:20},budget:6});
    const result=poolBudget(input);expect(result.purchaseGold).toBe(2);expect(result.maxPaidShops).toBe(2);
    expect(result.cdf[1]).toBeCloseTo(2/15,12);expect(result.cdf[2]).toBeCloseTo(brute(initial,1,1,2),12);
  });
  it('preserves mutually exclusive cost draws when targets have different costs',()=>{
    const result=poolBudget(base([{id:'A',cost:1,needed:1,remaining:1,price:1},{id:'B',cost:2,needed:1,remaining:1,price:2}],{tierRemaining:{1:3,2:3,3:20,4:20,5:20},tierOdds:{1:.5,2:.5,3:0,4:0,5:0},budget:5}));
    expect(result.probability).toBeCloseTo(1/18,12);
  });
  it('reserves purchase gold instead of spending the whole advertised budget on rerolls',()=>{
    const target={id:'A',cost:1,needed:3,remaining:10,price:1};
    expect(poolBudget(base([target],{budget:2}))).toMatchObject({probability:0,purchaseGold:3,maxPaidShops:0});
    expect(poolBudget(base([target],{budget:7})).maxPaidShops).toBe(2);
  });
  it('handles repeated copies, saturation and explicit periodic wisp slots',()=>{
    const target={id:'A',cost:1,needed:1,remaining:5,price:1};
    const periodic=poolBudget(base([target],{heroSlotsCycle:[1,2],budget:5}));
    // Failure in both shops returns unbought cards, so the same pool is sampled again.
    expect(periodic.cdf[1]).toBeCloseTo(5/20,12);
    expect(periodic.cdf[2]).toBeCloseTo(1-(15/20)*(15*14/(20*19)),12);
    const all=poolBudget(base([{...target,needed:2,remaining:20}],{budget:4}));expect(all.probability).toBe(1);expect(all.gold50).toBe(4);
  });
  it('does not turn unreachable, censored or empty evidence into an invented finite price',()=>{
    const unreachable=poolBudget(base([{id:'A',cost:1,needed:3,remaining:2,price:1}]));expect(unreachable.probability).toBe(0);expect(unreachable.gold90).toBeNull();expect(unreachable.reason).toContain('牌池不足');
    const capped=poolBudget(base([{id:'A',cost:1,needed:1,remaining:1,price:1}],{budget:100,maxShops:1}));expect(capped.limitedByShopCap).toBe(true);expect(capped.gold90).toBeNull();
    expect(poolBudget(base([],{budget:0}))).toMatchObject({probability:1,purchaseGold:0,gold50:0});
  });
  it('rejects wrong cost totals, aliased duplicate targets, and unsupported exhausted-cost rules',()=>{
    expect(()=>poolBudget(base([{id:'A',cost:1,needed:1,remaining:21,price:1}]))).toThrow(/physical/);
    expect(()=>poolBudget(base([{id:'A',cost:1,needed:1,remaining:2,price:1},{id:'A',cost:1,needed:1,remaining:2,price:1}]))).toThrow();
    expect(()=>poolBudget(base([{id:'A',cost:1,needed:1,remaining:1,price:1}],{tierRemaining:{1:1,2:20,3:20,4:20,5:20},heroSlotsCycle:[2]}))).toThrow(/exhaustion/);
    expect(()=>poolBudget(base([],{tierOdds:{1:.5,2:0,3:0,4:0,5:0,6:.5}}))).toThrow(/sum/);
  });
  it('allows buying the immediate third copy at full capacity, before another offered target',()=>{
    const targets=[{id:'A',cost:1,needed:1,remaining:2,price:1},{id:'B',cost:1,needed:1,remaining:1,price:1}];
    const result=poolBudget(base(targets,{budget:4,tierRemaining:{1:6,2:20,3:20,4:20,5:20},storage:{capacity:2,fixedUnits:0,owned:{A:{copies:2,maxStar:3},B:{copies:0,maxStar:3}}}}));
    expect(result.probability).toBeCloseTo(2/15,12);expect(result.storageConstrained).toBe(true);
  });
  it('requires a feasible purchase order, even when the final merged entity would fit',()=>{
    const input=base([{id:'A',cost:1,needed:2,remaining:20,price:1}],{budget:4,storage:{capacity:1,fixedUnits:0,owned:{A:{copies:1,maxStar:3}}}});
    expect(poolBudget(input).probability).toBe(0);
    expect(poolBudget({...input,storage:{...input.storage!,capacity:2}}).probability).toBe(1);
  });
  it('can skip an early target to preserve merge room, and matches a separate ordered-card Bellman oracle',()=>{
    const targets=[{id:'A',cost:1,needed:2,remaining:2,price:1},{id:'B',cost:1,needed:1,remaining:1,price:1}];
    const pool=['A','A','B','X','X','X'];
    function brute(cards:string[],a:number,b:number,shops:number):number{
      if(a===3&&b===1)return 1;if(!shops)return 0;
      let sum=0;
      for(let index=0;index<cards.length;index++){
        let best=brute(cards,a,b,shops-1);const id=cards[index],nextA=a+Number(id==='A'),nextB=b+Number(id==='B');
        const target=id==='A'&&a<3||id==='B'&&b<1;
        if(target&&(nextA===3?1:nextA)+nextB<=2){const after=cards.filter((_,i)=>i!==index);best=Math.max(best,brute(after,nextA,nextB,shops-1));}
        sum+=best;
      }
      return sum/cards.length;
    }
    const input=base(targets,{heroSlotsCycle:[1],budget:9,tierRemaining:{1:6,2:20,3:20,4:20,5:20},storage:{capacity:2,fixedUnits:0,owned:{A:{copies:1,maxStar:3},B:{copies:0,maxStar:3}}}});
    const result=poolBudget(input);
    expect(result.probability).toBeCloseTo(brute(pool,1,0,3),12);
    // Only A, A, B completes in three draws. B, A, A strands the second A.
    expect(result.probability).toBeCloseTo((2/6)*(1/5)*(1/4),12);
    expect(poolBudget({...input,storage:undefined}).probability).toBeGreaterThan(result.probability);
  });
  it('retains non-target entities and distinguishes impossible end storage from invalid initial storage',()=>{
    const input=base([{id:'A',cost:1,needed:1,remaining:2,price:1}],{storage:{capacity:2,fixedUnits:2,owned:{A:{copies:0,maxStar:3}}}});
    expect(poolBudget(input)).toMatchObject({probability:0,reason:expect.stringContaining('无足够位置')});
    expect(()=>poolBudget({...input,storage:{capacity:2,fixedUnits:2,owned:{A:{copies:1,maxStar:3}}}})).toThrow(/Initial/);
  });
});
