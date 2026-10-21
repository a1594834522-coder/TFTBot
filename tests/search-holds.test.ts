import {describe,it,expect} from 'vitest';
import {withSearchHolds} from '../src/decision/search-holds';
import type {DirectionAdvice} from '../src/decision/direction-advisor';
function fixture(){
  return {ready:true,milestone:'roll-down',mode:'flex',regime:null,owned:{A:2},shop:[{id:'A',slot:0}],
    rows:[{id:'r1',name:'同一阵容',regime:'four-cost',carry:'A',tank:'B',units:['A','B','utility']},{id:'r2',name:'同一阵容',regime:'four-cost',carry:'C',tank:'B',units:['C','B','utility']}],
    holds:{ready:true,cards:[{id:'utility'}],boards:[],directions:[],stage:4,stageEstimated:false},search:{ready:false,reason:'等待全场持牌'}} as unknown as Extract<DirectionAdvice,{ready:true}>;
}
describe('compact search retention',()=>{
  it('shows compared cores, including not-yet-seen ones, without highlighting every terminal utility hero',()=>{
    const advice=fixture(),result=withSearchHolds(advice);if(!result.ready)throw Error();
    expect(result.holds.cards.map(c=>c.id).sort()).toEqual(['A','B','C']);
    expect(result.holds.cards.find(c=>c.id==='A')).toMatchObject({quantity:1,reason:'可升二星'});
    expect(result.holds.cards.find(c=>c.id==='B')).toMatchObject({priority:2,reason:'多路线核心'});
    expect(advice.holds.cards[0].id).toBe('utility');
  });
  it('retains qualitative core targets while full-pool probabilities are still unavailable',()=>{
    const result=withSearchHolds(fixture());if(!result.ready)throw Error();expect(result.holds.ready).toBe(true);expect(result.search?.ready).toBe(false);
  });
  it('keeps a committed reroll goal when the lobby pool is incomplete',()=>{
    const advice=fixture();advice.mode='carry';advice.regime='reroll';advice.rows=[{...advice.rows[0],regime:'reroll'}];
    const result=withSearchHolds(advice);if(!result.ready)throw Error();expect(result.holds.cards.find(c=>c.id==='A')).toMatchObject({reason:'核心追三',quantity:1});
  });
});
