import {describe,it,expect} from 'vitest';
import {compareCombatActions} from '../src/decision/battle-action-value';
import type {BattleRequest} from '../src/game/battle-forecast';
const board=(id:string)=>({units:[{id,star:1,items:[]}],augments:[]});
const request:BattleRequest={round:'3-2',weightSource:'native',local:board('before'),localGaps:[],targets:[{id:'a',name:'甲',weight:.8,board:board('a'),gaps:[]},{id:'b',name:'乙',weight:.2,board:board('b'),gaps:[]}]};
describe('combat value supplied to the decision planner',()=>{
  it('compares actions against the same weighted opponent pool instead of unweighted headline scores',()=>{
    const table:Record<string,Record<string,number>>={before:{a:.3,b:.9},upgrade:{a:.6,b:.8},greed:{a:.2,b:1}};
    const values=compareCombatActions(request,[{id:'upgrade',board:board('upgrade')},{id:'greed',board:board('greed')}],(p,o)=>table[p.units[0].id][o.units[0].id]);
    expect(values[0].before).toBeCloseTo(.42);expect(values[0].after).toBeCloseTo(.64);expect(values[0].knownDelta).toBeCloseTo(.22);
    expect(values[1].knownDelta).toBeLessThan(0);
  });
  it('does not call a partial positive effect a proved improvement',()=>{
    const partial={...request,targets:request.targets.map(t=>t.id==='a'?{...t,board:null}:t)};
    const [value]=compareCombatActions(partial,[{id:'upgrade',board:board('upgrade')}],p=>p.units[0].id==='before'?.2:.6);
    expect(value.after).toBeNull();expect(value.coverage).toBeCloseTo(.2);
    expect(value.knownDelta).toBeCloseTo(.08);expect(value.lowerDelta).toBeLessThan(0);expect(value.upperDelta).toBeGreaterThan(0);
  });
});
