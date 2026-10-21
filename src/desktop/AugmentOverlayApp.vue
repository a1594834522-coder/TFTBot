<script setup lang="ts">
import {computed,shallowRef,onMounted,onUnmounted,ref} from 'vue';
import {highlightedCompUnits} from '../game/selected-comp';
import type {SelectedComp} from '../game/selected-comp';
import type {ReaderStatus} from '../recognition/status';
import {createCompAdvisor} from '../game/comp-advisor';
import {metatftComps} from '../game/comps-sources';
import {defaultAdvisorPreferences} from '../game/advisor-preferences';
import GameAnchors from './GameAnchors.vue';
import type {BattleForecast} from '../game/battle-forecast';
import {resolveHoldAdvice} from '../game/resolve-hold-advice';
const battle=shallowRef<BattleForecast|null>(null);
const status=shallowRef<ReaderStatus|null>(null),comp=shallowRef<SelectedComp|null>(null);
const advisor=createCompAdvisor(metatftComps(18)),preferences=ref(defaultAdvisorPreferences());
const size=ref({width:innerWidth,height:innerHeight});
const resize=()=>{size.value={width:innerWidth,height:innerHeight};};
const holds=computed(()=>resolveHoldAdvice(battle.value?.direction,advisor.evaluate(status.value,preferences.value.items,Date.now(),preferences.value.stage,preferences.value.boardId).holds,preferences.value));
const slots=computed(()=>comp.value?(status.value?.cards.shop??[]).flatMap((c,i)=>c&&highlightedCompUnits(comp.value).includes(c.id)?[i]:[]):holds.value.cards.flatMap(c=>c.shopSlots.slice(0,c.quantity)));
const off:Array<()=>void>=[];
onMounted(async()=>{window.addEventListener('resize',resize);off.push(window.tftDesktop.onSelectedComp(c=>comp.value=c),window.tftDesktop.onReader(s=>status.value=s),window.tftDesktop.onAdvisorPreferences(p=>preferences.value=p));comp.value=await window.tftDesktop.selectedComp();status.value=await window.tftDesktop.readerSnapshot();preferences.value=await window.tftDesktop.advisorPreferences();});
onMounted(async()=>{off.push(window.tftDesktop.onBattle(value=>battle.value=value));battle.value=await window.tftDesktop.battleSnapshot();});
onUnmounted(()=>{off.forEach(f=>f());window.removeEventListener('resize',resize);});
</script>
<template><GameAnchors :status="status" :width="size.width" :height="size.height" :highlighted-slots="slots"/></template>
