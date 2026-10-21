<script setup lang="ts">
import { CURRENT_SET } from "../../game/current-season";
/**
 * tracker 窗口 —— 本实现"记牌器/战绩板"页的 TS 重写。
 *
 * 内容：存活人数、玩家列表（血量/棋子数/阵亡）、记牌器横条、当前赛季推荐阵容。
 * 与 trick 一样：控制器给状态，组件只渲染。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import CardTrackerStrip from '../../ui/CardTrackerStrip.vue';
import CompsPanel from '../../ui/CompsPanel.vue';
import SetSwitcher from '../../ui/SetSwitcher.vue';
import RankBadge from '../../ui/RankBadge.vue';
import EarlyCompsPanel from '../../ui/EarlyCompsPanel.vue';
import type { TrickController, TrickState } from '../trick/controller';
import type { OfficialComp } from '../../game/comps-data';
import type { RankEntryView } from '../../core/rank';
import type { Settings } from '../../core/settings';

const props = withDefaults(
  defineProps<{
    controller: TrickController;
    /** 当前赛季推荐阵容（由 boot 从 comps 数据集传入） */
    comps?: OfficialComp[];
    /** 列表条数上限 */
    compLimit?: number;
    set?: number;
    /** 支持的赛季（切换用） */
    supportSets?: number[];
    /** 当前段位（由 boot 从 core/rank 取，拿不到就 null） */
    rank?: RankEntryView | null;
    /** 各阵容源的数量（官方 / blitz / MetaTFT） */
    sourceCounts?: Record<string, number>;
    /** 设置（可选；不传就全开） */
    settings?: Settings | null;
    /** 点阵容小棋盘上的棋子 → 由 boot 打开 characterwin */
    onOpenCharacter?: (id: string) => void;
    /** 选中阵容 → 把棋子推给 trick 做高亮 */
    onHighlightUnits?: (units: string[], compId?: string) => void;
  }>(),
  { comps: () => [], compLimit: 20, set: CURRENT_SET, supportSets: () => [], rank: null, sourceCounts: () => ({}) },
);

const state = ref<TrickState>(props.controller.state());
const selectedComp = ref<string | number | null>(null);
const currentSet = ref<number>(props.set);
watch(() => props.set, (set) => { currentSet.value = set; selectedComp.value = null; });
let off: (() => void) | null = null;

onMounted(() => {
  state.value = props.controller.state();
  off = props.controller.subscribe((s) => {
    state.value = s;
  });
});
onUnmounted(() => off?.());

const emit = defineEmits<{ (e: 'changeSet', set: number): void }>();

const players = computed(() => state.value.players);
const alive = computed(() => state.value.alive);
const onSelectComp = (id: string | number) => {
  selectedComp.value = id;
};
/** 本地先切（父层可接管做真正的数据切换） */
const onChangeSet = (s: number) => {
  currentSet.value = s;
  emit('changeSet', s);
};

/** 设置门控（不传 settings 视为全开） */
const flag = (k: keyof Settings) => (props.settings ? Boolean((props.settings as any)[k]) : true);

const openChar = (id: string) => props.onOpenCharacter?.(id);
const onHighlight = (units: string[], compId?: string) => props.onHighlightUnits?.(units, compId);

const championCount = (p: TrickState['players'][number]) => p.placements?.length ?? p.champions.length;
</script>

<template>
  <div class="tracker" :data-alive="alive" :data-players="players.length" :data-ready="state.ready">
    <header class="bar">
      <span>存活 <b>{{ alive }}</b> / {{ players.length }}</span>
      <SetSwitcher :support-sets="supportSets" :current-set="currentSet" @change="onChangeSet" />
      <RankBadge v-if="flag('showLevel')" :entry="rank" />
      <span class="dim">{{ state.lastEvent ?? '等待对局' }}</span>
    </header>

    <div class="body">
      <section class="players" data-section="players">
        <h2>玩家</h2>
        <ol v-if="players.length">
          <li
            v-for="(p, i) in players"
            :key="p.name || i"
            :data-player="p.name"
            :data-health="p.health"
            :class="{ dead: p.health <= 0 }"
          >
            <span class="idx">{{ i + 1 }}</span>
            <span class="name">{{ p.name || '未知' }}</span>
            <span class="units">{{ championCount(p) }} 只</span>
            <span class="hp">{{ p.health }}</span>
          </li>
        </ol>
        <p v-else class="empty">等待数据</p>
      </section>

      <section class="side">
        <CardTrackerStrip v-if="flag('showCardTracker')" :rows="state.tracker" :limit="14" />

        <EarlyCompsPanel v-if="flag('showCompsWin')" :set="currentSet" :limit="2" />

        <div v-if="flag('showCompsWin')" data-section="comps">
          <CompsPanel
            v-if="comps.length"
            :comps="comps"
            :limit="compLimit"
            :selected-id="selectedComp"
            :set="set"
            :source-counts="sourceCounts"
            :source="settings?.compsSource ?? 'all'"
            :settings="settings"
            @select="onSelectComp"
            @select-character="openChar"
            @highlight-units="onHighlight"
          />
          <p v-else class="empty">未加载阵容数据</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tracker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  min-width: 640px;
  background: #0b0f14;
  color: #e6e6e6;
  font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
}
.bar { display: flex; gap: 14px; padding: 4px 6px; border-bottom: 1px solid #232a35; color: #cbd5e1; }
.bar b { color: #7dd3fc; }
.dim { color: #6b7280; }
.body { display: flex; gap: 12px; align-items: flex-start; }
.players { flex: 1; border: 1px solid #232a35; border-radius: 8px; padding: 8px 10px; background: #0e141c; }
.players h2, .comps h2 { margin: 0 0 6px; font-size: 12px; color: #93c5fd; }
.players ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.players li { display: grid; grid-template-columns: 20px 1fr 48px 40px; gap: 6px; align-items: center; }
.players li.dead { color: #6b7280; text-decoration: line-through; }
.idx { color: #64748b; }
.hp { color: #fca5a5; text-align: right; }
.units { color: #9aa4b2; text-align: right; }
.side { width: 420px; display: flex; flex-direction: column; gap: 8px; }
.comps { border: 1px solid #232a35; border-radius: 8px; padding: 8px 10px; background: #0e141c; }
.comps ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; }
.comps li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; }
.cname { color: #e2e8f0; }
.cmeta { color: #fbbf24; font-size: 11px; }
.cprev { grid-column: 1 / -1; color: #9aa4b2; font-size: 11px; }
.empty { margin: 0; color: #6b7280; }
</style>
