<script setup lang="ts">
import type {StrategicAdvice,StrategicRow} from '../decision/strategic-advisor';
import {dataset} from '../game/tft-data';
const props=defineProps<{advice?:StrategicAdvice}>();
const name=(id:string)=>dataset.characterById(id)?.display_name??'名称待更新';
const stars=(copies:number)=>Math.log(copies)/Math.log(3)+1;
const percent=(value:number)=>(value*100).toFixed(0)+'%';
function detail(row:StrategicRow){
  if(!props.advice?.ready)return '';
  return `按当前等级和现有 ${props.advice.wallet} 金预算，补齐所列核心副本；每次四个英雄格的保守参考。不是单场胜率。五个英雄格假设下最优计划为 ${row.optimisticProbability===null?'待计算':percent(row.optimisticProbability)}。当前购买保留 ${props.advice.currentCashFloor} 金。${props.advice.gaps.join('；')}`;
}
</script>
<template><section class="strategic-options" data-strategic-options :data-ready="advice?.ready??false">
  <header><h2>后续方向</h2><small v-if="advice?.ready" :title="`来自 ${advice.sources.length} 个可能的当前聚类、${advice.goals} 条真实后续路线；${advice.frontier} 条不被其他方案全面超过。来源匹配不等同于所属概率。`">{{ advice.sources.every(s=>s.exact)?'实测转型路径':'相近过渡参考' }}</small></header>
  <div v-if="advice?.ready" class="route-grid">
    <article v-for="row in advice.rows" :key="row.goal.id" :data-strategic-route="row.goal.id">
      <header><strong>{{ row.labels.join(' · ') }}</strong><small :title="row.alternativeGoals.length?`相同核心可衔接 ${row.alternativeGoals.length+1} 个观测棋盘`:''">阶段 {{ row.goal.stage }}{{ row.alternativeGoals.length?' · '+(row.alternativeGoals.length+1)+' 路线':'' }}</small></header>
      <div class="route-targets"><span v-for="target in row.goal.targets" :key="target.id" :title="name(target.id)+' · 目标 '+target.copies+' 张副本'"><img :src="dataset.characterById(target.id)?.image_path" :alt="name(target.id)"/><small>{{ '★'.repeat(Math.round(stars(target.copies))) }}</small><b>{{ name(target.id) }}</b></span></div>
      <footer><span :title="detail(row)">核心补齐 <b>{{ percent(row.option.choice.completion.probability) }}</b><i>*</i></span><small v-if="row.observedPlace!==null" title="真实转型边的观察均名，包含选阵与存活偏差；不是执行此建议后的预期名次。">路径均名 {{ row.observedPlace.toFixed(2) }}</small></footer>
      <div class="route-buy"><span v-if="row.option.choice.buySlots.length" :title="'当前商店可留，按不降当前利息档位筛选；不是自动购买。'">当前可留 <b>{{ row.option.choice.buySlots.map(slot=>slot+1).join('、') }} 格</b></span><span v-else>当前无需补牌</span><small>余 {{ row.option.choice.goldAfter }} 金</small></div>
      <details><summary>看路线与留牌</summary><div class="route-units"><img v-for="id in row.goal.units" :key="id" :src="dataset.characterById(id)?.image_path" :alt="name(id)" :title="name(id)"/></div><p v-for="hold in row.option.retention.filter(h=>Math.abs(h.delta)>.005)" :key="hold.key" :title="'只比较这一目标的补齐机会，未计当前战力与其他路线；不代表应卖牌。'">{{ name(hold.id) }}：保留 {{ percent(hold.keepProbability) }} / 出售 {{ percent(hold.sellProbability) }}</p><small v-if="row.option.choice.totalGold50!==null">50% 预算约 {{ row.option.choice.totalGold50 }} 金</small></details>
    </article>
  </div><p v-else>{{ advice?.reason??'等待全场持牌与当前金币' }}</p>
</section></template>
<style scoped>
.strategic-options{margin:0 0 28px;padding:18px 20px;border:1px solid #36382f;background:#191c1b;border-radius:8px}.strategic-options>header,.route-grid article>header,.route-grid footer,.route-buy{display:flex;justify-content:space-between;align-items:center;gap:10px}.strategic-options h2{font-size:14px;font-weight:500;color:#d0cdbc;margin:0}.strategic-options>header>small{font-size:10px;color:#7f826e}.route-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:16px}.route-grid article{padding:13px;background:#141916;border:1px solid #303c33;border-radius:5px;min-width:0}.route-grid header strong{color:#b5bda7;font-size:12px;font-weight:500}.route-grid header small{color:#657666;font-size:10px}.route-targets{display:flex;gap:16px;margin:15px 0;min-height:72px}.route-targets>span{display:flex;align-items:center;flex-direction:column;gap:4px}.route-targets img{width:37px;height:37px;object-fit:cover;border:1px solid #857d5b;border-radius:3px}.route-targets small{font-size:10px;color:#bcaa70;line-height:1}.route-targets b{font-size:11px;font-weight:400;color:#a5b4a5}.route-grid footer{font-size:11px;color:#7d8f7d}.route-grid footer b{color:#ced5b4;font-size:15px;font-weight:500;margin-left:5px}.route-grid footer i{font-style:normal;font-size:10px}.route-grid footer small{font-size:10px;color:#8a8c72}.route-buy{margin-top:12px;padding-top:10px;border-top:1px solid #ffffff08;font-size:10px;color:#758575}.route-buy b{color:#acae8f;font-weight:400;margin-left:5px}.route-buy small{font-size:10px;color:#b0a078}.route-grid details{margin-top:12px;color:#667c69;font-size:10px}.route-grid summary{cursor:pointer}.route-units{display:flex;gap:4px;margin:10px 0;flex-wrap:wrap}.route-units img{width:24px;height:24px;object-fit:cover;border:1px solid #48594d;border-radius:2px}.route-grid details p{font-size:10px;line-height:1.7;margin:5px 0}.strategic-options>p{font-size:11px;color:#718270;margin:12px 0 0}
</style>
