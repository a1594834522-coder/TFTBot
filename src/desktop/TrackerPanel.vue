<script setup lang="ts">
import { computed, ref, shallowRef, onUnmounted, watch } from 'vue';
import type { TrickController } from '../windows/trick/controller';
import type { ReaderStatus } from '../recognition/status';
import { analyzePool, type Cost } from '../game/cardTracker';
import { currentPool, shopCatalog, normalizeShopHero, tierOdds, mechanics } from '../game/shop-mechanics';
import { dataset } from '../game/tft-data';
import { estimateRoll } from '../game/roll-odds';
import {shopAvailability} from '../game/shop-availability';
const props = defineProps<{ controller: TrickController; status: ReaderStatus | null; compact?: boolean }>();
const state = shallowRef(props.controller.state());
const off = props.controller.subscribe(s => { state.value = s; }); onUnmounted(off);
const cost = ref(0), level = ref(8), target = ref(shopCatalog[0].character_id);
watch(()=>props.status?.cards.level,n=>{if(n)level.value=n;},{immediate:true});
const rows = computed(() => analyzePool(Object.fromEntries(state.value.players.filter(p => p.health > 0).flatMap(p => p.champions).reduce((m,c) => m.set(c.name,(m.get(c.name) ?? 0)+c.copies),new Map<string,number>())), shopCatalog, { pool: currentPool, normalizeName: normalizeShopHero, players: state.value.players.filter(p=>p.health>0).map(p=>({player:p.name,ownedByName:Object.fromEntries(p.champions.map(c=>[c.name,c.copies]))})) }));
const missing = computed(() => state.value.players.filter(p => p.health>0 && (p.placements === undefined || p.coverage === 'partial')));
const unknown = computed(() => state.value.players.filter(p=>p.health>0).flatMap(p=>p.champions).filter(c=>!shopCatalog.some(h=>h.character_id===normalizeShopHero(c.name))));
const complete = computed(() => state.value.ready && !missing.value.length && !unknown.value.length);
const selected = computed(() => rows.value.find(r=>r.champion===target.value)!);
const probability = computed(() => tierOdds(level.value, selected.value.cost as Cost));
const availability=computed(()=>shopAvailability(props.status,target.value));
const result = computed(() => estimateRoll({tierProbability:probability.value,remaining:selected.value.remaining,tierRemaining:rows.value.filter(r=>r.cost===selected.value.cost).reduce((n,r)=>n+r.remaining,0)}));
const fourSlotResult=computed(()=>estimateRoll({tierProbability:probability.value,remaining:selected.value.remaining,tierRemaining:rows.value.filter(r=>r.cost===selected.value.cost).reduce((n,r)=>n+r.remaining,0),heroSlots:4}));
const name = (id:string) => dataset.characterById(id)?.display_name ?? '名称待更新';
const gold = (n:number|null) => n===null ? '无法估算' : `${Math.round(n*10)/10} 金币`;
const goldRange=(a:number|null,b:number|null)=>a===null||b===null?'无法估算':a.toFixed(1)===b.toFixed(1)?gold(a):`${Math.round(a*10)/10}–${Math.round(b*10)/10} 金币`;
</script>
<template>
  <section class="tracker-panel" data-card-tracker :data-ready="state.ready" :data-complete="complete">
    <header><h2>全场记牌器</h2><span>{{ state.ready ? `存活 ${state.alive} 人 · ${complete ? '玩家明细已齐' : '采集中，剩余数为上限估计'}` : '等待玩家名单及棋盘 / 备战席事件' }}</span></header>
    <p v-if="missing.length">尚缺 {{ missing.map(p=>p.name).join('、') }} 的棋子明细。</p>
    <p v-if="unknown.length">存在 {{ unknown.length }} 条未匹配普通商店英雄的记录，需核对特殊单位或新形态。</p>
    <div class="tracker-controls"><label>费用 <select v-model="cost"><option :value="0">全部</option><option v-for="n in 5" :key="n" :value="n">{{ n }}费</option></select></label><label>目标英雄 <select v-model="target" aria-label="记牌器目标英雄"><option v-for="h in shopCatalog" :key="h.character_id" :value="h.character_id">{{ h.cost }}费 · {{ h.display_name }}</option></select></label><label>{{ status?.cards.level ? '当前等级（已识别，可模拟）' : '当前等级（手动）' }} <select v-model="level" aria-label="刷牌等级"><option v-for="n in 11" :key="n" :value="n">{{ n }}级</option></select></label></div>
    <div class="roll-estimate" data-roll-estimate>
      <h3>{{ name(target) }} · 下一张预算</h3><p>参数来源：{{ mechanics.source }}。等级请按实际对局选择。</p>
      <div v-if="availability" class="roll-metrics" data-tracker-current-shop><span>商店已有 <b>{{ availability.count }} 张 · 无需刷新</b></span><span>标准买价 <b>{{ availability.price }} 金币 / 张</b></span><span>{{ availability.hidden?'商店暂隐藏':availability.affordableCount===null?'金币待同步':availability.affordableCount?'当前可买 '+availability.affordableCount+' 张':'按标价还差 '+availability.missingGold+' 金币' }}</span></div>
      <template v-else-if="complete"><p v-if="result.reason">{{ result.reason }}</p><div class="roll-metrics"><span>下次刷新命中 <b>{{ (fourSlotResult.hit*100).toFixed(2) }}–{{ (result.hit*100).toFixed(2) }}%</b></span><span>平均刷新花费 <b>{{ goldRange(result.meanGold,fourSlotResult.meanGold) }}</b></span><span>50% 命中预算 <b>{{ goldRange(result.gold50,fourSlotResult.gold50) }}</b></span><span>90% 命中预算 <b>{{ goldRange(result.gold90,fourSlotResult.gold90) }}</b></span></div><p>购买另需 {{ selected.cost }} 金币 · 当前等级该费用概率 {{ (probability*100).toFixed(0) }}% · 目标剩余 {{ selected.remaining }} 张</p></template>
      <p v-else>玩家明细未齐，暂不输出金币数值，避免用不完整牌池误导决策。</p>
      <small v-if="!availability">按每次刷新 2 金币、4–5 个英雄格分别估算，范围反映仙灵格未知，并非置信区间；同费用无放回抽取。假定等级和其他玩家持牌不变，不计免费刷新、特殊商店、复制生成及其他玩家商店暂占。概率预算并非保底。</small>
    </div>
    <div v-if="state.ready" class="tracker-table"><table><thead><tr><th>英雄</th><th>费用</th><th>已持有</th><th>估计剩余</th><th>持有玩家</th></tr></thead><tbody><tr v-for="r in rows.filter(r=>!cost || r.cost===cost)" :key="r.champion" :data-tracker-hero="r.champion" :class="{chosen:target===r.champion}" @click="target=r.champion"><td>{{ name(r.champion) }}</td><td>{{ r.cost }}</td><td>{{ r.owned }}</td><td>{{ r.remaining }} / {{ r.pool }}</td><td>{{ r.holders?.map(h=>`${h.player} ×${h.copies}`).join('，') || '暂无持有' }}</td></tr></tbody></table></div>
    <footer>{{ mechanics.source }}。二星折 3 张、三星折 9 张；淘汰玩家不再占池。不同形态共享牌池。</footer>
  </section>
</template>
<style scoped>
.tracker-panel{background:#15171f;border:1px solid #30323f;border-radius:7px;padding:20px;margin-bottom:22px}.tracker-panel header,.tracker-controls,.roll-metrics{display:flex;gap:20px;align-items:center;flex-wrap:wrap}.tracker-panel h2{font-size:18px}.tracker-panel p,.tracker-panel header span,.tracker-panel small,.tracker-panel footer{font-size:12px;color:#9ba5b8;line-height:1.8}.tracker-controls label{font-size:12px;display:flex;gap:8px;align-items:center}.roll-estimate{padding:15px;background:#1b202d;border-radius:5px;margin:18px 0}.roll-estimate h3{margin-top:0}.roll-metrics span{font-size:12px;display:flex;flex-direction:column}.roll-metrics b{font-size:20px;color:#ff779a}.tracker-table{max-height:380px;overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:9px;text-align:left;border-bottom:1px solid #30323f}tr.chosen{background:#392235}tbody tr{cursor:pointer}thead{position:sticky;top:0;background:#15171f}
</style>
