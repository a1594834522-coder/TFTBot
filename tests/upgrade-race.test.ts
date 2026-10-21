import {describe,it,expect} from 'vitest';
import {createUpgradeRace,type UpgradeRaceInput} from '../src/decision/upgrade-race';
function fixture():UpgradeRaceInput{return {targets:['A','B'].map(id=>({id,cost:1,needed:2,remaining:2,price:1})),tierRemaining:{1:6,2:10,3:10,4:10,5:10},tierOdds:{1:1,2:0,3:0,4:0,5:0},refreshPrice:2,heroSlotsCycle:[1]};}
describe('first key two-star race',()=>{
  it('matches a physical-card oracle including cash-constrained post-shop liquidation',()=>{
    const initial=['A','A','B','B','X','X'],memo=new Map<string,number>();
    function brute(held:string[],cash:number):number{
      if(held.filter(id=>id==='A').length>=2||held.filter(id=>id==='B').length>=2)return 1;
      const key=held.slice().sort().join('')+':'+cash,hit=memo.get(key);if(hit!==undefined)return hit;
      const subsets=(a:string[])=>Array.from({length:1<<a.length},(_,mask)=>a.filter((_,i)=>mask&(1<<i)));
      let best=0;
      for(const before of subsets(held)){
        const money=cash+held.length-before.length-2;if(money<0)continue;
        const pool=[...initial];for(const id of before)pool.splice(pool.indexOf(id),1);let expected=0;
        for(const id of pool){let shopBest=0;
          for(const kept of subsets(before)){
            const available=money+before.length-kept.length;
            shopBest=Math.max(shopBest,brute(kept,available));
            if(id!=='X'&&available>=1)shopBest=Math.max(shopBest,brute([...kept,id],available-1));
          }
          expected+=shopBest/pool.length;
        }
        best=Math.max(best,expected);
      }
      memo.set(key,best);return best;
    }
    const model=createUpgradeRace(fixture());for(let budget=0;budget<=10;budget++)expect(model.probability(budget)).toBeCloseTo(brute([],budget),12);
  });
  it('reserves actual upgrade purchase costs and is distinct from requiring both upgrades',()=>{
    const model=createUpgradeRace(fixture());expect(model.probability(5)).toBe(0);
    expect(model.probability(6)).toBeCloseTo(4/30,12);expect(model.probability(8)).toBeGreaterThan(model.probability(6));
    const done=fixture();done.targets[0].needed=0;expect(createUpgradeRace(done).probability(0)).toBe(1);
  });
  it('does not invent odds for unsupported targets or unbounded budgets',()=>{
    const bad=fixture();bad.targets[0].needed=3;expect(()=>createUpgradeRace(bad)).toThrow(/Invalid/);
    expect(()=>createUpgradeRace(fixture()).probability(-1)).toThrow(/budget/);
  });
});
