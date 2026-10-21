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
    <div class="notice">评级采用 MetaTFT 的 S / A / B / C / D 榜单，属于作者建议，不等同于统计胜率。更新时间：{{ updated }}。名称使用最新赛季中文资料。</div>
    <p v-if="error" class="error">{{ error }}；继续使用已有快照。</p>
    <p v-if="set !== snapshot.set" class="notice">当前快照适用于 S{{ snapshot.set }}，与最新赛季不符，暂不展示。</p>
    <div class="filters"><input v-model="search" placeholder="搜索海克斯名称或 ID" /><select v-model="rarity"><option value="all">全部品质</option><option value="Silver">银色</option><option value="Gold">金色</option><option value="Prismatic">彩色</option></select><button v-for="t in ['all', ...AUGMENT_TIERS]" :key="t" :class="{ active: tier === t }" @click="tier = t">{{ t === 'all' ? '全部评级' : t }}</button><span>{{ rows.length }} 项</span></div>
    <div class="augment-grid"><article v-for="a in rows" :key="a.id" class="augment-card" :data-rating="a.rating"><img :src="iconUrl('augments', a.id)" alt="" loading="lazy" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" /><div><strong>{{ a.name }}</strong><small>{{ a.rarity === 'Silver' ? '银色' : a.rarity === 'Gold' ? '金色' : a.rarity === 'Prismatic' ? '彩色' : '海克斯' }}</small></div><b class="tier-rating">{{ a.rating }}</b></article></div>
  </div>
</template>
<style scoped>
.filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:20px 0}.filters input{flex:1;min-width:220px}.filters span{color:#8391a5;margin-left:auto}.augment-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}.augment-card{display:flex;gap:12px;align-items:center;padding:16px;border:1px solid #263145;border-radius:12px;background:#121a28}.augment-card img{width:42px;height:42px;object-fit:contain}.augment-card strong{font-size:13px}.augment-card small{display:block;color:#8391a5;margin-top:6px}.tier-rating{font-size:22px;color:#efc887;margin-left:auto}[data-rating=S] .tier-rating{color:#ff8c97}[data-rating=A] .tier-rating{color:#e0b97a}
</style>
