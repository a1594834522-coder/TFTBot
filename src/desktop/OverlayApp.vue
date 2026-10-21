<script setup lang="ts">
import { onMounted,onUnmounted,shallowRef,ref } from 'vue';
import type {SelectedComp} from '../game/selected-comp';
import type {ReaderStatus} from '../recognition/status';
import CompanionOverlay from './CompanionOverlay.vue';
import {createCompAdvisor} from '../game/comp-advisor';
import {metatftComps} from '../game/comps-sources';
import {defaultAdvisorPreferences} from '../game/advisor-preferences';
import {computed} from 'vue';
import type {BattleForecast} from '../game/battle-forecast';
import {resolveHoldAdvice} from '../game/resolve-hold-advice';
const battle=shallowRef<BattleForecast|null>(null);
const comp=shallowRef<SelectedComp|null>(null),status=shallowRef<ReaderStatus|null>(null);
const state=ref({visible:true,locked:false,collapsed:false});
const preferences=ref(defaultAdvisorPreferences()),advisor=createCompAdvisor(metatftComps(18));
const holds=computed(()=>resolveHoldAdvice(battle.value?.direction,advisor.evaluate(status.value,preferences.value.items,Date.now(),preferences.value.stage,preferences.value.boardId).holds,preferences.value));
const error=ref('');const off:Array<()=>void>=[];
async function action(a:Parameters<typeof window.tftDesktop.overlay>[0]){state.value=await window.tftDesktop.overlay(a);}
async function transition(id:string|null){try{comp.value=await window.tftDesktop.selectTransition(id);error.value='';}catch(e){error.value=String(e);}}
async function focus(boardId:string|null){try{preferences.value=await window.tftDesktop.configureAdvisor({...preferences.value,items:[...preferences.value.items],boardId});error.value='';}catch(e){error.value=String(e);}}
onMounted(async()=>{off.push(window.tftDesktop.onAdvisorPreferences(p=>preferences.value=p));preferences.value=await window.tftDesktop.advisorPreferences();});
onMounted(async()=>{off.push(window.tftDesktop.onBattle(value=>battle.value=value));battle.value=await window.tftDesktop.battleSnapshot();});
onMounted(async()=>{off.push(window.tftDesktop.onSelectedComp(c=>comp.value=c),window.tftDesktop.onReader(s=>status.value=s),window.tftDesktop.onOverlay(s=>state.value=s));comp.value=await window.tftDesktop.selectedComp();status.value=await window.tftDesktop.readerSnapshot();await action('snapshot');});
onUnmounted(()=>off.forEach(f=>f()));
</script>
<template><CompanionOverlay :comp="comp" :status="status" :state="state" :holds="holds" :focused="preferences.boardId" :battle="battle" :title="error||undefined" @action="action" @transition="transition" @focus="focus"/></template>
