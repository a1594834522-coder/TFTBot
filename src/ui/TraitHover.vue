<script setup lang="ts">
/** 羁绊悬浮卡（重写 trait-hover 组件），带层级进度 */
import { computed } from 'vue';
import { dataset } from '../game/tft-data';

const props = withDefaults(
  defineProps<{
    traitId: string;
    /** 当前场上该羁绊人数 */
    count?: number;
    /** 层级断点（默认 2/4/6/8，可按羁绊覆盖） */
    breakpoints?: number[];
    minimal?: boolean;
  }>(),
  { count: 0, breakpoints: () => [2, 4, 6, 8], minimal: false },
);

const trait = computed(() => dataset.trait(props.traitId) ?? null);

/** 当前层级 / 下一档：人数 ≥ 断点即达成 */
const tiers = computed(() => {
  const bps = [...props.breakpoints].sort((a, b) => a - b);
  const active = bps.filter((b) => props.count >= b).length;
  const next = bps[active] ?? null;
  return { bps, active, next };
});

/** 达成人数：把 description 里的 (n) 段落切出来展示 */
const segments = computed(() => {
  const desc = trait.value?.description ?? '';
  if (!desc) return [];
  return desc
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
});
</script>

<template>
  <div v-if="trait" class="tr" :data-trait-id="trait.trait_id" :data-count="count">
    <header class="tr-head">
      <img v-if="trait.image_path" class="tr-icon" :src="trait.image_path" :alt="trait.display_name" loading="lazy" />
      <span class="tr-name">{{ trait.display_name }}</span>
      <span v-if="count" class="tr-count">{{ count }}</span>
    </header>

    <ul v-if="!minimal" class="tr-tiers">
      <li v-for="(bp, i) in tiers.bps" :key="bp" :class="{ active: i < tiers.active }">{{ bp }}</li>
      <li v-if="tiers.next" class="tr-next">再 {{ tiers.next - count }} 人</li>
    </ul>

    <ul v-if="!minimal && segments.length" class="tr-desc">
      <li v-for="(s, i) in segments" :key="i">{{ s }}</li>
    </ul>
  </div>
  <div v-else class="tr tr-empty">未知羁绊：{{ traitId }}</div>
</template>

<style scoped>
.tr {
  width: 260px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #11151c;
  color: #e6e6e6;
  font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
  border: 1px solid #232a35;
}
.tr-head { display: flex; align-items: center; gap: 8px; }
.tr-icon { width: 28px; height: 28px; border-radius: 4px; }
.tr-name { font-size: 13px; font-weight: 600; flex: 1; }
.tr-count { background: #2563eb; border-radius: 4px; padding: 0 6px; }
.tr-tiers { display: flex; gap: 6px; list-style: none; padding: 6px 0 0; margin: 0; align-items: center; }
.tr-tiers li { color: #6b7280; border: 1px solid #2b3444; border-radius: 4px; padding: 0 6px; }
.tr-tiers li.active { color: #0b0f14; background: #fbbf24; border-color: #fbbf24; font-weight: 700; }
.tr-next { color: #9aa4b2; border-style: dashed; }
.tr-desc { margin: 6px 0 0; padding-left: 14px; color: #b6c2d1; }
.tr-desc li { margin: 2px 0; }
.tr-empty { color: #f87171; }
</style>
