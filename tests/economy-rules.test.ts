import {describe,it,expect} from 'vitest';
import {resolveEconomyRules,levelSteps} from '../src/decision/economy-rules';
import {tradingRules} from '../src/decision/shopping-input';
describe('MetaTFT economic modifier reference',()=>{
  it('applies declared interest overrides and XP modifiers, without replaying instant grants',()=>{
    const r=resolveEconomyRules(tradingRules,['DA_LevelUp','DA_LevelUp','DA_UpwardMobility','DA_HedgeFund'],true);
    expect(r).toMatchObject({goldPerBuy:3,xpPerBuy:6,freeShopsOnLevel:2,healthOnLevel:2});expect(r.trading.interestCap).toBe(10);
    const zero=resolveEconomyRules(tradingRules,['DA_GoingLong','DA_HedgeFund'],true);expect(zero.trading.interestCap).toBe(0);
    expect(tradingRules.interestCap).toBe(5);
  });
  it('uses the native XP gap and retains only a one-level reference when thresholds disagree',()=>{
    const normal=resolveEconomyRules(tradingRules,[],true);
    expect(levelSteps(5,8,20,normal).steps[0]).toMatchObject({from:5,to:6,cost:12,buys:3,xpAfter:0});
    const mismatch=levelSteps(7,54,60,normal);expect(mismatch.steps).toHaveLength(1);expect(mismatch.gaps).toHaveLength(1);
    expect(levelSteps(5,null,20,normal).steps).toEqual([]);
  });
});
