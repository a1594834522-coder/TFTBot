/**
 * UI 层入口 —— 悬浮卡 + 棋盘 + 记牌器条。
 *
 * 设计取向：
 *   - 组件只吃 props + 本包 dataset，不依赖页面全局 store → 可单独渲染、可 SSR 测试。
 *   - 全部 `<script setup lang="ts">`，无 this、无 mixin。
 *   - 未知 id 不抛错，渲染明确的 "未知棋子/装备/羁绊"（本实现会白屏）。
 */
export { default as CharacterHover } from './CharacterHover.vue';
export { default as ItemHover } from './ItemHover.vue';
export { default as TraitHover } from './TraitHover.vue';
export { default as BoardSlot } from './BoardSlot.vue';
export { default as TftBoard } from './TftBoard.vue';
export { default as CardTrackerStrip } from './CardTrackerStrip.vue';
export { default as CompsPanel } from './CompsPanel.vue';

/** 窗口页（整页装配）：trick 窗口 */
export { default as TrickPage } from '../windows/trick/TrickPage.vue';
export { createTrickController, type TrickCorePort, type TrickController, type TrickState } from '../windows/trick/controller';
export { mountTrick } from '../windows/trick/index';

/**
 * 把常用的 Vue API 一起 re-export：chunk 是完全自包含的，
 * 页面里 `import { createApp, h } from './tftbot-ui.js'` 即可，不需要 importmap。
 */
export { createApp, h, defineComponent, ref, computed, reactive, watch, nextTick, onMounted, onUnmounted } from 'vue';

import type { App, Plugin } from 'vue';
import CharacterHover from './CharacterHover.vue';
import ItemHover from './ItemHover.vue';
import TraitHover from './TraitHover.vue';
import BoardSlot from './BoardSlot.vue';
import TftBoard from './TftBoard.vue';
import CardTrackerStrip from './CardTrackerStrip.vue';
import CompsPanel from './CompsPanel.vue';
import TrickPage from '../windows/trick/TrickPage.vue';

export const tftbotUi: Plugin = {
  install(app: App) {
    app.component('CharacterHover', CharacterHover);
    app.component('ItemHover', ItemHover);
    app.component('TraitHover', TraitHover);
    app.component('BoardSlot', BoardSlot);
    app.component('TftBoard', TftBoard);
    app.component('CardTrackerStrip', CardTrackerStrip);
    app.component('CompsPanel', CompsPanel);
    app.component('TrickPage', TrickPage);
  },
};

export const components = { CharacterHover, ItemHover, TraitHover, BoardSlot, TftBoard, CardTrackerStrip, CompsPanel, TrickPage };

export const UI_VERSION = '0.4.0';
