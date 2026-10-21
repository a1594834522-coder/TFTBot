<script setup lang="ts">
/** 装备悬浮卡（重写 item-hover 组件）；合成关系来自数据集 */
import { computed } from 'vue';
import { dataset } from '../game/tft-data';

const props = withDefaults(
  defineProps<{
    itemId: string;
    /** 是否展开合成路线 */
    showBuilds?: boolean;
    /** 只显示名字（图标条用） */
    minimal?: boolean;
  }>(),
  { showBuilds: true, minimal: false },
);

const item = computed(() => dataset.item(props.itemId) ?? null);
const graph = computed(() => dataset.itemBuildGraph(props.itemId));
/** type: 1 基础件 / 2 成装 / 3 光明 / 其它 */
const kind = computed(() => {
  switch (item.value?.type) {
    case 1:
      return '基础件';
    case 2:
      return '成装';
    case 3:
      return '光明装';
    default:
      return '特殊';
  }
});
</script>

<template>
  <div v-if="item" class="it" :data-item-id="item.item_id">
    <header class="it-head">
      <img v-if="item.image_path" class="it-icon" :src="item.image_path" :alt="item.display_name" loading="lazy" />
      <span class="it-name">{{ item.display_name }}</span>
      <span class="it-kind">{{ kind }}</span>
    </header>

    <template v-if="!minimal">
      <p v-if="item.description" class="it-desc">{{ item.description }}</p>

      <div v-if="showBuilds && graph.into.length" class="it-builds">
        <span class="it-label">可合成</span>
        <ul>
          <li v-for="it2 in graph.into.slice(0, 8)" :key="it2.item_id">{{ it2.display_name }}</li>
        </ul>
      </div>
      <div v-if="showBuilds && graph.from.length" class="it-builds">
        <span class="it-label">由</span>
        <ul>
          <li v-for="it2 in graph.from" :key="it2.item_id">{{ it2.display_name }}</li>
        </ul>
      </div>
    </template>
  </div>
  <div v-else class="it it-empty">未知装备：{{ itemId }}</div>
</template>

<style scoped>
.it {
  width: 260px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #11151c;
  color: #e6e6e6;
  font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
  border: 1px solid #232a35;
}
.it-head { display: flex; align-items: center; gap: 8px; }
.it-icon { width: 32px; height: 32px; border-radius: 4px; }
.it-name { font-size: 13px; font-weight: 600; flex: 1; }
.it-kind { color: #9aa4b2; font-size: 11px; }
.it-desc { margin: 6px 0 0; color: #b6c2d1; }
.it-builds { margin-top: 6px; display: flex; gap: 6px; align-items: flex-start; }
.it-label { color: #9aa4b2; flex: none; }
.it-builds ul { display: flex; gap: 4px; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; }
.it-builds li { background: #1b2330; border-radius: 4px; padding: 0 6px; color: #fca5a5; }
.it-empty { color: #f87171; }
</style>
