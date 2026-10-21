import {describe,it,expect} from 'vitest';
import {routeProgress} from '../src/decision/route-progress';
import type {DirectionInput,DirectionRow} from '../src/decision/direction-advisor';
import type {UnitRole} from '../src/decision/comp-profiles';

function fixture(){
  const roles:Record<string,UnitRole>=Object.fromEntries([['carry',4],['tank',4],['support',2],['utility',5],['worker',1]].map(([id,cost])=>[id,{cost,role:'',tags:[],traits:[]}])) as Record<string,UnitRole>;
  const input:DirectionInput={assets:{units:{carry:2,tank:3,support:1,worker:3},items:[],opponents:{},localComplete:true,poolComplete:false,inventoryComplete:false,level:7},
    board:['worker','worker','tank','support'],shop:[],health:50,round:'4-2',augments:[],augmentsComplete:true};
  const row={units:['carry','tank','support','utility'],carry:'carry',tank:'tank',regime:'four-cost'} as DirectionRow;
  return {roles,input,row};
}
describe('observed route progress',()=>{
  it('distinguishes currently fielded kinds, bench assets and missing first copies without selling the transition',()=>{
    const {roles,input,row}=fixture(),before=JSON.stringify({input,row});
    const result=routeProgress(input,row,8,roles)!;
    expect(result).toMatchObject({targetLevel:8,populationGap:1,onBoard:['tank','support'],heldAside:['carry'],missing:['utility'],firstCopiesBaseGold:5,gear:null});
    expect(result.cores).toEqual([{id:'carry',targetCopies:3,missingCopies:1,baseGold:4},{id:'tank',targetCopies:3,missingCopies:0,baseGold:0}]);
    expect(JSON.stringify({input,row})).toBe(before);
    // No inferred proceeds, liquidation of workers or combat-stability claim.
    expect(Object.keys(result)).not.toContain('netCost');
  });
  it('keeps a zero-overlap transition intact and does not call a first-copy cost a two-star completion cost',()=>{
    const {roles,input,row}=fixture();input.assets.units={worker:3};input.board=['worker'];
    const result=routeProgress(input,row,8,roles)!;
    expect(result.onBoard).toEqual([]);expect(result.heldAside).toEqual([]);
    expect(result.firstCopiesBaseGold).toBe(15);
    expect(result.cores.reduce((n,c)=>n+c.baseGold!,0)).toBe(24);
    expect(input.assets.units).toEqual({worker:3});
  });
  it('uses all physical copies for goals, caps completed goals and differentiates a reroll carry from its front line',()=>{
    const {roles,input,row}=fixture();row.regime='reroll';input.assets.units={carry:6,tank:9};
    expect(routeProgress(input,row,7,roles)?.cores).toEqual([{id:'carry',targetCopies:9,missingCopies:3,baseGold:12},{id:'tank',targetCopies:3,missingCopies:0,baseGold:0}]);
    row.tank=row.carry;expect(routeProgress(input,row,7,roles)?.cores).toHaveLength(1);
  });
  it('does not require rival data, gold or shop for asset comparison, and keeps an unknown level unknown',()=>{
    const {roles,input,row}=fixture();input.assets.level=null;
    expect(routeProgress(input,row,8,roles)).toMatchObject({populationGap:null,firstCopiesBaseGold:5});
    input.assets.localComplete=false;expect(routeProgress(input,row,8,roles)).toBeNull();
    input.assets.localComplete=true;input.assets.units.carry=1.5;expect(routeProgress(input,row,8,roles)).toBeNull();
  });
  it('leaves an unknown standard price unknown rather than skipping a missing hero',()=>{
    const {roles,input,row}=fixture();delete roles.utility;
    expect(routeProgress(input,row,8,roles)?.firstCopiesBaseGold).toBeNull();
    delete roles.carry;expect(routeProgress(input,row,8,roles)?.cores[0].baseGold).toBeNull();
  });
  it('preserves physical item accounting and makes a future holder transfer explicit only with full inventory',()=>{
    const {roles,input,row}=fixture();row.gearAllocation={assignments:[
      {index:0,id:'item',unit:'carry',holder:'carry',transfer:false},
      {index:1,id:'item',unit:'carry',transfer:false},
      {index:2,id:'item',unit:'tank',holder:'worker',transfer:true}
    ],protected:[3],unassigned:[4],ambiguous:[5,6]} as NonNullable<DirectionRow['gearAllocation']>;
    expect(routeProgress(input,row,8,roles)?.gear).toBeNull();input.assets.inventoryComplete=true;
    const gear=routeProgress(input,row,8,roles)!.gear!;
    expect(gear).toMatchObject({bound:1,loose:1,protected:1,unassigned:1,ambiguous:2});
    expect(gear.transfers).toEqual([{index:2,id:'item',unit:'tank',holder:'worker',transfer:true}]);
    expect(gear.bound+gear.loose+gear.transfers.length+gear.protected+gear.unassigned+gear.ambiguous).toBe(7);
    expect(gear.transfers[0]).not.toBe(row.gearAllocation.assignments[2]);
  });
});
