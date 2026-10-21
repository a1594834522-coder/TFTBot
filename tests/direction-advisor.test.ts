import {describe,it,expect} from 'vitest';
import {directionAdvice,earlyAssociation,type DirectionInput} from '../src/decision/direction-advisor';
import type {DirectionCatalog,DirectionProfile} from '../src/decision/direction-catalog';
import type {GearModel} from '../src/decision/gear-affinity';
import {compileAugmentFact} from '../src/decision/direction-catalog';
import {resolveHoldAdvice} from '../src/game/resolve-hold-advice';
const rod='DA_Component_NeedlesslyLargeRod',sword='DA_Component_BFSword';
function fixture(){
  const profiles:DirectionProfile[]=['cheap','four','five'].map((key,i)=>({key,name:key,count:1000,avg:4,
    regime:{primary:i===0?'reroll':i===1?'four-cost':'legendary',alternatives:[],carry:key,tank:'tank',carryStar:i===0?3:2,rollLevel:5+i*2,evidence:[]},
    early:[{level:4,units:['worker','tank','filler'],poolUnits:['worker','tank','filler'],count:200,avg:4,battleWinRate:.6}],units:[],
    pairs:[{id:key,profile:key,carry:key,tank:'tank',carryStar:i===0?3:2,tankStar:2,regime:i===0?'reroll':i===1?'four-cost':'legendary',support:100,
      templates:[{level:8,units:[key,'tank'],poolUnits:[key,'tank'],count:100,avg:4}]}]}));
  const catalog:DirectionCatalog={profiles,roles:{cheap:{cost:1,role:'',tags:[],traits:[]},four:{cost:4,role:'',tags:[],traits:[]},five:{cost:5,role:'',tags:[],traits:[]},tank:{cost:2,role:'',tags:['Role.Tank'],traits:[]},worker:{cost:1,role:'',tags:[],traits:[]}},traitThresholds:{},augments:{
    reroll:compileAugmentFact({apiName:'reroll',tags:['Augment.Category.Reroll']}),xp:compileAugmentFact({apiName:'xp',curveTable:{AdditionalXP:[[1,2]]}}),neutral:compileAugmentFact({apiName:'neutral'})}};
  const gear:GearModel={recipes:{},damageItems:[],backgroundComponents:{[rod]:.5,[sword]:.5},backgroundItems:{},models:profiles.map(p=>({profile:p.key,unit:p.key,components:{[rod]:p.key==='cheap'?90:10,[sword]:p.key==='cheap'?10:90},items:{},componentMass:100,itemMass:0,buildWeight:100,orientation:p.key==='cheap'?'magic':'physical'}))};
  const input:DirectionInput={assets:{units:{worker:3,tank:1,cheap:3},items:[{id:rod}],opponents:{},localComplete:true,poolComplete:true,inventoryComplete:true,level:4,stage:2},round:'2-1',augments:['reroll'],augmentsComplete:true,board:['worker','tank'],shop:[{id:'cheap',slot:0},{id:'worker',slot:1}],health:90};
  return {catalog,gear,input};
}
describe('milestone direction evidence',()=>{
  it('honors an explicit selected route independently from automatic confidence and clearing restores inference',()=>{
    const {catalog,gear,input}=fixture();input.intent={key:'metatft:four',directionId:'four',units:['four','tank']};
    const result=directionAdvice(input,catalog,gear);if(!result.ready)throw Error();
    expect(result).toMatchObject({mode:'selected',regime:'four-cost',focusId:'four'});expect(result.rows[0].id).toBe('four');
    expect(result.rows.some(r=>r.regime==='reroll')).toBe(true);input.intent=null;
    expect(directionAdvice(input,catalog,gear)).toMatchObject({mode:'carry',regime:'reroll'});
  });
  it('keeps a blocked selected goal visible rather than silently substituting another carry',()=>{
    const {catalog,gear,input}=fixture();input.assets.opponents.cheap=100;input.intent={key:'metatft:cheap',directionId:'cheap'};
    const result=directionAdvice(input,catalog,gear);if(!result.ready)throw Error();
    expect(result.rows[0]).toMatchObject({id:'cheap',blocked:true});expect(result.message).toContain('牌池不足');
    expect(result.rows.slice(1).some(r=>!r.blocked)).toBe(true);
  });
  it('does not claim a selected direction when its core is absent from the selected variant',()=>{
    const {catalog,gear,input}=fixture();input.intent={key:'metatft:four',units:['worker','tank']};
    const result=directionAdvice(input,catalog,gear);if(!result.ready)throw Error();expect(result.focusId).toBeUndefined();expect(result.gaps.some(g=>g.includes('已选阵容'))).toBe(true);
  });
  it('uses an observed early association with zero final-carry overlap',()=>{
    const {catalog,input}=fixture(),association=earlyAssociation(catalog.profiles[1],input)!;
    expect(association.retained).toBe(4);expect(association.board.poolUnits).not.toContain('four');
    const result=directionAdvice(input,catalog,fixture().gear);if(!result.ready)throw Error();
    expect(result.holds.cards.map(c=>c.id)).toContain('worker');
  });
  it('can commit a cheap reroll only when augment, natural copies and gear agree',()=>{
    const {catalog,gear,input}=fixture(),result=directionAdvice(input,catalog,gear);if(!result.ready)throw Error();
    expect(result.mode).toBe('carry');expect(result.regime).toBe('reroll');
    expect(result.holds.cards.find(c=>c.id==='cheap')).toMatchObject({quantity:1,reason:'核心追三'});
    input.assets.items=[{id:sword}];expect(directionAdvice(input,catalog,gear)).toMatchObject({ready:true,mode:'flex'});
  });
  it('does not lock before picked augment or full inventory evidence arrives',()=>{
    const {catalog,gear,input}=fixture();input.augmentsComplete=false;
    expect(directionAdvice(input,catalog,gear)).toMatchObject({mode:'flex'});input.augmentsComplete=true;input.assets.inventoryComplete=false;
    expect(directionAdvice(input,catalog,gear)).toMatchObject({mode:'flex'});input.assets.inventoryComplete=true;input.augments=['unknown'];
    expect(directionAdvice(input,catalog,gear)).toMatchObject({mode:'flex'});
  });
  it('does not treat tie-broken asset candidates as independent agreement at 3-2',()=>{
    const {catalog,gear,input}=fixture();input.round='3-2';input.assets.stage=3;input.augments=['reroll','neutral'];input.assets.units={worker:3,tank:1};
    // All three endgames share this transition: assets contain no family signal.
    expect(directionAdvice(input,catalog,gear)).toMatchObject({mode:'flex'});
  });
  it('an XP augment alone cannot commit to 95, even at high health',()=>{
    const {catalog,gear,input}=fixture();input.round='3-2';input.assets.stage=3;input.augments=['xp','neutral'];input.assets.units={five:1};input.assets.level=7;input.assets.items=[{id:sword}];
    catalog.profiles=catalog.profiles.filter(p=>p.key==='five');
    expect(directionAdvice(input,catalog,gear)).toMatchObject({mode:'flex'});
    input.combatWinRate=.7;expect(directionAdvice(input,catalog,gear)).toMatchObject({mode:'regime',regime:'legendary'});
  });
  it('known blocked three-star pools cannot become a reroll commitment',()=>{
    const {catalog,gear,input}=fixture();input.assets.opponents.cheap=100;
    const result=directionAdvice(input,catalog,gear);if(!result.ready)throw Error();expect(result.mode).toBe('flex');expect(result.rows.every(r=>r.carry!=='cheap')).toBe(true);
  });
  it('does not let a two-star cheap transition lock a level-8 startup into reroll',()=>{
    const {catalog,gear,input}=fixture();input.round='4-2';input.assets.stage=4;input.assets.level=8;input.augments=['reroll','neutral'];
    const result=directionAdvice(input,catalog,gear);if(!result.ready)throw Error();
    expect(result.mode).toBe('flex');expect(result.rows.length).toBeGreaterThan(0);expect(result.rows.every(r=>r.regime!=='reroll')).toBe(true);
  });
  it('transition holders stop accumulating at two stars and manual selection is shared across surfaces',()=>{
    const {catalog,gear,input}=fixture();input.assets.units.worker=3;
    const result=directionAdvice(input,catalog,gear);if(!result.ready)throw Error();expect(result.holds.cards.find(c=>c.id==='worker')?.quantity).toBe(0);
    const legacy={...result.holds,cards:[]},prefs={items:[],stage:null,boardId:result.holds.boards[0].id};
    expect(resolveHoldAdvice(result,legacy,prefs).cards.every(c=>result.holds.boards[0].units.includes(c.id))).toBe(true);
    expect(resolveHoldAdvice(result,legacy,{...prefs,stage:3})).toBe(legacy);
  });
  it('distinguishes immediate random grants from the next-purchase mechanism',()=>{
    const base={curveTable:{UnitCost:[[1,1]],ActorLevel:[[1,3]]}};
    expect(compileAugmentFact({...base,desc:'Gain a random champion.'}).grant?.trigger).toBe('instant');
    expect(compileAugmentFact({...base,desc:'The next champion you buy is 3-star.'}).grant?.trigger).toBe('next-purchase');
  });
  it('extracts cost-specific and one-sided damage effects without forcing shared AD/AP or attack speed',()=>{
    expect(compileAugmentFact({desc:'Your 1 and 2-cost champions gain Health.'}).focusCosts).toEqual([1,2]);
    expect(compileAugmentFact({desc:'Your team gains 10% Attack Damage.'}).offense).toBe('physical');
    expect(compileAugmentFact({desc:'Your team gains Attack Damage and Ability Power.'}).offense).toBeNull();
    expect(compileAugmentFact({desc:'Your team gains Attack Speed.'}).offense).toBeNull();
    expect(compileAugmentFact({desc:'Champions cannot be benched or sold.'}).moveLocked).toBe(true);
  });
  it('abstains instead of proposing swaps when a known augment locks previously fielded units',()=>{
    const {catalog,gear,input}=fixture();catalog.augments.locked=compileAugmentFact({apiName:'locked',desc:'Champions cannot be benched or sold.'});input.augments=['locked'];
    expect(directionAdvice(input,catalog,gear)).toMatchObject({ready:false,unsupported:true});
  });
  it('does not transfer gear from another hero retained in the selected final variant',()=>{
    const {catalog,gear,input}=fixture();catalog.profiles=[catalog.profiles[1]];
    catalog.profiles[0].pairs[0].templates[0].poolUnits.push('cheap');input.assets.items=[{id:rod,holder:'cheap'}];
    const result=directionAdvice(input,catalog,gear);if(!result.ready)throw Error();expect(result.rows[0].gear.known).toBe(false);
  });
  it('does not change recommendations just because physical inventory ordering changes',()=>{
    const {catalog,gear,input}=fixture();input.assets.items=[{id:rod},{id:sword},{id:rod},{id:sword},{id:rod}];
    const first=directionAdvice(input,catalog,gear);input.assets.items.reverse();const second=directionAdvice(input,catalog,gear);
    if(!first.ready||!second.ready)throw Error();expect(first.rows.map(r=>r.id)).toEqual(second.rows.map(r=>r.id));
  });
});
