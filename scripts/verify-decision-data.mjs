import fs from 'node:fs';
import crypto from 'node:crypto';
const read=name=>JSON.parse(fs.readFileSync('data/'+name+'.json','utf8'));
const base=read('metatft-comps'),full=read('metatft-strategic-profiles'),catalog=read('metatft-direction-catalog'),gear=read('metatft-gear-model'),mechanics=read('current-shop-mechanics'),rules=read('decision-trading-rules');
const fail=message=>{throw Error('[decision-data] '+message);};
const battlePolicy=read('battle-unit-policy'),battleLookup=read('metatft-model/lookups'),nonPool=read('current-non-pool-units');
const sha256=name=>crypto.createHash('sha256').update(fs.readFileSync('data/'+name+'.json')).digest('hex');
if(battlePolicy.set!==18||battlePolicy.evidence.lookupSha256!==sha256('metatft-model/lookups')||battlePolicy.evidence.nonPoolSha256!==sha256('current-non-pool-units'))fail('战斗单位策略与模型/牌库来源不一致');
for(const id of battlePolicy.excluded)if(!nonPool.ids.includes(id)||battleLookup.unit_encodings[id]!==undefined)fail('模型排除表错误地包含可编码单位：'+id);
for(const [id,form]of Object.entries(battlePolicy.forms))if(mechanics.aliases[id]!==form.poolId||battleLookup.unit_encodings[id]===undefined)fail('战斗形态与牌库身份不一致：'+id);
const equalIds=(a,b)=>JSON.stringify(a.slice().sort())===JSON.stringify(b.slice().sort());
if(!equalIds(battlePolicy.excluded,nonPool.ids.filter(id=>battleLookup.unit_encodings[id]===undefined)))fail('模型排除表缺少已核实的非商店单位');
const formIds=Object.entries(mechanics.aliases).filter(([id,base])=>id!==base&&battleLookup.unit_encodings[id]!==undefined&&JSON.stringify(battleLookup.unit_traits[id])!==JSON.stringify(battleLookup.unit_traits[base])).map(([id])=>id);
if(!equalIds(Object.keys(battlePolicy.forms),formIds))fail('战斗形态表未覆盖完整模型别名');
for(const [id,rule]of Object.entries(battlePolicy.auxiliaries))if(!nonPool.ids.includes(id)||battleLookup.unit_encodings[id]===undefined||!rule.augments.length||rule.augments.some(id=>!catalog.augments[id]||!battleLookup.augment_lookup[id]))fail('独立单位来源规则缺少可核对数据：'+id);
for(const fact of battlePolicy.evidence.auxiliaryFacts)if(catalog.augments[fact.id]?.description!==fact.description)fail('独立单位来源描述与本地赛季快照不一致：'+fact.id);
const names=new Map(base.sets['18'].map(c=>[c.id,c.name])),profiles=new Map(full.profiles.map(p=>[p.key,p])),shop=new Map(mechanics.units.map(u=>[u.id,u.cost]));
for(const data of [full,catalog,gear])if(data.meta.set!=='TFTSet18'||data.meta.clusterId!==base.meta.cluster_id||data.meta.queue!==1100)fail('阵容、装备模型与核心候选的赛季/聚类版本不一致，请重新同步');
if(names.size!==profiles.size||catalog.profiles.length!==profiles.size||new Set(catalog.profiles.map(p=>p.key)).size!==profiles.size)fail('阵容家族快照数量不一致');
for(const [id,cost]of shop)if(catalog.roles[id]?.cost!==cost||rules.heroes[id]?.cost!==cost)fail('英雄费用来源冲突：'+id);
const fingerprint=b=>b.level+':'+b.poolUnits.slice().sort().join('|');
let pairs=0;
for(const profile of catalog.profiles){
 const source=profiles.get(profile.key);
 if(!source||names.get(profile.key)!==profile.name||source.name!==profile.name||source.count!==profile.count||source.avg!==profile.avg)fail('名称或统计未对应同一阵容：'+profile.key);
 const observed=new Set(source.boards.map(fingerprint));
 if(!profile.pairs.length)fail('阵容没有可验证的核心变体：'+profile.key);
 for(const pair of profile.pairs){
  pairs++;if(pair.profile!==profile.key||!shop.has(pair.carry)||!shop.has(pair.tank)||!pair.templates.length)fail('核心身份不合法：'+pair.id);
  for(const board of [...pair.templates,...pair.lateTemplates??[]])if(!observed.has(fingerprint(board))||!board.poolUnits.includes(pair.carry)||!board.poolUnits.includes(pair.tank)||board.poolUnits.some(id=>!shop.has(id)))fail('核心变体不是可购买的实际共同棋盘：'+pair.id);
  if((pair.lateTemplates??[]).some(b=>b.level<9||b.count<30||b.poolUnits.length>b.level))fail('高人口参考超出可验证范围：'+pair.id);
 }
}
for(const model of gear.models){
 if(!profiles.has(model.profile)||!catalog.roles[model.unit])fail('装备模型引用了其它快照的英雄');
 if(Math.abs(Object.values(model.components).reduce((n,v)=>n+v,0)-model.componentMass)>1e-6||Math.abs(Object.values(model.items).reduce((n,v)=>n+v,0)-model.itemMass)>1e-6)fail('装备频率质量不守恒');
}
for(const distribution of [gear.backgroundComponents,gear.backgroundItems])if(Math.abs(Object.values(distribution).reduce((n,v)=>n+v,0)-1)>1e-8)fail('装备参考频率未归一');
const files=['metatft-comps','metatft-strategic-profiles','metatft-direction-catalog','metatft-gear-model','metatft-transition-library','current-shop-mechanics','decision-trading-rules','battle-unit-policy','current-non-pool-units'];
const manifest={set:'TFTSet18',clusterId:base.meta.cluster_id,generatedAt:new Date().toISOString(),sourceFetchedAt:full.meta.fetchedAt,
 counts:{families:profiles.size,boards:full.profiles.reduce((n,p)=>n+p.boards.length,0),early:full.profiles.reduce((n,p)=>n+p.early.length,0),pairs,gearModels:gear.models.length},
 scope:full.meta.window,files:Object.fromEntries(files.map(name=>[name+'.json',crypto.createHash('sha256').update(fs.readFileSync('data/'+name+'.json')).digest('hex')]))};
fs.writeFileSync('data/decision-model-manifest.json',JSON.stringify(manifest,null,2));
console.log('[decision-data] S18 · '+profiles.size+' families · '+pairs+' observed cores · consistent snapshot');
