<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import type {CurrentPursuit} from '../decision/current-pursuit';
import {dataset} from '../game/tft-data';
import type {PursuitMode} from '../decision/pursuit-policy';
const props=defineProps<{advice?:CurrentPursuit;budget?:number|null;mode?:PursuitMode;updating?:boolean}>();
defineEmits<{budget:[value:number|null];mode:[value:PursuitMode]}>();
const slots=ref<4|5>(4),expanded=ref(false),seen=ref(false);
watch(()=>props.advice,a=>{if(a?.ready||a&&!a.ready&&a.reason.startsWith('正在'))seen.value=true;},{immediate:true});
const visible=computed(()=>props.advice?.ready||props.advice&&!props.advice.ready&&props.advice.reason.startsWith('正在')||props.updating&&seen.value);
const pct=(n:number)=>n>0&&n<.001?'<0.1%':(Math.max(0,Math.min(1,n))*100).toFixed(1)+'%';
const percent=(b:{lower:number;upper:number})=>Math.abs(b.upper-b.lower)<.0001?pct(b.lower):pct(b.lower)+'–'+pct(b.upper);
const gold=(b:{lower:number;upper:number})=>Math.abs(b.upper-b.lower)<.05?b.lower.toFixed(1):b.lower.toFixed(1)+'–'+b.upper.toFixed(1);
const name=(id:string)=>dataset.characterById(id)?.display_name??'名称待更新';
const paths=computed(()=>{
  const a=props.advice;if(!a?.ready||a.mode!==(props.mode??'upgrade-first'))return [];
  const rows=a.paths.flatMap(path=>{const band=path.bands.find(b=>b.heroSlots===slots.value);return band?[{path,band}]:[];});
  if(expanded.value||rows.length<=4)return rows;
  // Show different intentions, without inventing a joint gold/combat score.
  const main=new Set(a.routes[0].cores),picked=[rows.find(r=>!r.path.buy.length)];
  for(const kind of ['main','alternative','both'])picked.push(rows.find(r=>r.path.buy.length&&
    (kind==='main'?r.path.buy.every(b=>main.has(b.id)):kind==='alternative'?r.path.buy.every(b=>!main.has(b.id)):r.path.buy.some(b=>main.has(b.id))&&r.path.buy.some(b=>!main.has(b.id)))));
  const shown=[...new Set(picked.filter((r):r is typeof rows[number]=>!!r))];
  for(const r of rows)if(shown.length<4&&!shown.includes(r))shown.push(r);
  return shown.sort((a,b)=>a.path.spent-b.path.spent||a.path.id.localeCompare(b.path.id));
});
</script>
<template>
  <section v-if="visible" class="current-pursuit" data-current-pursuit :data-pursuit-state="advice?.ready&&advice.mode===(mode??'upgrade-first')?'ready':'updating'">
    <header><div><h2>这家店怎么留</h2><small v-if="advice?.ready">{{ advice.budget }} 金总预算 · {{ advice.level }} 级 · {{ advice.weightSource==='uniform'?'全场等权':'候选对手' }}</small></div><div class="pursuit-controls"><select data-pursuit-mode :value="mode??'upgrade-first'" aria-label="留牌目标" title="补齐优先按已揭示的来牌调整购买，可能减少临时补强；胜率与余金独立比较。" @change="$emit('mode',($event.target as HTMLSelectElement).value as PursuitMode)"><option value="upgrade-first">升星优先</option><option value="completion-first">补齐优先</option></select><select data-pursuit-budget :value="budget??'wallet'" aria-label="留牌比较总预算" title="包括当前买牌与后续刷新费用" @change="$emit('budget',($event.target as HTMLSelectElement).value==='wallet'?null:Number(($event.target as HTMLSelectElement).value))"><option v-for="n in [20,40,60]" :key="n" :value="n">{{ n }} 金预算</option><option value="wallet">当前金币</option></select><nav aria-label="留牌比较商店情景" title="分别固定为四个或五个英雄格；实际仙灵周期未同步。"><button v-for="n in [4,5] as const" :key="n" :aria-pressed="slots===n" :data-pursuit-slots="n" @click="slots=n">{{ n }}英雄格</button></nav></div></header>
    <div v-if="advice?.ready&&advice.mode===(mode??'upgrade-first')" class="pursuit-table"><table><thead><tr><th>当前留牌</th><th>买牌花费</th><th title="后续采用相同购买规则；任一路主C与前排达到目标星级的概率。">{{ advice.routes[0].targets.some(t=>t.copies===9)?'核心追三':'双核二星' }}</th><th title="对手棋盘固定，包括抽不齐的落点；是单场模型参考，不代表名次或上分概率。">搜后胜率</th><th title="当前购买与后续刷新后剩余金币的期望；未使用的预算外金币保留。">预计余金</th></tr></thead>
      <tbody><tr v-for="{path,band} in paths" :key="path.id" :data-pursuit-path="path.id"><td><span v-if="!path.buy.length" class="skip-label">跳过这家店</span><div v-else class="pursuit-buy"><img v-for="b in path.buy" :key="b.slot" :src="dataset.characterById(b.id)?.image_path" :alt="name(b.id)" :title="name(b.id)+' · 商店第'+(b.slot+1)+'格'"/></div></td><td>{{ path.spent }}<small>金</small></td><td>{{ percent(band.completion) }}</td><td class="pursuit-combat" :title="'区间包含未评分落点和未知对手，不是置信区间。完整落点评分 '+pct(band.evaluatedMass)+'；额外 '+pct(band.retainedFloorMass)+' 保留可重放棋盘下界。'+band.gaps.join(' · ')">{{ percent(band.combat) }}</td><td>{{ gold(band.expectedGold) }}<small>金</small></td></tr></tbody></table></div>
    <p v-else class="pursuit-pending" role="status">{{ !advice?'等待最新局面':!advice.ready?advice.reason:'正在按所选目标重新比较' }}</p>
    <footer v-if="advice?.ready&&advice.mode===(mode??'upgrade-first')"><button v-if="advice.paths.length>4" data-pursuit-expand :aria-expanded="expanded" @click="expanded=!expanded">{{ expanded?'收起':'全部 '+advice.paths.length+' 种组合' }}</button><details><summary>计算条件</summary><p>{{ advice.routes.map(r=>r.name+' · '+r.targets.map(t=>name(t.id)+(t.copies===9?'三星':'二星')).join(' / ')).join('；') }}<br/>{{ advice.gaps.join(' · ') }}</p></details></footer>
  </section>
  <p v-else-if="advice&&!advice.ready&&(advice.reason.startsWith('正在')||advice.reason.includes('暂不可用'))" class="pursuit-pending" role="status">{{ advice.reason }}</p>
</template>
<style scoped>
.current-pursuit{background:var(--surface);border:1px solid var(--line);border-radius:7px;padding:22px;margin-bottom:22px;min-width:0}.current-pursuit[data-pursuit-state=updating]{min-height:370px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}h2{margin:0;font-size:14px;font-weight:500;color:var(--text)}header small{display:block;font-size:10px;color:var(--muted);margin-top:5px}.pursuit-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}select{font-size:10px;padding:5px 8px;color:var(--muted)}nav{display:flex;gap:4px}nav button{font-size:10px;padding:5px 9px;border-color:transparent;color:var(--muted)}nav button[aria-pressed=true]{border-color:var(--line-strong);color:var(--text);background:var(--accent-soft)}.pursuit-table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}th{text-align:right;color:var(--muted);font-weight:400;font-size:10px;padding:0 12px 12px}th:first-child,td:first-child{text-align:left;padding-left:0}th:last-child,td:last-child{padding-right:0}td{padding:13px 12px;border-top:1px solid var(--line);text-align:right;color:var(--text)}td small{font-size:10px;color:var(--muted);margin-left:4px}.skip-label{font-size:11px;color:var(--muted)}.pursuit-buy{display:flex;gap:4px;min-height:28px;align-items:center}.pursuit-buy img{width:28px;height:28px;border:1px solid var(--line-strong);border-radius:3px;object-fit:cover}.pursuit-combat{color:var(--accent)}footer{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding-top:13px;font-size:10px;color:var(--faint);flex-wrap:wrap}footer>button{font-size:10px;color:var(--muted);padding:2px 0;border:0;background:none}details{margin-left:auto}summary{cursor:pointer;text-align:right}details p{max-width:850px;white-space:normal;line-height:1.9;color:var(--muted);margin:12px 0 0}.pursuit-pending{font-size:11px;color:var(--muted);margin-bottom:22px}@media(max-width:1200px){.current-pursuit{padding:18px}td,th{padding-left:8px;padding-right:8px}.pursuit-buy img{width:25px;height:25px}}
</style>
