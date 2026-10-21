#!/usr/bin/env node
/**
 * 生成 dist/boot/boot-demo.html —— 用假 cube 跑一遍「精简版 boot」：
 *   装配 background → 判断窗口=trick → 挂整页 → 喂两条 update-info → 断言 DOM 变化。
 * 这是"能装进真机窗口"的最小可运行证据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'dist', 'boot');
const chunk = path.join(outDir, 'tftbot-boot.js');
if (!fs.existsSync(chunk)) {
  console.error('先构建 boot：npm run build:boot');
  process.exit(2);
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>tftbot-boot demo</title>
<link rel="stylesheet" href="./tftbot.css" />
<style>body{margin:0;background:#0b0f14;color:#e6e6e6;font:13px/1.5 system-ui,sans-serif}</style></head>
<body>
<div id="app"></div>
<div id="app2" style="margin-top:12px"></div>
<div id="app3" style="margin-top:12px"></div>
<div id="app4" style="margin-top:12px"></div>
<script type="module">
import { boot, BOOT_VERSION } from './tftbot-boot.js';

// —— 假 cube：内存存储 + 可编程事件 + 窗口表 ——
const store = new Map();
const listeners = new Set();
const sent = [];
const received = new Set();
const opened = [];
['background','main','trick','tracker','characterwin','settings'].forEach((n) => opened.push(n));
const cube = {
  windows: {
    current: { id: () => 'trick', isOffscreen: () => false, dragMove(){} },
    getMainWindow: async () => ({ id: 'main' }),
    getCurrentWindow: async () => ({ id: 'trick', maximized: false }),
    getWindowByName: async (name) => { if (!opened.includes(name)) throw new Error('no window'); return { id: name }; },
    getWindowInfo: async () => ({ show: true }),
    obtainDeclaredWindow: async (n) => ({ id: n }),
    show: (id) => sent.push({ op: 'show', id }),
    hide: (id) => sent.push({ op: 'hide', id }),
    close(){}, minimize(){}, maximize(){}, unmaximize(){}, setSize(){}, setBounds(){}, setPosition(){}, on: () => () => {},
    message: {
      invoke: async (_w, cmd) => ({ cmd }),
      send: (windowId, command, payload) => { sent.push({ windowId, command, payload }); received.forEach((cb) => cb(command, payload)); },
      on: (event, cb) => { if (event === 'received') { received.add(cb); return () => received.delete(cb); } return () => {}; },
    },
  },
  io: { localStorage: {
    getItem: async (k) => store.get(k) ?? '',
    setItem: async (k, v) => { store.set(k, v); },
    removeItem: async (k) => { store.delete(k); },
  }},
  games: {
    getRunningGame: async () => ({ handle: 1, width: 1920, height: 1080, game: { classId: 5426 } }),
    on: () => () => {},
    launchers: { events: { on: () => () => {} }, invokeLEP: async () => Promise.reject(new Error('no lcu')) },
    events: {
      on: (event, cb) => { if (event === 'update-info') { listeners.add(cb); return () => listeners.delete(cb); } return () => {}; },
      getInfo: async () => null,
      provider: { loadGEP: async () => '', updateInfo(){}, triggerEvent(){} },
    },
  },
  utils: {}, net: {}, node: {}, settings: { setGeneralSetting(){} },
  extensions: { current: { getManifest: () => ({ meta: { name: 'tftbot', version: 'demo' }, data: {} }) } },
};

// 事件注入器（模拟原生层推 update-info）
window.__emit = (key, value) => listeners.forEach((cb) => cb({}, { key, value: typeof value === 'string' ? value : JSON.stringify(value) }));

// 预置设置：记牌器/预警/高亮都打开（默认是关的，正好用来验证门控）
store.set('tftbot:settings:demo', JSON.stringify({ showCardTracker: true, showWarning: true, chessHighlight: true, compsSource: 'metatft' }));

const handle = await boot({ cube, window: 'trick', el: '#app', initialSet: 18, getOwner: () => 'demo', shadow: true });
const trackerHandle = await boot({ cube, window: 'tracker', el: '#app2', initialSet: 18, getOwner: () => 'demo' });
const charHandle = await boot({ cube, window: 'characterwin', el: '#app3', initialSet: 18, characterId: 'DA_18_Caitlyn', getOwner: () => 'demo' });
const settingsHandle = await boot({ cube, window: 'settings', el: '#app4', getOwner: () => 'demo' });

// 喂一局：roster + players_info（三个页面共享同一条事件流）
window.__emit('tft_roster', [
  { summoner: 'Me', tag_line: '111', health: 72, index: 0, localplayer: '1' },
  { summoner: 'Foe', tag_line: '222', health: 40, index: 1 },
  { summoner: 'Out', tag_line: '333', health: 0, index: 2 },
]);
window.__emit('players_info', [
  { summoner: 'Me', tag_line: '111', champions: [{ name: 'DA_18_Caitlyn', level: 3 }, { name: 'DA_18_Ahri', level: 2 }] },
  { summoner: 'Foe', tag_line: '222', champions: [{ name: 'DA_18_Caitlyn', level: 2 }] },
  { summoner: 'Out', tag_line: '333', champions: [] },
]);

setTimeout(async () => {
  const q = (sel) => [...document.querySelectorAll(sel)];
  const text = document.body.innerText;
  const checks = [
    ['boot 版本', BOOT_VERSION === '0.2.0'],
    ['识别窗口 trick', handle.currentWindow === 'trick'],
    ['三页各挂一个窗口', [handle, trackerHandle, charHandle].every((h) => h.windows.length === 1)],
    ['精简版命令数', handle.lean.commands().length >= 30],
    ['非游戏命令不存在', !handle.lean.commands().includes('getFeaturesList')],
    // trick 页
    ['trick 存活数', document.querySelector('#app [data-alive]')?.getAttribute('data-alive') === '2'],
    ['trick 我方名', text.includes('Me#111')],
    ['trick 棋盘格数', q('#app [data-slot]').length === 37],
    ['trick 棋盘落子', q('#app [data-slot][data-character-id]:not([data-character-id=""])').length === 2],
    ['trick 记牌器', q('#app [data-champion]').length > 0],
    ['trick 玩家数', document.querySelector('#app [data-player-count]')?.getAttribute('data-player-count') === '3'],
    ['trick 事件驱动', document.querySelector('#app [data-last-event]')?.textContent?.includes('players_info')],
    ['trick 赛季芯片', q('#app [data-set]').length >= 2],
    // tracker 页
    ['tracker 存活数', document.querySelector('#app2 [data-alive]')?.getAttribute('data-alive') === '2'],
    ['tracker 玩家列表', q('#app2 [data-player]').length === 3],
    ['tracker 阵容面板', Number(document.querySelector('#app2 [data-comps]')?.getAttribute('data-comps') ?? 0) > 0],
    ['tracker 前期走向', !!document.querySelector('#app2 [data-stages]:not([data-stages="0"])')],
    ['tracker 前期阶段芯片', document.querySelectorAll('#app2 [data-stage]').length >= 4],
    // 阵容牌高亮联动
    ['高亮联动 写入共享存储', (() => { try { const v = JSON.parse(store.get('tftbot:highlight:units') || '{}'); return Array.isArray(v.units) && v.units.length > 0; } catch { return false; } })()],
    ['高亮联动 已发 IPC', sent.some((m) => m.command === 'highlightUnits')],
    ['tracker 自动选中阵容', !!document.querySelector('#app2 [data-selected]:not([data-selected=""])')],
    ['tracker 阵容详情羁绊', !!document.querySelector('#app2 [data-section="synergy"]')],
    ['tracker 详情小棋盘', q('#app2 [data-detail] [data-slot]').length === 37],
    ['tracker 赛季切换', q('#app2 [data-set]').length >= 2],
    ['tracker 当前赛季', document.querySelector('#app2 [data-current]')?.getAttribute('data-current') === '18'],
    ['tracker 段位徽标', !!document.querySelector('#app2 [data-tier]')],
    ['tracker MetaTFT 标记', !!document.querySelector('#app2 [data-metatft-count]')],
    ['tracker 升级节奏', !!document.querySelector('#app2 [data-section="levels"]')],
    ['tracker 装备建议', !!document.querySelector('#app2 [data-section="builds"]')],
    ['tracker 站位热区', !!document.querySelector('#app2 [data-heat]:not([data-heat=""])')],
    ['tracker 开局分支', !!document.querySelector('#app2 [data-section="early-options"]')],
    ['tracker 作者阵容', !!document.querySelector('#app2 [data-section="pro-comps"]')],
    // characterwin 页
    ['character 渲染', document.querySelector('#app3 [data-character-id="DA_18_Caitlyn"]') !== null],
    ['character 属性', q('#app3 [data-stat]').length >= 5],
    ['character 相关阵容', Number(document.querySelector('#app3 [data-comps]')?.getAttribute('data-comps') ?? 0) > 0],
    ['character 单卡表现或阵容', !!document.querySelector('#app3 [data-section="unit-stats"]') || !!document.querySelector('#app3 [data-section="comps"]')],
    // settings 页
    ['settings 四页挂窗口', [handle, trackerHandle, charHandle, settingsHandle].every((h) => h.windows.length === 1)],
    ['settings 开关数', q('#app4 [data-setting]').length >= 12],
    ['settings 阵容源芯片', q('#app4 [data-source]').length === 4],
    ['settings 开关状态', document.querySelector('#app4 [data-setting="showCardTracker"]')?.getAttribute('data-on') === '1'],
    // shadow 录制
    ['shadow 已开启', !!handle.shadow && typeof window.__TFTBOT_SHADOW__ === 'object'],
    ['shadow 录到事件', (window.__TFTBOT_SHADOW__?.size?.() ?? 0) >= 1],
    ['shadow dump 可解析', (window.__TFTBOT_SHADOW__?.dump?.() ?? '').split(String.fromCharCode(10)).filter(Boolean).every((l) => { try { return typeof JSON.parse(l).key === 'string'; } catch { return false; } })],
  ];
  await new Promise((r) => setTimeout(r, 1300)); // 等高亮兜底轮询（500ms）跑一轮
  const ok = checks.every(([, v]) => v);
  document.title = (ok ? 'PASS ' : 'FAIL ') + 'tftbot-boot ' + BOOT_VERSION;
  console.log('[boot-demo]', ok ? 'ALL PASS' : 'FAILED', JSON.stringify(checks));
}, 200);
</script>
</body></html>
`;

fs.writeFileSync(path.join(outDir, 'boot-demo.html'), html);
console.log('[boot-demo] wrote dist/boot/boot-demo.html');
