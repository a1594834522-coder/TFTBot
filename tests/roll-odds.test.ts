import {expect,it} from 'vitest';
import {estimateRoll} from '../src/game/roll-odds';

// Independent enumeration of the slot tree: non-target-cost, target, other
// same-cost copy. This does not use the production binomial/hypergeometric sum.
function enumeratedHit(slots:number,p:number,r:number,n:number):number {
  if(!slots)return 0;
  return (1-p)*enumeratedHit(slots-1,p,r,n)
    +p*(r/n+(n-r)/n*enumeratedHit(slots-1,p,r,n-1));
}
function random(seed:number){let state=seed>>>0;return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};}
// Physical deck: each same-cost draw removes one actual copy; restore the
// unbought shop after each roll. No production probabilities are used here.
function dealer(p:number,r:number,n:number,seed:number){
  const rng=random(seed),deck=Uint8Array.from({length:n},(_,i)=>Number(i<r));
  return ()=>{let left=n,hit=false;const swaps:number[]=[];
    for(let slot=0;slot<5;slot++){
      if(rng()>=p)continue;
      const i=Math.floor(rng()*left);if(deck[i]){hit=true;break;}
      left--;[deck[i],deck[left]]=[deck[left],deck[i]];swaps.push(i);
    }
    for(let j=swaps.length-1;j>=0;j--){const i=swaps[j];[deck[i],deck[left]]=[deck[left],deck[i]];left++;}
    return hit;
  };
}
it('逐槽穷举交叉核对各等级概率与多种剩余牌池',()=>{
  for(const heroSlots of [4,5] as const)for(const p of [.01,.05,.15,.3,.55,.75,1])for(const n of [6,14,30,345,420])for(const r of [1,Math.floor(n/2),n-1]){
    const v=estimateRoll({tierProbability:p,remaining:r,tierRemaining:n,heroSlots});
    expect(v.hit).toBeCloseTo(enumeratedHit(heroSlots,p,r,n),12);
  }
});
it('四格和五格采用各自的抽牌数与耗尽门槛，现成商店牌仍无需刷新',()=>{
  expect(estimateRoll({tierProbability:1,remaining:1,tierRemaining:10,heroSlots:4})).toMatchObject({hit:.4,meanGold:5,gold50:4,gold90:10});
  expect(estimateRoll({tierProbability:1,remaining:1,tierRemaining:4,heroSlots:4}).hit).toBe(1);
  expect(estimateRoll({tierProbability:1,remaining:1,tierRemaining:4,heroSlots:5}).meanGold).toBeNull();
  expect(estimateRoll({tierProbability:0,remaining:0,tierRemaining:0,heroSlots:4,inShop:true}).meanGold).toBe(0);
});
it('上次实局阿卡丽快照：约10.024%单刷命中、19.952金均值、14/44金分位数',()=>{
  const v=estimateRoll({tierProbability:.3,remaining:24,tierRemaining:345});
  expect(v.hit).toBeCloseTo(.10024158813188733,12);expect(v.meanGold).toBeCloseTo(19.951798821948138,10);
  expect(v.gold50).toBe(14);expect(v.gold90).toBe(44);
  for(const [q,budget] of [[.5,v.gold50!],[.9,v.gold90!]]){
    expect(1-(1-v.hit)**(budget/2)).toBeGreaterThanOrEqual(q);
    expect(1-(1-v.hit)**(budget/2-1)).toBeLessThan(q);
  }
});
it('50万次实体抽牌和20万条刷牌直到命中的轨迹与公式吻合',()=>{
  const deal=dealer(.3,24,345,0x416c616c);let hits=0;
  for(let i=0;i<500000;i++)hits+=Number(deal());
  const v=estimateRoll({tierProbability:.3,remaining:24,tierRemaining:345});
  expect(Math.abs(hits/500000-v.hit)).toBeLessThan(.002);
  let gold=0;
  for(let i=0;i<200000;i++){do{gold+=2;}while(!deal());}
  console.info('[roll-audit]',JSON.stringify({shops:500000,simulatedHit:hits/500000,trajectories:200000,simulatedMeanGold:gold/200000,formulaHit:v.hit,formulaMeanGold:v.meanGold}));
  expect(Math.abs(gold/200000-v.meanGold!)).toBeLessThan(.2);
});
it('极小正概率不因 1 减接近 1 的浮点消减被误判为不可能',()=>{
  const p=1e-20,expectedHit=5*p*24/345;
  const v=estimateRoll({tierProbability:p,remaining:24,tierRemaining:345});
  expect(v.hit/expectedHit).toBeCloseTo(1,12);expect(v.meanGold).not.toBeNull();
});
