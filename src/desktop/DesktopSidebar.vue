<script setup lang="ts">
import NavigationIcon from './NavigationIcon.vue';
import {version} from '../../package.json';
defineProps<{view:string;set:number;preview?:boolean}>();
defineEmits<{navigate:[view:'comps'|'advisor'|'augments'|'board'|'settings']}>();
const items=[{id:'comps',name:'热门阵容'},{id:'augments',name:'海克斯评级'},{id:'board',name:'对局面板'},{id:'settings',name:'偏好设置'}] as const;
</script>
<template><aside class="desktop-sidebar">
  <div class="app-brand"><strong>TFTBot<small>云顶助手</small></strong></div>
  <nav class="desktop-nav" aria-label="主导航"><button v-for="item in items" :key="item.id" :data-nav="item.id" :class="{current:view===item.id}" :disabled="preview&&!['comps','advisor'].includes(item.id)" :aria-current="view===item.id?'page':undefined" @click="$emit('navigate',item.id)"><NavigationIcon :name="item.id"/><span>{{ item.name }}</span></button></nav>
  <div class="sidebar-bottom"><div class="season-card"><span>当前赛季</span><strong>S{{ set }}</strong></div><span class="sidebar-version">MetaTFT <small>v{{ version }}</small></span></div>
</aside></template>
