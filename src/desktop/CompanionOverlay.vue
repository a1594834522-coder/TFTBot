<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { SelectedComp } from '../game/selected-comp';
import type { ReaderStatus } from '../recognition/status';
import { overlayModel } from '../game/overlay-model';
import type {EarlyHoldAdvice} from '../game/comp-advisor';
import type {BattleForecast} from '../game/battle-forecast';
import WinChanceBadge from './WinChanceBadge.vue';
const props=defineProps<{comp:SelectedComp|null;status:ReaderStatus|null;state:{collapsed:boolean;locked:boolean;visible:boolean};holds?:EarlyHoldAdvice;focused?:string|null;battle?:BattleForecast|null}>();
const emit=defineEmits<{action:[action:'collapse'|'expand'|'lock'|'unlock'|'hide'];transition:[id:string|null];focus:[id:string|null]}>();
const model=computed(()=>overlayModel(props.status));
const route=computed(()=>props.comp?.transitions?.find(t=>t.id===props.comp?.transitionId));
const flexible=computed(()=>!props.comp&&props.holds?.ready);
const rows=computed(()=>[{key:'core',units:props.comp?.units??props.holds?.cards.map(c=>c.id)??[]},{key:'early',units:route.value?.units??[]}]);
const hover=ref<string|null>(null),pinned=ref<string|null>(null),anchor=ref(14);
const active=computed(()=>pinned.value??hover.value);
const card=computed(()=>active.value?model.value.card(active.value):null);
const info=computed(()=>!model.value.complete?'等待全场持牌数据':!model.value.level?'等待等级数据':'S18 PBE 牌池参数 · 理论刷新费');
const gold=(value:number|null)=>value===null?'不可达':`${Number(value.toFixed(1))}`;
function reveal(id:string,event:Event){hover.value=id;const el=event.currentTarget as HTMLElement;anchor.value=Math.min(352,Math.max(12,el.offsetLeft-45));}
watch([()=>props.comp?.key,()=>props.comp?.transitionId,()=>props.state.collapsed],()=>{pinned.value=null;hover.value=null;});
</script>
<template>
  <section class="companion" data-game-overlay :data-ready="model.complete" :data-collapsed="state.collapsed" :data-locked="state.locked" @keydown.esc="pinned=null;hover=null">
    <header class="hud-header">
      <span class="hud-mark" aria-hidden="true">◈</span><strong>{{ comp?.name??(flexible?'灵活留牌':'记牌器') }}</strong>
      <i class="hud-status" :class="{live:model.complete}" :title="info" :aria-label="info"/>
      <WinChanceBadge :forecast="battle" :collapsed="state.collapsed" :style="{'--win-detail-height':comp?'194px':'138px'}"/>
      <div class="hud-actions">
        <button :aria-label="state.collapsed?'展开':'收起'" :title="state.collapsed?'展开':'收起'" @click="emit('action',state.collapsed?'expand':'collapse')"><svg viewBox="0 0 16 16"><path :d="state.collapsed?'m4 6 4 4 4-4':'m4 10 4-4 4 4'"/></svg></button>
        <button :aria-label="state.locked?'关闭鼠标穿透':'鼠标穿透'" title="鼠标穿透 · Ctrl+Shift+F8" :class="{on:state.locked}" @click="emit('action',state.locked?'unlock':'lock')"><svg viewBox="0 0 16 16"><rect x="4" y="7" width="8" height="6" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg></button>
        <button aria-label="隐藏浮窗" title="隐藏 · F8" @click="emit('action','hide')"><svg viewBox="0 0 16 16"><path d="m5 5 6 6m0-6-6 6"/></svg></button>
      </div>
    </header>
    <main v-if="!state.collapsed && (comp||flexible)" class="hud-content">
      <template v-for="row in rows" :key="row.key">
        <nav v-if="row.key==='early' && comp?.transitions?.length" class="hud-routes" aria-label="过渡阵容">
          <span>过渡</span><button v-for="(t,i) in comp.transitions" :key="t.id" :class="{selected:comp.transitionId===t.id}" :aria-pressed="comp.transitionId===t.id" :title="t.name+(t.heldCount===undefined?'':' · 已持 '+t.heldCount+'/'+t.units.length)" :data-transition="t.id" @click="emit('transition',t.id)"><small>0{{ i+1 }}</small>{{ t.name }}</button>
          <button class="route-off" :class="{selected:!route}" title="仅高亮成型阵容" aria-label="不选择过渡阵容" @click="emit('transition',null)">−</button>
        </nav>
        <nav v-if="row.key==='early' && flexible" class="hud-routes" aria-label="前期过渡"><span>过渡</span><button v-for="(b,i) in holds?.boards" :key="b.id" :class="{selected:focused===b.id}" :aria-pressed="focused===b.id" :title="b.units.map(id=>model.card(id).name).join(' / ')" :data-early-choice="b.id" @click="emit('focus',focused===b.id?null:b.id)"><small>0{{ i+1 }}</small>{{ b.units.length }}人口 · 已齐 {{ b.held.length }}</button></nav>
        <div v-if="row.units.length" class="hud-units" :class="row.key" :data-overlay-row="row.key">
          <button v-for="id in row.units" :key="id" class="hud-unit" :class="['cost-'+model.card(id).cost,{inspected:active===id}]" :data-overlay-unit="id" :aria-label="model.card(id).name+'，剩余'+(model.card(id).remaining??'未知')+'张'" :aria-expanded="active===id" @mouseenter="reveal(id,$event)" @mouseleave="hover=null" @focus="reveal(id,$event)" @blur="hover=null" @click="reveal(id,$event);pinned=pinned===id?null:id">
            <span class="hud-portrait"><img v-if="model.card(id).image" :src="model.card(id).image" :alt="model.card(id).name" draggable="false"/><span v-else>{{ model.card(id).name.slice(0,1) }}</span></span><i v-if="flexible&&holds?.cards.find(c=>c.id===id)?.quantity" class="hud-available">+</i><b>{{ model.card(id).remaining??'—' }}</b>
          </button>
        </div>
      </template>
    </main>
    <div v-else-if="!state.collapsed" class="hud-empty">在主界面选择阵容</div>
    <aside v-if="card && !state.collapsed" class="hud-popover" :style="{left:anchor+'px'}" role="status" data-overlay-budget>
      <div class="popover-top"><strong>{{ card.name }}</strong><span>{{ card.cost }}费</span><button v-if="pinned" aria-label="关闭英雄详情" @click="pinned=null;hover=null">×</button></div>
      <small v-if="flexible" class="hold-reason">{{ holds?.cards.find(c=>c.id===card?.id)?.reason }}</small>
      <template v-if="card.result"><div class="gold-line"><span>下一张 · 平均刷新</span><b>{{ gold(card.result.meanGold) }}<small v-if="card.result.meanGold!==null"> 金</small></b></div><div class="popover-note">90% {{ gold(card.result.gold90) }}{{ card.result.gold90===null?'':' 金' }}<span>购买另 {{ card.cost }} 金</span></div><small class="model-note">{{ info }} · 非保底</small></template>
      <span v-else class="waiting-detail">{{ info }}</span>
    </aside>
  </section>
</template>
<style scoped>
.hud-unit{position:relative}.hud-available{position:absolute;right:0;top:0;background:#b9a375;color:#121820;border-radius:0 3px 0 4px;font-style:normal;font-size:10px;width:12px;line-height:12px}.hold-reason{display:block;font-size:10px;color:#b2ad97;margin-bottom:10px}
.companion{--gold:#c7ae81;--ink:#e3e3df;position:relative;width:584px;height:100%;box-sizing:border-box;color:var(--ink);font:11px/1.4 "Segoe UI","Microsoft YaHei",sans-serif;background:linear-gradient(120deg,rgba(29,32,39,.97),rgba(14,17,23,.97));border:1px solid #c2af842e;border-radius:10px;overflow:hidden;box-shadow:0 12px 35px #0005;user-select:none}.companion *{box-sizing:border-box}.companion button{font:inherit;cursor:pointer;app-region:no-drag;-webkit-app-region:no-drag}.hud-header{height:41px;display:flex;align-items:center;gap:9px;padding:0 13px;border-bottom:1px solid #ffffff09;app-region:drag;-webkit-app-region:drag}.hud-mark{font-size:20px;color:var(--gold);opacity:.85}.hud-header strong{font-size:12px;font-weight:600;letter-spacing:.4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hud-status{width:5px;height:5px;flex-shrink:0;background:#a28f65;border-radius:50%;margin-left:3px;app-region:no-drag;-webkit-app-region:no-drag}.hud-status.live{background:#82b5a4;box-shadow:0 0 8px #82b5a422}.hud-actions{display:flex;gap:1px;margin-left:auto}.hud-actions button{display:grid;place-items:center;width:26px;height:26px;padding:5px;border:0;border-radius:5px;background:transparent;color:#727986}.hud-actions button:hover,.hud-actions button.on{background:#ffffff0a;color:var(--gold)}svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}.hud-content{padding:16px 18px 14px}.hud-units{display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}.hud-unit{display:flex;flex-direction:column;align-items:center;width:44px;flex:0 0 44px;padding:0;background:none;border:0;text-align:center;color:#b7bdc7;border-radius:0;outline-offset:2px}.hud-portrait{display:grid;place-items:center;width:44px;height:44px;overflow:hidden;background:#262b34;border:1px solid #7f8d974f;border-radius:5px;border-bottom:2px solid var(--cost,#7f8d97)}.hud-portrait img{display:block;width:100%;height:100%;object-fit:cover;transition:filter .15s;filter:saturate(.78)}.hud-unit b{display:block;font:500 12px/1 "Segoe UI",sans-serif;font-variant-numeric:tabular-nums;margin-top:7px}.hud-unit:hover,.hud-unit.inspected{color:#e5c793;background:none}.hud-unit:hover .hud-portrait,.hud-unit.inspected .hud-portrait{box-shadow:0 0 0 1px #dbc38b8c;border-color:#dbc38b}.hud-unit:hover img,.hud-unit.inspected img{filter:saturate(1)}.cost-1{--cost:#7a818a}.cost-2{--cost:#498869}.cost-3{--cost:#467fba}.cost-4{--cost:#9868af}.cost-5,.cost-6,.cost-7{--cost:#b99a57}.hud-routes{height:47px;display:flex;align-items:center;gap:6px;margin-top:7px}.hud-routes>span{font-size:10px;color:#5f6774;flex-shrink:0;margin-right:3px}.hud-routes button{border:1px solid transparent;background:none;border-radius:4px;padding:5px 7px;font-size:10px;color:#7e8796;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:159px}.hud-routes small{font-size:8px;margin-right:5px;opacity:.55}.hud-routes button.selected{border-color:#b49b6f38;color:#d7be91;background:#b49b6f0b}.hud-routes button:hover{color:#e3ceaa;background:#b49b6f0e}.hud-routes .route-off{margin-left:auto;width:23px;padding:4px}.early .hud-portrait{width:38px;height:38px}.early .hud-unit{width:38px;flex-basis:38px}.early{gap:10px}.early .hud-unit b{font-size:11px;margin-top:6px}.hud-empty{height:140px;display:grid;place-items:center;font-size:11px;color:#747c8c}.hud-popover{position:absolute;z-index:3;top:46px;width:218px;border:1px solid #bfa57855;border-radius:7px;background:#151a23fa;box-shadow:0 8px 30px #000b;padding:12px 13px;pointer-events:none}.hud-popover button{pointer-events:auto;border:0;background:none;color:#7e8796;padding:0 0 0 8px;font-size:15px}.popover-top{display:flex;gap:8px;align-items:center;margin-bottom:11px}.popover-top strong{font-size:12px}.popover-top>span{font-size:10px;color:#777f90;margin-left:auto}.gold-line{display:flex;justify-content:space-between;align-items:center;gap:8px}.gold-line>span{font-size:10px;color:#8993a3}.gold-line b{font-size:23px;line-height:1;color:#e0c48e;font-weight:500;font-variant-numeric:tabular-nums}.gold-line small{font-size:10px}.popover-note{margin-top:10px;font-size:10px;color:#b6becb;display:flex;justify-content:space-between}.popover-note>span{color:#6f798b}.model-note{display:block;font-size:8px;color:#596578;margin-top:10px}.waiting-detail{font-size:10px;color:#939eb0}.companion button:focus-visible{outline:1px solid #d4ba84;outline-offset:3px}
</style>
