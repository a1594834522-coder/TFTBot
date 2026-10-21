<script setup lang="ts">
import { CURRENT_SET } from "../../game/current-season";
/**
 * trick 窗口（棋盘 + 记牌器 + 排行 + 悬浮卡）—— 本实现 trick 页的 TS 重写。
 *
 * 数据入口只有 controller：组件不订阅 cube、不算牌池，纯渲染 + 交互。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import TftBoard, { type BoardChampion } from '../../ui/TftBoard.vue';
import CardTrackerStrip from '../../ui/CardTrackerStrip.vue';
import CharacterHover from '../../ui/CharacterHover.vue';
import SetSwitcher from '../../ui/SetSwitcher.vue';
import RankBadge from '../../ui/RankBadge.vue';
import type { TrickController, TrickState } from './controller';
import type { RankEntryView } from '../../core/rank';
import type { Settings } from '../../core/settings';

const props = withDefaults(
  defineProps<{
    controller: TrickController;
    /** 当前赛季（决定数据查哪份） */
    set?: number;
    /** 默认高亮的"追三"英雄 */
    highlightIds?: string[];
    /** 支持的赛季（顶栏切换用；空则不显示切换器） */
    supportSets?: number[];
    /** 当前段位（可选） */
    rank?: RankEntryView | null;
    /** 设置（可选；不传就全开，保持向后兼容） */
    settings?: Settings | null;
  }>(),
  { set: CURRENT_SET, supportSets: () => [], rank: null },
);

const emit = defineEmits<{ (e: 'changeSet', set: number): void }>();

const state = ref<TrickState>(props.controller.state());
const localSet = ref<number>(props.set);
watch(() => props.set, (set) => { localSet.value = set; });
let off: (() => void) | null = null;

onMounted(() => {
  state.value = props.controller.state();
  off = props.controller.subscribe((s) => {
    state.value = s;
  });
});
onUnmounted(() => off?.());

const onChangeSet = (s: number) => {
  localSet.value = s;
  emit('changeSet', s);
};

/** 同名独立棋子保留各自的星级、装备和棋盘/备战席位置。 */
const championsOf = (player: TrickState['players'][number]): BoardChampion[] => {
  if (player.placements) return player.placements.map((c) => ({
    character_id: c.name,
    position: c.position,
    level: Number(c.level) || 1,
    items: c.items ?? [c.item_1, c.item_2, c.item_3].filter((id): id is string => !!id),
  }));
  return player.champions.map((c) => ({
    character_id: c.name,
    level: c.levels.length ? Math.max(...c.levels) : 1,
    items: c.items,
  }));
};
const myChampions = computed(() => state.value.me ? championsOf(state.value.me) : []);

/** 设置门控（不传 settings 视为全开） */
const flag = (k: keyof Settings) => (props.settings ? Boolean((props.settings as any)[k]) : true);

const highlight = computed(() => {
  const explicit = props.highlightIds ?? [];
  const warnIds = flag('showThreeMark') ? state.value.marks : [];
  return [...new Set([...explicit, ...warnIds])];
});

const selectedChampion = computed(() => state.value.selected);
const meName = computed(() => state.value.me?.name ?? '—');

function onSelect(id: string) {
  props.controller.select(state.value.selected === id ? null : id);
}
</script>

<template>
  <div class="trick" :data-alive="state.alive" :data-ready="state.ready">
    <header class="topbar">
      <span class="tb-item">存活 <b>{{ state.alive }}</b></span>
      <span class="tb-item">我 <b>{{ meName }}</b></span>
      <span class="tb-item tb-dim">{{ state.players.length }} 名玩家</span>
      <SetSwitcher v-if="supportSets.length" :support-sets="supportSets" :current-set="localSet" compact @change="onChangeSet" />
      <RankBadge v-if="rank" :entry="rank" compact />
      <span class="tb-item tb-dim" data-last-event>{{ state.lastEvent ?? '等待对局' }}</span>
    </header>

    <main class="body">
      <section class="board-col">
        <TftBoard :champions="myChampions" :highlight-ids="flag('chessHighlight') ? highlight : []" @select="onSelect" />
        <CardTrackerStrip v-if="flag('showCardTracker')" :rows="state.tracker" :limit="10" />
      </section>

      <aside class="side">
        <div v-if="selectedChampion" class="hover-wrap">
          <CharacterHover :character-id="selectedChampion" :set="localSet" :level="3" />
        </div>

        <section v-if="flag('showWarning')" class="panel" :data-warn-count="state.warnings.length">
          <h2>三星预警</h2>
          <ul v-if="state.warnings.length">
            <li v-for="w in state.warnings" :key="w.champion" :data-warn="w.champion" :data-holders="w.holders?.length ?? 0">
              <span class="w-name">{{ w.champion }}</span>
              <span class="w-need">差 {{ w.neededForThree }}</span>
              <span v-if="w.holders?.length" class="w-holders">
                <span v-for="h in w.holders" :key="h.player" :data-holder="h.player" :data-copies="h.copies">
                  {{ h.player }}×{{ h.copies }}
                </span>
              </span>
            </li>
          </ul>
          <p v-else class="empty">暂无</p>
        </section>

        <section class="panel" :data-player-count="state.players.length">
          <h2>玩家</h2>
          <ul v-if="state.players.length">
            <li v-for="p in state.players" :key="p.name" :data-health="p.health" :class="{ dead: p.health <= 0 }">
              <span class="pname">{{ p.name || '未知' }}</span>
              <span class="php">{{ p.health }}</span>
            </li>
          </ul>
          <p v-else class="empty">等待数据</p>
        </section>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.trick {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  min-width: 720px;
  background: #0b0f14;
  color: #e6e6e6;
  font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
}
.topbar { display: flex; gap: 14px; align-items: center; padding: 4px 6px; border-bottom: 1px solid #232a35; }
.tb-item { color: #cbd5e1; }
.tb-item b { color: #7dd3fc; }
.tb-dim { color: #6b7280; }
.body { display: flex; gap: 12px; align-items: flex-start; }
.board-col { display: flex; flex-direction: column; gap: 8px; }
.side { width: 300px; display: flex; flex-direction: column; gap: 10px; }
.hover-wrap { position: sticky; top: 0; }
.panel { border: 1px solid #232a35; border-radius: 8px; padding: 8px 10px; background: #0e141c; }
.panel h2 { margin: 0 0 6px; font-size: 12px; color: #93c5fd; font-weight: 600; }
.panel ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.panel li { display: flex; justify-content: space-between; color: #cbd5e1; }
.panel li.dead { color: #6b7280; text-decoration: line-through; }
.php { color: #fca5a5; }
.empty { margin: 0; color: #6b7280; }
.w-holders { color: #fbbf24; margin-left: 6px; display: inline-flex; gap: 6px; }
.w-need { color: #6b7280; margin-left: 4px; }
</style>
