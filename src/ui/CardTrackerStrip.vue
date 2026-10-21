<script setup lang="ts">
/**
 * 记牌器横条 —— 本实现棋盘下方那排「剩余张数」。
 * 输入就是 core/cardTracker 的输出行，纯展示。
 */
import { computed } from 'vue';
import { dataset } from '../game/tft-data';

export interface TrackerRow {
  champion: string;
  cost?: number | null;
  owned?: number;
  remaining: number;
}

const props = withDefaults(
  defineProps<{
    rows: TrackerRow[];
    /** 最多显示几行（默认 12） */
    limit?: number;
    /** 只看这些费用 */
    costs?: number[];
  }>(),
  { limit: 12, costs: () => [] },
);

const visible = computed(() => {
  const filtered = props.costs.length ? props.rows.filter((r) => (r.cost ?? 0) > 0 && props.costs.includes(r.cost as number)) : props.rows;
  return [...filtered].sort((a, b) => a.remaining - b.remaining).slice(0, props.limit);
});

const nameOf = (id: string) => dataset.characterById(id)?.display_name ?? id;
const imageOf = (id: string) => dataset.characterById(id)?.image_path ?? '';
</script>

<template>
  <div class="strip" :data-count="visible.length">
    <span v-if="!visible.length" class="strip-empty">记牌器：暂无数据</span>
    <div v-for="row in visible" :key="row.champion" class="cell" :data-champion="row.champion" :data-remaining="row.remaining">
      <img v-if="imageOf(row.champion)" class="cell-icon" :src="imageOf(row.champion)" :alt="nameOf(row.champion)" loading="lazy" />
      <span class="cell-num" :class="{ low: row.remaining <= 2 }">{{ row.remaining }}</span>
      <span class="cell-name">{{ nameOf(row.champion) }}</span>
    </div>
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #0e141c;
  border: 1px solid #232a35;
  color: #e6e6e6;
  font: 11px/1.2 ui-sans-serif, system-ui, sans-serif;
  overflow: hidden;
}
.strip-empty { color: #6b7280; }
.cell { position: relative; display: flex; flex-direction: column; align-items: center; gap: 1px; width: 44px; }
.cell-icon { width: 26px; height: 26px; border-radius: 4px; object-fit: cover; }
.cell-num { font-weight: 700; color: #93c5fd; }
.cell-num.low { color: #f87171; }
.cell-name { max-width: 44px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9aa4b2; font-size: 9px; }
</style>
