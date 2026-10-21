<script setup lang="ts">
import {computed,ref} from 'vue';
import type {BattleForecast} from '../game/battle-forecast';
const props=defineProps<{forecast?:BattleForecast|null;collapsed?:boolean}>();
const open=ref(false);
const percent=(n:number)=>Math.round(n*100)+'%';
const ready=computed(()=>props.forecast?.phase==='ready');
const label=computed(()=>props.forecast?.weightSource==='uniform'?'全场':'下场');
const value=computed(()=>!ready.value?'—':props.forecast?.winRate!=null?percent(props.forecast.winRate):props.forecast&&props.forecast.coverage>0?`${percent(props.forecast.lower)}–${percent(props.forecast.upper)}`:'—');
</script>
<template>
  <div class="win-chance" data-win-chance :data-phase="forecast?.phase??'waiting'" @mouseenter="open=true" @mouseleave="open=false" @focusin="open=true" @focusout="open=false" @keydown.esc="open=false">
    <button :aria-label="label+'模型胜率 '+value" :aria-expanded="open" :class="{ready,approximate:forecast?.approximate}" @click="open=!open"><span>{{ label }}</span><b>{{ value }}</b><i v-if="ready&&forecast?.approximate">*</i></button>
    <aside v-if="open&&!collapsed" class="win-detail" role="status" data-win-chance-detail>
      <header><strong>MetaTFT 单场胜率</strong><small>{{ forecast?.weightSource==='uniform'?'存活对手等权':'候选对手加权' }}</small></header>
      <p v-if="!ready">{{ forecast?.message??'等待场上棋盘' }}</p>
      <template v-else>
        <div v-for="o in forecast?.opponents.filter(o=>o.weight>0)" :key="o.id" class="win-opponent"><span>{{ o.name }}</span><small>{{ percent(o.weight) }}</small><b>{{ o.winRate===null?'—':percent(o.winRate) }}</b></div>
        <p v-if="forecast?.coverage!==1">已覆盖 {{ percent(forecast?.coverage??0) }}，缺失对手保留未知范围</p>
        <p v-if="forecast?.gaps.length">{{ forecast.gaps.join(' · ') }}</p>
        <footer>{{ forecast?.weightSource==='uniform'?'候选未识别，暂作全场战力参考。':'' }}模型不计站位与当前仙灵效果。</footer>
      </template>
    </aside>
  </div>
</template>
<style scoped>
.win-chance .win-detail{position:absolute;top:30px;right:0;max-height:var(--win-detail-height,138px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.win-chance{position:relative;margin-left:auto;-webkit-app-region:no-drag;app-region:no-drag;font:10px/1.4 "Segoe UI","Microsoft YaHei",sans-serif}.win-chance>button{display:flex;align-items:baseline;gap:6px;padding:4px 7px;border:0;background:#ffffff04;border-radius:4px;color:#626f7c;cursor:pointer;white-space:nowrap}.win-chance>button.ready{color:#b2bea9}.win-chance>button>span{font-size:9px;color:#748170}.win-chance b{font-weight:500;font-variant-numeric:tabular-nums}.win-chance>button>b{font-size:13px}.win-chance i{font-style:normal;font-size:10px;opacity:.6;margin-left:-4px}.win-detail{position:fixed;top:44px;right:17px;z-index:9;width:240px;padding:12px;background:#151b24fa;border:1px solid #a3906255;border-radius:6px;box-shadow:0 9px 30px #0009;color:#acb4bf;box-sizing:border-box}.win-detail header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.win-detail header strong{font-size:11px;font-weight:500;color:#c6c8be}.win-detail small{font-size:9px;color:#66778b}.win-opponent{display:flex;align-items:center;gap:10px;margin-top:6px}.win-opponent>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.win-opponent>b{width:34px;text-align:right;color:#c6c7b5}.win-detail p,.win-detail footer{font-size:9px;color:#687b90;line-height:1.6;margin:9px 0 0}.win-detail footer{padding-top:8px;border-top:1px solid #ffffff09}
</style>
