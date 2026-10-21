<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import CompBrowser from './CompBrowser.vue';
import DesktopSidebar from './DesktopSidebar.vue';
import NavigationIcon from './NavigationIcon.vue';
import SmartCompPanel from './SmartCompPanel.vue';
import ReaderPanel from './ReaderPanel.vue';
import TrackerPanel from './TrackerPanel.vue';
import {highlightedCompUnits} from '../game/selected-comp';
import type { SelectedComp } from '../game/selected-comp';
import type { ReaderStatus } from '../recognition/status';
import { CURRENT_SET } from '../game/current-season';
import SettingsPage from '../windows/settings/SettingsPage.vue';
import TrickPage from '../windows/trick/TrickPage.vue';
import AugmentsPage from './AugmentsPage.vue';
import { createDesktopSession } from './session';
import { dataset } from '../game/tft-data';
import { allComps, sourcesFor, metatftMeta } from '../game/comps-sources';
import { bundledAugmentTiers } from '../game/metatft-augments';
import { normalizeSettings, type Settings } from '../core/settings';


type View = 'comps' | 'advisor' | 'augments' | 'board' | 'settings';
const view = ref<View>('comps');
const nav = [{id:'comps',name:'热门阵容'},{id:'advisor',name:'阵容助手'},{id:'augments',name:'海克斯评级'},{id:'board',name:'对局面板'},{id:'settings',name:'偏好设置'}] as const;
const session = shallowRef<Awaited<ReturnType<typeof createDesktopSession>> | null>(null);
const set = ref(CURRENT_SET);
const settings = shallowRef(normalizeSettings({}));
const selected = ref<string | number | null>(null);
const error = ref('');
const readerStatus = shallowRef<ReaderStatus | null>(null);
const selectedComp = shallowRef<SelectedComp|null>(null);
let offComp:(()=>void)|undefined;
async function pickComp(key:string|null,directionId?:string){try{selectedComp.value=await window.tftDesktop.selectComp(key,directionId);}catch(e){error.value=(e as Error).message;}}
async function pickTransition(id:string|null){try{selectedComp.value=await window.tftDesktop.selectTransition(id);}catch(e){error.value=(e as Error).message;}}
let offReader: (() => void) | undefined;
async function startReader() { try { acceptReader(await window.tftDesktop.readerStart()); } catch (e) { error.value = (e as Error).message; } }
function acceptReader(status: ReaderStatus) { readerStatus.value = status; session.value?.applyLiveStatus(status); const state = session.value?.controller.state(); if (state?.lastEvent !== '录像回放') recordStatus.value = state?.ready ? (status.testMode ? '协议测试对局 · 非真实读数' : '原生实时对局 · 记牌器已接入') : '尚未收到有效玩家快照'; }
async function showOverlay() { try { await window.tftDesktop.overlay('show'); } catch(e) { error.value=(e as Error).message; } }
async function stopReader() { await window.tftDesktop.readerStop(); }
const recordStatus = ref('尚未连接实时对局');
const pinned = ref(false);
const augments = shallowRef(bundledAugmentTiers);
const refreshing = ref(false);
const augmentError = ref('');
const comps = computed(() => allComps({ set: set.value }));
const sources = computed(() => Object.fromEntries(sourcesFor(set.value).map((s) => [s.id, s.count])));
const characters = computed(() => dataset.charactersOf(set.value));
const snapshotDate = String(metatftMeta().fetchedAt ?? '').slice(0, 10);
let offSettings: (() => void) | undefined;

onMounted(async () => {
  try {
    if (!window.tftDesktop) throw new Error('请通过 TFTBot 桌面程序启动');
    session.value = await createDesktopSession(window.tftDesktop);
    offComp=window.tftDesktop.onSelectedComp(c=>{selectedComp.value=c;});
    selectedComp.value=await window.tftDesktop.selectedComp();
    offReader = window.tftDesktop.onReader(acceptReader);
    acceptReader(await window.tftDesktop.readerSnapshot());
    set.value = session.value.currentSet();
    settings.value = session.value.settings.get();
    offSettings = session.value.settings.subscribe((s) => { settings.value = s; });
    const cached = await window.tftDesktop.augments(true);
    if (cached?.set === CURRENT_SET) augments.value = cached;
    await nextTick();
    window.tftDesktop.reportReady({ set: set.value, comps: comps.value.length, champions: characters.value.length, augments: augments.value.augments.length, source: 'MetaTFT + 官网 + Blitz' });
  } catch (e) { error.value = String((e as Error).message); }
});
onUnmounted(() => { offComp?.(); offReader?.(); offSettings?.(); session.value?.dispose(); });

async function updateSetting(key: keyof Settings, value: unknown) {
  try { await session.value?.settings.patch({ [key]: value }); } catch (e) { error.value = String((e as Error).message); }
}
async function refreshAugments() {
  if (refreshing.value) return;
  refreshing.value = true; augmentError.value = '';
  try { const fresh = await window.tftDesktop.augments(false); if (fresh && fresh.set !== CURRENT_SET) throw new Error('MetaTFT 数据与最新赛季不符'); if (fresh) augments.value = fresh; }
  catch (e) { augmentError.value = String((e as Error).message); }
  finally { refreshing.value = false; }
}
async function importRecording() {
  try {
    const recording = await window.tftDesktop.openRecording();
    if (recording && session.value) {
      const result = session.value.loadRecording(recording.text);
      recordStatus.value = `录像 · ${recording.name} · ${result.events} 条事件${result.invalid ? ` / ${result.invalid} 条无效` : ''}`;
      view.value = 'board'; error.value = '';
    }
  } catch (e) { error.value = String((e as Error).message); }
}
async function togglePin() { await window.tftDesktop.setAlwaysOnTop(!pinned.value); pinned.value = !pinned.value; }
</script>
<template>
  <div class="desktop-shell" data-desktop-ready="true" data-native-titlebar="true">
    <DesktopSidebar :view="view" :set="set" @navigate="view=$event"/>
    <header class="desktop-header"><div class="header-location"><span>工作台</span><i>/</i><strong>{{ nav.find(item=>item.id===view)?.name }}</strong></div><div class="header-actions"><span class="connection-status" :class="{live:readerStatus?.phase==='receiving'}" :title="readerStatus?.message??recordStatus"><i/>{{ readerStatus?.testMode?'协议测试':readerStatus?.phase==='receiving'?'正在同步对局':'等待对局' }}</span><button class="header-overlay" @click="showOverlay"><NavigationIcon name="overlay"/>局内浮窗</button><button class="pin-button" :class="{active:pinned}" :aria-pressed="pinned" :title="pinned?'取消窗口置顶':'窗口置顶'" aria-label="窗口置顶" @click="togglePin"><NavigationIcon name="pin"/></button></div></header>
    <main class="desktop-content" :class="{ 'comps-content': view === 'comps' }">
      <div v-if="error" class="error">{{ error }}</div>
      <CompBrowser v-if="view === 'comps'" :comps="comps" :set="set" :source="settings.compsSource" :snapshot-date="snapshotDate" :selected-key="selectedComp?.key" @select-comp="pickComp" @update:source="updateSetting('compsSource', $event)" />
      <AugmentsPage v-else-if="view === 'augments'" :snapshot="augments" :set="set" :loading="refreshing" :error="augmentError" @refresh="refreshAugments" />
      <SmartCompPanel v-else-if="view === 'advisor'" :status="readerStatus" :selected-key="selectedComp?.key" :selected-direction-id="selectedComp?.directionId" :mainline="selectedComp" @select-transition="pickTransition" @select-comp="pickComp" @start="startReader"/>

      <template v-else-if="view === 'board'"><div class="page-heading"><div><h1>对局面板</h1><p>{{ recordStatus }}</p></div><div><button data-show-overlay class="primary" @click="showOverlay">打开记牌浮窗</button> <button @click="importRecording">导入 JSONL 录像</button></div></div><ReaderPanel :status="readerStatus" :selected-ids="highlightedCompUnits(selectedComp)" @start="startReader" @stop="stopReader" /><div class="notice">商店、海克斯与全场持牌通过原版原生组件接收。全场数据以同一记分板快照统计；未齐或过期时暂停金币估算。</div><TrackerPanel v-if="session" :controller="session.controller" :status="readerStatus" /><TrickPage v-if="session" :controller="session.controller" :set="set" :settings="settings" /></template>
      <template v-else-if="view === 'settings'"><div class="page-heading"><div><h1>功能设置</h1><p>设置自动保存 · 仅使用最新赛季 S{{ set }}</p></div></div><div class="notice">独立版已接入原版只读采集链路；真实对局待验证，当前不执行游戏操作。</div><SettingsPage :settings="settings" @update:setting="updateSetting" /></template>
    </main>
    <footer class="desktop-footer"><span>{{ selectedComp ? `已选阵容：${selectedComp.name}` : `S${set} · 官网 / Blitz / MetaTFT` }}</span><span>{{ recordStatus }}</span></footer>
  </div>
</template>
