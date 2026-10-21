<script setup lang="ts">
/**
 * characterwin 窗口 —— 单个英雄的详情页（大卡 + 羁绊 + 装备 + 含该英雄的阵容）。
 * 数据全来自本地数据集与 comps 数据集，不依赖页面 store。
 */
import { computed, ref, watch } from 'vue';
import CharacterHover from '../../ui/CharacterHover.vue';
import TraitHover from '../../ui/TraitHover.vue';
import ItemHover from '../../ui/ItemHover.vue';
import SetSwitcher from '../../ui/SetSwitcher.vue';
import { CURRENT_SET } from '../../game/current-season';
import { dataset } from '../../game/tft-data';
import { comps as compsData, type OfficialComp } from '../../game/comps-data';
import { metatftComps } from '../../game/comps-sources';
import type { Settings } from '../../core/settings';

const props = withDefaults(
  defineProps<{
    characterId: string;
    set?: number;
    /** 外部传入的阵容（一般用数据集自带） */
    comps?: OfficialComp[];
    /** 显示几条相关阵容 */
    compLimit?: number;
    /** 支持的赛季（顶栏切换用；空则不显示切换器） */
    supportSets?: number[];
    /** 设置（可选；不传视为全开） */
    settings?: Settings | null;
  }>(),
  { set: CURRENT_SET, compLimit: 5, supportSets: () => [] },
);

const emit = defineEmits<{ (e: 'changeSet', set: number): void }>();
const localSet = ref<number>(props.set);
watch(
  () => props.set,
  (v) => {
    localSet.value = v;
  },
);

/** 优先在当前赛季里找，找不到再全局找（避免切赛季后变"未知英雄"） */
const champ = computed(
  () => dataset.character(localSet.value, props.characterId) ?? dataset.characterById(props.characterId) ?? null,
);
const traits = computed(() => (champ.value?.trait_ids ?? []).map((id) => dataset.trait(id)).filter(Boolean));
const topItems = computed(() => (champ.value?.top_items ?? []).slice(0, 3));
const stats = computed(() => champ.value?.stats ?? {});

/** 设置门控（不传 settings 视为全开） */
const flag = (k: keyof Settings) => (props.settings ? Boolean((props.settings as any)[k]) : true);

const onChangeSet = (s: number) => {
  localSet.value = s;
  emit('changeSet', s);
};

/** 含该英雄的阵容（优先用外部传入，否则查数据集） */
const relatedComps = computed(() => {
  const all = props.comps?.length ? props.comps : compsData.comps(localSet.value);
  return all
    .filter((c) => c.units.some((u) => u.character_id === props.characterId))
    .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99))
    .slice(0, props.compLimit);
});

/** MetaTFT 单卡表现：从快照里找第一个含该英雄、且带 unit_stats 的阵容 */
const unitStat = computed(() => {
  for (const c of metatftComps(localSet.value)) {
    const hit = c.details?.unitStats?.find((u) => u.unit === props.characterId);
    if (hit) return hit;
  }
  return null;
});
</script>

<template>
  <div class="charwin" :data-character-id="characterId" :data-set="set">
    <div v-if="champ" class="left">
      <div v-if="supportSets.length" class="setrow">
        <SetSwitcher :support-sets="supportSets" :current-set="localSet" compact @change="onChangeSet" />
      </div>
      <CharacterHover :character-id="characterId" :set="localSet" :level="3" :show-cost="true" />
      <ul class="stats">
        <li data-stat="health">生命 {{ stats.health ?? '-' }}</li>
        <li data-stat="attack">攻击 {{ stats.attack ?? '-' }}</li>
        <li data-stat="armor">护甲 {{ stats.armor ?? '-' }}</li>
        <li data-stat="magic_resist">魔抗 {{ stats.magic_resist ?? '-' }}</li>
        <li data-stat="attack_speed">攻速 {{ stats.attack_speed ?? '-' }}</li>
        <li data-stat="range">射程 {{ stats.range ?? '-' }}</li>
      </ul>
    </div>

    <div class="right">
      <section class="block" data-section="traits">
        <h2>羁绊</h2>
        <div class="traits">
          <TraitHover v-for="t in traits" :key="t!.trait_id" :trait-id="t!.trait_id" :count="0" minimal />
        </div>
      </section>

      <section v-if="flag('showItems')" class="block" data-section="items">
        <h2>推荐装备</h2>
        <div class="items">
          <ItemHover v-for="id in topItems" :key="id" :item-id="id" :show-builds="false" />
        </div>
        <p v-if="!topItems.length" class="empty">无推荐</p>
      </section>

      <section v-if="flag('showAugments') && unitStat" class="block" data-section="unit-stats" :data-samples="unitStat.count ?? 0">
        <h2>MetaTFT 单卡表现 <span class="dim">平均 {{ unitStat.avg?.toFixed(2) ?? '-' }} 名</span></h2>
        <ul class="stars">
          <li v-for="t in unitStat.tiers ?? []" :key="'t' + t.tier" :data-star="t.tier">
            <span>{{ '★'.repeat(t.tier) }}</span>
            <span class="avg">{{ t.avg?.toFixed(2) ?? '-' }}</span>
            <span class="cnt">{{ t.count ?? 0 }} 场</span>
          </li>
        </ul>
        <ul class="items-n">
          <li v-for="n in unitStat.numItems ?? []" :key="'n' + n.items" :data-item-count="n.items">
            <span>{{ n.items }} 件装备</span>
            <span class="avg">{{ n.avg?.toFixed(2) ?? '-' }}</span>
            <span class="cnt">{{ n.count ?? 0 }} 场</span>
          </li>
        </ul>
      </section>

      <section class="block" data-section="comps" :data-comps="relatedComps.length">
        <h2>相关阵容</h2>
        <ul v-if="relatedComps.length">
          <li v-for="c in relatedComps" :key="String(c.id)" :data-comp-id="String(c.id)">
            <span class="cname">{{ c.name }}</span>
            <span class="ctier">T{{ c.tier ?? '-' }}</span>
          </li>
        </ul>
        <p v-else class="empty">暂无</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.charwin {
  display: flex;
  gap: 12px;
  padding: 10px;
  min-width: 620px;
  background: #0b0f14;
  color: #e6e6e6;
  font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
}
.left { display: flex; flex-direction: column; gap: 8px; }
.stats { margin: 0; padding: 8px 10px; list-style: none; border: 1px solid #232a35; border-radius: 8px; background: #0e141c; display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px 10px; }
.stats li { color: #cbd5e1; }
.right { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.block { border: 1px solid #232a35; border-radius: 8px; padding: 8px 10px; background: #0e141c; }
.block h2 { margin: 0 0 6px; font-size: 12px; color: #93c5fd; }
.traits, .items { display: flex; gap: 8px; flex-wrap: wrap; }
.traits :deep(.tr), .items :deep(.it) { width: 200px; }
.block ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.block li { display: flex; justify-content: space-between; gap: 8px; }
.ctier { color: #fbbf24; }
.empty { margin: 0; color: #6b7280; }\n.dim { color: #6b7280; font-weight: 400; font-size: 11px; }\n.stars, .items-n { margin: 0; padding: 0; list-style: none; display: flex; gap: 10px; flex-wrap: wrap; }\n.stars li, .items-n li { display: flex; gap: 6px; align-items: baseline; background: #131a24; border-radius: 4px; padding: 1px 7px; }\n.avg { color: #fbbf24; }\n.cnt { color: #6b7280; font-size: 11px; }
</style>
