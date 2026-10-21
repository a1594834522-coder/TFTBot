<script setup lang="ts">
/**
 * TFT 棋盘（4×7 = 28 格）+ 备战席（9 格）。
 *
 * 对应本实现 trick/tracker 窗口里那块棋盘；这里数据完全由 props 驱动：
 *   champions: [{ character_id, position?, level?, items? }]
 * position 0..27 为棋盘格；28..36 为备战席。
 * 没有 position 的棋子会顺序占空格（本实现也是这么兜底的）。
 */
import { computed } from 'vue';
import BoardSlot from './BoardSlot.vue';

export interface BoardChampion {
  character_id: string;
  position?: number;
  level?: number;
  items?: string[];
}

const props = withDefaults(
  defineProps<{
    champions: BoardChampion[];
    /** 棋盘行数/列数（默认 4×7） */
    rows?: number;
    cols?: number;
    /** 备战席格数 */
    benchSlots?: number;
    /** 追三命中的英雄 id（高亮） */
    highlightIds?: string[];
    /** 是否显示备战席 */
    showBench?: boolean;
    /** 站位热区：格子下标 → 0..1 权重（MetaTFT positioning） */
    heat?: Record<number, number>;
  }>(),
  { rows: 4, cols: 7, benchSlots: 9, highlightIds: () => [], showBench: true, heat: () => ({}) },
);

const emit = defineEmits<{ (e: 'select', id: string, slot: number): void }>();

const boardSize = computed(() => props.rows * props.cols);

/** 把 champions 摆到格子上：先按 position，冲突/缺失的按顺序填空 */
const placed = computed(() => {
  const map = new Map<number, BoardChampion>();
  const pending: BoardChampion[] = [];
  for (const c of props.champions) {
    const pos = c.position;
    if (typeof pos === 'number') {
      if (pos >= 0 && pos < boardSize.value) {
        // 棋盘范围内的按 position 落位
        if (map.has(pos)) pending.push(c);
        else map.set(pos, c);
      } else if (pos >= boardSize.value && pos < boardSize.value + props.benchSlots) {
        // 备战席由 bench 处理，不参与棋盘填空
      } else {
        // 非法 position：不要丢棋子，按顺序补到棋盘空格
        pending.push(c);
      }
      continue;
    }
    pending.push(c);
  }
  let i = 0;
  for (let slot = 0; slot < boardSize.value && i < pending.length; slot++) {
    if (!map.has(slot)) map.set(slot, pending[i++]);
  }
  return map;
});

const bench = computed(() => {
  const map = new Map<number, BoardChampion>();
  const start = boardSize.value;
  for (const c of props.champions) {
    if (typeof c.position === 'number' && c.position >= start && c.position < start + props.benchSlots) {
      map.set(c.position - start, c);
    }
  }
  return map;
});

const isHighlighted = (id?: string | null) => !!id && props.highlightIds.includes(id);
</script>

<template>
  <div class="board" :data-rows="rows" :data-cols="cols">
    <div class="grid" :style="{ gridTemplateColumns: `repeat(${cols}, 64px)` }">
      <BoardSlot
        v-for="slot in boardSize"
        :key="'b' + slot"
        :slot="slot - 1"
        :character-id="placed.get(slot - 1)?.character_id ?? null"
        :level="placed.get(slot - 1)?.level ?? 1"
        :items="placed.get(slot - 1)?.items ?? []"
        :highlight="isHighlighted(placed.get(slot - 1)?.character_id)"
        :heat="heat[slot - 1] ?? 0"
        @select="(id) => emit('select', id, slot - 1)"
      />
    </div>

    <div v-if="showBench" class="grid bench" :style="{ gridTemplateColumns: `repeat(${benchSlots}, 64px)` }">
      <BoardSlot
        v-for="slot in benchSlots"
        :key="'n' + slot"
        bench
        :slot="boardSize + slot - 1"
        :character-id="bench.get(slot - 1)?.character_id ?? null"
        :level="bench.get(slot - 1)?.level ?? 1"
        :items="bench.get(slot - 1)?.items ?? []"
        :highlight="isHighlighted(bench.get(slot - 1)?.character_id)"
        :heat="heat[boardSize + slot - 1] ?? 0"
        @select="(id) => emit('select', id, boardSize + slot - 1)"
      />
    </div>
  </div>
</template>

<style scoped>
.board { display: flex; flex-direction: column; gap: 8px; }
.grid { display: grid; gap: 6px; }
.bench { padding-top: 8px; border-top: 1px dashed #232a35; }
</style>
