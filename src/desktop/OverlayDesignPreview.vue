<script setup lang="ts">
import { computed, ref } from 'vue';
import CompanionOverlay from './CompanionOverlay.vue';
import { resolveSelectedComp } from '../game/selected-comp';
import type { ReaderStatus } from '../recognition/status';
import { shopCatalog } from '../game/shop-mechanics';
import { buildSnapshot } from '../game/roster';
const key='metatft:metatft:426:426021';
const comp=ref(resolveSelectedComp(key));
const mode=ref('live'),state=ref({visible:true,locked:false,collapsed:false});
const status=computed<ReaderStatus>(()=>{
  const roster=Array.from({length:8},(_,i)=>({summoner:'示例'+i,tag_line:'',index:i,health:80-i*7}));
  const players=roster.map((p,i)=>({summoner:p.summoner,tag_line:'',coverage:mode.value==='partial'&&i===7?'partial' as const:'full' as const,champions:shopCatalog.filter((_,j)=>j%8===i).map((h,j)=>({name:h.character_id,num:(j*3+i)%8,level:1}))}));
  return {phase:'receiving',message:'设计预览示例数据',transport:'original-native',testMode:true,frames:1,lastFrameAt:Date.now(),cards:{shop:[],augments:[],pickedAugment:null,shopReady:true,augmentsReady:false,level:7},tracker:{revision:1,snapshot:buildSnapshot(roster,players)}};
});
function transition(id:string|null){comp.value=resolveSelectedComp(key,id);}
function action(a:string){if(a==='collapse'||a==='expand')state.value.collapsed=a==='collapse';if(a==='lock'||a==='unlock')state.value.locked=a==='lock';if(a==='hide')state.value.visible=false;}
function change(next:string){mode.value=next;comp.value=next==='empty'?null:resolveSelectedComp(key);state.value={visible:true,locked:false,collapsed:false};}
</script>
<template>
  <div class="design-preview">
    <header class="preview-header"><span class="preview-brand">◈ <b>TFTBot</b></span><span>局内记牌器 <i>/</i> 设计预览</span><small>示例数据 · 7级</small></header>
    <div class="preview-stage">
      <div class="stage-grid" aria-hidden="true"/>
      <div class="preview-caption"><span>更少干扰，更快决策</span><h1>只留下你要的牌。</h1></div>
      <div class="hud-preview-wrap" :class="{collapsed:state.collapsed}" v-if="state.visible"><CompanionOverlay :comp="comp" :status="status" :state="state" @action="action" @transition="transition"/></div>
      <button v-else class="restore-preview" @click="state.visible=true">显示浮窗</button>
      <nav class="preview-modes" aria-label="预览状态"><button v-for="m in [{id:'live',name:'完整数据'},{id:'partial',name:'明细未齐'},{id:'empty',name:'未选阵容'}]" :key="m.id" :class="{chosen:mode===m.id}" @click="change(m.id)">{{ m.name }}</button></nav>
      <p class="preview-hint">切换过渡 · 悬停查看金币 · 点击固定详情</p>
    </div>
    <footer class="preview-footer"><span>01 / COMPACT COMPANION</span><span>584 × 248</span></footer>
  </div>
</template>
<style scoped>
.design-preview{min-height:100vh;overflow:auto;background:#0b1015;color:#d7dbdf;font:12px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}.preview-header{height:78px;display:flex;align-items:center;gap:37px;padding:0 54px;border-bottom:1px solid #ffffff07;color:#65707b;font-size:11px}.preview-header small{margin-left:auto;font-size:10px;color:#6e7d84}.preview-header i{font-style:normal;margin:0 12px;color:#35414d}.preview-brand{display:flex;align-items:center;gap:10px;font-size:24px;color:#c7ae81}.preview-brand b{font-size:13px;color:#cdd1d4;font-weight:500;letter-spacing:.6px}.preview-stage{min-height:640px;height:calc(100vh - 134px);position:relative;display:flex;align-items:center;flex-direction:column;justify-content:center;isolation:isolate;background:radial-gradient(ellipse at 50% 48%,#26373228,transparent 63%)}.stage-grid{position:absolute;z-index:-1;top:28%;width:850px;height:330px;transform:perspective(650px) rotateX(57deg);background-image:linear-gradient(#748f8612 1px,transparent 1px),linear-gradient(90deg,#748f8612 1px,transparent 1px);background-size:60px 60px;mask-image:radial-gradient(ellipse,#000,transparent 68%)}.preview-caption{width:584px;margin-bottom:32px}.preview-caption>span{font-size:10px;letter-spacing:3px;color:#6b7c7d}.preview-caption h1{font-size:30px;font-weight:400;letter-spacing:1px;margin:8px 0;color:#c8cece}.hud-preview-wrap{width:584px;height:248px;box-shadow:0 35px 100px #0008;border-radius:10px}.hud-preview-wrap.collapsed{height:42px;margin-bottom:206px}.preview-modes{display:flex;gap:4px;margin-top:36px;padding:4px;background:#11181f;border:1px solid #ffffff06;border-radius:7px}.preview-modes button,.restore-preview{font:inherit;font-size:10px;border:0;border-radius:4px;padding:7px 14px;background:none;color:#63717d;cursor:pointer}.preview-modes button.chosen{color:#baaa88;background:#242a2e}.preview-modes button:hover{color:#d3cab7}.preview-hint{font-size:10px;color:#45535d;letter-spacing:1px;margin:14px 0 0}.preview-footer{display:flex;justify-content:space-between;height:56px;padding:18px 54px;font-size:9px;letter-spacing:2px;color:#3c4b55;border-top:1px solid #ffffff06}
</style>
