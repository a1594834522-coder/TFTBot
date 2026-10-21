import {describe,it,expect} from 'vitest';
import {withMainlineTransitions} from '../src/game/mainline-transitions';
import type {DirectionCatalog,DirectionProfile} from '../src/decision/direction-catalog';
import type {SelectedComp} from '../src/game/selected-comp';
import {shopCatalog} from '../src/game/shop-mechanics';
const ids=shopCatalog.slice(0,13).map(h=>h.character_id);
function fixture(){
  const early=[{level:4,units:ids.slice(0,4),poolUnits:ids.slice(0,4),count:100,avg:4,battleWinRate:.55},
    {level:4,units:ids.slice(4,8),poolUnits:ids.slice(4,8),count:80,avg:4.1,battleWinRate:.6},
    {level:4,units:ids.slice(1,5),poolUnits:ids.slice(1,5),count:60,avg:4.2,battleWinRate:.5},
    {level:7,units:ids.slice(4,11),poolUnits:ids.slice(4,11),count:90,avg:4.3,battleWinRate:.52}];
  const profile={key:'demo',name:'主线',early} as DirectionProfile,catalog={profiles:[profile],roles:{},augments:{},traitThresholds:{}} as DirectionCatalog;
  const base:SelectedComp={key:'metatft:demo',name:'主线',units:ids.slice(0,4),directionId:'chosen-core',transitionId:null};
  return {base,catalog,assets:{units:{} as Record<string,number>,level:4,localComplete:true}};
}
describe('player-selected mainline transitions',()=>{
  it('uses observed zero-overlap transitions fitting current holdings without choosing one for the player',()=>{
    const {base,catalog,assets}=fixture();assets.units=Object.fromEntries(ids.slice(4,8).map(id=>[id,3]));
    const result=withMainlineTransitions(base,assets,undefined,catalog)!;
    expect(result.transitionId).toBeNull();expect(result.highlightedUnits).toEqual(base.units);expect(result.transitions![0]).toMatchObject({units:ids.slice(4,8),heldCount:4,upgradedCount:4,keepCount:0,count:80});
    expect(base).not.toHaveProperty('transitions');
  });
  it('pins the explicit choice across level and holding changes while updating its evidence',()=>{
    const {base,catalog,assets}=fixture(),initial=withMainlineTransitions(base,assets,undefined,catalog)!;
    const chosen=withMainlineTransitions(initial,assets,initial.transitions![1].id,catalog)!;
    assets.level=7;assets.units=Object.fromEntries(ids.slice(4,11).map(id=>[id,1]));
    const next=withMainlineTransitions(chosen,assets,undefined,catalog)!;
    expect(next.transitionId).toBe(chosen.transitionId);expect(next.transitions![0].id).toBe(chosen.transitionId);expect(next.units).toEqual(base.units);expect(next.directionId).toBe('chosen-core');
    expect(new Set(next.highlightedUnits)).toEqual(new Set([...base.units,...next.transitions![0].units]));
    expect(withMainlineTransitions(next,assets,null,catalog)!.highlightedUnits).toEqual(base.units);
  });
  it('accepts a trusted route no longer in the visible three and rejects another family’s lookalike ID',()=>{
    const {base,catalog,assets}=fixture(),higher=withMainlineTransitions(base,{...assets,level:7},undefined,catalog)!.transitions![0];
    const lower=withMainlineTransitions(base,assets,undefined,catalog)!;expect(lower.transitions!.some(t=>t.id===higher.id)).toBe(false);
    expect(withMainlineTransitions(lower,assets,higher.id,catalog)!.transitionId).toBe(higher.id);
    const otherCatalog={...catalog,profiles:[{...catalog.profiles[0],key:'other'}]},other={...base,key:'metatft:other'};
    const foreign=withMainlineTransitions(other,assets,undefined,otherCatalog)!.transitions![0];
    expect(()=>withMainlineTransitions(base,assets,foreign.id,catalog)).toThrow(/过渡/);
  });
  it('uses content-stable identities and migrates legacy selections by actual board content',()=>{
    const {base,catalog,assets}=fixture(),first=withMainlineTransitions(base,assets,undefined,catalog)!;
    const reordered={...catalog,profiles:[{...catalog.profiles[0],early:[...catalog.profiles[0].early].reverse()}]};
    expect(withMainlineTransitions(base,assets,undefined,reordered)!.transitions!.map(t=>t.id)).toEqual(first.transitions!.map(t=>t.id));
    const legacy={...base,transitionId:'early-4-0',transitions:[{...first.transitions![0],id:'early-4-0'}]};
    expect(withMainlineTransitions(legacy,assets,undefined,catalog)!.transitionId).toBe(first.transitions![0].id);
  });
  it('clears stale holding evidence and does not invent zero ownership when the reader is incomplete',()=>{
    const {base,catalog,assets}=fixture();assets.units={[ids[0]]:3};const known=withMainlineTransitions(base,assets,undefined,catalog)!;
    const unknown=withMainlineTransitions(known,{...assets,localComplete:false},undefined,catalog)!;
    expect(unknown.transitions!.every(t=>t.heldCount===undefined&&t.upgradedCount===undefined&&t.missingUnits===undefined)).toBe(true);
  });
  it('retains an explicit trusted comp reference outside the aggregate top-N without inventing statistics',()=>{
    const {base,catalog,assets}=fixture(),legacy={id:'early-5-2',name:'旧过渡',level:5,units:ids.slice(8,13),keepCount:0};
    const result=withMainlineTransitions({...base,transitions:[legacy],transitionId:legacy.id},assets,undefined,catalog)!;
    expect(result.transitions![0]).toMatchObject({source:'comp-reference',units:legacy.units});expect(result.transitionId).toBe(result.transitions![0].id);
    expect(result.transitions![0].count).toBeUndefined();expect(result.transitions![0].battleWinRate).toBeUndefined();
    expect(()=>withMainlineTransitions(base,assets,'',catalog)).toThrow();
  });
});
