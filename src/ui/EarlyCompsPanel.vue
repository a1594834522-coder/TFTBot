<script setup lang="ts">
/**
 * 前期棋盘聚类面板（MetaTFT tft-early-comps）。
 * 回答「现在这个阶段该往哪套走」：按阶段（2-1~5-x）列出常见棋盘 + 平均名次 + 吃鸡率。
 *
 * 阶段整体 matchup_winrate 为 0.5，具体棋盘另有历史对战胜率。
 * 当前组件的 win 仍展示最终吃鸡率，不与对战胜率混淆。
 */
import { computed, ref } from 'vue';
import { earlyStages, boardLabel } from '../game/metatft-early';
import { dataset } from '../game/tft-data';
import { displayName } from '../game/names';

const props = withDefaults(
  defineProps<{
    set: number;
    /** 只看某个阶段（不传则显示全部阶段） */
    stage?: number | null;
    /** 每阶段最多几条 */
    limit?: number;
  }>(),
  { stage: null, limit: 3 },
);

const stages = computed(() => {
  const all = earlyStages(props.set);
  const pick = props.stage ? all.filter((s) => s.stage === props.stage) : all;
  return pick.map((s) => ({ ...s, boards: s.boards.slice(0, props.limit) }));
});

const active = ref<number | null>(props.stage ?? stages.value[0]?.stage ?? null);
const shown = computed(() => stages.value.filter((s) => (active.value == null ? true : s.stage === active.value)));

const nameOf = (id: string) => dataset.characterById(id)?.display_name ?? displayName(id);
</script>

<template>
  <div class="early" :data-stages="stages.length" :data-active="active ?? ''">
    <header class="head">
      <span class="title">前期走向</span>
      <button
        v-for="s in stages"
        :key="s.stage"
        type="button"
        class="chip"
        :class="{ active: active === s.stage }"
        :data-stage="s.stage"
        @click="active = s.stage"
      >
        {{ s.stage }}-x
      </button>
    </header>

    <div v-for="s in shown" :key="s.stage" class="stage" :data-stage-block="s.stage">
      <div v-for="(b, i) in s.boards" :key="i" class="board" :data-units="b.units.length">
        <span class="units">{{ b.units.map(nameOf).join(' / ') }}</span>
        <span class="meta">
          <b v-if="b.avgPlace">{{ b.avgPlace.toFixed(2) }}</b>
          <span v-if="b.winRate" class="win">{{ Math.round(b.winRate * 100) }}%</span>
        </span>
      </div>
      <p v-if="!s.boards.length" class="empty">暂无数据</p>
    </div>
  </div>
</template>

<style scoped>
.early {
  border: 1px solid #232a35;
  border-radius: 8px;
  background: #0e141c;
  color: #e6e6e6;
  font: 12px/1.6 ui-sans-serif, system-ui, sans-serif;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.head { display: flex; gap: 6px; align-items: center; }
.title { color: #93c5fd; font-weight: 600; margin-right: 4px; }
.chip {
  background: #131a24;
  border: 1px solid #2b3444;
  color: #cbd5e1;
  border-radius: 4px;
  padding: 0 7px;
  font: 11px/1.7 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
}
.chip.active { background: #2563eb; border-color: #2563eb; color: #fff; }
.board { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
.units { color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { flex: none; color: #fbbf24; display: flex; gap: 6px; }
.win { color: #4ade80; }
.empty { margin: 0; color: #6b7280; }
</style>
