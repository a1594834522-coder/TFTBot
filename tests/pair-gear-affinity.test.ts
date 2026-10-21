import {describe,it,expect} from 'vitest';
import {buildGearModel,gearAffinity,type GearToken} from '../src/decision/gear-affinity';
import {pairGearAffinity} from '../src/decision/pair-gear-affinity';
import type {Item} from '../src/game/tft-data';
import type {CompProfile,UnitRole} from '../src/decision/comp-profiles';
const sword='DA_Component_BFSword',rod='DA_Component_NeedlesslyLargeRod',bow='DA_Component_RecurveBow',vest='DA_Component_ChainVest',cloak='DA_Component_NegatronCloak';
const items=[{item_id:'AD',builds_from:[sword,sword]},{item_id:'AP',builds_from:[rod,rod]},{item_id:'Shared',builds_from:[bow,rod]},{item_id:'Armor',builds_from:[vest,cloak]}] as Item[];
function model(){
  const roles:Record<string,UnitRole>={A:{cost:4,role:'AD',tags:['Role.Attack'],traits:[]},B:{cost:2,role:'tank',tags:['Role.Magic','Role.Tank'],traits:[]}};
  const profiles=[{key:'p',regime:{primary:'reroll',carry:'B'},units:[{id:'A'},{id:'B'}],builds:[{unit:'A',items:['AD','AD','Shared'],count:100},{unit:'B',items:['AP','Armor','Armor'],count:100}]}] as CompProfile[];
  return buildGearModel(profiles,items,roles);
}
describe('physical two-core equipment allocation',()=>{
  it('allocates damage and frontline gear once, including a tank carry using real AP build evidence',()=>{
    const m=model(),tokens=[{id:'AD'},{id:'AP'},{id:'Armor'},{id:sword},{id:rod}],fit=pairGearAffinity(m,'p','A','B',tokens);
    expect(fit.assignments.find(a=>a.id==='AD')?.unit).toBe('A');expect(fit.assignments.find(a=>a.id==='AP')?.unit).toBe('B');
    expect(fit.assignments.find(a=>a.id===rod)?.unit).toBe('B');expect(new Set(fit.assignments.map(a=>a.index)).size).toBe(fit.assignments.length);
    expect(fit.matchedCompleted).toBe(3);expect(fit.matchedComponents).toBe(2);expect(fit.unassigned).toEqual([]);
  });
  it('keeps worn core and retained third-hero items bound and declares transition transfers',()=>{
    const m=model(),tokens=[{id:'AD',holder:'B'},{id:'AD',holder:'C'},{id:'AP',holder:'transition'}],before=JSON.stringify(tokens),fit=pairGearAffinity(m,'p','A','B',tokens,['A','B','C']);
    expect(fit.assignments.find(a=>a.index===0)?.unit).toBe('B');expect(fit.second.coreItemLift).toBeLessThan(0);
    expect(fit.protected).toEqual([1]);expect(fit.assignments.find(a=>a.index===2)).toMatchObject({unit:'B',transfer:true});
    expect(JSON.stringify(tokens)).toBe(before);
  });
  it('respects three completed slots and leaves excess gear explicit',()=>{
    const fit=pairGearAffinity(model(),'p','A','B',[...Array(4).fill({id:'AD'}),...Array(4).fill({id:'Armor'})]);
    expect(fit.assignments.filter(a=>a.unit==='A')).toHaveLength(3);expect(fit.assignments.filter(a=>a.unit==='B')).toHaveLength(3);
    expect(fit.unassigned).toHaveLength(2);expect(fit.matchedCompleted).toBe(6);
  });
  it('matches an independent exhaustive assignment oracle under the declared capacity objective',()=>{
    const m=model(),tokens:GearToken[]=['AD','Armor','Shared',rod,sword,cloak].map(id=>({id}));
    let best=[-1,-1,-Infinity];
    const better=(a:number[],b:number[])=>a[0]>b[0]||a[0]===b[0]&&(a[1]>b[1]||a[1]===b[1]&&a[2]>b[2]+1e-10);
    function brute(i:number,used:Array<{c:number;r:number}>,completed:number,components:number,lift:number){
      if(i===tokens.length){const row=[completed,components,lift];if(better(row,best))best=row;return;}
      brute(i+1,used,completed,components,lift);
      for(let actor=0;actor<2;actor++){
        const fit=gearAffinity(m,'p',actor===0?'A':'B',[tokens[i]]),component=tokens[i].id.includes('Component_');
        if(!fit.known||fit.componentLift+fit.coreItemLift< -1e-10)continue;
        const c=used[actor].c+Number(!component),r=used[actor].r+Number(component);if(c>3||2*c+r>6)continue;
        const next=used.map(u=>({...u}));next[actor]={c,r};brute(i+1,next,completed+Number(!component),components+Number(component),lift+fit.componentLift+fit.coreItemLift);
      }
    }
    brute(0,[{c:0,r:0},{c:0,r:0}],0,0,0);
    const fit=pairGearAffinity(m,'p','A','B',tokens);
    expect(fit.matchedCompleted).toBe(best[0]);expect(fit.matchedComponents).toBe(best[1]);expect(fit.jointCoreLift+fit.jointComponentLift).toBeCloseTo(best[2],12);
  });
  it('preserves ambiguous or unknown evidence instead of inventing a four-item final carry',()=>{
    const tokens=[...Array(4).fill({id:'AD',holder:'A'}),{id:'Armor'},{id:'Unknown'}],fit=pairGearAffinity(model(),'p','A','B',tokens);
    expect(fit.first.known).toBe(false);expect(fit.ambiguous).toEqual([0,1,2,3]);expect(fit.unassigned).toContain(5);
    const partition=[...fit.assignments.map(a=>a.index),...fit.protected,...fit.unassigned,...fit.ambiguous];
    expect(partition.sort((a,b)=>a-b)).toEqual(tokens.map((_,i)=>i));
  });
});
