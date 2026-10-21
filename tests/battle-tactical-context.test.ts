import {describe,it,expect} from 'vitest';
import {battleTacticalContext,modelBoardGaps} from '../src/decision/battle-tactical-context';
import {shoppingTactics} from '../src/decision/shopping-tactics';
import {lineupCandidates} from '../src/decision/lineup-search';
import {tradingRules} from '../src/decision/shopping-input';
import type {ShopState} from '../src/decision/shop-ledger';
import type {BattleRequest} from '../src/game/battle-forecast';
import type {BattleLookups,BattleUnit} from '../src/game/battle-model-encoding';
import lookupFile from '../data/metatft-model/lookups.json';
const lookup=lookupFile as BattleLookups;
const parents=['DA_18_GnarSmall','DA_18_Teemo','DA_18_Veigar'],worker='DA_18_Shen',replacement='DA_18_Ornn';
function fixture(extra:BattleUnit={id:'DA_TheTower_TrainingDummy',star:1,items:['DA_WarmogsArmor']},augments=['DA_TheTower']){
  const state:ShopState={gold:40,level:4,boardCapacity:4,itemRack:[],offers:[],units:[...parents,worker,replacement].map((id,index)=>({key:'u'+index,id,star:2,area:index<4?'board':'bench',slot:index<4?index:0,items:[],equipmentKnown:true}))};
  const request:BattleRequest={round:'4-2',weightSource:'uniform',local:{units:[...state.units.slice(0,4).map(u=>({id:u.id,star:u.star,items:[]})),extra],augments},localGaps:[],targets:[{id:'opponent',name:'示例',weight:1,board:{units:[{id:worker,star:2,items:[]}],augments:[]},gaps:[]}]};
  return {state,request};
}
describe('combat auxiliaries and source-preserving deployment',()=>{
  it('retains an observed independent tower, equipment and full normal capacity in every model comparison',async()=>{
    const {state,request}=fixture(),context=battleTacticalContext(request,state,lookup);if(!context.ready)throw Error(context.reason);
    const result=await shoppingTactics(state,tradingRules,context.request,pairs=>{
      for(const {player}of pairs){expect(player.units.find(u=>u.id==='DA_TheTower_TrainingDummy')).toEqual(request.local.units[4]);expect(player.units).toHaveLength(5);}
      return pairs.map(({player})=>({winRate:player.units.some(u=>u.id===replacement)?.8:.4}));
    },{auxiliary:context.auxiliary,acceptsLineup:context.accepts});
    if(!result.ready)throw Error(result.reason);expect(result.choices[0].onBoard).toHaveLength(4);expect(result.choices[0].auxiliary).toEqual([request.local.units[4]]);
    expect(result.choices[0].buy).toEqual([]);expect(result.choices[0].incoming.every(u=>u.id!=='DA_TheTower_TrainingDummy')).toBe(true);
    expect(state.units).toHaveLength(5); // The auxiliary never became a shop/bench entity.
  });
  it('projects only the verified non-embedded units, keeping unknown new champions unsupported',()=>{
    const {state,request}=fixture({id:'DA_Elderwood18_Lifeblossom',star:1,items:[]},[]),context=battleTacticalContext(request,state,lookup);
    if(!context.ready)throw Error(context.reason);expect(context.auxiliary).toEqual([]);expect(context.request.local.units).toHaveLength(4);
    expect(context.gaps).toContain('部分召唤单位未单独建模');expect(request.local.units).toHaveLength(5);
    request.local.units[4].id='UNRECOGNIZED_NEW_CHAMPION';expect(battleTacticalContext(request,state,lookup)).toMatchObject({ready:false});
  });
  it('keeps source-dependent BFF units only while the actual source entities, stars and equipment remain identical',()=>{
    const {state,request}=fixture({id:'DA_18_SprykinAugmentSummonMelee',star:1,items:[]},['DA_18_SprykinAugment']);
    const context=battleTacticalContext(request,state,lookup);if(!context.ready)throw Error(context.reason);
    const lineups=lineupCandidates(state,request.local.augments,2,[],context.auxiliary);
    const swapOther=lineups.find(c=>parents.every(id=>c.units.some(u=>u.id===id))&&c.units.some(u=>u.id===replacement))!;
    const loseParent=lineups.find(c=>!c.units.some(u=>u.id===parents[0]))!;
    expect(context.accepts(swapOther)).toBe(true);expect(context.accepts(loseParent)).toBe(false);
    const changed=structuredClone(swapOther);changed.units.find(u=>u.id===parents[0])!.star=3;expect(context.accepts(changed)).toBe(false);
    const duplicate=structuredClone(swapOther);duplicate.units.find(u=>u.id===parents[0])!.key='identical-looking-other-copy';expect(context.accepts(duplicate)).toBe(false);
  });
  it('includes a Sprykin emblem holder in the protected rider context',()=>{
    const {state,request}=fixture({id:'DA_18_SprykinAugmentSummonMelee',star:1,items:[]},['DA_18_SprykinAugment']);
    state.units[3].items=[{id:'DA_18_EmblemSprykin',key:'emblem-token'}];request.local.units[3].items=['DA_18_EmblemSprykin'];
    const context=battleTacticalContext(request,state,lookup);if(!context.ready)throw Error(context.reason);
    expect(lineupCandidates(state,request.local.augments,2,[],context.auxiliary).filter(context.accepts).every(c=>c.units.some(u=>u.key==='u3'))).toBe(true);
  });
  it('does not invent an independent source or silently preserve a Golem whose source is unknown',()=>{
    const {state,request}=fixture();request.local.augments=[];
    expect(battleTacticalContext(request,state,lookup)).toMatchObject({ready:false,reason:expect.stringContaining('来源')});
    request.local.units[4].id='DA_Golem';expect(battleTacticalContext(request,state,lookup)).toMatchObject({ready:false,reason:expect.stringContaining('来源')});
  });
  it('waits for incomplete auxiliary equipment or an inactive source trait, without removing those units',()=>{
    const {state,request}=fixture();request.localGaps=['装备未齐'];expect(battleTacticalContext(request,state,lookup)).toMatchObject({ready:false,reason:expect.stringContaining('装备')});
    const dependent=fixture({id:'DA_18_SprykinAugmentSummonMelee',star:1,items:[]},['DA_18_SprykinAugment']);dependent.request.local.units=dependent.request.local.units.filter(u=>u.id!==parents[0]);
    expect(battleTacticalContext(dependent.request,dependent.state,lookup)).toMatchObject({ready:false,reason:expect.stringContaining('羁绊')});
  });
  it('does not drop an explicitly supplied trait on a future unencoded unit, and marks Dummify history uncertainty',()=>{
    const {state,request}=fixture({id:'DA_Elderwood18_Lifeblossom',star:1,items:[]},[]);
    const future={...lookup,unit_traits:{...lookup.unit_traits,DA_Elderwood18_Lifeblossom:['Sprykin']}};
    expect(battleTacticalContext(request,state,future)).toMatchObject({ready:false,reason:expect.stringContaining('羁绊')});
    expect(modelBoardGaps({...request.local,augments:['DA_Dummify']},lookup)).toContain('假人历史属性未单独建模');
    expect(modelBoardGaps({units:[{id:'DA_Lux18_Base',star:2,items:[]}],augments:[]},lookup)).toContain('部分英雄形态未确认');
    expect(modelBoardGaps({units:[{id:'DA_18_Lux_Elderwood',star:2,items:[]}],augments:[]},lookup)).not.toContain('部分英雄形态未确认');
  });
});
