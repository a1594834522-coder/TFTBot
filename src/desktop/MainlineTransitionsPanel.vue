<script setup lang="ts">
import {ref,watch} from 'vue';
import type {SelectedComp,TransitionRoute} from '../game/selected-comp';
import {dataset} from '../game/tft-data';
const props=defineProps<{comp:SelectedComp;owned:Record<string,number>;known:boolean;shop:string[];level?:number|null}>();
defineEmits<{select:[id:string|null]}>();
const expanded=ref((props.level??4)<=7);let manual=false;
watch(()=>props.level,level=>{if(!manual)expanded.value=(level??4)<=7;});
watch(()=>props.comp.key,()=>{manual=false;expanded.value=(props.level??4)<=7;});
function toggle(){manual=true;expanded.value=!expanded.value;}
const name=(id:string)=>dataset.characterById(id)?.display_name??'名称待更新';
const available=(id:string)=>props.known?Math.min(props.shop.filter(x=>x===id).length,Math.max(0,3-(props.owned[id]??0))):0;
const selected=(route:TransitionRoute)=>route.id===props.comp.transitionId;
const context=(route:TransitionRoute)=>route.source==='metatft-aggregate'?'MetaTFT 同主线前期棋盘关联；观测数不是唯一对局数或转型概率。':'阵容资料中的过渡参考。';
</script>
<template><section v-if="comp.transitions?.length" class="mainline-transitions" data-mainline-transitions>
  <header><div><h2>前期过渡</h2><small>{{ comp.transitions.find(t=>t.id===comp.transitionId)?.name??comp.name }}</small></div><div class="transition-actions"><button :class="{active:!comp.transitionId}" data-clear-transition @click="$emit('select',null)">仅高亮主线</button><button data-toggle-transitions :aria-expanded="expanded" @click="toggle">{{ expanded?'收起':'查看过渡' }}</button></div></header>
  <div v-if="expanded" class="transition-grid"><button v-for="route in comp.transitions" :key="route.id" :data-mainline-transition="route.id" :class="{selected:selected(route)}" :aria-pressed="selected(route)" @click="$emit('select',selected(route)?null:route.id)">
    <header><span>{{ route.level }} 人口 · {{ route.name }}</span><b>{{ selected(route)?'当前过渡':'用于过渡' }}</b></header>
    <div class="transition-units"><span v-for="id in route.units" :key="id" :class="{owned:known&&owned[id]>0,offered:available(id)}" :title="name(id)+(known?' · 已持 '+(owned[id]??0)+' 张副本':' · 持牌待同步')+(comp.units.includes(id)?' · 主线共用':' · 临时过渡')"><img :src="dataset.characterById(id)?.image_path" :alt="name(id)"/><i v-if="available(id)">+{{ available(id) }}</i><small>{{ name(id) }}</small></span></div>
    <footer><span>{{ known?'已持 '+(route.heldCount??route.units.filter(id=>owned[id]>0).length)+' / '+route.units.length:'持牌待同步' }}</span><span v-if="route.source==='comp-reference'" title="保留玩家选择的阵容资料方案；当前完整聚合窗口没有足够对应记录，未展示胜率或观测数。">资料参考</span><span v-if="route.count!==undefined" :title="context(route)">{{ route.count.toLocaleString() }} 条观测</span><span v-if="route.battleWinRate!==undefined" title="该终局家族的前期棋盘历史对战统计，不是本局预测胜率。">历史对战 {{ (route.battleWinRate*100).toFixed(1) }}%</span></footer>
  </button></div>
</section></template>
<style scoped>
.mainline-transitions{padding:18px 20px;margin:0 0 22px;background:#1b1b19;border:1px solid #343431;border-radius:8px}.mainline-transitions>header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.mainline-transitions h2{font-size:15px;color:#d0d0c5;font-weight:500;margin:0 0 5px}.mainline-transitions header small{font-size:10px;color:#a19f95}.transition-actions{display:flex;gap:7px}.transition-actions button{font-size:10px;border:1px solid #484841;background:none;color:#a19f95;padding:6px 10px;border-radius:4px}.transition-actions button.active{color:#c4b18b;border-color:#9b875455}.transition-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.transition-grid>button{padding:14px;border:1px solid #343431;border-radius:5px;background:#1b1b19;text-align:left;min-width:0}.transition-grid>button.selected{border-color:#a18d62;background:#242923}.transition-grid header{display:flex;align-items:center;gap:8px;justify-content:space-between;font-size:10px;color:#bcb8ac}.transition-grid header>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.transition-grid header b{font-size:9px;font-weight:400;color:#baaa85;white-space:nowrap}.transition-units{display:flex;gap:7px;flex-wrap:wrap;margin:16px 0}.transition-units>span{position:relative;width:36px;opacity:.6}.transition-units img{display:block;width:36px;height:36px;object-fit:cover;border:1px solid #66665e;border-radius:3px;box-sizing:border-box}.transition-units .owned{opacity:1}.transition-units .owned img{border-color:#b7a278}.transition-units .offered img{box-shadow:0 0 0 1px #a8b58855}.transition-units i{position:absolute;right:-3px;top:-3px;background:#b9a67b;color:#1b1b19;font-size:8px;font-style:normal;line-height:13px;min-width:13px;text-align:center;border-radius:3px}.transition-units small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8px;color:#a19f95;margin-top:5px}.transition-grid footer{display:flex;gap:9px;flex-wrap:wrap;justify-content:space-between;font-size:9px;color:#83837a}.transition-grid footer>span:first-child{color:#b3b1a1}
</style>
