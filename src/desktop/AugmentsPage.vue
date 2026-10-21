<script setup lang="ts">
import { computed, ref } from 'vue';
import { AUGMENT_TIERS, type AugmentTierSnapshot } from '../game/metatft-augments';
import { iconUrl } from '../core/metatft';
const props = defineProps<{ snapshot: AugmentTierSnapshot; set: number; loading: boolean; error: string }>();
defineEmits<{ (event: 'refresh'): void }>();
const search = ref('');
const tier = ref('all');
const rarity = ref('all');
const rows = computed(() => props.snapshot.set !== props.set ? [] : props.snapshot.augments.filter((a) =>
  (tier.value === 'all' || a.rating === tier.value) && (rarity.value === 'all' || a.rarity === rarity.value) &&
  (a.name + ' ' + a.id).toLowerCase().includes(search.value.trim().toLowerCase()),
));
const updated = computed(() => props.snapshot.updatedAt ? new Date(props.snapshot.updatedAt).toLocaleString('zh-CN') : '未知');
</script>
<template>
  <div class="augments-page" data-desktop-view="augments">
    <div class="page-heading"><div><h1>海克斯评级</h1><p>MetaTFT 作者评级 · {{ snapshot.author }} · {{ snapshot.patch }} · S{{ snapshot.set }}</p></div><button class="primary" :disabled="loading" @click="$emit('refresh')">{{ loading ? '正在更新…' : '更新 MetaTFT 评级' }}</button></div>
    <div class="augment-note"><span>作者评级 · 不等同于统计胜率</span><span>更新 {{ updated }}</span></div>
    <p v-if="error" class="error">{{ error }}；继续使用已有快照。</p>
    <p v-if="set !== snapshot.set" class="notice">当前快照适用于 S{{ snapshot.set }}，与最新赛季不符，暂不展示。</p>
    <div class="filters"><input v-model="search" aria-label="搜索海克斯" placeholder="搜索海克斯名称" /><select v-model="rarity" aria-label="海克斯品质"><option value="all">全部品质</option><option value="Silver">银色</option><option value="Gold">金色</option><option value="Prismatic">彩色</option></select><button v-for="t in ['all', ...AUGMENT_TIERS]" :key="t" :class="{ active: tier === t }" @click="tier = t">{{ t === 'all' ? '全部评级' : t }}</button><span>{{ rows.length }} 项</span></div>
    <div class="augment-grid"><article v-for="a in rows" :key="a.id" class="augment-card" :data-rating="a.rating"><img :src="iconUrl('augments', a.id)" alt="" loading="lazy" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" /><div><strong>{{ a.name }}</strong><small>{{ a.rarity === 'Silver' ? '银色' : a.rarity === 'Gold' ? '金色' : a.rarity === 'Prismatic' ? '彩色' : '海克斯' }}</small></div><b class="tier-rating">{{ a.rating }}</b></article></div>
  </div>
</template>
<style scoped>
.filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:20px 0}.filters input{flex:1;min-width:220px}.filters span{color:var(--muted);margin-left:auto}.augment-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}.augment-card{display:flex;gap:12px;align-items:center;padding:16px;border:1px solid #ffffff0e;border-radius:7px;background:var(--surface)}.augment-card img{width:42px;height:42px;object-fit:contain}.augment-card strong{font-size:13px;font-weight:500}.augment-card small{display:block;color:var(--muted);margin-top:4px;font-size:11px}.tier-rating{font-size:22px;color:#efc887;margin-left:auto}[data-rating=S] .tier-rating{color:var(--clay)}[data-rating=A] .tier-rating{color:var(--gold)}
.augment-note{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-top:1px solid #ffffff0a;border-bottom:1px solid #ffffff0a;font-size:11px;color:var(--muted)}.filters input{background:var(--surface)}.filters button{font-size:12px;padding:7px 11px;background:#ffffff02;border-color:#ffffff0c}.filters button.active{color:var(--text);background:#bcb8ac10;border-color:#bcb8ac30}.filters span{font-size:11px}.augment-card:hover{border-color:#bcb8ac30;background:var(--surface)}
</style>
