import {expect,it} from 'vitest';
import {advisorInput,recommendComps,fitEquipment,createCompAdvisor,earlyHoldAdvice,type AdvisorInput} from '../src/game/comp-advisor';
import {advisorDemo} from '../src/desktop/advisor-demo';
import {metatftComps} from '../src/game/comps-sources';
import {earlyStages} from '../src/game/metatft-early';
import type {MetatftComp} from '../src/game/metatft-comps';
const comps=metatftComps(18);
it('输入只来自明确本方，不借对手持牌或把过期数据当当前开局',()=>{
  const s=advisorDemo('ap');const input=advisorInput(s);
  expect(input.units.DA_18_Kayle).toBe(3);expect(input.items).toHaveLength(2);
  s.tracker!.snapshot!.players.forEach(p=>p.isLocal=false);
  expect(advisorInput(s).localComplete).toBe(false);
  const old=advisorDemo('ap');old.lastFrameAt=Date.now()-16000;
  expect(advisorInput(old).localComplete).toBe(false);
});
it('同行没齐仍能根据自己推荐，且不伪造完整竞争分',()=>{
  const input=advisorInput(advisorDemo('partial')),result=recommendComps(input,comps);
  expect(input.localComplete).toBe(true);expect(input.poolComplete).toBe(false);
  expect(result.ready).toBe(true);expect(result.rows[0].components.contested).toBeNull();
});
it('法系持牌与装备优先衔接凯尔，物理开局和大量同行会改变排序',()=>{
  const ap=recommendComps(advisorInput(advisorDemo('ap')),comps);
  expect(ap.rows[0].name).toBe('迅捷射手 凯尔');
  const ad=recommendComps(advisorInput(advisorDemo('ad')),comps);
  expect(ad.rows[0].name).toBe('护卫 雷恩加尔');
  const contested=recommendComps(advisorInput(advisorDemo('contested')),comps);
  expect(contested.rows.find(r=>r.name==='护卫 雷恩加尔')!.score).toBeLessThan(ad.rows[0].score);
  expect(contested.rows[0].name).not.toBe(ad.rows[0].name);
});
it('同一件成装或散件只使用一次，重复散件配方需要两份',()=>{
  const holder='DA_18_Kayle',core=[holder];
  expect(fitEquipment({unit:holder,items:['DA_InfinityEdge','DA_InfinityEdge']},[{id:'DA_InfinityEdge'}],core).credit).toBe(1);
  expect(fitEquipment({unit:holder,items:['DA_RabadonsDeathcap']},[{id:'DA_Component_NeedlesslyLargeRod'}],core).credit).toBe(.35);
  expect(fitEquipment({unit:holder,items:['DA_RabadonsDeathcap']},[{id:'DA_Component_NeedlesslyLargeRod'},{id:'DA_Component_NeedlesslyLargeRod'}],core).credit).toBe(1);
});
it('保留英雄的装备不能给另一名保留英雄；过渡牌出售转移可计入衔接',()=>{
  const build={unit:'DA_18_Kayle',items:['DA_GuinsoosRageblade']};
  expect(fitEquipment(build,[{id:build.items[0],holder:'DA_18_Varus'}],['DA_18_Kayle','DA_18_Varus']).credit).toBe(0);
  expect(fitEquipment(build,[{id:build.items[0],holder:'DA_18_Varus'}],['DA_18_Kayle']).credit).toBe(1);
});
it('仅MetaTFT参与个人推荐，缺少汇总或样本太少的候选不进入',()=>{
  const input=advisorInput(advisorDemo('ap'));
  const altered=[{...comps[0],source:'official'},{...comps[1],games:5},{...comps[2],avgPlace:undefined}] as MetatftComp[];
  expect(recommendComps(input,altered).rows).toHaveLength(0);
});
it('输入未变化时复用缓存，商店变化后更新留牌但不修改用户选阵',()=>{
  const service=createCompAdvisor(comps),s=advisorDemo('ap');
  const first=service.evaluate(s);expect(service.evaluate({...s,frames:999})).toBe(first);
  s.cards.shop=[{id:'DA_18_Rakan',known:true,name:'洛'}];
  expect(service.evaluate(s)).not.toBe(first);
});
it('装备栏按本方身份读取数量，自动同步后不重复加入旧手动装备',()=>{
  const s=advisorDemo('ap'),bow='DA_Component_RecurveBow';
  expect(advisorInput(s,[bow]).items.filter(i=>i.id===bow)).toHaveLength(1);
  s.cards.itemBenches=[{summoner:'示例玩家1',tag_line:'demo',bench_items:[{name:bow,count:9}]},{summoner:'示例玩家0',tag_line:'demo',bench_items:[{name:bow,count:2}]}];
  const result=advisorInput(s,[bow]);expect(result.items.filter(i=>i.id===bow)).toHaveLength(2);
  expect(result.inventoryComplete).toBe(true);expect(result.inventorySource).toBe('native');
});
it('留牌主要依据指定阶段真实前期棋盘，支持未定阵；对子只推荐所需购买数量',()=>{
  const s=advisorDemo('ap');s.cards.stage=2;
  const input:AdvisorInput={...advisorInput(s),units:{DA_18_Akali_AD:2,DA_18_Rakan:1,DA_18_Varus:1},items:[]};
  const result=recommendComps(input,comps);
  const shop=[0,1,2].map(()=>({id:'DA_18_Akali_AD',name:'阿卡丽',known:true}));
  const advice=earlyHoldAdvice(result,shop);
  expect(advice.boards.length).toBeGreaterThan(0);
  for(const b of advice.boards)expect(earlyStages(18).find(s=>s.stage===2)!.boards.some(raw=>raw.id===b.id)).toBe(true);
  expect(advice.cards.find(c=>c.id==='DA_18_Akali_AD')).toMatchObject({quantity:1,reason:'再留 1 张可升二星'});
  expect(advice.stageEstimated).toBe(false);
});
it('已经二星时，未定阵不建议继续囤同名牌追三；仙灵不作为英雄留牌',()=>{
  const s=advisorDemo('ap');s.cards.shop=[{id:'DA_18_Kayle',known:true,name:'凯尔'},{id:'DA_18_LostTravelers',known:true,name:'迷路的游客',kind:'wisp'}];
  const holds=createCompAdvisor(comps).evaluate(s).holds;
  expect(holds.cards.find(c=>c.id==='DA_18_Kayle')?.quantity??0).toBe(0);
  expect(holds.cards.some(c=>c.id==='DA_18_LostTravelers')).toBe(false);
});
