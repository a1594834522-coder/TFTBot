#!/usr/bin/env node
/**
 * 生成 dist/ui/ui-demo.html —— 在真浏览器里把 3 个悬浮组件挂起来，
 * 用于目视检查 + 作为"UI 层能用"的证据（配合截图/控制台自检）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'dist', 'ui');
const chunk = path.join(outDir, 'tftbot-ui.js');
if (!fs.existsSync(chunk)) {
  console.error('先构建 UI：npm run build:ui');
  process.exit(2);
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>tftbot-ui demo</title>
<link rel="stylesheet" href="./tftbot.css" />
<style>
  body { margin:0; padding:16px; background:#0b0f14; color:#e6e6e6;
         font:13px/1.5 ui-sans-serif,system-ui,sans-serif; }
  h1 { font-size:14px; color:#7dd3fc; margin:0 0 12px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-start; }
  .col { display:flex; flex-direction:column; gap:12px; }
</style></head>
<body>
<h1>tftbot-ui · 悬浮卡 / 棋盘 / 记牌器 / trick 窗口页 渲染自检</h1>
<div id="page"></div>
<div id="app" style="margin-top:16px"></div>
<script type="module">
import { createApp, h, CharacterHover, ItemHover, TraitHover, TftBoard, CardTrackerStrip, TrickPage, createTrickController, UI_VERSION } from './tftbot-ui.js';

// 假一局数据：棋盘 5 个棋子 + 备战席 2 个 + 记牌器 3 行
const champions = [
  { character_id: 'DA_18_Caitlyn', position: 0, level: 2, items: ['DA_Component_BFSword', 'DA_InfinityEdge'] },
  { character_id: 'DA_18_Ahri', position: 1, level: 2 },
  { character_id: 'DA_18_Caitlyn', position: 3, level: 3 },
  { character_id: 'DA_18_Ahri', position: 7, level: 1 },
  { character_id: 'DA_18_Caitlyn', position: 10, level: 1 },
  { character_id: 'DA_18_Ahri', position: 28, level: 2 },
  { character_id: 'DA_18_Caitlyn', position: 33, level: 1 },
];
const tracker = [
  { champion: 'DA_18_Caitlyn', cost: 2, owned: 9, remaining: 3 },
  { champion: 'DA_18_Ahri', cost: 1, owned: 6, remaining: 1 },
  { champion: 'DA_18_Teemo', cost: 4, owned: 2, remaining: 8 },
];

// ---- 整页：trick 窗口（用假快照驱动控制器）----
const snapshot = {
  alive: 3,
  ownedByName: { DA_18_Caitlyn: 12, DA_18_Ahri: 6, 'DA_18_Teemo': 2 },
  players: [
    { summoner: 'Me', tagLine: '111', name: 'Me#111', health: 72, index: 0, champions: [{ name: 'DA_18_Caitlyn', copies: 9, levels: [3], items: ['DA_Component_BFSword'] }, { name: 'DA_18_Ahri', copies: 3, levels: [2], items: [] }] },
    { summoner: 'Foe', tagLine: '222', name: 'Foe#222', health: 40, index: 1, champions: [{ name: 'DA_18_Caitlyn', copies: 3, levels: [2], items: [] }] },
    { summoner: 'Out', tagLine: '333', name: 'Out#333', health: 0, index: 2, champions: [] },
  ],
};
const catalog = [
  { character_id: 'DA_18_Caitlyn', cost: 2 },
  { character_id: 'DA_18_Ahri', cost: 1 },
  { character_id: 'DA_18_Teemo', cost: 4 },
];
const fakeCore = { snapshot: () => snapshot, onGame: () => () => {} };
const ctrl = createTrickController({ core: fakeCore, catalog, costs: [1, 2, 4], meName: 'Me#111' });
ctrl.apply(snapshot, 'players_info');
ctrl.select('DA_18_Caitlyn');
createApp({ render: () => h(TrickPage, { controller: ctrl, set: 18 }) }).mount('#page');

const app = createApp({
  render: () => h('div', { class: 'col' }, [
    h(TftBoard, { champions, highlightIds: ['DA_18_Caitlyn'] }),
    h(CardTrackerStrip, { rows: tracker }),
    h('div', { class: 'row' }, [
      h('div', { class: 'col' }, [
        h(CharacterHover, { characterId: 'DA_18_Caitlyn', set: 18, level: 2, items: ['DA_Component_BFSword', 'DA_InfinityEdge'] }),
        h(CharacterHover, { characterId: 'DA_18_Caitlyn', set: 18, compact: true }),
      ]),
      h('div', { class: 'col' }, [
        h(ItemHover, { itemId: 'DA_Component_BFSword' }),
        h(TraitHover, { traitId: 'DA_18_Inferno', count: 3 }),
      ]),
    ]),
  ]),
});
app.mount('#app');

// 自检：确认关键内容真的渲染出来（分两个作用域：#page 整页 / #app 组件）
setTimeout(() => {
  const page = document.querySelector('#page');
  const appEl = document.querySelector('#app');
  const q = (root, sel) => [...root.querySelectorAll(sel)];
  const filled = (root) => q(root, '[data-slot]').filter((el) => el.getAttribute('data-character-id')).length;
  const text = (root) => root.innerText;

  const checks = [
    // ---- 整页（trick 窗口）----
    ['整页存活数', page.querySelector('[data-alive]')?.getAttribute('data-alive') === '3'],
    ['整页我方名', text(page).includes('Me#111')],
    ['整页棋盘格数', q(page, '[data-slot]').length === 37],
    ['整页落子数', filled(page) === 2],
    ['整页玩家数', page.querySelector('[data-player-count]')?.getAttribute('data-player-count') === '3'],
    ['整页记牌器', q(page, '[data-champion]').length === 3],
    ['整页悬浮卡', !!page.querySelector('.ch') && text(page).includes('凯特琳')],
    // ---- 组件层 ----
    ['角色名', text(appEl).includes('凯特琳')],
    ['费用', text(appEl).includes('2费')],
    ['羁绊名', q(appEl, '[data-trait-id]').length > 0],
    ['装备名', text(appEl).includes('暴风大剑')],
    ['合成去向', text(appEl).includes('无尽之刃')],
    ['羁绊层级', text(appEl).includes('再 1 人')],
    ['组件棋盘格数', q(appEl, '[data-slot]').length === 37],
    ['组件落子数', filled(appEl) === 7],
    ['棋盘高亮', q(appEl, '.slot.highlight').length > 0],
    ['记牌器行数', q(appEl, '[data-champion]').length === 3],
    ['记牌器排序', q(appEl, '[data-champion]')[0]?.getAttribute('data-champion') === 'DA_18_Ahri'],
  ];
  const ok = checks.every(([, v]) => v);
  document.title = (ok ? 'PASS ' : 'FAIL ') + 'tftbot-ui ' + UI_VERSION;
  console.log('[ui-demo]', ok ? 'ALL PASS' : 'FAILED', JSON.stringify(checks));
}, 120);
</script>
</body></html>
`;

fs.writeFileSync(path.join(outDir, 'ui-demo.html'), html);
console.log('[ui-demo] wrote dist/ui/ui-demo.html');
