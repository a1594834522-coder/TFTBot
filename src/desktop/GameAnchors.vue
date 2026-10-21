<script setup lang="ts">
import {computed} from 'vue';
import type {ReaderStatus} from '../recognition/status';
import {shopOverlayLayout} from '../game/shop-overlay-layout';
const props=defineProps<{status:ReaderStatus|null;width:number;height:number;highlightedSlots:number[];embedded?:boolean}>();
const layout=computed(()=>shopOverlayLayout(props.width,props.height));
const wisp=computed(()=>{const c=props.status?.cards.shop[4];return props.status?.cards.shopVisible!==false&&c?.kind==='wisp'?c:null;});
</script>
<template><div class="augment-game-layer" :style="embedded?{position:'absolute',width:'100%',height:'100%'}:undefined" data-augment-game-layer>
  <div class="augment-under-cards"><div v-for="n in 3" :key="n" class="augment-anchor"><div v-if="status?.cards.augments[n-1]" class="augment-rating-badge" :data-anchored-rating="status.cards.augments[n-1]!.id"><b>{{ status.cards.augments[n-1]!.rating??'?' }}</b><span>MetaTFT</span></div></div></div>
  <div v-if="status?.cards.shopVisible!==false" class="shop-target-outlines" :style="layout"><div v-for="n in 5" :key="n" :class="{highlight:highlightedSlots.includes(n-1)}" :data-shop-highlight="highlightedSlots.includes(n-1)?n:undefined"/></div>
  <div v-if="wisp" class="wisp-rating-track" :style="{left:layout.left,width:layout.width}" data-wisp-track><div class="wisp-rating-badge" :data-wisp-rating="wisp.id" :data-tier="wisp.rating??'unrated'"><b>{{ wisp.rating??'—' }}</b></div></div>
  <small v-if="status?.testMode" class="augment-test-label">示例叠加 · 非真实对局</small>
</div></template>
<style scoped>
.augment-game-layer{position:fixed;inset:0;width:100vw;height:100vh;background:transparent;pointer-events:none}.augment-under-cards{position:absolute;left:50%;bottom:24.5%;transform:translateX(-50%);width:71%;display:flex;justify-content:space-around}.augment-anchor{width:33.333%;display:flex;justify-content:center}.augment-rating-badge{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:46px;min-height:46px;padding:3px 7px;background:rgba(12,15,21,.83);border:1px solid #b88e4b;border-radius:6px;box-shadow:0 3px 8px #0008;color:#ffce77;font-family:'Microsoft YaHei',sans-serif}.augment-rating-badge b{font-size:22px;line-height:1}.augment-rating-badge span{font-size:9px;margin-top:3px;color:#e5d3b5}.augment-test-label{position:absolute;bottom:18%;left:50%;transform:translateX(-50%);font-size:12px;color:#fff;background:#332b20;padding:4px}.shop-target-outlines{position:absolute;display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.shop-target-outlines .highlight{border:2px solid #b8a16b;box-shadow:inset 0 0 12px #b8a16b18,0 0 7px #b8a16b30;border-radius:3px}.wisp-rating-track{position:absolute;bottom:.05%;height:1.25%;display:flex;justify-content:flex-end;pointer-events:none}.wisp-rating-badge{width:20%;display:flex;justify-content:center;align-items:center;color:#a79a85}.wisp-rating-badge b{display:grid;place-items:center;background:#191b22e8;border:1px solid #b49c6a88;border-radius:2px;font:500 clamp(8px,1.1vh,13px)/1 'Microsoft YaHei',sans-serif;min-width:1.5vw;height:100%;box-sizing:border-box;padding:0 4px;color:#dfc792}.wisp-rating-badge[data-tier=S] b{color:#f59e9b;border-color:#e8949188}.wisp-rating-badge[data-tier=unrated] b{color:#8d949c;border-color:#6c768188}
</style>
