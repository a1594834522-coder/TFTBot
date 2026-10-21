<script setup lang="ts">
/**
 * 阵容面板 —— 官方阵容（238 套）的列表 + 详情。
 *
 * 列表支持：分组过滤（官网阵容 / blitz）、Tier 过滤、英雄搜索、按 Tier 排序。
 * 详情：阵容名 / Tier / 上场棋子（按 position 摆到小棋盘）/ 羁绊数量 / 运营标签。
 *
 * 设计：受控组件 —— `selectedId` 由外部给，点击只 emit，不自己藏状态（可 SSR、可回放）。
 */
import { computed, ref, watch } from 'vue';
import TftBoard, { type BoardChampion } from './TftBoard.vue';
import { dataset } from '../game/tft-data';
import type { OfficialComp } from '../game/comps-data';
import type { MetatftComp } from '../game/metatft-comps';
import { displayName } from '../game/names';
import { sourceOfComp } from '../game/comps-sources';
import type { Settings } from '../core/settings';

const props = withDefaults(
  defineProps<{
    comps: OfficialComp[];
    /** 桌面程序使用双栏布局；悬浮窗保留紧凑布局。 */
    layout?: 'compact' | 'wide';
    /** 选中的阵容 id（受控） */
    selectedId?: string | number | null;
    /** 列表条数上限 */
    limit?: number;
    /** 初始 Tier 过滤（空 = 全部） */
    tier?: number | null;
    /** 初始分组过滤（空 = 全部） */
    group?: string | null;
    /** 英雄搜索（id 或中文名片段，不区分大小写） */
    search?: string;
    /** 是否显示详情区 */
    showDetail?: boolean;
    /** 数据源过滤（all = 不过滤） */
    source?: 'all' | 'official' | 'blitz' | 'metatft';
    /** 各源数量（显示在列表头，可空） */
    sourceCounts?: Record<string, number>;
    /** 设置（可选；不传视为全开）——showLevel 控制等级相关区块 */
    settings?: Settings | null;
  }>(),
  {
    selectedId: null,
    layout: 'compact',
    limit: 40,
    tier: null,
    group: null,
    search: '',
    showDetail: true,
    source: 'all',
    sourceCounts: () => ({}),
    settings: null,
  },
);

const emit = defineEmits<{
  (e: 'select', id: string | number): void;
  (e: 'update:source', v: string): void;
  (e: 'update:tier', v: number | null): void;
  /** 点小棋盘上的棋子 → 打开英雄详情 */
  (e: 'selectCharacter', id: string): void;
  /** 选中阵容后 → 把该阵容的棋子推给 trick 做棋盘高亮 */
  (e: 'highlightUnits', units: string[], compId?: string): void;
}>();

const SOURCE_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'official', label: '官网' },
  { id: 'blitz', label: 'blitz' },
  { id: 'metatft', label: 'MetaTFT' },
] as const;
const TIER_OPTIONS: Array<number | null> = [null, 0, 1, 2, 3, 4];

const localSource = ref<string>(props.source);
const localTier = ref<number | null>(props.tier);
watch(() => props.source, (v) => { localSource.value = v; });
watch(() => props.tier, (v) => { localTier.value = v; });

function pickSource(id: string) {
  localSource.value = id;
  emit('update:source', id);
}
function pickTier(t: number | null) {
  localTier.value = t;
  emit('update:tier', t);
}

/** 数据集里没有的 id（例如 MetaTFT 的新赛季 DA_ 命名）退化成可读串，不显示原始 id */
const nameOf = (id: string) => dataset.characterById(id)?.display_name ?? displayName(id);

/** 过滤后的列表 */
const filtered = computed(() => {
  const q = props.search.trim().toLowerCase();
  return props.comps
    .filter((c) => (localSource.value === 'all' ? true : sourceOfComp(c) === localSource.value))
    .filter((c) => (localTier.value == null ? true : (c.tier ?? 99) === localTier.value))
    .filter((c) => (props.group ? String(c.id).startsWith('trait:') === (props.group === 'blitz') : true))
    .filter((c) => {
      if (!q) return true;
      if (String(c.name).toLowerCase().includes(q)) return true;
      return c.units.some((u) => u.character_id.toLowerCase().includes(q) || nameOf(u.character_id).includes(props.search.trim()));
    })
    .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || b.units.length - a.units.length)
});
const list = computed(() => filtered.value.slice(0, props.limit));

const selected = computed(() => {
  if (props.selectedId != null) return filtered.value.find((c) => String(c.id) === String(props.selectedId)) ?? list.value[0] ?? null;
  return list.value[0] ?? null;
});

/** 阵容棋子 → 棋盘数据（position 直接映射；没有则顺序铺） */
const boardChampions = computed<BoardChampion[]>(() =>
  (selected.value?.units ?? []).map((u, i) => ({
    character_id: u.character_id,
    position: typeof u.position === 'number' ? u.position : i,
    level: u.level ?? 1,
    items: u.items ?? [],
  })),
);

// 选中的阵容变化 → 把它的棋子推给 trick（棋盘高亮）
watch(
  () => selected.value,
  (c) => {
    if (!c) { emit('highlightUnits', []); return; }
    const units = (c.units ?? []).map((u) => u.character_id).filter(Boolean);
    emit('highlightUnits', units, String(c.id));
  },
  { immediate: true },
);

const synergy = computed(() =>
  (selected.value?.synergy ?? [])
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.count - a.count)
    .map((s) => ({ ...s, name: dataset.trait(s.trait_id)?.display_name ?? displayName(s.trait_id) })),
);

/** MetaTFT comp_details（官方/blitz 阵容没有这个字段） */
const mtDetails = computed(() => (selected.value as MetatftComp | null)?.details ?? null);

/** 等级相关区块受设置控制（不传 settings 视为全开） */
const showLevel = computed(() => (props.settings ? Boolean((props.settings as any).showLevel) : true));

/** 升级里程碑：同一 level 只留最早那步，避免列表太长 */
const levelSteps = computed(() => {
  const seen = new Set<number>();
  return (mtDetails.value?.levels ?? [])
    .filter((l) => l.stage > 0)
    .sort((a, b) => a.stage - b.stage || a.round - b.round)
    .filter((l) => {
      if (seen.has(l.level)) return false;
      seen.add(l.level);
      return true;
    })
    .slice(0, 6);
});

/** MetaTFT 站位热区：把 details.positioning 归一化成「格子 → 0..1」 */
const heat = computed<Record<number, number>>(() => {
  const pos = mtDetails.value?.positioning;
  if (!pos) return {};
  const totals = new Map<number, number>();
  let max = 0;
  for (const cells of Object.values(pos)) {
    for (const c of cells) {
      if (!Number.isFinite(c.cell)) continue;
      totals.set(c.cell, (totals.get(c.cell) ?? 0) + c.count);
      max = Math.max(max, totals.get(c.cell)!);
    }
  }
  if (!max) return {};
  return Object.fromEntries([...totals].map(([cell, n]) => [cell, Math.round((n / max) * 100) / 100]));
});

const itemName = (id: string) => dataset.item(id)?.display_name ?? displayName(id);
</script>

<template>
  <div class="comps" :class="{ wide: layout === 'wide' }" :data-comps="list.length" :data-selected="selected ? String(selected.id) : ''">
    <header class="head">
      <span class="title">阵容</span>
      <span class="count">{{ list.length }} / {{ comps.length }}</span>
      <span v-if="search" class="chip">“{{ search }}”</span>
      <span v-if="sourceCounts.metatft" class="chip mt" data-metatft-count>{{ sourceCounts.metatft }} MT</span>
    </header>

    <!-- 交互芯片：数据源 / Tier（点击切换，受控 prop 决定初始高亮） -->
    <div class="filters" data-section="filters">
      <button
        v-for="s in SOURCE_OPTIONS"
        :key="s.id"
        type="button"
        class="chip-btn"
        :class="{ active: localSource === s.id }"
        :data-filter-source="s.id"
        @click="pickSource(s.id)"
      >
        {{ s.label }}
      </button>
      <span class="sep" />
      <button
        v-for="t in TIER_OPTIONS"
        :key="String(t)"
        type="button"
        class="chip-btn"
        :class="{ active: localTier === t }"
        :data-filter-tier="t == null ? 'all' : t"
        @click="pickTier(t)"
      >
        {{ t == null ? '全部' : 'T' + t }}
      </button>
    </div>

    <ul class="list">
      <li
        v-for="c in list"
        :key="String(c.id)"
        :data-comp-id="String(c.id)"
        :data-tier="c.tier ?? ''"
        :data-source="sourceOfComp(c)"
        :class="{ active: selected && String(selected.id) === String(c.id) }"
        @click="emit('select', c.id)"
      >
        <span class="cname">{{ c.name }}</span>
        <span class="cmeta">
          <span v-if="sourceOfComp(c) === 'metatft'" class="mt">MT</span>
          T{{ c.tier ?? '-' }} · {{ c.units.length }}人
        </span>
      </li>
      <li v-if="!list.length" class="empty">没有匹配的阵容</li>
    </ul>

    <section v-if="showDetail && selected" class="detail" :data-detail="String(selected.id)">
      <h3>
        {{ selected.name }}
        <span class="tier">T{{ selected.tier ?? '-' }}</span>
      </h3>

      <TftBoard
        :champions="boardChampions"
        :show-bench="true"
        :rows="4"
        :cols="7"
        :heat="heat"
        @select="(id) => emit('selectCharacter', id)"
      />

      <div class="synergy" data-section="synergy">
        <span v-for="s in synergy" :key="s.trait_id" class="syn" :data-trait-id="s.trait_id" :data-count="s.count">
          {{ s.name }} <b>{{ s.count }}</b>
        </span>
      </div>

      <div v-if="selected.play_tags?.length" class="tags" data-section="tags">
        <span v-for="t in selected.play_tags" :key="t" class="tag">{{ t }}</span>
      </div>

      <div v-if="selected.early_units?.length" class="early" data-section="early">
        <span class="label">过渡</span>
        <span v-for="u in selected.early_units" :key="u.character_id" class="unit">{{ nameOf(u.character_id) }}</span>
      </div>

      <!-- MetaTFT comp_details 的决策项（只有 MetaTFT 阵容才有） -->
      <div v-if="showLevel && mtDetails?.levels?.length" class="mt-block" data-section="levels">
        <span class="label">升级</span>
        <span v-for="l in levelSteps" :key="`${l.stage}-${l.round}`" class="step" :data-step="`${l.stage}-${l.round}`">
          {{ l.stage }}-{{ l.round }} L{{ l.level }}
        </span>
      </div>

      <div v-if="showLevel && mtDetails?.finalLevels?.length" class="mt-block" data-section="final-levels">
        <span class="label">等级名次</span>
        <span v-for="f in mtDetails.finalLevels" :key="f.level" class="step" :data-level="f.level">
          L{{ f.level }} <b>{{ f.avg?.toFixed?.(2) ?? '-' }}</b>
        </span>
      </div>

      <div v-if="mtDetails?.builds?.length" class="mt-block builds" data-section="builds">
        <span class="label">装备</span>
        <div v-for="(b, i) in mtDetails.builds" :key="i" class="build" :data-holder="b.unit ?? ''">
          <span class="holder">{{ b.unit ? nameOf(b.unit) : '' }}</span>
          <span v-for="it in b.items" :key="it" class="item">{{ itemName(it) }}</span>
          <span v-if="b.avg" class="bavg">{{ b.avg.toFixed(2) }}</span>
        </div>
      </div>

      <div v-if="mtDetails?.augments?.length" class="mt-block" data-section="augments">
        <span class="label">海克斯</span>
        <span v-for="a in mtDetails.augments" :key="a.name" class="step" :data-augment="a.name">
          {{ displayName(a.name) }} <b v-if="a.avg">{{ a.avg.toFixed(2) }}</b>
        </span>
      </div>

      <div v-if="mtDetails?.earlyOptions?.length" class="mt-block builds" data-section="early-options">
        <span class="label">开局分支</span>
        <div v-for="(e, i) in mtDetails.earlyOptions" :key="i" class="build" :data-level="e.level">
          <span class="holder">L{{ e.level }}</span>
          <span v-for="u in e.units" :key="u" class="item">{{ nameOf(u) }}</span>
          <span v-if="e.win" class="bavg">{{ Math.round(e.win * 100) }}%</span>
        </div>
      </div>

      <div v-if="mtDetails?.proComps?.length" class="mt-block builds" data-section="pro-comps">
        <span class="label">作者阵容</span>
        <div v-for="(p, i) in mtDetails.proComps" :key="i" class="pro" :data-author="p.author ?? ''">
          <span class="cname">{{ p.title }}</span>
          <span class="cmeta">{{ p.author ?? '匿名' }}{{ p.region ? ' · ' + p.region : '' }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.comps {
  border: 1px solid #232a35;
  border-radius: 8px;
  background: #0e141c;
  color: #e6e6e6;
  font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
}
.head { display: flex; align-items: center; gap: 8px; }
.comps.wide { max-width: none; width: 100%; display: grid; grid-template-columns: minmax(270px, 0.8fr) minmax(490px, 1.2fr); gap: 14px 24px; padding: 18px; align-items: start; }
.wide > .head, .wide > .filters { grid-column: 1; }
.wide > .list { grid-column: 1; grid-row: 3; max-height: 620px; }
.wide > .detail { grid-column: 2; grid-row: 1 / span 3; border-top: none; border-left: 1px solid #26364b; padding: 0 0 0 22px; min-width: 0; }
.wide > .list li { padding: 10px 9px; }
.wide > .filters button { padding: 4px 8px; }
@media (max-width: 1280px) {
  .comps.wide { grid-template-columns: 1fr; }
  .wide > .detail { grid-column: 1; grid-row: auto; border-left: none; border-top: 1px solid #26364b; padding: 18px 0 0; }
  .wide > .list { max-height: 260px; }
}
.title { color: #93c5fd; font-weight: 600; }
.count { color: #6b7280; }
.chip { background: #1b2330; border-radius: 4px; padding: 0 6px; color: #fbbf24; font-size: 11px; }
.chip.mt, .mt { color: #a855f7; }
.filters { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.chip-btn { background: #131a24; border: 1px solid #2b3444; color: #cbd5e1; border-radius: 4px; padding: 0 7px; font: 11px/1.7 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.chip-btn:hover { border-color: #3b82f6; }
.chip-btn.active { background: #2563eb; border-color: #2563eb; color: #fff; }
.sep { width: 1px; height: 14px; background: #2b3444; margin: 0 2px; }
.list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; }
.list li { display: flex; justify-content: space-between; gap: 8px; padding: 2px 6px; border-radius: 4px; cursor: pointer; }
.list li:hover { background: #161d27; }
.list li.active { background: #1b2330; box-shadow: inset 2px 0 0 #7dd3fc; }
.cname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmeta { color: #fbbf24; flex: none; font-size: 11px; }
.empty { color: #6b7280; cursor: default; }
.detail { border-top: 1px solid #232a35; padding-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.detail h3 { margin: 0; font-size: 13px; color: #e2e8f0; display: flex; justify-content: space-between; }
.tier { color: #fbbf24; }
.synergy { display: flex; flex-wrap: wrap; gap: 6px; }
.syn { background: #1b2330; border-radius: 4px; padding: 0 6px; color: #93c5fd; }
.syn b { color: #fbbf24; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tag { background: #14322a; color: #4ade80; border-radius: 4px; padding: 0 6px; }
.early { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.label { color: #6b7280; }
.unit { color: #cbd5e1; }
.mt-block { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.mt-block.builds { flex-direction: column; align-items: stretch; }
.step { background: #1b2330; border-radius: 4px; padding: 0 6px; color: #cbd5e1; font-size: 11px; }
.step b { color: #fbbf24; }
.build { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; font-size: 11px; }
.holder { color: #93c5fd; min-width: 64px; }
.item { background: #131a24; border-radius: 3px; padding: 0 4px; color: #cbd5e1; }
.bavg { color: #fbbf24; margin-left: auto; }
.pro { display: flex; flex-direction: column; gap: 1px; padding: 2px 0; border-top: 1px dashed #232a35; }
.pro .cname { color: #e2e8f0; }
.pro .cmeta { color: #6b7280; font-size: 11px; }
</style>
