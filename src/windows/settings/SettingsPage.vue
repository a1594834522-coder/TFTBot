<script setup lang="ts">
/**
 * 设置页 —— 把 background 的 getSettings/setSettings 变成可视化开关。
 *
 * 设计：
 *   - 受控：`settings` 进、`update:setting` 出（key + value），页面自己不改外部状态；
 *   - 分组按「悬浮层 / 棋盘 / 记牌器 / 阵容源」，只暴露游戏面板相关项；
 *   - 每个开关带 `data-setting="<key>"`，便于 e2e 与 SSR 断言。
 */
import { computed, ref, watch } from 'vue';
import { TOGGLE_KEYS, COMPS_SOURCE_PREFS, type Settings, type ToggleKey } from '../../core/settings';

const props = withDefaults(
  defineProps<{
    settings: Settings;
    /** 每个开关的中文说明（可选覆盖） */
    labels?: Partial<Record<ToggleKey, string>>;
  }>(),
  { labels: () => ({}) },
);

const emit = defineEmits<{
  (e: 'update:setting', key: keyof Settings, value: unknown): void;
}>();

const local = ref<Settings>(props.settings);
watch(
  () => props.settings,
  (v) => {
    local.value = v;
  },
);

const DEFAULT_LABELS: Record<ToggleKey, string> = {
  showCompsWin: '悬浮层：阵容/胜率面板',
  showCompsTracker: '悬浮层：记牌器入口',
  showCardTracker: '记牌器',
  showThreeMark: '三星标记',
  showWarning: '三星预警',
  chessHighlight: '棋盘高亮',
  showOnlyMe: '只看自己的棋子',
  showOverallRecord: '总战绩',
  autoAcept: '自动接受对局',
  showItems: '推荐装备',
  showAugments: '海克斯',
  showLevel: '等级提示',
};

const GROUPS: Array<{ title: string; keys: ToggleKey[] }> = [
  { title: '悬浮层', keys: ['showCompsWin', 'showCompsTracker'] },
  { title: '棋盘', keys: ['chessHighlight', 'showThreeMark', 'showWarning', 'showOnlyMe'] },
  { title: '记牌器 / 战绩', keys: ['showCardTracker', 'showOverallRecord'] },
  { title: '数据展示', keys: ['showItems', 'showAugments', 'showLevel'] },
  { title: '其它', keys: ['autoAcept'] },
];

const labelOf = (k: ToggleKey) => props.labels[k] ?? DEFAULT_LABELS[k];
const enabledCount = computed(() => TOGGLE_KEYS.filter((k) => local.value[k]).length);

function toggle(k: ToggleKey) {
  const next = !local.value[k];
  local.value = { ...local.value, [k]: next };
  emit('update:setting', k, next);
}

function pickSource(id: string) {
  local.value = { ...local.value, compsSource: id as Settings['compsSource'] };
  emit('update:setting', 'compsSource', id);
}
</script>

<template>
  <div class="settings" :data-settings="TOGGLE_KEYS.length" :data-enabled="enabledCount">
    <header class="head">
      <span class="title">设置</span>
      <span class="count">{{ enabledCount }} / {{ TOGGLE_KEYS.length }} 开</span>
    </header>

    <section class="sources" data-section="comps-source">
      <h2>阵容数据源</h2>
      <div class="chips">
        <button
          v-for="s in COMPS_SOURCE_PREFS"
          :key="s"
          type="button"
          class="chip"
          :class="{ active: local.compsSource === s }"
          :data-source="s"
          @click="pickSource(s)"
        >
          {{ s === 'all' ? '全部' : s === 'official' ? '官网' : s === 'blitz' ? 'blitz' : 'MetaTFT' }}
        </button>
      </div>
    </section>

    <section v-for="g in GROUPS" :key="g.title" class="group" :data-group="g.title">
      <h2>{{ g.title }}</h2>
      <ul>
        <li v-for="k in g.keys" :key="k" :data-setting="k" :data-on="local[k] ? '1' : '0'">
          <span class="label">{{ labelOf(k) }}</span>
          <button
            type="button"
            class="sw"
            :class="{ on: local[k] }"
            :aria-pressed="local[k] ? 'true' : 'false'"
            @click="toggle(k)"
          >
            <span class="dot" />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  min-width: 320px;
  background: #0b0f14;
  color: #e6e6e6;
  font: 12px/1.6 ui-sans-serif, system-ui, sans-serif;
}
.head { display: flex; gap: 10px; align-items: baseline; border-bottom: 1px solid #232a35; padding-bottom: 4px; }
.title { color: #93c5fd; font-weight: 600; }
.count { color: #6b7280; }
.group h2, .sources h2 { margin: 0 0 4px; font-size: 12px; color: #93c5fd; }
.group ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.group li { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.label { color: #cbd5e1; }
.sw { width: 34px; height: 16px; border-radius: 8px; border: 1px solid #2b3444; background: #131a24; position: relative; cursor: pointer; padding: 0; }
.sw.on { background: #2563eb; border-color: #2563eb; }
.dot { position: absolute; top: 1px; left: 1px; width: 12px; height: 12px; border-radius: 50%; background: #6b7280; transition: left 0.1s; }
.sw.on .dot { left: 19px; background: #fff; }
.chips { display: flex; gap: 4px; }
.chip { background: #131a24; border: 1px solid #2b3444; color: #cbd5e1; border-radius: 4px; padding: 0 7px; font: 11px/1.7 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.chip.active { background: #2563eb; border-color: #2563eb; color: #fff; }
</style>
