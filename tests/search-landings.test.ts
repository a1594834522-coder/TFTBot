import {describe,it,expect} from 'vitest';
import {searchLandings,landingDefinitions} from '../src/decision/search-landings';
import type {DirectionAdvice} from '../src/decision/direction-advisor';
import type {StrategicInput} from '../src/decision/strategic-input';
import {trade,materializeAcquisitions,type TradingRules} from '../src/decision/shop-ledger';
import type {BattleRequest} from '../src/game/battle-forecast';
import {createSSRApp,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import SearchLandingPanel from '../src/desktop/SearchLandingPanel.vue';
const rules:TradingRules={version:'test',provisional:false,heroes:Object.fromEntries(['A','B','C'].map(id=>[id,{cost:1,maxStar:3,sellValues:{1:1,2:3,3:9}}])),benchCapacity:9,itemRackCapacity:10,interestStep:10,interestCap:5,victoryGoldBeforeInterest:1};
function fixture(){
  const advice={ready:true,mode:'selected',focusId:'main',rows:[{id:'main',name:'主线',carry:'A',tank:'B',regime:'four-cost'},{id:'alt',name:'备选',carry:'C',tank:'B',regime:'four-cost'}]} as unknown as DirectionAdvice;
  const input:Extract<StrategicInput,{ready:true}>={ready:true,stage:4,gaps:[],state:{gold:1,level:8,boardCapacity:2,itemRack:[],offers:[{slot:0,id:'A',price:1}],units:[
    {key:'a1',id:'A',star:1,area:'board',slot:0,items:[{key:'item',id:'IE'}]},
    {key:'a2',id:'A',star:1,area:'bench',slot:0,items:[]},{key:'b1',id:'B',star:1,area:'board',slot:1,items:[]}]},
    pool:{complete:true,remaining:{A:5,B:5,C:5},tierRemaining:{1:25,2:10,3:10,4:10,5:10},tierOdds:{1:1,2:0,3:0,4:0,5:0},refreshPrice:2,heroSlotsCycle:[4]}};
  const request:BattleRequest={round:'4-2',weightSource:'uniform',local:{units:[{id:'A',star:1,items:['IE']},{id:'B',star:1,items:[]}],augments:[]},localGaps:[],targets:[{id:'opp',name:'对手',weight:1,board:{units:[{id:'C',star:2,items:[]}],augments:[]},gaps:[]}]};
  const model=(pairs:Array<{player:BattleRequest['local'];opponent:BattleRequest['local']}>)=>pairs.map(({player})=>({winRate:player.units.some(u=>u.id==='A'&&u.star===2&&u.items.includes('IE'))?.8:.3}));
  return {advice,input,request,model};
}
describe('combat value of incomplete search landings',()=>{
  it('keeps a useful failed roll as a real equipped board instead of assigning failed completion zero value',async()=>{
    const {advice,input,request,model}=fixture(),before=JSON.stringify(input);
    const result=await searchLandings(advice,input,rules,request,model);if(!result.ready)throw Error(result.reason);
    expect(result.baseline).toBe(.3);expect(result.plans).toHaveLength(2);
    for(const band of result.plans[0].bands){
      expect(band.completion).toEqual({lower:0,upper:0});expect(band.coverage).toBe(1);
      expect(band.combat.lower).toBe(.8);expect(band.combat.upper).toBe(.8);expect(band.failureCombat).toEqual({lower:.8,upper:.8});
      expect(band.examples[0].units.find(u=>u.id==='A')).toMatchObject({star:2,items:['IE']});
    }
    expect(JSON.stringify(input)).toBe(before);
  });
  it('preserves missing opponent mass and never presents a partial opponent mean as complete combat coverage',async()=>{
    const {advice,input,request,model}=fixture();request.targets[0].weight=.75;request.targets.push({id:'unknown',name:'未知',weight:.25,board:null,gaps:[]});
    const result=await searchLandings(advice,input,rules,request,model);if(!result.ready)throw Error(result.reason);
    expect(result.baseline).toBeNull();expect(result.opponentCoverage).toBe(.75);
    expect(result.plans[0].bands[0].combat).toMatchObject({lower:expect.closeTo(.6),upper:expect.closeTo(.85)});
    expect(result.plans[0].bands[0].examples[0].winRate).toBeNull();
  });
  it('preserves unevaluated combat mass under evaluation limits and never renormalizes successful boards',async()=>{
    const {advice,input,request,model}=fixture();
    const result=await searchLandings(advice,input,rules,request,model,{maxBoards:0});if(!result.ready)throw Error(result.reason);
    for(const band of result.plans[0].bands){expect(band.coverage).toBe(0);expect(band.combat).toEqual({lower:0,upper:1});expect(band.failureCombat).toEqual({lower:0,upper:1});}
    expect(await searchLandings(advice,input,rules,request,model,{cancelled:()=>true})).toEqual({ready:false,reason:'局面已变化'});
  });
  it('requires a manual mainline and keeps reroll and startup strategies separate',()=>{
    const {advice}=fixture();if(!advice.ready)throw Error();
    expect(landingDefinitions({...advice,mode:'flex'})).toEqual([]);
    const reroll={...advice,rows:advice.rows.map((r,i)=>({...r,regime:i?'four-cost' as const:'reroll' as const}))};
    const defs=landingDefinitions(reroll);expect(defs).toHaveLength(1);expect(defs[0].targets).toEqual([{id:'A',copies:9},{id:'B',copies:3}]);
  });
  it('moves a completed mainline away from redundant pursuit scenarios instead of showing three identical stop outcomes',async()=>{
    const {advice,input,request,model}=fixture();input.state.units=[...input.state.units.filter(u=>u.area==='board').map(u=>({...u,star:2}))];
    expect(await searchLandings(advice,input,rules,request,model)).toEqual({ready:false,reason:'主线核心已齐，查看当前换牌与上限参考'});
  });
  it('materializes the same physical upgrade as paid trading, retains item entities and never mutates or returns hypothetical cash',()=>{
    const {input}=fixture(),before=JSON.stringify(input.state),paid=trade(input.state,{type:'buy',slot:0},rules),materialized=materializeAcquisitions(input.state,[{id:'A',copies:1}],rules);
    if(!paid.ok||!materialized.ok)throw Error();expect(materialized.units).toEqual(paid.state.units);
    expect(JSON.stringify(input.state)).toBe(before);expect(materialized).not.toHaveProperty('gold');
    input.state.units[1].items=[{key:'other',id:'other'}];expect(materializeAcquisitions(input.state,[{id:'A',copies:1}],rules)).toMatchObject({ok:false,reason:'unsupported-merge-equipment'});
  });
  it('detects a weaker landing after an irreversible merge instead of assuming every upgrade improves combat',async()=>{
    const {advice,input,request}=fixture();input.state.units=input.state.units.filter(u=>u.id==='A').map((u,slot)=>({...u,area:'board',slot,items:[]}));
    request.local.units=[{id:'A',star:1,items:[]},{id:'A',star:1,items:[]}];
    const result=await searchLandings(advice,input,rules,request,pairs=>pairs.map(({player})=>({winRate:player.units.filter(u=>u.id==='A').length===2?.9:.4})));
    if(!result.ready)throw Error(result.reason);
    expect(result.baseline).toBe(.9);expect(result.plans[0].bands[0].weaker).toEqual({lower:1,upper:1});
    expect(result.plans[0].bands[0].combat.lower).toBe(.4);
  });
  it('shows compact failure-aware scenarios without auto-selecting any mainline or purchase',async()=>{
    const {advice,input,request,model}=fixture(),result=await searchLandings(advice,input,rules,request,model);
    const html=await renderToString(createSSRApp({render:()=>h(SearchLandingPanel,{advice:result})}));
    expect(html).toContain('预算落点');expect(html).toContain('核心未齐');expect(html).toContain('没抽齐时');expect(html).toContain('80.0%');
    expect(html).toContain('data-landing-slots="5"');expect(html).not.toContain('设为主线');expect(html).not.toContain('高亮这组');
    const pending=await renderToString(createSSRApp({render:()=>h(SearchLandingPanel,{advice:{ready:false,reason:'更新中'}})}));expect(pending).not.toContain('data-search-landings');
  });
});
