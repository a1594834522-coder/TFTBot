import {describe,it,expect} from 'vitest';
import {adaptivePursuit} from '../src/decision/adaptive-pursuit';
import {createPoolKernel} from '../src/decision/pool-kernel';
import {SearchDistributionCache,searchDistribution,type SearchDistributionInput} from '../src/decision/search-distribution';
function fixture():SearchDistributionInput{return {
  targets:[{id:'A',cost:1,needed:1,remaining:2,price:1},{id:'B',cost:1,needed:3,remaining:4,price:1},{id:'C',cost:1,needed:1,remaining:2,price:1},{id:'D',cost:1,needed:1,remaining:2,price:1}],owned:[2,0,2,2],
  goals:[{id:'AB',targets:['A','B']},{id:'CD',targets:['C','D']}],tierRemaining:{1:12,2:10,3:10,4:10,5:10},tierOdds:{1:1,2:0,3:0,4:0,5:0},cash:6,refreshPrice:2,heroSlots:2,visible:[],initialPurchase:[]};}
/** Independent physical-card recursion. Every paid shop is revealed BEFORE its
 * purchase subset is chosen; unbought physical cards return to the pool. */
function oracle(input:SearchDistributionInput){
  const ids=input.targets.map(t=>t.id),initial=[...ids.flatMap((id,i)=>Array(input.targets[i].remaining).fill(id)),...Array(input.tierRemaining[1]-input.targets.reduce((n,t)=>n+t.remaining,0)).fill('X')],memo=new Map<string,{p:number;cash:number}>();
  const better=(a:{p:number;cash:number},b:{p:number;cash:number})=>a.p>b.p+1e-12||Math.abs(a.p-b.p)<1e-12&&a.cash>b.cash+1e-12;
  function value(needed:number[],cash:number,pool:string[]):{p:number;cash:number}{
    if(input.goals.some(g=>g.targets.every(id=>needed[ids.indexOf(id)]===0)))return {p:1,cash};
    if(cash<2)return {p:0,cash};const key=needed.join(',')+':'+cash,hit=memo.get(key);if(hit)return hit;
    let p=0,gold=0,shops=0;
    for(let a=0;a<pool.length;a++)for(let b=a+1;b<pool.length;b++){
      shops++;let best={p:-1,cash:0};const revealed=[a,b];
      for(let mask=0;mask<4;mask++){
        const needs=[...needed],bought:number[]=[];let money=cash-2,legal=true;
        for(let i=0;i<2;i++)if(mask&(1<<i)){const index=ids.indexOf(pool[revealed[i]]);if(index<0||needs[index]<=0||money<1){legal=false;break;}needs[index]--;money--;bought.push(revealed[i]);}
        if(!legal)continue;const after=pool.filter((_,i)=>!bought.includes(i)),candidate=value(needs,money,after);if(better(candidate,best))best=candidate;
      }
      p+=best.p;gold+=best.cash;
    }
    let result={p:p/shops,cash:gold/shops};const stop={p:0,cash};if(better(stop,result))result=stop;memo.set(key,result);return result;
  }
  return value(input.targets.map(t=>t.needed),input.cash,initial);
}
describe('observable adaptive completion policy',()=>{
  it('keeps mixed-cost slots correlated and saves cash on a failed final affordable shop',async()=>{
    const input:SearchDistributionInput={targets:[{id:'A',cost:1,needed:1,remaining:2,price:1},{id:'B',cost:2,needed:1,remaining:2,price:2}],owned:[2,2],goals:[{id:'AB',targets:['A','B']}],
      tierRemaining:{1:3,2:3,3:10,4:10,5:10},tierOdds:{1:.5,2:.5,3:0,4:0,5:0},cash:5,refreshPrice:2,heroSlots:2,visible:[],initialPurchase:[]};
    const root=createPoolKernel(input).root,prepared=await adaptivePursuit(input,[{code:root,cash:5}]);if(prepared.cancelled)throw Error();
    const result=await searchDistribution(input,{policy:prepared.policy});if(result.cancelled)throw Error();
    expect(result.completion.lower).toBeCloseTo(2/9,12);expect(result.expectedCash.lower).toBeCloseTo(7/3,12);expect(prepared.limited).toBe(false);
  });
  it('matches an independent optimal physical-card oracle, including failed branches and saved cash',async()=>{
    const input=fixture(),before=JSON.stringify(input),root=createPoolKernel(input).root,prepared=await adaptivePursuit(input,[{code:root,cash:input.cash}]);if(prepared.cancelled)throw Error();
    const expected=oracle(input),result=await searchDistribution(input,{policy:prepared.policy}),base=await searchDistribution(input);if(result.cancelled||base.cancelled)throw Error();
    expect(prepared.limited).toBe(false);expect(result.completion.lower).toBeCloseTo(expected.p,12);expect(result.completion.upper).toBeCloseTo(expected.p,12);
    expect(result.expectedCash.lower).toBeCloseTo(expected.cash,12);expect(result.expectedCash.upper).toBeCloseTo(expected.cash,12);
    expect(prepared.bounds[0].lower).toBeCloseTo(expected.p,12);expect(prepared.bounds[0].upper).toBeCloseTo(expected.p,12);expect(prepared.bounds[0].cashLower).toBeCloseTo(expected.cash,12);
    expect(result.completion.lower).toBeGreaterThan(base.completion.lower);expect(result.landings.reduce((n,l)=>n+l.probability,0)).toBeCloseTo(1,12);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('passes up an available upgrade when it provably prevents a more reachable route, without knowing future shops',async()=>{
    const input=fixture(),root=createPoolKernel(input).root,prepared=await adaptivePursuit(input,[{code:root,cash:6}]);if(prepared.cancelled)throw Error();
    expect(prepared.policy.buy(root,4,[{index:0,price:1},{index:2,price:1}]).bought).toEqual(['C']);
    // An affordable completed goal is taken immediately, and no current bundle
    // is silently undone. All these decisions use only observed offers.
    expect(prepared.policy.buy(root,4,[{index:2,price:1},{index:3,price:1}]).bought.sort()).toEqual(['C','D']);
    expect(prepared.policy.refresh(root,1)).toBe(false);
  });
  it('preserves interval bounds and the base completion chance under small state/action limits',async()=>{
    const input=fixture(),root=createPoolKernel(input).root,base=await searchDistribution(input),exact=oracle(input);if(base.cancelled)throw Error();
    for(const limits of [{maxStates:1},{maxStates:2},{maxDecisions:1},{maxDecisions:30}]){
      const prepared=await adaptivePursuit(input,[{code:root,cash:input.cash}],limits);if(prepared.cancelled)throw Error();
      expect(prepared.limited).toBe(true);const result=await searchDistribution(input,{policy:prepared.policy});if(result.cancelled)throw Error();
      expect(result.completion.lower+1e-12).toBeGreaterThanOrEqual(base.completion.lower);expect(result.completion.lower).toBeLessThanOrEqual(exact.p+1e-12);
      expect(prepared.bounds[0].lower).toBeLessThanOrEqual(result.completion.lower+1e-12);expect(prepared.bounds[0].upper+1e-12).toBeGreaterThanOrEqual(result.completion.upper);
      expect(prepared.bounds[0].cashLower).toBeLessThanOrEqual(result.expectedCash.lower+1e-12);expect(prepared.bounds[0].cashUpper+1e-12).toBeGreaterThanOrEqual(result.expectedCash.upper);
    }
  });
  it('does not mix adaptive and base transitions or different pools when a distribution cache is warm',async()=>{
    const input=fixture(),root=createPoolKernel(input).root,cache=new SearchDistributionCache(),prepared=await adaptivePursuit(input,[{code:root,cash:6},{code:root,cash:8}]);if(prepared.cancelled)throw Error();
    const base=await searchDistribution(input,{cache}),adaptive=await searchDistribution(input,{cache,policy:prepared.policy});
    expect(adaptive).toEqual(await searchDistribution(input,{policy:prepared.policy}));expect(await searchDistribution(input,{cache})).toEqual(base);
    expect(await searchDistribution({...input,cash:8},{cache,policy:prepared.policy})).toEqual(await searchDistribution({...input,cash:8},{policy:prepared.policy}));
    await expect(searchDistribution({...input,heroSlots:4},{cache,policy:prepared.policy})).rejects.toThrow(/does not match/);
    expect(await adaptivePursuit(input,[{code:root,cash:6}],{cancelled:()=>true})).toEqual({cancelled:true});
    await expect(adaptivePursuit(input,[{code:root,cash:-1}])).rejects.toThrow();
  });
});
