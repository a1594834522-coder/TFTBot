<script setup lang="ts">
import type {EquipmentHandoffs} from '../decision/equipment-handoffs';
import {dataset} from '../game/tft-data';
defineProps<{advice?:EquipmentHandoffs}>();
const name=(id:string)=>dataset.characterById(id)?.display_name??'名称待更新';
const itemName=(id:string)=>dataset.item(id)?.display_name??'装备待更新';
const pct=(n:number)=>(n*100).toFixed(1)+'%';
const pt=(n:number)=>(n>0?'+':'')+(n*100).toFixed(1)+'pt';
</script>
<template><section v-if="advice?.ready&&advice.choices.length" class="handoff-panel" data-equipment-handoffs>
  <header><h2>装备承接</h2><small :title="advice.gaps.join(' · ')">不出售参考 {{ advice.baseline===null?'待补齐':pct(advice.baseline) }}*</small></header>
  <div class="handoff-grid"><article v-for="(choice,index) in advice.choices" :key="index" data-handoff-choice>
    <div class="handoff-path"><div class="handoff-sellers"><span v-for="unit in choice.sold" :key="unit.key" :title="'出售 '+name(unit.id)+' '+unit.star+'星'"><img :src="dataset.characterById(unit.id)?.image_path" :alt="name(unit.id)"/><small>{{ '★'.repeat(unit.star) }}</small></span></div><i>→</i><div class="handoff-recipients"><span v-for="unit in choice.recipients.filter(u=>choice.moves.some(m=>m.to===u.key))" :key="unit.key" :title="name(unit.id)+' '+unit.star+'星'"><img :src="dataset.characterById(unit.id)?.image_path" :alt="name(unit.id)"/><div><img v-for="move in choice.moves.filter(m=>m.to===unit.key)" :key="move.token.key" :src="dataset.item(move.result.id)?.image_path" :alt="itemName(move.result.id)" :title="move.consumed.length?[itemName(move.token.id),...move.consumed.map(t=>itemName(t.id))].join(' + ')+' → '+itemName(move.result.id):itemName(move.result.id)"/></div></span></div></div>
    <footer><span :title="advice.gaps.join(' · ')">{{ advice.weightSource==='uniform'?'全场':'候选' }} <b>{{ choice.winRate===null?'待补齐':pct(choice.winRate) }}*</b><i :class="{negative:choice.upperGain<=0}">{{ choice.gain===null?pt(choice.lowerGain)+'～'+pt(choice.upperGain):pt(choice.gain) }}</i></span><small>余 {{ choice.goldAfter }} 金</small></footer>
    <p v-if="choice.conditionalRack" class="handoff-condition" title="当前没有确认装备栏容量；此比较以出售前有这些空余位置为条件，不表示软件已验证可直接出售。">装备栏需空 {{ choice.requiredRackSlots }} 格</p>
    <details data-handoff-details><summary>承接明细</summary><p>购买 {{ choice.spent }} 金 · 出售回收 {{ choice.refund }} 金</p><p v-if="choice.bought.length">购买 {{ choice.bought.map(b=>name(b.id)+'（第'+(b.slot+1)+'格）').join('、') }}</p><div v-for="move in choice.moves" :key="move.token.key" class="handoff-move"><span>{{ name(choice.lineup.find(u=>u.key===move.to)?.id??'') }}</span><span>{{ move.consumed.length?[itemName(move.token.id),...move.consumed.map(t=>itemName(t.id))].join(' + ')+' → ':'' }}{{ itemName(move.result.id) }}</span></div><div class="handoff-lineup"><span v-for="unit in choice.lineup" :key="unit.key" :title="name(unit.id)+' · '+unit.star+'星 · '+unit.items.map(itemName).join('、')"><img :src="dataset.characterById(unit.id)?.image_path" :alt="name(unit.id)"/><small>{{ '★'.repeat(unit.star) }}</small></span></div></details>
  </article></div>
</section><p v-else-if="advice&&!advice.ready" class="handoff-status">{{ advice.reason }}</p></template>
<style scoped src="./equipment-handoffs.css"></style>
