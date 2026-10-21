import {describe,it,expect} from 'vitest';
import {advisorDemo} from '../src/desktop/advisor-demo';
import {strategicInput} from '../src/decision/strategic-input';
import type {ShoppingInput} from '../src/decision/shopping-input';
function fixture(){
  const status=advisorDemo('ap'),shopping:ShoppingInput={ready:true,rulesVersion:'test',provisional:true,gaps:[],state:{gold:31,level:5,boardCapacity:5,itemRack:[],offers:[],units:status.tracker!.snapshot!.players.find(p=>p.isLocal)!.champions.map((c,slot)=>({key:'u'+slot,id:c.name,star:c.copies===3?2:1,area:'board',slot,items:[]}))}};
  return {status,shopping};
}
describe('coherent strategic pool snapshot',()=>{
  it('keeps pool evidence available for legendary and late upgrades after stage four',()=>{
    const {status,shopping}=fixture();status.cards.stage=6;expect(strategicInput(status,shopping)).toMatchObject({ready:true,stage:6});
  });
  it('subtracts actual physical copies and preserves the cost-pool total',()=>{
    const {status,shopping}=fixture(),input=strategicInput(status,shopping);if(!input.ready)throw Error(input.reason);
    expect(input.pool.remaining.DA_18_Kayle).toBe(22);expect(input.pool.heroSlotsCycle).toEqual([4]);
    expect(input.pool.complete).toBe(true);expect(input.gaps).toContain('仙灵刷新阶段未同步，按每次四个英雄格参考');
  });
  it('waits for agreement between own GEP entities and whole-lobby holdings, including star copies',()=>{
    const {status,shopping}=fixture();if(!shopping.ready)throw Error();shopping.state.units[0].star=1;
    expect(strategicInput(status,shopping)).toMatchObject({ready:false,reason:expect.stringContaining('帧同步')});
  });
  it('does not estimate an incomplete or impossible whole-lobby pool',()=>{
    const {status,shopping}=fixture();status.tracker!.snapshot!.players[1].coverage='partial';
    expect(strategicInput(status,shopping)).toMatchObject({ready:false});
    status.tracker!.snapshot!.players[1].coverage='full';status.tracker!.snapshot!.players[1].champions=[{...status.tracker!.snapshot!.players[0].champions[0],copies:1000}];
    expect(strategicInput(status,shopping)).toMatchObject({ready:false,reason:expect.stringContaining('牌池占用同步')});
  });
});
