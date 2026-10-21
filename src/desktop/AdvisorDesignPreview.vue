<script setup lang="ts">
import {ref,computed,onMounted,onUnmounted,watch} from 'vue';
import SmartCompPanel from './SmartCompPanel.vue';
import DesktopSidebar from './DesktopSidebar.vue';
import CompBrowser from './CompBrowser.vue';
import {allComps,metatftMeta,type CompsSource} from '../game/comps-sources';
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
const previewView=ref('advisor'),source=ref<CompsSource|'all'>('metatft');
const previewComps=allComps({set:18}),stamp=String(metatftMeta().fetchedAt??'').slice(0,10);
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
<template>
  <div class="desktop-shell advisor-preview">
    <DesktopSidebar :view="previewView" :set="18" preview @navigate="previewView=$event"/>
    <header class="desktop-header preview-toolbar"><div class="header-location"><span>设计预览</span><i>/</i><strong>{{ previewView==='comps'?'热门阵容':'阵容助手' }}</strong></div><div v-if="previewView==='advisor'" class="preview-scenarios"><button v-for="s in [{id:'ap',name:'法系开局'},{id:'ad',name:'物理开局'},{id:'contested',name:'同行挤压'},{id:'partial',name:'数据未齐'},{id:'startup',name:'4-2 启动'}]" :key="s.id" :class="{chosen:scenario===s.id}" @click="scenario=s.id as AdvisorScenario|'startup'">{{ s.name }}</button></div><span class="preview-badge">示例数据</span></header>
    <main class="desktop-content" :class="{'comps-content':previewView==='comps'}">
      <CompBrowser v-if="previewView==='comps'" :comps="previewComps" :set="18" :source="source" :snapshot-date="stamp" :selected-key="selected?.key" @update:source="source=$event" @select-comp="pick"/>
      <template v-else><SmartCompPanel :status="status" :selected-key="selected?.key" :selected-direction-id="selected?.directionId" :preview-forecast="forecast" :mainline="selected" @select-transition="transition" @preview-budget="budget=$event" @select-comp="pick"/><div v-if="selected" class="linked-preview"><small>局内浮窗预览</small><div class="linked-hud"><CompanionOverlay :comp="selected" :status="status" :state="state" @transition="transition" @action="a=>{if(a==='collapse'||a==='expand')state.collapsed=a==='collapse';}"/></div></div></template>
    </main>
    <footer class="desktop-footer"><span>{{ selected?'当前主线 · '+selected.name:'S18 · MetaTFT' }}</span><span>界面预览 · 不连接游戏</span></footer>
  </div>
</template>
<style scoped>
.preview-scenarios{display:flex;align-items:center;gap:4px;margin-left:auto}.preview-toolbar button{border:1px solid transparent;background:none;color:#a19f95;padding:5px 8px;font-size:9px;white-space:nowrap}.preview-toolbar button.chosen{background:#bcb8ac10;border-color:#bcb8ac25;color:#d1cbbc}.preview-badge{font-size:9px;padding:3px 8px;border:1px solid #d7be8830;background:#d7be8807;color:#c4b28d;border-radius:5px;white-space:nowrap}.linked-preview{margin:40px auto 0;width:584px}.linked-preview>small{display:block;font-size:10px;color:#a19f95;letter-spacing:1px;margin-bottom:12px}.linked-hud{height:248px;width:584px}
</style>
