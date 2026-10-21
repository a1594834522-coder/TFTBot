<script setup lang="ts">
/**
 * 棋子悬浮卡（重写 character-hover 组件）
 * 数据全部来自 tft-data（本地 JSON），不依赖页面里的全局 store —— 可单独复用/单测。
 */
import { computed } from 'vue';
import { CURRENT_SET } from '../game/current-season';
import { dataset } from '../game/tft-data';

const props = withDefaults(
  defineProps<{
    /** 英雄 id，如 TFT16_Tristana */
    characterId: string;
    /** 赛季（决定去哪份数据里查） */
    set?: number;
    /** 星级 1/2/3，用于显示与费用计算 */
    level?: number;
    /** 携带装备 id */
    items?: string[];
    /** 显示费用徽标 */
    showCost?: boolean;
    /** 紧凑模式（只显示名字+羁绊） */
    compact?: boolean;
  }>(),
  { set: CURRENT_SET, level: 1, items: () => [], showCost: true, compact: false },
);

const champ = computed(() => dataset.character(props.set, props.characterId) ?? dataset.characterById(props.characterId) ?? null);
const traits = computed(() => (champ.value ? champ.value.trait_ids.map((id) => dataset.trait(id)).filter(Boolean) : []));
const itemObjs = computed(() => props.items.map((id) => dataset.item(id)).filter(Boolean));
/** 星级只影响血量展示（TFT 规则：1★ ×1、2★ ×1.8、3★ ×3.24） */
const health = computed(() => {
  const base = champ.value?.stats?.health ?? 0;
  if (!base) return 0;
  const mult = props.level === 3 ? 3.24 : props.level === 2 ? 1.8 : 1;
  return Math.round(base * mult);
});
const costColor = computed(() => ['#9aa4b2', '#22c55e', '#3b82f6', '#a855f7', '#f59e0b'][(champ.value?.cost ?? 1) - 1] ?? '#9aa4b2');
</script>

<template>
  <div v-if="champ" class="ch" :data-character-id="champ.character_id" :data-level="level">
    <header class="ch-head">
      <img v-if="champ.image_path" class="ch-avatar" :src="champ.image_path" :alt="champ.display_name" loading="lazy" />
      <div class="ch-title">
        <span class="ch-name">{{ champ.display_name }}</span>
        <span v-if="showCost" class="ch-cost" :style="{ background: costColor }">{{ champ.cost }}费</span>
        <span v-if="level > 1" class="ch-star">{{ '★'.repeat(level) }}</span>
      </div>
      <span v-if="health" class="ch-hp">{{ health }} HP</span>
    </header>

    <ul v-if="!compact" class="ch-traits">
      <li v-for="t in traits" :key="t!.trait_id" :data-trait-id="t!.trait_id">{{ t!.display_name }}</li>
    </ul>

    <template v-if="!compact">
      <p v-if="champ.ability?.name" class="ch-ability">
        <strong>{{ champ.ability.name }}</strong>
        <span v-if="champ.ability.mana_cost != null" class="ch-mana">{{ champ.ability.mana_start ?? 0 }}/{{ champ.ability.mana_cost }}</span>
      </p>
      <p v-if="champ.ability?.description" class="ch-desc">{{ champ.ability.description }}</p>

      <ul v-if="itemObjs.length" class="ch-items">
        <li v-for="it in itemObjs" :key="it!.item_id" :data-item-id="it!.item_id">{{ it!.display_name }}</li>
      </ul>
      <p v-else-if="champ.top_items?.length" class="ch-recommend">
        推荐：{{ champ.top_items.slice(0, 3).map((id) => dataset.item(id)?.display_name ?? id).join(' / ') }}
      </p>
    </template>
  </div>
  <div v-else class="ch ch-empty">未知棋子：{{ characterId }}</div>
</template>

<style scoped>
.ch {
  width: 280px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #11151c;
  color: #e6e6e6;
  font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
  border: 1px solid #232a35;
}
.ch-head { display: flex; align-items: center; gap: 8px; }
.ch-avatar { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; }
.ch-title { display: flex; align-items: center; gap: 6px; flex: 1; }
.ch-name { font-size: 14px; font-weight: 600; }
.ch-cost { color: #0b0f14; border-radius: 4px; padding: 0 5px; font-weight: 700; }
.ch-star { color: #fbbf24; }
.ch-hp { color: #9aa4b2; }
.ch-traits { display: flex; gap: 6px; padding: 6px 0 0; margin: 0; list-style: none; flex-wrap: wrap; }
.ch-traits li { background: #1b2330; border-radius: 4px; padding: 1px 6px; color: #93c5fd; }
.ch-ability { margin: 6px 0 0; display: flex; gap: 6px; align-items: baseline; }
.ch-mana { color: #60a5fa; font-size: 11px; }
.ch-desc { margin: 4px 0 0; color: #b6c2d1; max-height: 84px; overflow: hidden; }
.ch-items { display: flex; gap: 6px; padding: 6px 0 0; margin: 0; list-style: none; flex-wrap: wrap; }
.ch-items li { background: #1b2330; border-radius: 4px; padding: 1px 6px; color: #fca5a5; }
.ch-recommend { margin: 6px 0 0; color: #9aa4b2; }
.ch-empty { color: #f87171; }
</style>
