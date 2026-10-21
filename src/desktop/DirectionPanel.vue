<script setup lang="ts">
import {computed,ref} from 'vue';
import type {DirectionAdvice} from '../decision/direction-advisor';
import {dataset} from '../game/tft-data';
import RouteProgressDetails from './RouteProgressDetails.vue';
const props=defineProps<{advice?:DirectionAdvice;selectedKey?:string|null;selectedDirectionId?:string;budget?:number|null}>();
defineEmits<{selectComp:[key:string,directionId:string];budget:[number|null]}>();
const labels={reroll:'赌狗','four-cost':'84',legendary:'95'};
const filter=ref<'all'|'reroll'|'four-cost'|'legendary'>('all');
const visibleRows=computed(()=>{const a=props.advice;return !a?.ready?[]:filter.value==='all'?a.rows:(a.comparisonRows??a.rows).filter(r=>r.regime===filter.value);});
const visibleGoals=computed(()=>{const a=props.advice;if(!a?.ready||!a.search?.ready)return [];return filter.value==='all'?a.search.goals:a.search.goals.filter(g=>visibleRows.value.some(r=>g.id.startsWith(r.id+':')));});
const mainRoute=computed(()=>{const a=props.advice;return a?.ready&&a.mode==='selected'?a.rows.find(r=>r.id===a.focusId):undefined;});

const name=(id:string)=>dataset.characterById(id)?.display_name??'待更新';
const pct=(p:number)=>p>0&&p<.001?'<0.1%':p>0&&p<.01?(p*100).toFixed(1)+'%':Math.round(p*100)+'%';
</script>
<template><section v-if="advice?.ready" class="directions" data-direction-advisor :data-mode="advice.mode" :aria-busy="!!advice.updating">
  <header><div><span class="eyebrow">{{ advice.round??'对局中' }} · {{ {opening:'前期过渡','second-augment':'中期参考','roll-down':'启动与变阵',late:'补强参考'}[advice.milestone] }}</span><h2>{{ advice.message }}</h2></div><span v-if="advice.updating" class="direction-mode">更新中</span></header>
  <div class="direction-controls"><nav class="route-filters" aria-label="阵容类型"><button v-for="kind in ['all','reroll','four-cost','legendary'] as const" :key="kind" :data-route-filter="kind" :class="{active:filter===kind}" @click="filter=kind">{{ kind==='all'?'推荐':labels[kind] }}</button></nav>
  <nav class="search-budgets" aria-label="搜牌预算"><span>搜牌预算</span><button v-for="amount in [20,40,60,null]" :key="String(amount)" :class="{active:(budget??null)===amount}" :data-search-budget="amount??'wallet'" @click="$emit('budget',amount)">{{ amount===null?'当前金币':amount+' 金' }}</button></nav></div>
  <div class="direction-cards"><article v-for="row in visibleRows" :key="row.id" :data-suggestion="row.key" :class="{chosen:selectedDirectionId?selectedDirectionId===row.id:selectedKey===row.key}">
    <div class="card-heading"><span>{{ row.regime==='reroll'?(dataset.characterById(row.carry)?.cost??'')+'费赌狗':labels[row.regime] }}</span><small>{{ row.labels.join(' · ') }}</small></div>
    <h3>{{ row.name }}</h3>
    <div class="observed-stats" title="MetaTFT 阵容终局聚合统计，API默认窗口；不是当前局面的预计名次。">汇总均名 {{ row.observedPlace.toFixed(2) }} <span>{{ row.observations.toLocaleString() }} 场</span></div>
    <div class="core-pair"><span v-for="id in [row.carry,row.tank]" :key="id" :class="'cost-'+dataset.characterById(id)?.cost"><img :src="dataset.characterById(id)?.image_path" :alt="name(id)"/><b>{{ name(id) }}</b><span class="pair-items"><img v-for="item in row.gearAllocation?.assignments.filter(a=>a.unit===id&&!a.id.includes('Component_'))" :key="item.index" :src="dataset.item(item.id)?.image_path" :alt="dataset.item(item.id)?.display_name??'装备'" :title="(dataset.item(item.id)?.display_name??'装备')+(item.transfer?' · 规划转移给'+name(id):' · '+name(id))"/></span></span></div>
    <div class="route-facts"><span>主C / 前排<b>{{ row.copies }} / {{ row.tankCopies }} 张</b></span><span title="其他存活玩家持有的该核心副本数；不是对手人数。">同行占主C<b>{{ row.poolComplete?row.rivalCopies??0:'—' }}{{ row.poolComplete?' 张':'' }}</b></span><span title="与该终局家族有真实观测关联的近人口过渡棋盘，已持有英雄种数。">过渡已持<b>{{ row.early?(row.early.units.length-row.early.missing)+' / '+row.early.units.length:'—' }}</b></span><span title="依据已选海克斯的描述与机制匹配，不是该海克斯带来的胜率提升。">机制关联<b>{{ new Set([...row.traitSupport,...row.mechanismSupport]).size }} 项</b></span></div>
    <small v-if="row.blocked" class="pool-warning">追三空间不足</small>
    <div class="route-units"><img v-for="id in row.units" :key="id" :src="dataset.characterById(id)?.image_path" :alt="name(id)" :title="name(id)"/></div>
    <RouteProgressDetails v-if="row.progress" :progress="row.progress"/>
    <footer><span :title="'按实际出装频率逐件分配给双核；不重复使用物品。转移须处理原持有者，未分配物品可考虑其它英雄。这不是战斗胜率。'">{{ row.gear.supporting.length?'核心装支持':row.tankGear?.supporting.length?'前排装支持':row.gear.known||row.tankGear?.known?'散件方向已比较':'等待装备信号' }}</span><button :data-advisor-pick="row.key" :data-direction-pick="row.id" :data-late-count="row.lateBoards?.length??0" @click="$emit('selectComp',row.key,row.id)">{{ (selectedDirectionId?selectedDirectionId===row.id:selectedKey===row.key)?'当前主线':'设为主线' }}</button></footer>
  </article></div>
  <section v-if="mainRoute?.lateBoards?.length" class="late-variants" data-late-variants><header><strong>主线后期变体</strong><small>真实棋盘参考</small></header><div class="late-grid"><article v-for="(board,index) in mainRoute.lateBoards" :key="index" title="高人口样本存在筛选偏差；均名不是本局升级收益，也不保证该变体更强。"><div><b>{{ board.level }} 人口</b><span v-if="board.avg!==null">汇总均名 {{ board.avg.toFixed(2) }}</span><small>{{ board.count.toLocaleString() }} 次观测</small></div><div class="late-units"><img v-for="id in board.poolUnits" :key="id" :class="{owned:advice.owned[id]>0}" :src="dataset.characterById(id)?.image_path" :alt="name(id)" :title="name(id)+(advice.owned[id]?' · 已持有':'')"/></div></article></div></section>
  <div v-if="advice.search?.ready&&!advice.updating&&(filter==='all'||visibleGoals.length)" class="search-plan" data-direction-search :data-phase="advice.search.phase">
    <header><strong>{{ advice.mode==='selected'&&advice.regime!=='reroll'?'主线与备选 · 双核二星参考':filter!=='all'?'候选补齐参考':{reroll:'核心追三',flex:'多路线搜牌',upgrade:'核心到手 · 继续追二星',reinforce:'三星已成 · 补强关键牌'}[advice.search.phase] }}</strong><span :title="advice.search.gaps.join('；')">{{ advice.search.level }}级 · {{ advice.search.budget }} 金预算（含买牌）</span></header>
    <div v-if="advice.search.portfolio&&filter==='all'" class="portfolio"><span>任一路首核补齐</span><b>{{ pct(advice.search.portfolio.completionProbability) }}–{{ pct(advice.search.optimisticProbability??advice.search.portfolio.completionProbability) }}</b><small title="仙灵刷新阶段未同步，分别按四个和五个英雄格参考。">4–5 英雄格</small><div v-if="advice.search.portfolio.buy.length" class="buy-now"><span>当前可留</span><img v-for="id in advice.search.portfolio.buy" :key="id" :src="dataset.characterById(id)?.image_path" :alt="name(id)" :title="name(id)"/></div></div>
    <div v-if="advice.search.keyUpgradePortfolio&&filter==='all'" class="portfolio" :title="'主C或前排任一升二星，仍不代表战斗已稳定。先留首张再选路追星；双核均二星参考 '+pct(advice.search.upgradePortfolio?.completionProbability??0)+'–'+pct(advice.search.optimisticUpgradeProbability??0)"><span>选路后关键二星</span><b>{{ pct(advice.search.keyUpgradePortfolio.completionProbability) }}–{{ pct(advice.search.optimisticKeyUpgradeProbability??advice.search.keyUpgradePortfolio.completionProbability) }}</b></div>
    <div class="search-goals"><div v-for="goal in visibleGoals" :key="goal.id" class="search-goal" :title="goal.reason??'固定当前人口、金币和对手占牌；不是战斗胜率。'">
      <span><span v-for="target in goal.targets" :key="target.id" class="search-target"><img :src="dataset.characterById(target.id)?.image_path" :alt="name(target.id)"/><small>{{ target.copies===9?'三星':target.copies===3?'二星':'首张' }}</small></span></span>
      <b>{{ pct(goal.probability) }}–{{ pct(goal.optimisticProbability) }}</b><small>{{ goal.gold50===null?'预算内未达50%':'50%约 '+goal.gold50+' 金' }}</small>
    </div></div>
  </div>
  <small v-if="filter!=='all'&&!visibleGoals.length" class="evidence">设为主线后查看该路线的搜牌参考</small>
  <details class="evidence"><summary>数据与计算依据</summary><p>{{ advice.gaps.length?advice.gaps.join(' · '):'装备 · 过渡 · 海克斯' }}</p></details>
</section></template>
<style scoped src="./direction-panel.css"></style>
