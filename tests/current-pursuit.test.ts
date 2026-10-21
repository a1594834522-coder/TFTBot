import {describe,it,expect} from 'vitest';
import {currentPursuit,CurrentPursuitWorkspace} from '../src/decision/current-pursuit';
import type {DirectionAdvice} from '../src/decision/direction-advisor';
import type {StrategicInput} from '../src/decision/strategic-input';
import type {TradingRules} from '../src/decision/shop-ledger';
import type {BattleRequest} from '../src/game/battle-forecast';
import {createSSRApp,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import CurrentPursuitPanel from '../src/desktop/CurrentPursuitPanel.vue';
const rules:TradingRules={version:'test',provisional:false,heroes:Object.fromEntries(['A','B','C','D'].map(id=>[id,{cost:1,maxStar:3,sellValues:{1:1,2:3,3:9}}])),benchCapacity:9,itemRackCapacity:10,interestStep:10,interestCap:5,victoryGoldBeforeInterest:1};
function fixture(){
  const advice={ready:true,mode:'selected',focusId:'main',rows:[{id:'main',name:'主线',carry:'A',tank:'B',regime:'four-cost'},{id:'alt',name:'备选',carry:'C',tank:'B',regime:'four-cost'},{id:'wrong',name:'95',carry:'D',tank:'B',regime:'legendary'}]} as unknown as DirectionAdvice;
  const input:Extract<StrategicInput,{ready:true}>={ready:true,stage:4,gaps:[],state:{gold:3,level:8,boardCapacity:2,itemRack:[],offers:[{slot:0,id:'A',price:1},null,{slot:2,id:'C',price:1},{slot:3,id:'D',price:1}],units:[
    {key:'a1',id:'A',star:1,area:'board',slot:0,items:[{key:'gear',id:'IE'}],equipmentKnown:true},
    {key:'a2',id:'A',star:1,area:'bench',slot:0,items:[],equipmentKnown:true},{key:'b1',id:'B',star:2,area:'board',slot:1,items:[],equipmentKnown:true}]},
    pool:{complete:true,remaining:{A:3,B:5,C:4,D:0},tierRemaining:{1:12,2:10,3:10,4:10,5:10},tierOdds:{1:1,2:0,3:0,4:0,5:0},refreshPrice:2,heroSlotsCycle:[4]}};
  const request:BattleRequest={round:'4-2',weightSource:'uniform',local:{units:[{id:'A',star:1,items:['IE']},{id:'B',star:2,items:[]}],augments:[]},localGaps:[],targets:[{id:'opp',name:'对手',weight:1,board:{units:[{id:'C',star:2,items:[]}],augments:[]},gaps:[]}]};
  const model=(pairs:Array<{player:BattleRequest['local'];opponent:BattleRequest['local']}>)=>pairs.map(({player})=>({winRate:player.units.some(u=>u.id==='A'&&u.star===2&&u.items.includes('IE'))?.8:.2}));
  return {advice,input,request,model};
}
const choose=(n:number,k:number)=>{let r=1;for(let i=1;i<=k;i++)r=r*(n-i+1)/i;return r;};
describe('current-shop core purchases and their full future distribution',()=>{
  it('reuses only scratch data, replaying new purchases, equipment and opponent coverage rather than an old recommendation',async()=>{
    const {advice,input,request,model}=fixture(),workspace=new CurrentPursuitWorkspace(),strip=(r:Awaited<ReturnType<typeof currentPursuit>>)=>r.ready?{...r,adaptive:r.adaptive?.map(({reused,...a})=>a)}:r;
    const options={workspace,mode:'key-upgrade' as const},first=await currentPursuit(advice,input,rules,request,model,options),repeat=await currentPursuit(advice,input,rules,request,model,options);
    if(!repeat.ready)throw Error();expect(repeat.adaptive?.every(a=>a.reused)).toBe(true);expect(strip(repeat)).toEqual(strip(first));
    input.state.gold=4;input.state.offers=[{slot:0,id:'C',price:1},null,{slot:2,id:'A',price:1}];request.targets[0].weight=.6;request.targets.push({id:'missing',name:'缺失对手',weight:.4,board:null,gaps:[]});
    const updated=await currentPursuit(advice,input,rules,request,model,options),fresh=await currentPursuit(advice,input,rules,request,model,{mode:'key-upgrade'});
    expect(strip(updated)).toEqual(strip(fresh));if(!updated.ready)throw Error();expect(updated.opponentCoverage).toBe(.6);expect(updated.paths.find(p=>p.buy.some(b=>b.id==='A'))!.buy[0].slot).toBe(2);
    // Same copy counts/policy, but ambiguous equipment merges must be rejected anew.
    input.state.units[1].items=[{key:'other-item',id:'BT'}];
    const ambiguous=await currentPursuit(advice,input,rules,request,model,options);expect(strip(ambiguous)).toEqual(strip(await currentPursuit(advice,input,rules,request,model,{mode:'key-upgrade'})));
    if(!ambiguous.ready)throw Error();expect(ambiguous.paths.some(p=>p.buy.some(b=>b.id==='A'))).toBe(false);expect(ambiguous.paths[0].bands[0].completion.lower).toBe(0);
  });
  it('counts the union of different new upgrades without double-crediting a shop that completes both',async()=>{
    const {advice,input,request,model}=fixture();input.state.gold=4;input.state.units.find(u=>u.id==='B')!.star=1;request.local.units.find(u=>u.id==='B')!.star=1;input.pool.remaining.B=7;input.pool.tierRemaining[1]=14;
    const r=await currentPursuit(advice,input,rules,request,model,{mode:'key-upgrade'});if(!r.ready)throw Error(r.reason);
    for(const b of r.paths[0].bands){
      // One fresh shop can buy the missing A, or two B. C cannot reach two-star.
      // Enumerate physical draws independently: fail iff A=0 and B<=1.
      const miss=(choose(4,b.heroSlots)+7*choose(4,b.heroSlots-1))/choose(14,b.heroSlots),hitA=1-choose(11,b.heroSlots)/choose(14,b.heroSlots);
      expect(b.completion.lower).toBeCloseTo(1-miss,12);expect(b.completion.upper).toBeCloseTo(1-miss,12);
      expect(b.expectedGold.lower).toBeCloseTo(hitA+2*miss,12);expect(b.expectedGold.upper).toBeCloseTo(hitA+2*miss,12);
    }
  });
  it('waits for actual star-level synchronization rather than calling several unmerged singles an existing upgrade',async()=>{
    const {advice,input,request,model}=fixture();input.state.units.push({key:'a3',id:'A',star:1,area:'bench',slot:1,items:[],equipmentKnown:true});
    for(const mode of ['upgrade-first','completion-first','key-upgrade'] as const)expect(await currentPursuit(advice,input,rules,request,model,{mode})).toEqual({ready:false,controls:true,reason:'核心升星快照待同步'});
  });
  it('can pursue one new two-star when completing the whole pair is unaffordable, matching an independent shop-count oracle',async()=>{
    const {advice,input,request,model}=fixture();input.state.units.find(u=>u.id==='B')!.star=1;request.local.units.find(u=>u.id==='B')!.star=1;input.pool.remaining.B=7;input.pool.tierRemaining[1]=14;
    const whole=await currentPursuit(advice,input,rules,request,model,{mode:'completion-first'}),key=await currentPursuit(advice,input,rules,request,model,{mode:'key-upgrade'});if(!whole.ready||!key.ready)throw Error();
    expect(key.milestone).toMatchObject({kind:'new-two-star',label:'新增二星'});expect(whole.paths[0].bands[0].completion.lower).toBe(0);
    for(const b of key.paths[0].bands){const hit=1-choose(11,b.heroSlots)/choose(14,b.heroSlots);expect(b.completion.lower).toBeCloseTo(hit,12);expect(b.completion.upper).toBeCloseTo(hit,12);expect(b.expectedGold.lower).toBeCloseTo(1-hit,12);}
    for(const b of key.paths.find(p=>p.id==='keep:0')!.bands){expect(b.completion).toEqual({lower:1,upper:1});expect(b.expectedGold).toEqual({lower:2,upper:2});expect(b.combat.lower).toBe(.8);}
  });
  it('never credits existing two-stars as new progress, including an already complete alternative pair',async()=>{
    const {advice,input,request,model}=fixture();input.state.units.push({key:'c2',id:'C',star:2,area:'bench',slot:1,items:[],equipmentKnown:true});
    const r=await currentPursuit(advice,input,rules,request,model,{mode:'key-upgrade'});if(!r.ready)throw Error(r.reason);
    expect(r.milestone.targets).toEqual(['A']);expect(r.paths.map(p=>p.id)).toEqual(['skip','keep:0']);
    expect(r.paths[0].bands[0].completion.lower).toBeLessThan(1);expect(r.paths[0].bands[0].completion.lower).toBeCloseTo(1-choose(9,4)/choose(12,4),12);
  });
  it('keeps reroll pursuit on its own route and makes a deliberate two-star milestone distinct from chasing three-stars',async()=>{
    const {advice,input,request,model}=fixture();if(!advice.ready)throw Error();advice.rows[0].regime='reroll';
    const key=await currentPursuit(advice,input,rules,request,model,{mode:'key-upgrade'}),three=await currentPursuit(advice,input,rules,request,model);if(!key.ready||!three.ready)throw Error();
    expect(key.routes).toHaveLength(1);expect(key.routes[0].targets.find(t=>t.id==='A')!.copies).toBe(3);expect(three.routes[0].targets.find(t=>t.id==='A')!.copies).toBe(9);expect(three.milestone.label).toBe('核心追三');
    input.state.units=input.state.units.filter(u=>u.key!=='a2').map(u=>u.id==='A'?{...u,star:2}:u);request.local.units[0].star=2;
    const done=await currentPursuit(advice,input,rules,request,model,{mode:'key-upgrade'});expect(done).toMatchObject({ready:false,controls:true});
    const html=await renderToString(createSSRApp({render:()=>h(CurrentPursuitPanel,{advice:done,mode:'key-upgrade'})}));expect(html).toContain('data-pursuit-mode');expect(html).not.toContain('data-pursuit-path=');expect(html).toContain('可切换追三目标');
  });
  it('keeps unknown physical merges out of confirmed upgrade probability even when copy-count completion is exact',async()=>{
    const {advice,input,request,model}=fixture();input.state.units[1].items=[{key:'second-gear',id:'BT'}];input.state.offers[0]=null;
    const r=await currentPursuit(advice,input,rules,request,model,{mode:'key-upgrade',maxBoards:0});if(!r.ready)throw Error(r.reason);
    for(const b of r.paths[0].bands){expect(b.completion.lower).toBe(0);expect(b.completion.upper).toBeCloseTo(1-choose(9,b.heroSlots)/choose(12,b.heroSlots),12);expect(b.gaps.some(g=>g.includes('实体合成待覆盖'))).toBe(true);}
  });
  it('shows the new milestone and hides numbers from a different objective during switching',async()=>{
    const {advice,input,request,model}=fixture(),key=await currentPursuit(advice,input,rules,request,model,{mode:'key-upgrade'});
    const html=await renderToString(createSSRApp({render:()=>h(CurrentPursuitPanel,{advice:key,mode:'key-upgrade'})}));expect(html).toContain('新增二星');expect(html).toContain('关键二星');expect(html).toContain('已有二星不重复计算');
    const stale=await renderToString(createSSRApp({render:()=>h(CurrentPursuitPanel,{advice:key,mode:'upgrade-first'})}));expect(stale).not.toContain('data-pursuit-path=');
  });
  it('compares adaptive completion and upgrade-first as different objectives, without reusing stale-mode numbers',async()=>{
    const {advice,input,request,model}=fixture(),base=await currentPursuit(advice,input,rules,request,model),adaptive=await currentPursuit(advice,input,rules,request,model,{mode:'completion-first'});
    if(!base.ready||!adaptive.ready)throw Error();expect(adaptive.mode).toBe('completion-first');expect(adaptive.adaptive).toHaveLength(2);
    for(const p of adaptive.paths)for(const b of p.bands)expect(b.completion.lower+1e-12).toBeGreaterThanOrEqual(base.paths.find(q=>q.id===p.id)!.bands.find(q=>q.heroSlots===b.heroSlots)!.completion.lower);
    expect(adaptive.paths.find(p=>p.id==='keep:2')!.bands[0].expectedGold.lower).toBe(2);expect(base.paths.find(p=>p.id==='keep:2')!.bands[0].expectedGold.lower).toBe(0);
    const html=await renderToString(createSSRApp({render:()=>h(CurrentPursuitPanel,{advice:adaptive,mode:'completion-first'})}));expect(html).toContain('data-pursuit-state="ready"');expect(html).toContain('补齐优先');
    const stale=await renderToString(createSSRApp({render:()=>h(CurrentPursuitPanel,{advice:base,mode:'completion-first'})}));expect(stale).toContain('data-pursuit-state="updating"');expect(stale).not.toContain('data-pursuit-path=');expect(stale).toContain('data-pursuit-mode');
  });
  it('reuses scalar scores and model-support checks without changing any purchase distribution or physical guards',async()=>{
    const {advice,input,request,model}=fixture();let calls=0,checks=0;
    const predict:typeof model=pairs=>{calls+=pairs.length;return model(pairs);},supports=()=>{checks++;return true;};
    const reference=await currentPursuit(advice,input,rules,request,predict,{scoreReuse:false,supportsBoard:supports}),oldCalls=calls,oldChecks=checks;
    calls=0;checks=0;const cached=await currentPursuit(advice,input,rules,request,predict,{supportsBoard:supports});
    expect(cached).toEqual(reference);expect(calls).toBeLessThan(oldCalls);expect(checks).toBeLessThan(oldChecks);
  });
  it('compares every legal current subset against skip, with an independent physical-card oracle and real opportunity cost',async()=>{
    const {advice,input,request,model}=fixture(),before=JSON.stringify({advice,input,request});
    const r=await currentPursuit(advice,input,rules,request,model);if(!r.ready)throw Error(r.reason);
    expect(r.paths.map(p=>p.id)).toEqual(['skip','keep:0','keep:2','keep:0.2']);expect(r.routes).toHaveLength(2);
    for(const slots of [4,5]){
      const hit=1-choose(9,slots)/choose(12,slots),skip=r.paths[0].bands.find(b=>b.heroSlots===slots)!;
      expect(skip.completion.lower).toBeCloseTo(hit,12);expect(skip.completion.upper).toBeCloseTo(hit,12);
      expect(skip.combat.lower).toBeCloseTo(.8*hit+.2*(1-hit),12);expect(skip.combat.upper).toBeCloseTo(skip.combat.lower,12);
      expect(skip.expectedGold.lower).toBeCloseTo(choose(5,slots)/choose(12,slots),12);
      const main=r.paths[1].bands.find(b=>b.heroSlots===slots)!,alt=r.paths[2].bands.find(b=>b.heroSlots===slots)!,both=r.paths[3].bands.find(b=>b.heroSlots===slots)!;
      expect(main.completion).toEqual({lower:1,upper:1});expect(main.combat).toEqual({lower:.8,upper:.8});expect(main.expectedGold).toEqual({lower:2,upper:2});
      expect(alt.completion.lower).toBe(0);expect(alt.combat.lower).toBeCloseTo(.2,12);expect(alt.expectedGold.lower).toBe(0);
      expect(both.combat.lower).toBe(.8);expect(both.expectedGold.lower).toBe(1);
    }
    expect(JSON.stringify({advice,input,request})).toBe(before);
  });
  it('respects total budget and preserves unspent reserve without treating it as available roll money',async()=>{
    const {advice,input,request,model}=fixture();input.state.gold=50;
    const r=await currentPursuit(advice,input,rules,request,model,{budget:1});if(!r.ready)throw Error(r.reason);
    expect(r.budget).toBe(1);expect(r.paths).toHaveLength(3);expect(r.paths.find(p=>p.id==='keep:0.2')).toBeUndefined();
    expect(r.paths[0].bands[0].expectedGold).toEqual({lower:50,upper:50});
    expect(r.paths.find(p=>p.id==='keep:0')!.bands[0].expectedGold).toEqual({lower:49,upper:49});
  });
  it('keeps missing opponents and unscored landing mass separate from complete forecasts',async()=>{
    const {advice,input,request,model}=fixture();request.targets[0].weight=.75;request.targets.push({id:'missing',name:'未知',weight:.25,board:null,gaps:[]});
    const r=await currentPursuit(advice,input,rules,request,model);if(!r.ready)throw Error(r.reason);
    expect(r.opponentCoverage).toBe(.75);expect(r.paths[1].bands[0].combat.lower).toBeCloseTo(.6,12);expect(r.paths[1].bands[0].combat.upper).toBeCloseTo(.85,12);
    const limited=await currentPursuit(advice,input,rules,request,model,{maxBoards:0});if(!limited.ready)throw Error(limited.reason);
    for(const p of limited.paths)for(const b of p.bands){expect(b.evaluatedMass).toBe(0);expect(b.combat.upper).toBe(1);expect(b.combat.lower).toBeLessThanOrEqual(r.paths.find(v=>v.id===p.id)!.bands.find(v=>v.heroSlots===b.heroSlots)!.combat.lower+1e-12);}
    expect(limited.paths[1].bands[0].combat.lower).toBe(0); // The equipped A merged: old entities cannot be replayed.
    expect(limited.paths[2].bands[0].combat.lower).toBeCloseTo(.15,12); // This old board really is still attainable.
    const capped=await currentPursuit(advice,input,rules,request,model,{maxStates:1});if(!capped.ready)throw Error(capped.reason);
    for(const b of capped.paths[0].bands){expect(b.completion.lower).toBeLessThanOrEqual(r.paths[0].bands.find(v=>v.heroSlots===b.heroSlots)!.completion.lower+1e-12);expect(b.completion.upper).toBeGreaterThanOrEqual(r.paths[0].bands.find(v=>v.heroSlots===b.heroSlots)!.completion.upper-1e-12);}
  });
  it('does not recommend illegal equipment merges, extra copies beyond goals, cross-regime cards or automatic commitment',async()=>{
    const {advice,input,request,model}=fixture();input.state.units[1].items=[{key:'other',id:'BT'}];
    const r=await currentPursuit(advice,input,rules,request,model);if(!r.ready)throw Error(r.reason);
    expect(r.paths.map(p=>p.id)).toEqual(['skip','keep:2']);
    expect(await currentPursuit({...advice,mode:'flex'} as DirectionAdvice,input,rules,request,model)).toEqual({ready:false,reason:'选择主线后比较当前留牌'});
    expect(await currentPursuit(advice,input,rules,request,model,{cancelled:()=>true})).toEqual({ready:false,reason:'局面已变化'});
    expect(await currentPursuit(advice,{...input,stage:2},rules,request,model)).toEqual({ready:false,reason:'启动阶段比较当前留牌'});
  });
  it('gives purchase roots a fair turn under a shared model quota, including the five-slot case',async()=>{
    const {advice,input,request,model}=fixture();const r=await currentPursuit(advice,input,rules,request,model,{maxBoards:4});if(!r.ready)throw Error(r.reason);
    expect(r.evaluations).toBe(4);for(const p of r.paths)for(const b of p.bands)expect(b.evaluatedMass).toBeGreaterThan(0);
  });
  it('renders separate combat, completion and cash columns without purchasing or changing the mainline',async()=>{
    const {advice,input,request,model}=fixture(),result=await currentPursuit(advice,input,rules,request,model);
    const html=await renderToString(createSSRApp({render:()=>h(CurrentPursuitPanel,{advice:result})}));
    for(const text of ['跳过这家店','买牌花费','双核二星','搜后胜率','预计余金','data-pursuit-slots="5"','留牌比较总预算'])expect(html).toContain(text);
    expect(html).not.toContain('设为主线');expect(html).not.toContain('高亮这组');expect(html).not.toContain('立即购买');
  });
  it('still compares a current mainline purchase when an alternative is already complete, without rolling that branch unnecessarily',async()=>{
    const {advice,input,request,model}=fixture();input.state.units.push({key:'c2',id:'C',star:2,area:'bench',slot:1,items:[],equipmentKnown:true});
    const r=await currentPursuit(advice,input,rules,request,model);if(!r.ready)throw Error(r.reason);
    expect(r.paths[0].bands[0].completion.lower).toBe(1);expect(r.paths[0].bands[0].expectedGold).toEqual({lower:3,upper:3});
    expect(r.paths.find(p=>p.id==='keep:0')!.bands[0].combat.lower).toBe(.8);
  });
  it('preserves a known current form and equipped source but refuses to invent future forms',async()=>{
    const {advice,input,request}=fixture(),pool='DA_Lux18_Base',form='DA_18_Lux_Elderwood';
    if(!advice.ready)throw Error();advice.rows.forEach(r=>{if(r.carry==='A')r.carry=pool;});
    input.state.units.forEach(u=>{if(u.id==='A'){u.id=pool;u.combatId=form;}});input.state.offers[0]={slot:0,id:pool,combatId:form,price:1};
    input.pool.remaining[pool]=input.pool.remaining.A;delete input.pool.remaining.A;request.local.units[0].id=form;
    const localRules={...rules,heroes:{...rules.heroes,[pool]:rules.heroes.A}},model=(pairs:Array<{player:BattleRequest['local'];opponent:BattleRequest['local']}>)=>pairs.map(({player})=>({winRate:player.units.some(u=>u.id===form&&u.star===2&&u.items.includes('IE'))?.8:.2}));
    const r=await currentPursuit(advice,input,localRules,request,model);if(!r.ready)throw Error(r.reason);
    expect(r.paths.find(p=>p.id==='keep:0')!.bands[0].combat).toEqual({lower:.8,upper:.8});
    expect(r.paths.find(p=>p.id==='keep:0')!.bands[0].completion).toEqual({lower:1,upper:1});
    expect(r.paths[0].bands.some(b=>b.gaps.includes('未来英雄形态未确认'))).toBe(true);
    expect(r.paths[0].bands[0].completion.lower).toBe(0);expect(r.paths[0].bands[0].completion.upper).toBeGreaterThan(0);
  });
  it('honors auxiliary/source restrictions rather than preserving a summon after its actual source changes',async()=>{
    const {advice,input,request,model}=fixture(),auxiliary={id:'tower',star:1,items:[]};request.local.units.push(auxiliary);
    const r=await currentPursuit(advice,input,rules,request,model,{auxiliary:[auxiliary],acceptsLineup:c=>c.units.some(u=>u.key==='a1'&&u.star===1)});if(!r.ready)throw Error(r.reason);
    expect(r.paths.find(p=>p.id==='keep:0')!.bands[0].combat).toEqual({lower:0,upper:1});
    expect(r.paths.find(p=>p.id==='keep:2')!.bands[0].combat.lower).toBeCloseTo(.2,12);
  });
});
