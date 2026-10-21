import {describe,it,expect} from 'vitest';
import {buildGearModel,gearAffinity,gearOrientation} from '../src/decision/gear-affinity';
import type {CompProfile,UnitRole} from '../src/decision/comp-profiles';
import type {Item} from '../src/game/tft-data';
const sword='DA_Component_BFSword',rod='DA_Component_NeedlesslyLargeRod',bow='DA_Component_RecurveBow';
const items=[{item_id:'AD',builds_from:[sword,sword]},{item_id:'AP',builds_from:[rod,rod]},{item_id:'Shared',builds_from:[bow,rod]}] as Item[];
const roles:Record<string,UnitRole>={A:{cost:4,role:'ad',tags:['Role.Attack'],traits:[]},B:{cost:4,role:'ap',tags:['Role.Magic'],traits:[]}};
const profiles=[{key:'a',units:[{id:'A'}],builds:[{unit:'A',items:['AD','AD','Shared'],count:100}]},{key:'b',units:[{id:'B'}],builds:[{unit:'B',items:['AP','AP','Shared'],count:100}]}] as CompProfile[];
describe('component and core-item compatibility learned from complete builds',()=>{
  it('distinguishes AP and AD components without requiring three completed items',()=>{
    const m=buildGearModel(profiles,items,roles),tokens=[{id:rod},{id:rod}];
    expect(gearAffinity(m,'b','B',tokens).componentLift).toBeGreaterThan(gearAffinity(m,'a','A',tokens).componentLift);
    expect(gearOrientation(tokens,m)).toBe('magic');expect(gearOrientation([{id:'AD'}],m)).toBe('physical');
  });
  it('retains compatibility of shared core gear across different damage families',()=>{
    const m=buildGearModel(profiles,items,roles);
    expect(gearAffinity(m,'a','A',[{id:'Shared'}]).known).toBe(true);expect(gearAffinity(m,'b','B',[{id:'Shared'}]).known).toBe(true);
    expect(gearOrientation([{id:sword},{id:rod}],m)).toBe('flex');
    expect(gearOrientation([{id:'Shared'}],m)).toBe('flex');
  });
  it('does not move a protected holder\'s item to another core or count it twice',()=>{
    const m=buildGearModel(profiles,items,roles),tokens=[{id:'AP',holder:'B'}];
    expect(gearAffinity(m,'a','A',tokens,['B']).damageComponents).toBe(0);
    expect(gearAffinity(m,'b','B',tokens,['B'])).toMatchObject({damageComponents:0,componentLift:0,known:true});
    expect(gearAffinity(m,'b','B',[{id:rod}]).damageComponents).toBe(1);
  });
  it('does not turn a completed item or emblem back into loose components',()=>{
    const m=buildGearModel(profiles,items,roles);
    expect(gearAffinity(m,'b','B',[{id:'Shared'}]).componentLift).toBe(0);
    expect(gearOrientation([{id:'UnknownCompleted'}],m)).toBe('flex');
  });
  it('does not invent an affinity for absent build evidence',()=>{
    const m=buildGearModel(profiles,items,roles);expect(gearAffinity(m,'missing','A',[{id:rod}])).toMatchObject({known:false,componentLift:0});
  });
});
