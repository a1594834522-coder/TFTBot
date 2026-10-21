<script setup lang="ts">
/**
 * 段位徽标 —— 展示 core/rank 的 `RankEntryView`（tier/division/lp/winRate）。
 * 未定级或拿不到数据时显示"未定级"，不抛错（本实现 LCU 挂了会空白）。
 */
import { computed } from 'vue';
import type { RankEntryView } from '../core/rank';

const props = withDefaults(
  defineProps<{
    entry?: RankEntryView | null;
    /** 只显示段位，不显示胜率/战绩 */
    compact?: boolean;
  }>(),
  { entry: null, compact: false },
);

const TIER_COLOR: Record<string, string> = {
  IRON: '#6b7280',
  BRONZE: '#a16207',
  SILVER: '#94a3b8',
  GOLD: '#f59e0b',
  PLATINUM: '#22d3ee',
  EMERALD: '#10b981',
  DIAMOND: '#3b82f6',
  MASTER: '#a855f7',
  GRANDMASTER: '#ef4444',
  CHALLENGER: '#fbbf24',
  UNRANKED: '#4b5563',
};

const tier = computed(() => props.entry?.tier ?? 'UNRANKED');
const color = computed(() => TIER_COLOR[tier.value] ?? '#6b7280');
const label = computed(() => props.entry?.label ?? '未定级');
const winRate = computed(() => (props.entry?.winRate ? Math.round(props.entry.winRate * 100) : 0));
const record = computed(() => (props.entry ? `${props.entry.wins}W ${props.entry.losses}L` : ''));
</script>

<template>
  <div class="rank" :data-tier="tier" :data-queue="entry?.queue ?? ''" :data-lp="entry?.lp ?? 0">
    <span class="badge" :style="{ borderColor: color, color }">{{ label }}</span>
    <template v-if="!compact && entry">
      <span class="win" :data-win-rate="winRate">{{ winRate }}%</span>
      <span class="rec">{{ record }}</span>
    </template>
  </div>
</template>

<style scoped>
.rank { display: inline-flex; align-items: center; gap: 8px; font: 11px/1.5 ui-sans-serif, system-ui, sans-serif; }
.badge { border: 1px solid; border-radius: 4px; padding: 0 6px; font-weight: 600; }
.win { color: #93c5fd; }
.rec { color: #6b7280; }
</style>
