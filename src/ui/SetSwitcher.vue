<script setup lang="ts">
/**
 * 赛季切换器 —— 受控芯片组（`currentSet` + `emit('change')`）。
 *
 * 本实现是在主窗口里一组小按钮；这里做成通用组件，
 * 数据来自 `supportSets`（lean 的 dataset 里就有 16/17/18）。
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    supportSets: number[];
    currentSet: number;
    /** 紧凑模式（只显示数字） */
    compact?: boolean;
    /** 每个赛季的阵容数量（可选，用来提示数据有没有） */
    counts?: Record<number, number>;
  }>(),
  { compact: false, counts: () => ({}) },
);

const emit = defineEmits<{ (e: 'change', set: number): void }>();

const sets = computed(() => [...props.supportSets].sort((a, b) => a - b));
</script>

<template>
  <div class="sets" :data-current="currentSet" :data-count="sets.length">
    <button
      v-for="s in sets"
      :key="s"
      type="button"
      class="chip"
      :class="{ active: s === currentSet, empty: !counts[s] }"
      :data-set="s"
      :title="counts[s] ? `S${s} · ${counts[s]} 套阵容` : `S${s}`"
      @click="emit('change', s)"
    >
      <template v-if="compact">S{{ s }}</template>
      <template v-else>
        S{{ s }}
        <span v-if="counts[s]" class="n">{{ counts[s] }}</span>
      </template>
    </button>
  </div>
</template>

<style scoped>
.sets { display: flex; gap: 4px; align-items: center; }
.chip {
  background: #131a24;
  border: 1px solid #2b3444;
  color: #cbd5e1;
  border-radius: 4px;
  padding: 1px 7px;
  font: 11px/1.5 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.chip:hover { border-color: #3b82f6; }
.chip.active { background: #2563eb; border-color: #2563eb; color: #fff; }
.chip.empty { opacity: 0.6; }
.n { color: #fbbf24; font-size: 10px; }
.chip.active .n { color: #fef3c7; }
</style>
