<script setup lang="ts">
import {computed,ref,watch,onMounted,onUnmounted} from 'vue';
import EarlyHoldPanel from './EarlyHoldPanel.vue';
import MainlineTransitionsPanel from './MainlineTransitionsPanel.vue';
import type {SelectedComp} from '../game/selected-comp';
import {normalizeShopHero} from '../game/shop-mechanics';
import type {ReaderStatus} from '../recognition/status';
import type {CompSuggestion} from '../game/comp-advisor';
import {createCompAdvisor} from '../game/comp-advisor';
import {defaultAdvisorPreferences} from '../game/advisor-preferences';
import {metatftComps,metatftMeta} from '../game/comps-sources';
import {dataset} from '../game/tft-data';
import ShoppingTacticsPanel from './ShoppingTacticsPanel.vue';
import StrategicOptionsPanel from './StrategicOptionsPanel.vue';
import type {BattleForecast} from '../game/battle-forecast';
import DirectionPanel from './DirectionPanel.vue';
import {resolveHoldAdvice} from '../game/resolve-hold-advice';
const props=defineProps<{status:ReaderStatus|null;selectedKey?:string|null;selectedDirectionId?:string;previewForecast?:BattleForecast;mainline?:SelectedComp|null}>();
const battle=ref<BattleForecast|null>(props.previewForecast??null);
watch(()=>props.previewForecast,value=>{if(value)battle.value=value;});
const emit=defineEmits<{selectComp:[key:string|null,directionId?:string];start:[];previewBudget:[number|null];selectTransition:[id:string|null]}>();
const preferences=ref(defaultAdvisorPreferences());
const manual=computed({get:()=>preferences.value.items,set:items=>{preferences.value={...preferences.value,items};}});
const editItems=ref(false),detail=ref<string|null>(null);
const advisor=createCompAdvisor(metatftComps(18));
const extraItem=ref('');
const evaluation=computed(()=>advisor.evaluate(props.status,manual.value,Date.now(),preferences.value.stage,preferences.value.boardId));
const input=computed(()=>evaluation.value.result.input);
const holds=computed(()=>resolveHoldAdvice(battle.value?.direction,evaluation.value.holds,preferences.value));
watch(()=>input.value.inventorySource,source=>{if(source==='native')editItems.value=false;});
const result=computed(()=>evaluation.value.result);
let offPreferences:(()=>void)|undefined,hydrating=true;
let offBattle:(()=>void)|undefined;
onMounted(async()=>{if(window.tftDesktop?.onBattle){offBattle=window.tftDesktop.onBattle(value=>battle.value=value);battle.value=await window.tftDesktop.battleSnapshot();}});
onUnmounted(()=>offBattle?.());
onMounted(async()=>{if(window.tftDesktop?.advisorPreferences){offPreferences=window.tftDesktop.onAdvisorPreferences(p=>{if(JSON.stringify(p)!==JSON.stringify(preferences.value))preferences.value=p;});preferences.value=await window.tftDesktop.advisorPreferences();}hydrating=false;});
onUnmounted(()=>offPreferences?.());
watch(preferences,async p=>{if(!hydrating && window.tftDesktop?.configureAdvisor)try{await window.tftDesktop.configureAdvisor({...p,items:[...p.items]});}catch{}},{deep:true});
watch(()=>preferences.value.searchBudget,value=>{if(props.previewForecast)emit('previewBudget',value??null);});
const top=computed(()=>result.value.rows.slice(0,3));
const inspected=computed(()=>result.value.rows.find(r=>r.key===detail.value));
const local=computed(()=>props.status?.tracker?.snapshot?.players.find(p=>p.isLocal));
watch(()=>props.status?.tracker?.snapshot?.players.map(p=>p.name).sort().join('|'),(next,prev)=>{if(prev&&next!==prev){preferences.value=defaultAdvisorPreferences();detail.value=null;}});
const name=(id:string)=>dataset.characterById(id)?.display_name??'名称待更新';
const portrait=(id:string)=>dataset.characterById(id)?.image_path;
const components=dataset.items.filter(i=>i.item_id.includes('Component_'));
const completed=dataset.items.filter(i=>!i.item_id.includes('Component_'));
const manualCount=(id:string)=>manual.value.filter(i=>i===id).length;
function add(id:string){if(manual.value.length<30)manual.value.push(id);}
function remove(id:string){const i=manual.value.lastIndexOf(id);if(i>=0)manual.value.splice(i,1);}
function itemName(id:string){return dataset.item(id)?.display_name??'名称待更新';}
const scoreLabel=(r:CompSuggestion)=>`规则适配度 ${r.score}，不是胜率。持牌 ${r.components.board}；装备 ${r.components.items??'未使用'}；版本表现 ${r.components.meta}；竞争 ${r.components.contested??'未使用'}`;
const stamp=String(metatftMeta().fetchedAt??'').slice(0,10);
</script>
<template>
  <section class="smart-panel" data-smart-advisor :data-ready="result.ready">
    <header class="smart-heading"><div><span class="smart-eyebrow">METATFT · S18</span><h1>阵容助手</h1></div><div class="input-status"><button v-if="selectedKey" data-clear-direction @click="emit('selectComp',null)">取消主线</button><span v-if="input.level">{{ input.level }}级</span><span v-if="input.gold!==null&&input.gold!==undefined">{{ input.gold }} 金</span><span v-if="local">{{ Object.keys(input.units).length }} 种英雄</span><span :title="input.inventorySource==='native'?'装备栏已自动读取，旧手动补充不重复计入':'已穿戴装备加手动补充；未知装备不当作没有。'">{{ input.items.length }} 件已知装备</span><span v-if="input.inventorySource==='native'">装备栏已同步</span><button v-else :class="{active:editItems}" @click="editItems=!editItems">补充装备 <b>{{ editItems?'−':'+' }}</b></button></div></header>
    <div v-if="editItems" class="manual-inventory">
      <div class="component-picker"><button v-for="item in components" :key="item.item_id" :aria-label="'添加'+item.display_name" :title="item.display_name+' · 点击添加，右键减一'" @click="add(item.item_id)" @contextmenu.prevent="remove(item.item_id)"><img :src="item.image_path" :alt="item.display_name"/><b v-if="manualCount(item.item_id)">{{ manualCount(item.item_id) }}</b></button><button class="clear-items" @click="manual=[]">清空补充</button></div>
      <div class="extra-items"><select v-model="extraItem" aria-label="补充成装"><option value="">补充成装 / 特殊装备</option><option v-for="i in completed" :key="i.item_id" :value="i.item_id">{{ i.display_name }}</option></select><button :disabled="!extraItem" @click="add(extraItem)">添加</button><span>只添加装备栏内未识别的物品</span></div>
      <div v-if="manual.length" class="manual-tokens"><button v-for="(id,i) in manual" :key="i" :title="'移除 '+itemName(id)" :aria-label="'移除补充装备'+itemName(id)" @click="manual.splice(i,1)"><img :src="dataset.item(id)?.image_path" :alt="itemName(id)"/><span>×</span></button></div>
    </div>
    <MainlineTransitionsPanel v-if="mainline" :comp="mainline" :level="input.level" :owned="input.units" :known="input.localComplete" :shop="status?.cards.shopReady?status.cards.shop.flatMap(c=>c?.known&&c.kind!=='wisp'?[normalizeShopHero(c.id)]:[]):[]" @select="emit('selectTransition',$event)"/>
    <div v-if="!result.ready" class="smart-empty"><span>◈</span><h2>{{ result.message }}</h2><button v-if="!status||['stopped','error'].includes(status.phase)" class="primary" data-advisor-start @click="emit('start')">连接对局</button></div>
    <template v-else>
      <DirectionPanel :advice="battle?.direction" :selected-key="selectedKey" :selected-direction-id="selectedDirectionId" :budget="preferences.searchBudget" @select-comp="(key,id)=>emit('selectComp',key,id)" @budget="preferences={...preferences,searchBudget:$event}"/>
      <div v-if="battle?.direction&&!battle.direction.ready&&battle.direction.unsupported" class="notice">{{ battle.direction.reason }}</div>
      <EarlyHoldPanel v-if="!selectedKey&&holds.ready" :advice="holds" :focused="preferences.boardId" @stage="preferences={...preferences,stage:$event,boardId:null}" @focus="preferences={...preferences,boardId:$event}"/>
      <ShoppingTacticsPanel :advice="battle?.tactics"/>
      <StrategicOptionsPanel :advice="battle?.strategy"/>
      <div v-if="!battle?.direction?.ready&&!battle?.direction?.unsupported" class="smart-summary"><span><i/>基础候选参考</span><small>适配度 ≠ 胜率</small></div>
      <div v-if="!battle?.direction?.ready&&!battle?.direction?.unsupported" class="suggestion-grid">
        <article v-for="(r,index) in top" :key="r.key" class="suggestion-card" :class="{leading:index===0,selected:r.key===selectedKey}" :data-suggestion="r.key">
          <header><span class="suggestion-rank">0{{ index+1 }}</span><span class="fit-score" :title="scoreLabel(r)">适配 <b>{{ r.score }}</b></span></header>
          <h2>{{ r.name }}</h2><div class="suggestion-stats"><span>均名 <b>{{ r.avgPlace.toFixed(2) }}</b></span><span>{{ r.games.toLocaleString() }} 场</span></div>
          <div class="suggestion-units"><span v-for="id in r.units" :key="id" :class="['cost-'+dataset.characterById(id)?.cost,{owned:r.keep.includes(id)}]" :title="name(id)+(r.keep.includes(id)?' · 已持有':'')"><img :src="portrait(id)" :alt="name(id)"/></span></div>
          <div class="suggestion-reasons"><span v-for="reason in r.reasons.slice(0,2)" :key="reason">{{ reason }}</span><span v-if="r.blockedThree.length" class="risk">追三空间不足</span></div>
          <footer><button class="inspect" :aria-expanded="detail===r.key" @click="detail=detail===r.key?null:r.key">看衔接 <span>{{ detail===r.key?'−':'↗' }}</span></button><button :class="{chosen:r.key===selectedKey}" :data-advisor-pick="r.key" @click="emit('selectComp',r.key)">{{ r.key===selectedKey?'已选用':'选用阵容' }}</button></footer>
        </article>
      </div>
      <section v-if="inspected" class="suggestion-detail" data-advisor-detail>
        <header><h2>{{ inspected.name }}</h2><button aria-label="关闭衔接详情" @click="detail=null">×</button></header>
        <div class="detail-columns"><div><h3>保留</h3><div class="detail-unit-strip"><span v-for="id in inspected.keep" :key="id"><img :src="portrait(id)" :alt="name(id)"/><small>{{ name(id) }}</small></span><p v-if="!inspected.keep.length">当前牌以过渡使用</p></div><h3>优先补齐</h3><div class="detail-unit-strip"><span v-for="id in inspected.missing.slice(0,4)" :key="id"><img :src="portrait(id)" :alt="name(id)"/><small>{{ name(id) }}</small></span></div></div><div><h3>当前可衔接的出装</h3><div v-for="b in inspected.equipment" :key="b.unit" class="equipment-plan"><span>{{ name(b.unit) }}</span><img v-for="(id,i) in b.items" :key="id+i" :src="dataset.item(id)?.image_path" :alt="itemName(id)" :title="itemName(id)"/><small>{{ b.sample.toLocaleString() }} 场</small></div><p class="detail-note">过渡英雄的装备需出售后转移，保留英雄上的装备不会重复分配。</p></div><div><h3>推荐依据</h3><div class="score-bars"><div v-for="(value,key) in inspected.components" :key="key"><span>{{ {board:'持牌衔接',items:'装备适配',meta:'版本表现',contested:'同行空间'}[key] }}</span><i><b :style="{width:(value??0)+'%'}"/></i><small>{{ value??'—' }}</small></div></div><p class="detail-note" v-if="inspected.crowded.length">{{ inspected.crowded.map(name).join('、') }}：其他玩家共持有 {{ inspected.rivals }} 张核心牌。</p><p class="detail-note" v-if="inspected.blockedThree.length">{{ inspected.blockedThree.map(name).join('、') }} 追三受限，可保留二星或考虑转型。</p></div></div>
      </section>
      <footer class="advisor-provenance"><span>MetaTFT · {{ stamp }} · {{ result.rows.length }} 套阵容</span><span title="关键节点控制器使用真实聚合关联与明确机制，尚待实局效果校准。">决策原型 · 实局待校准</span></footer>
    </template>
  </section>
</template>
<style scoped>
.smart-panel{max-width:1440px;margin:auto}.smart-heading{display:flex;align-items:center;justify-content:space-between;margin:8px 0 23px;gap:20px}.smart-eyebrow{color:#777b82;font-size:9px;letter-spacing:2px}.smart-heading h1{font-size:36px;margin:5px 0 0;letter-spacing:-1px}.input-status{display:flex;align-items:center;gap:15px;font-size:11px;color:#828995}.input-status button{border-color:#4c4435;color:#cbb58f;background:#24221d;padding:7px 11px;font-size:11px}.input-status b{font-weight:400;margin-left:8px}.smart-summary{display:flex;align-items:center;justify-content:space-between;color:#969f9e;font-size:11px;margin-bottom:14px}.smart-summary>span{display:flex;gap:8px;align-items:center}.smart-summary i{width:5px;height:5px;background:#85a994;border-radius:50%}.smart-summary small{font-size:10px;color:#666e7e}.suggestion-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.suggestion-card{border:1px solid #292d33;border-radius:8px;background:linear-gradient(145deg,#1a1d23,#12151b);padding:21px 20px 16px;min-width:0;display:flex;flex-direction:column}.suggestion-card.leading{border-color:#726043;background:linear-gradient(145deg,#292821,#14181e 78%)}.suggestion-card.selected{box-shadow:inset 0 0 0 1px #c9ad7359}.suggestion-card>header{display:flex;align-items:center;justify-content:space-between}.suggestion-rank{font:11px "Segoe UI",sans-serif;color:#7b7c78;letter-spacing:1px}.fit-score{color:#8e938d;font-size:10px}.fit-score b{font-size:24px;font-weight:500;color:#c7b38c;line-height:1;margin-left:5px;font-variant-numeric:tabular-nums}.suggestion-card h2{font-size:18px;margin:20px 0 6px;color:#e4e2dc;font-weight:600;letter-spacing:.2px;line-height:1.5}.suggestion-stats{display:flex;gap:15px;color:#666f7c;font-size:10px}.suggestion-stats b{color:#b9b6ad;font-weight:500;margin-left:3px}.suggestion-units{display:flex;gap:5px;flex-wrap:wrap;margin:24px 0 20px;min-height:36px}.suggestion-units>span{width:30px;height:30px;border:1px solid #49505d;border-radius:3px;overflow:hidden;opacity:.36;filter:saturate(.4)}.suggestion-units img{display:block;width:100%;height:100%;object-fit:cover}.suggestion-units .owned{opacity:1;filter:none;border-color:#bca77a;box-shadow:0 0 0 1px #bca77a33}.suggestion-reasons{font-size:10px;color:#919a9e;display:flex;flex-direction:column;gap:6px;min-height:44px;line-height:1.6}.suggestion-reasons .risk{color:#d19e7b}.suggestion-card>footer{border-top:1px solid #ffffff08;margin-top:24px;padding-top:16px;display:flex;justify-content:space-between;gap:10px;align-items:center}.suggestion-card>footer button{font-size:11px;padding:7px 13px;background:#b7a077;border-color:#b7a077;color:#15191e}.suggestion-card>footer button.chosen{background:#292b25;color:#baa984;border-color:#4a4738}.suggestion-card>footer .inspect{background:none;border:0;color:#737d88;padding:5px 0}.inspect span{margin-left:9px;color:#a39b88}.manual-inventory{background:#171c23;border:1px solid #30343c;padding:16px;border-radius:7px;margin-bottom:22px}.component-picker{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.component-picker button{position:relative;padding:0;border:1px solid #49505b;border-radius:3px;width:34px;height:34px;background:#232a32}.component-picker img{width:100%;height:100%;display:block;object-fit:cover}.component-picker b{position:absolute;bottom:-5px;right:-5px;background:#b9a375;color:#14181f;min-width:15px;height:15px;font-size:9px;border-radius:3px}.component-picker .clear-items{margin-left:auto;width:auto;border:0;background:none;font-size:10px;color:#7d8696}.extra-items{display:flex;gap:8px;align-items:center;margin-top:16px}.extra-items select,.extra-items button{font-size:11px;padding:5px 8px}.extra-items>span{font-size:10px;color:#647180;margin-left:auto}.manual-tokens{display:flex;gap:5px;margin-top:12px;flex-wrap:wrap}.manual-tokens button{position:relative;width:26px;height:26px;padding:0;border-radius:2px}.manual-tokens img{width:100%;height:100%}.manual-tokens span{position:absolute;right:-1px;top:-4px;font-size:10px;background:#151c26;color:#c8c6c3;line-height:1}.smart-empty{min-height:380px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;border:1px solid #242b35;background:#14181e;border-radius:9px}.smart-empty>span{font-size:32px;color:#776b51}.smart-empty h2{color:#8c96a1;font-size:14px;font-weight:400}.smart-empty button{font-size:11px}.advisor-provenance{display:flex;justify-content:space-between;font-size:9px;color:#555f6d;margin-top:22px}.suggestion-detail{padding:22px;background:#151a22;border:1px solid #303844;border-radius:7px;margin-top:20px}.suggestion-detail>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.suggestion-detail h2{font-size:15px;margin:0;color:#c5bdac}.suggestion-detail>header button{border:0;background:none;font-size:17px;padding:0 4px;color:#7e8594}.detail-columns{display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:24px}.detail-columns h3{font-size:11px;font-weight:500;margin:12px 0;color:#a7afbc}.detail-unit-strip{display:flex;gap:8px;flex-wrap:wrap}.detail-unit-strip>span{display:flex;flex-direction:column;align-items:center;gap:4px}.detail-unit-strip img{width:30px;height:30px;border:1px solid #48525e;border-radius:3px}.detail-unit-strip small{font-size:9px;color:#7c8798}.detail-unit-strip p,.detail-note{font-size:10px;color:#5f6c7f;line-height:1.9}.equipment-plan{display:flex;align-items:center;gap:5px;margin-bottom:8px}.equipment-plan>span{font-size:10px;color:#929caa;min-width:47px}.equipment-plan img{width:24px;height:24px;border:1px solid #414a57}.equipment-plan small{margin-left:auto;color:#5f6b7e;font-size:9px;white-space:nowrap}.score-bars>div{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:10px;color:#7d8a9b}.score-bars i{flex:1;height:3px;border-radius:3px;background:#242d38;overflow:hidden}.score-bars b{display:block;height:100%;background:#a29576}.score-bars small{width:20px;text-align:right;font-size:10px;color:#afb3b3}@media(max-width:1180px){.suggestion-card{padding:17px 14px}.suggestion-card h2{font-size:15px}.suggestion-grid{gap:11px}.suggestion-units>span{width:25px;height:25px}.detail-columns{grid-template-columns:1fr 1fr}.detail-columns>div:last-child{grid-column:1/-1}.input-status{gap:9px;font-size:10px}}
</style>
