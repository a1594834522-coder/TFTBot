<script setup lang="ts">
import {computed} from 'vue';
import type {ReaderStatus} from '../recognition/status';
import type {BattleForecast} from '../game/battle-forecast';
import type {PurchaseSelection} from '../game/advisor-preferences';
import {currentPurchases} from '../game/purchase-selection';
import {dataset} from '../game/tft-data';
const props=defineProps<{status:ReaderStatus|null;forecast?:BattleForecast|null;selection?:PurchaseSelection|null;disabled?:boolean}>();
const emit=defineEmits<{select:[PurchaseSelection|null]}>();
const current=computed(()=>currentPurchases(props.status,props.forecast));
const name=(id:string)=>dataset.characterById(id)?.display_name??'名称待更新';
const points=(n:number)=>(n*100).toFixed(1);
const active=(id:string)=>props.selection?.context===current.value?.context&&props.selection?.id===id;
function select(id:string){if(current.value)emit('select',active(id)?null:{context:current.value.context,id});}
</script>
<template><section v-if="current?.rows.length" class="purchase-opportunities" data-purchase-opportunities>
  <header><h2>商店补强</h2><small title="先比较不买牌时，当前场上与备战席能组成的最好棋盘，再计算购买组合的额外模型收益。最多两牌联动，装备保留原持有者；组合需要一起购买、按明细上场。">相对免费换牌</small></header>
  <div class="purchase-grid"><article v-for="row in current.rows" :key="row.id" :data-purchase-id="row.id">
    <div class="purchase-row"><div class="purchase-units"><span v-for="buy in row.choice.buy" :key="buy.id" :title="name(buy.id)+' · 商店第'+buy.slots.map(n=>n+1).join('、')+'格'"><img :src="dataset.characterById(buy.id)?.image_path" :alt="name(buy.id)"/><b v-if="buy.quantity>1">×{{ buy.quantity }}</b></span></div><strong>{{ row.spend }}<small> 金</small></strong></div>
    <footer><span :title="forecast?.tactics?.ready?forecast.tactics.gaps.join(' · '):''">{{ forecast?.weightSource==='uniform'?'全场':'下场' }} <b>{{ row.gain===null?points(row.lowerGain)+'～'+points(row.upperGain):'+'+points(row.gain) }}pt*</b></span><button :disabled="disabled" :class="{active:active(row.id)}" :aria-pressed="active(row.id)" :data-purchase-highlight="row.id" @click="select(row.id)">{{ active(row.id)?'已高亮':'高亮这组' }}</button></footer>
    <details><summary>上场明细</summary><p v-if="row.choice.buy.reduce((n,b)=>n+b.quantity,0)>1" class="bundle-note">整组方案 · 收益不可拆分</p><div v-for="group in [{label:'换上',units:row.choice.incoming},{label:'换下',units:row.choice.outgoing}]" :key="group.label" class="purchase-diff"><small>{{ group.label }}</small><span v-if="!group.units.length">—</span><span v-for="unit in group.units" :key="unit.key">{{ name(unit.id) }} {{ unit.star }}★</span></div><div v-for="(upgrade,index) in row.choice.upgraded" :key="index" class="purchase-diff"><small>升星</small><span>{{ name(upgrade.id) }} {{ upgrade.before }} → {{ upgrade.after }}★</span></div></details>
  </article></div>
</section></template>
<style scoped>
.purchase-opportunities{margin:0 0 24px;padding:18px 20px;border:1px solid #3d453c;border-radius:8px;background:linear-gradient(110deg,#1d2522,#141c23 80%)}header,.purchase-row,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:14px;font-weight:500;color:#cbd1cb;margin:0}header>small{font-size:9px;color:#879289;cursor:help}.purchase-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:15px}article{min-width:0;padding:13px;background:#10182088;border:1px solid #38423e;border-radius:5px}.purchase-units{display:flex;gap:8px}.purchase-units>span{position:relative;width:33px;height:33px}.purchase-units img{width:100%;height:100%;border:1px solid #8c967d;border-radius:4px}.purchase-units b{position:absolute;bottom:-3px;right:-6px;padding:1px 3px;border-radius:2px;font-size:9px;color:#17221d;background:#a6b69a}.purchase-row>strong{font-size:18px;font-weight:500;color:#cfbea0;font-variant-numeric:tabular-nums}.purchase-row>strong small{font-size:10px;font-weight:400}footer{margin-top:16px;font-size:10px;color:#7f9287}footer b{font-weight:500;color:#b5c7a9;margin-left:4px;font-variant-numeric:tabular-nums}button{padding:5px 8px;font-size:10px;color:#afbaa8;background:transparent;border:1px solid #54624c;border-radius:4px}button.active{background:#46533a;border-color:#9ba88a;color:#e0e5d4}details{font-size:9px;color:#819082;margin-top:12px}summary{cursor:pointer;color:#6e8078}.purchase-diff{display:flex;flex-wrap:wrap;gap:5px 10px;margin-top:9px;font-size:10px;color:#adb6aa}.purchase-diff>small{font-size:9px;color:#6e8078;min-width:24px}.bundle-note{font-size:9px;color:#a89a7e;margin:10px 0 0}
</style>
