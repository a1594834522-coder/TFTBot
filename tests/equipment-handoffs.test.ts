import {describe,it,expect} from 'vitest';
import {equipItem,equipmentAllocations,type EquipmentRules} from '../src/decision/equipment-ledger';
import {equipmentHandoffs} from '../src/decision/equipment-handoffs';
import type {ShoppingInput} from '../src/decision/shopping-input';
import type {TradingRules} from '../src/decision/shop-ledger';
import type {DirectionAdvice} from '../src/decision/direction-advisor';
import type {BattleRequest} from '../src/game/battle-forecast';
import type {GearModel} from '../src/decision/gear-affinity';
import {createSSRApp,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import EquipmentHandoffsPanel from '../src/desktop/EquipmentHandoffsPanel.vue';
const craft=['Item.Equippable.Item.Craftable'],part=['Item.Equippable.Item.Component'];
const eq:EquipmentRules={set:18,version:'test',provisional:false,source:{blockedAugments:{salvage:'Selling breaks items'}},traits:{A:[],B:[],C:['tank']},items:{
  IE:{unique:false,tags:craft,recipe:['Sword','Glove'],traits:[],incompatible:[]},Sword:{unique:false,tags:part,recipe:[],traits:[],incompatible:[]},Glove:{unique:false,tags:part,recipe:[],traits:[],incompatible:[]},
  Unique:{unique:true,tags:craft,recipe:[],traits:[],incompatible:[]},Emblem:{unique:true,tags:['Item.Equippable.Item.Emblem'],recipe:[],traits:['tank'],incompatible:['tank']},
  Temporary:{unique:false,tags:['Item.Equippable.Item.Temporary'],recipe:[],traits:[],incompatible:[]}}};
const rules:TradingRules={version:'test',provisional:false,heroes:{A:{cost:1,maxStar:3,sellValues:{1:1,2:3,3:9}},B:{cost:4,maxStar:3,sellValues:{1:4,2:11,3:35}},C:{cost:2,maxStar:3,sellValues:{1:2,2:5,3:17}}},benchCapacity:9,itemRackCapacity:null,interestStep:10,interestCap:5,victoryGoldBeforeInterest:1};
const gear:GearModel={models:[],backgroundComponents:{},backgroundItems:{},recipes:{},damageItems:[]};
function fixture(){
 const input:Extract<ShoppingInput,{ready:true}>={ready:true,gaps:[],rulesVersion:'test',provisional:false,state:{gold:2,level:8,boardCapacity:2,itemRack:[],offers:[{slot:0,id:'B',price:4}],units:[{key:'worker',id:'A',star:2,area:'board',slot:0,items:[{key:'real-ie',id:'IE'}],equipmentKnown:true},{key:'tank',id:'C',star:1,area:'board',slot:1,items:[],equipmentKnown:true}]}};
 const advice={ready:true,mode:'selected',focusId:'main',rows:[{id:'main',key:'metatft:family',carry:'B',tank:'C'}]} as unknown as DirectionAdvice;
 const request:BattleRequest={round:'4-2',local:{units:[{id:'A',star:2,items:['IE']},{id:'C',star:1,items:[]}],augments:[]},localGaps:[],weightSource:'uniform',targets:[{id:'op',name:'对手',weight:1,board:{units:[{id:'C',star:2,items:[]}],augments:[]},gaps:[]}]};
 const model=(pairs:Array<{player:BattleRequest['local'];opponent:BattleRequest['local']}>)=>pairs.map(({player})=>({winRate:player.units.some(u=>u.id==='B'&&u.items.includes('IE'))?.85:player.units.some(u=>u.id==='A'&&u.items.includes('IE'))?.6:.2}));
 return {input,advice,request,model};
}
describe('physical equipment handoff comparisons',()=>{
 it('replays and re-scores a known stronger no-sale tactical reference before crediting liquidation',async()=>{
  const {input,advice,request}=fixture(),extended={...rules,heroes:{...rules.heroes,...Object.fromEntries(['D','E','F','G'].map(id=>[id,{cost:1,maxStar:3,sellValues:{1:1,2:3,3:9}}]))}};
  input.state.boardCapacity=3;input.state.units.push({key:'current-d',id:'D',star:1,area:'board',slot:2,items:[],equipmentKnown:true},...['E','F','G'].map((id,slot)=>({key:'bench-'+id,id,star:1,area:'bench' as const,slot,items:[],equipmentKnown:true})));
  request.local.units.push({id:'D',star:1,items:[]});
  const model=(pairs:Array<{player:BattleRequest['local'];opponent:BattleRequest['local']}>)=>pairs.map(({player})=>({winRate:['E','F','G'].every(id=>player.units.some(u=>u.id===id))?.95:player.units.some(u=>u.id==='B'&&u.items.includes('IE'))?.85:.6}));
  const narrow=await equipmentHandoffs(input,extended,eq,advice,request,model,gear);
  const guarded=await equipmentHandoffs(input,extended,eq,advice,request,model,gear,{noSaleReference:{actions:[],onBoardKeys:['bench-E','bench-F','bench-G'],goldAfter:2}});
  if(!narrow.ready||!guarded.ready)throw Error();expect(narrow.baseline).toBe(.6);expect(guarded.baseline).toBe(.95);expect(guarded.baselineGold).toBe(2);expect(guarded.choices.every(c=>(c.gain??0)<0)).toBe(true);
 });
 it('rejects a reference with stale entities, gold or a hidden sale rather than trusting its old model value',async()=>{
  const {input,advice,request,model}=fixture();
  for(const reference of [{actions:[],onBoardKeys:['missing'],goldAfter:2},{actions:[],onBoardKeys:['worker','tank'],goldAfter:99},{actions:[{type:'sell' as const,key:'worker'}],onBoardKeys:['tank'],goldAfter:5}]){
   const result=await equipmentHandoffs(input,rules,eq,advice,request,model,gear,{noSaleReference:reference});expect(result.ready).toBe(false);
  }
 });
 it('pays for a visible core with a declared worker sale, transfers the same token, and keeps capacity uncertainty explicit',async()=>{
  const {input,advice,request,model}=fixture(),before=JSON.stringify(input);const result=await equipmentHandoffs(input,rules,eq,advice,request,model,gear);
  if(!result.ready)throw Error(result.reason);expect(result.baseline).toBe(.6);expect(result.choices).toHaveLength(1);
  const c=result.choices[0];expect(c).toMatchObject({refund:3,spent:4,goldAfter:1,requiredRackSlots:1,conditionalRack:true,gain:expect.closeTo(.25)});
  expect(c.sold[0]).toMatchObject({key:'worker',star:2});expect(c.moves[0].token).toEqual({key:'real-ie',id:'IE'});expect(c.lineup.find(u=>u.id==='B')?.items).toEqual(['IE']);expect(c.lineup.some(u=>u.key==='worker')).toBe(false);
  expect(JSON.stringify(input)).toBe(before);
 });
 it('compares against free rack equipment and deployment, rather than crediting their benefit to the sale',async()=>{
  const {input,advice,request,model}=fixture();input.state.gold=4;input.state.itemRack=[{key:'free-ie',id:'IE'}];
  const result=await equipmentHandoffs(input,rules,eq,advice,request,model,gear);if(!result.ready)throw Error(result.reason);
  expect(result.baseline).toBe(.85);expect(result.choices.every(c=>(c.gain??0)<=1e-6)).toBe(true);
 });
 it('retains the cost of losing the stronger worker and never assumes the mainline must be better',async()=>{
  const {input,advice,request}=fixture();const result=await equipmentHandoffs(input,rules,eq,advice,request,pairs=>pairs.map(({player})=>({winRate:player.units.some(u=>u.id==='A')?.9:.3})),gear);
  if(!result.ready)throw Error(result.reason);expect(result.choices[0].gain).toBeCloseTo(-.6);
 });
 it('keeps missing opponent mass and respects auxiliary source restrictions',async()=>{
  const {input,advice,request,model}=fixture();request.targets[0].weight=.75;request.targets.push({id:'missing',name:'未齐',weight:.25,board:null,gaps:[]});
  const result=await equipmentHandoffs(input,rules,eq,advice,request,model,gear);if(!result.ready)throw Error(result.reason);
  expect(result.choices[0]).toMatchObject({gain:null,lowerGain:expect.closeTo(-.0625),upperGain:expect.closeTo(.4375)});
  const protectedResult=await equipmentHandoffs(input,rules,eq,advice,request,model,gear,{acceptsLineup:l=>l.units.some(u=>u.key==='worker')});if(!protectedResult.ready)throw Error(protectedResult.reason);expect(protectedResult.choices).toEqual([]);
 });
 it('requires real inventory and known sale mechanisms and never infers unknown gear as empty',async()=>{
  const {input,advice,request,model}=fixture();request.localGaps=['海克斯未齐'];expect(await equipmentHandoffs(input,rules,eq,advice,request,model,gear)).toMatchObject({ready:false});
  request.localGaps=[];request.local.augments=['salvage'];expect(await equipmentHandoffs(input,rules,eq,advice,request,model,gear)).toMatchObject({ready:false});request.local.augments=[];
  input.gaps=['装备栏未齐'];expect(await equipmentHandoffs(input,rules,eq,advice,request,model,gear)).toMatchObject({ready:false});input.gaps=[];
  input.state.units[0].equipmentKnown=false;expect(await equipmentHandoffs(input,rules,eq,advice,request,model,gear)).toMatchObject({ready:false});
 });
 it('crafts only the matching physical pair, including at three occupied slots, without mutating or duplicating equipment',()=>{
  const {input}=fixture();input.state.units[1].items=[{key:'sword',id:'Sword'},{key:'one',id:'IE'},{key:'two',id:'IE'}];input.state.itemRack=[{key:'glove',id:'Glove'}];const before=JSON.stringify(input.state);
  const result=equipItem(input.state,'glove','tank',eq);if(!result.ok)throw Error(result.reason);
  expect(result.move.consumed).toEqual([{key:'sword',id:'Sword'}]);expect(result.state.itemRack).toEqual([]);expect(result.state.units[1].items.map(i=>i.id)).toEqual(['IE','IE','IE']);expect(JSON.stringify(input.state)).toBe(before);
  expect(equipItem(result.state,'glove','tank',eq).ok).toBe(false);
 });
 it('enforces unique items, innate/previously granted trait restrictions and temporary items',()=>{
  const {input}=fixture();input.state.units[1].items=[{key:'existing',id:'Unique'}];input.state.itemRack=[{key:'new',id:'Unique'},{key:'emblem',id:'Emblem'},{key:'temp',id:'Temporary'}];
  expect(equipItem(input.state,'new','tank',eq).ok).toBe(false);expect(equipItem(input.state,'emblem','tank',eq).ok).toBe(false);expect(equipItem(input.state,'temp','worker',eq).ok).toBe(false);
 });
 it('keeps untouched and complete allocations even when empirical affinity has no evidence for an item',()=>{
  const {input}=fixture();input.state.units[1].items=[];input.state.itemRack=[0,1,2].map(i=>({key:'ie'+i,id:'IE'}));
  const rows=equipmentAllocations(input.state,['tank'],eq,()=>0,8);expect(rows.some(r=>!r.moves.length)).toBe(true);expect(rows.some(r=>r.state.units[1].items.length===3)).toBe(true);
 });
 it('explores component orders instead of forcing the item-rack order to decide the recipe',()=>{
  const {input}=fixture();input.state.units[1].items=[];input.state.itemRack=[{id:'Sword',key:'s'},{id:'Rod',key:'r'},{id:'Glove',key:'g'}];
  const policy=structuredClone(eq);policy.items.Rod={unique:false,tags:part,recipe:[],traits:[],incompatible:[]};policy.items.Gunblade={unique:false,tags:craft,recipe:['Sword','Rod'],traits:[],incompatible:[]};
  const rows=equipmentAllocations(input.state,['tank'],policy,u=>u.items.some(i=>i.id==='IE')?10:0,64);
  expect(rows.some(row=>row.state.units[1].items.map(i=>i.id).sort().join('|')==='IE|Rod')).toBe(true);
 });
 it('shows a conditional read-only comparison, not an action button or a claim of known rack capacity',async()=>{
  const {input,advice,request,model}=fixture(),result=await equipmentHandoffs(input,rules,eq,advice,request,model,gear);
  const html=await renderToString(createSSRApp({render:()=>h(EquipmentHandoffsPanel,{advice:result})}));
  expect(html).toContain('不出售参考');expect(html).toContain('装备栏需空 1 格');expect(html).toContain('承接明细');expect(html).toContain('购买 4 金');expect(html).not.toContain('<button');
 });
});
