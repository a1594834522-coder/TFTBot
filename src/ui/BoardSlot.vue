<script setup lang="ts">
/**
 * 棋盘格（单格）—— 本实现 trick 窗口里每个六边形格子的 TS 重写。
 * 纯展示组件：只吃 characterId/level/items，点击事件用 emit，不碰全局状态。
 */
import { computed } from 'vue';
import { dataset } from '../game/tft-data';

const props = withDefaults(
  defineProps<{
    characterId?: string | null;
    level?: number;
    items?: string[];
    /** 格位序号，用于 data 属性与调试 */
    slot?: number;
    /** 是否为备战席格（样式略不同） */
    bench?: boolean;
    /** 高亮（例如"追三"命中） */
    highlight?: boolean;
    /** 站位热区权重 0..1（MetaTFT positioning） */
    heat?: number;
  }>(),
  { characterId: null, level: 1, items: () => [], slot: 0, bench: false, highlight: false, heat: 0 },
);

const emit = defineEmits<{ (e: 'select', id: string): void }>();

const champ = computed(() => (props.characterId ? dataset.characterById(props.characterId) ?? null : null));
const itemNames = computed(() => props.items.map((id) => dataset.item(id)?.display_name ?? id));
const costColor = computed(() => ['#9aa4b2', '#22c55e', '#3b82f6', '#a855f7', '#f59e0b'][(champ.value?.cost ?? 1) - 1] ?? '#9aa4b2');
</script>

<template>
  <button
    type="button"
    class="slot"
    :class="{ empty: !champ, bench, highlight, hot: heat > 0 }"
    :data-slot="slot"
    :data-character-id="champ?.character_id ?? ''"
    :data-level="champ ? level : ''"
    :data-heat="heat ? heat.toFixed(2) : ''"
    :style="[champ ? { borderColor: costColor } : {}, heat > 0 ? { background: `rgba(125,211,252,${(0.08 + heat * 0.32).toFixed(2)})` } : {}]"
    :title="champ ? `${champ.display_name}${level > 1 ? ' ' + '★'.repeat(level) : ''}${itemNames.length ? ' · ' + itemNames.join('/') : ''}` : '空格'"
    @click="champ && emit('select', champ.character_id)"
  >
    <template v-if="champ">
      <img v-if="champ.image_path" class="slot-icon" :src="champ.image_path" :alt="champ.display_name" loading="lazy" />
      <span class="slot-name">{{ champ.display_name }}</span>
      <span v-if="level > 1" class="slot-star">{{ '★'.repeat(level) }}</span>
      <span v-if="items.length" class="slot-items">
        <i v-for="n in items.length" :key="n" class="dot" />
      </span>
    </template>
  </button>
</template>

<style scoped>
.slot {
  position: relative;
  width: 64px;
  height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 2px;
  border-radius: 8px;
  border: 1px solid #2b3444;
  background: #131a24;
  color: #e6e6e6;
  cursor: pointer;
  font: 10px/1.2 ui-sans-serif, system-ui, sans-serif;
  overflow: hidden;
}
.slot.empty { border-style: dashed; border-color: #232a35; background: #0e141c; cursor: default; }
.slot.bench { border-radius: 6px; opacity: 0.95; }
.slot.highlight { box-shadow: 0 0 0 2px #fbbf24 inset; }
.slot-icon { width: 30px; height: 30px; border-radius: 4px; object-fit: cover; }
.slot-name { max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slot-star { position: absolute; top: 1px; right: 3px; color: #fbbf24; font-size: 9px; }
.slot-items { position: absolute; bottom: 2px; display: flex; gap: 2px; }
.dot { width: 4px; height: 4px; border-radius: 50%; background: #fca5a5; }
</style>
