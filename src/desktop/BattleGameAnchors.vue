<script setup lang="ts">
import {computed} from 'vue';
import type {ReaderStatus} from '../recognition/status';
import type {BattleForecast} from '../game/battle-forecast';
const props=defineProps<{status:ReaderStatus|null;forecast:BattleForecast|null}>();
const current=computed(()=>props.forecast?.phase==='ready'&&props.forecast.round===props.status?.cards.round&&Date.now()-(props.forecast?.at??0)<15000);
const nextKnown=computed(()=>current.value&&props.forecast?.weightSource!=='uniform'&&!!props.status?.opponentVision?.candidates.length);
const pct=(n:number)=>Math.round(n*100)+'%';
const chance=computed(()=>!nextKnown.value?'—':props.forecast?.winRate!=null?pct(props.forecast.winRate):pct(props.forecast!.lower)+'–'+pct(props.forecast!.upper));
const opponents=computed(()=>!current.value?[]:(props.status?.opponentVision?.rows??[]).flatMap(row=>{const o=props.forecast!.opponents.find(o=>o.id===row.id);return o&&o.winRate!==null?[{...row,winRate:o.winRate,candidate:props.status!.opponentVision!.candidates.includes(row.id)}]:[];}));
</script>
<template>
  <div v-if="status?.opponentVision?.rows.length" class="battle-anchors" data-battle-game-anchors>
    <div v-if="nextKnown" class="battle-next" data-next-fight-chance :data-source="forecast?.weightSource"><b>{{ chance }}</b></div>
    <div v-for="o in opponents" :key="o.id" class="battle-player" :class="{candidate:o.candidate}" :style="{top:(o.y*100)+'%'}" :data-player-winrate="o.id"><b>{{ pct(o.winRate) }}</b></div>
  </div>
</template>
<style scoped>
.battle-anchors{position:absolute;inset:0;pointer-events:none;color:#eee6d8;font-family:'Segoe UI','Microsoft YaHei',sans-serif;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px #000c,0 0 5px #0008}.battle-next{position:absolute;top:6.8%;left:50%;transform:translateX(-50%);white-space:nowrap}.battle-next b{font-size:clamp(25px,2.5vh,36px);font-weight:600;line-height:1.15;letter-spacing:.3px}.battle-player{position:absolute;right:5.4%;transform:translateY(12px);color:#ddd7cb;line-height:1.2;white-space:nowrap}.battle-player b{font-size:clamp(17px,1.65vh,24px);font-weight:600}.battle-player.candidate{color:#f0dec0}
</style>
