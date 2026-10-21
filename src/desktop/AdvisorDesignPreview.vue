<script setup lang="ts">
import {ref,computed,onMounted,onUnmounted,watch} from 'vue';
import SmartCompPanel from './SmartCompPanel.vue';
import CompanionOverlay from './CompanionOverlay.vue';
import {advisorDemo,type AdvisorScenario} from './advisor-demo';
import {resolveSelectedComp} from '../game/selected-comp';
import {applyDirectionSelection} from '../game/direction-selection';
import {withMainlineTransitions} from '../game/mainline-transitions';
import {advisorInput} from '../game/comp-advisor';
import {directionAdvice} from '../decision/direction-advisor';
import {directionInput} from '../decision/direction-input';
import {directionSearch} from '../decision/direction-search';
import {withSearchHolds} from '../decision/search-holds';
import {shoppingInput,tradingRules} from '../decision/shopping-input';
import {strategicInput} from '../decision/strategic-input';
import {emptyBattleForecast} from '../game/battle-forecast';
import {earlyStages} from '../game/metatft-early';
import type {DirectionCatalog} from '../decision/direction-catalog';
import type {GearModel} from '../decision/gear-affinity';
import catalog from '../../data/metatft-direction-catalog.json';
import gear from '../../data/metatft-gear-model.json';
const scenario=ref<AdvisorScenario|'startup'>('ap'),budget=ref<number|null>(null);
const tick=ref(0);let timer:ReturnType<typeof setInterval>;
onMounted(()=>{timer=setInterval(()=>tick.value++,1000);});onUnmounted(()=>clearInterval(timer));
const status=computed(()=>{
  void tick.value;const value=advisorDemo(scenario.value==='startup'?'ap':scenario.value),local=value.tracker!.snapshot!.players.find(p=>p.isLocal)!;
  value.cards.gold=40;value.cards.pickedAugments=['DA_TradeSector'];value.cards.pickedAugmentsComplete=true;
  value.cards.itemBenches=[{summoner:local.summoner,tag_line:local.tagLine,bench_items:[]}];
  value.cards.ownHoldings={board:local.champions.map((u,slot)=>({name:u.name,level:u.copies===3?2:1,items:u.items,position:slot,area:'board'})),bench:[]};
  if(scenario.value==='startup'){value.cards.stage=4;value.cards.round='4-2';value.cards.level=8;value.cards.pickedAugments.push('DA_LevelUp');}
  return value;
});
const forecast=computed(()=>{
  const value=directionAdvice({...directionInput(status.value),intent:selected.value},catalog as unknown as DirectionCatalog,gear as unknown as GearModel,earlyStages(18));
  if(value.ready)value.search=directionSearch(value,strategicInput(status.value,shoppingInput(status.value)),tradingRules,budget.value);
  return {...emptyBattleForecast('示例数据'),direction:withSearchHolds(value)};
});
const selected=ref<ReturnType<typeof resolveSelectedComp>>(null);
const state=ref({visible:true,locked:false,collapsed:false});
function transition(id:string|null){if(selected.value)selected.value=withMainlineTransitions(applyDirectionSelection(resolveSelectedComp(selected.value.key,null),selected.value.directionId),advisorInput(status.value),id);}
function pick(key:string|null,id?:string){selected.value=withMainlineTransitions(applyDirectionSelection(resolveSelectedComp(key,null),id),advisorInput(status.value));}
watch(status,value=>{selected.value=withMainlineTransitions(selected.value,advisorInput(value));});
</script>
<template><div class="advisor-preview"><header class="preview-toolbar"><strong>◈ TFTBot</strong><span>阵容助手 · 示例数据</span><button v-for="s in [{id:'ap',name:'法系开局'},{id:'ad',name:'物理开局'},{id:'contested',name:'同行挤压'},{id:'partial',name:'缺少同行数据'},{id:'startup',name:'4-2 多路启动'}]" :key="s.id" :class="{chosen:scenario===s.id}" @click="scenario=s.id as AdvisorScenario|'startup'">{{ s.name }}</button></header><main><SmartCompPanel :status="status" :selected-key="selected?.key" :selected-direction-id="selected?.directionId" :preview-forecast="forecast" :mainline="selected" @select-transition="transition" @preview-budget="budget=$event" @select-comp="pick"/><div v-if="selected" class="linked-preview"><small>已同步到局内浮窗</small><div class="linked-hud"><CompanionOverlay :comp="selected" :status="status" :state="state" @transition="transition" @action="a=>{if(a==='collapse'||a==='expand')state.collapsed=a==='collapse';}"/></div></div></main></div></template>
<style scoped>.advisor-preview{min-height:100vh;background:#0e1117;color:#e5e4df;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;overflow:auto}.preview-toolbar{height:64px;padding:0 38px;display:flex;align-items:center;gap:10px;background:#141820;border-bottom:1px solid #292c33}.preview-toolbar strong{font-size:12px;margin-right:15px;color:#bcaa85;white-space:nowrap}.preview-toolbar>span{font-size:11px;color:#646f7f;margin-right:auto;white-space:nowrap}.preview-toolbar button{border:0;background:none;color:#6c7887;padding:5px 9px;font-size:10px}.preview-toolbar button.chosen{background:#2c2b25;color:#c6b38d}.advisor-preview>main{padding:35px 38px;max-width:1600px;margin:auto}.linked-preview{margin:40px auto 0;width:584px}.linked-preview>small{display:block;font-size:10px;color:#647383;letter-spacing:1px;margin-bottom:12px}.linked-hud{height:248px;width:584px}</style>
