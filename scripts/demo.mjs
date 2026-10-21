#!/usr/bin/env node
/**
 * build 之后生成 dist/demo.html —— 在真实浏览器里跑一遍核心逻辑的自检页。
 * 用途：证明 TS → ESM chunk → 浏览器 这条管线是通的（不只是 node 单测通过）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>tftbot-core demo</title>
<style>
  body { font: 13px/1.6 ui-monospace, Menlo, Consolas, monospace; background:#111; color:#e6e6e6; padding:16px; }
  h1 { font-size:15px; color:#7dd3fc; margin:0 0 8px; }
  .pass { color:#4ade80; } .fail { color:#f87171; } pre { white-space:pre-wrap; margin:2px 0; }
</style>
</head>
<body>
<h1>tftbot-core · 浏览器自检</h1>
<div id="out">running…</div>
<script type="module">
import * as A from './tftbot-core.js';

const rows = [];
const t = (name, ok, extra = '') => rows.push({ name, ok, extra });
const render = () => {
  const ok = rows.every((r) => r.ok);
  document.getElementById('out').innerHTML =
    '<pre>' + rows.map((r) => \`<span class="\${r.ok ? 'pass' : 'fail'}">\${r.ok ? 'PASS' : 'FAIL'}</span> \${r.name} \${r.extra}\`).join('\\n') +
    \`\\n\\n\${ok ? '<span class="pass">ALL PASS</span>' : '<span class="fail">FAILED</span>'}</pre>\`;
  console.log('[demo]', ok ? 'ALL PASS' : 'FAILED', JSON.stringify(rows));
};

try {
  t('exports', typeof A.createCore === 'function' && typeof A.parseUpdateInfo === 'function', 'version=' + A.VERSION);

  // 1) 事件解析（本实现 JSON.parse 的地方）
  const rosterEvent = A.makeEvent('tft_roster', [
    { summoner: 'Me', tag_line: '999', health: 60, index: 0 },
    { summoner: 'Foe', tag_line: '888', health: 30, index: 1 },
  ]);
  const r1 = A.parseUpdateInfo(rosterEvent);
  t('parse tft_roster', r1.ok && r1.data.data.length === 2);

  // 2) 非法事件不炸
  const r2 = A.parseUpdateInfo({ key: 'tft_roster', value: '{oops' });
  t('invalid payload tolerated', r2.ok === false && !!r2.error);

  // 3) 棋子聚合（2星=3、3星=9）
  const playersEvent = A.makeEvent('players_info', [
    { summoner: 'Me', tag_line: '999', champions: [{ name: 'Teemo', level: 2 }, { name: 'Teemo', level: 1 }] },
    { summoner: 'Foe', tag_line: '888', champions: [{ name: 'Teemo', level: 3 }] },
  ]);
  const snap = A.buildSnapshot(r1.data.data, A.parseUpdateInfo(playersEvent).data.data);
  t('roster snapshot', snap.alive === 2 && snap.ownedByName.Teemo === 13, 'alive=' + snap.alive + ' owned=' + snap.ownedByName.Teemo);

  // 4) 记牌器 / 追三
  //    Teemo 已被全场拿 13 张 > 4 费池 12 → 池子空了，记牌器不显示（这是正确行为）
  const pool = A.analyzePool(snap.ownedByName, [{ character_id: 'Teemo', cost: 4 }, { character_id: 'Garen', cost: 5 }], {
    costs: [4, 5],
  });
  const teemoRow = pool.find((r) => r.champion === 'Teemo');
  t('pool exhausted', teemoRow.remaining === 0 && teemoRow.canThreeStar === false && A.cardTrackerRows(pool).length === 0);

  //    只拿 4 张时：池 12 → 剩 8，且在追三费用内，应出现一行
  const pool2 = A.analyzePool({ Teemo: 4 }, [{ character_id: 'Teemo', cost: 4 }], { costs: [4, 5] });
  const tracker2 = A.cardTrackerRows(pool2);
  t('card tracker row', tracker2.length === 1 && tracker2[0].remaining === 8, JSON.stringify(tracker2));

  // 5) 功能状态解析（server / always 两种策略）
  const server = A.parseFeatureUnlockResponse({ features: A.DEFAULT_FEATURES }, 'server');
  const always = A.parseFeatureUnlockResponse(null, 'always');
  t('feature gate (server)', A.isFeatureUnlocked(server.features, 'card_tracker') === false);
  t('feature gate (always)', A.isFeatureUnlocked(always.features, 'card_tracker', 'always') === true && always.membership.displayStatus === 'permanent');

  // 6) 设置归一化
  const s = A.normalizeSettings({ threeMarkCosts: [], level3Warning: [true] });
  t('settings normalize', s.threeMarkCosts.length === 2 && s.level3Warning.length === 7);

  // 7) 用假 cube 装配 core（无页面依赖）
  const listeners = new Set();
  const cube = {
    windows: {
      getMainWindow: async () => ({ id: 'background' }),
      message: { invoke: async () => ({ showCardTracker: true }), send(){}, on: () => () => {} },
      current: { id: () => 'demo', isOffscreen: () => false, dragMove(){} },
    },
    games: {
      events: { on: (_e, cb) => { listeners.add(cb); return () => listeners.delete(cb); }, provider: {} },
      launchers: { invokeLEP: async () => ({}) },
    },
  };
  const core = A.createCore({ cube, unlockPolicy: 'always', catalog: [{ character_id: 'Teemo', cost: 4 }] });
  listeners.forEach((cb) => cb({}, rosterEvent));
  listeners.forEach((cb) => cb({}, playersEvent));
  t('createCore wiring', core.snapshot()?.alive === 2 && core.cardTracker().length >= 0);
  const unlocked = await core.isUnlocked('card_tracker');
  t('core.isUnlocked (always, no network)', unlocked === true);
  core.dispose();

  // 8) background 装配：命令注册 / 设置持久化 / 阵容 CRUD / 广播
  const mem = new Map();
  const sent = [];
  const invoked = new Set();
  const bgCube = {
    ...cube,
    windows: {
      ...cube.windows,
      getWindowByName: async (name) => {
        if (!['background', 'main', 'trick', 'tracker'].includes(name)) throw new Error('no window ' + name);
        return { id: name };
      },
      message: {
        invoke: async () => undefined,
        send: (windowId, command, payload) => sent.push({ windowId, command, payload }),
        on: (event, cb) => {
          if (event === 'invoked') {
            invoked.add(cb);
            return () => invoked.delete(cb);
          }
          return () => {};
        },
      },
    },
    io: {
      localStorage: {
        getItem: async (k) => mem.get(k) ?? '',
        setItem: async (k, v) => { mem.set(k, v); },
        removeItem: async (k) => { mem.delete(k); },
      },
    },
  };
  const call = (command, payload) =>
    new Promise((resolve) => {
      let settled = false;
      for (const cb of invoked) cb(command, payload, (v) => { settled = true; resolve(v); });
      setTimeout(() => { if (!settled) resolve(undefined); }, 100);
    });
  const noNetApi = new A.HexApiClient({ fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ code: 500 }) }) });
  const app = A.createBackgroundApp(bgCube, { api: noNetApi, unlockPolicy: 'always', getOwner: () => 'demo-user' });
  await app.ready();
  t('background commands registered', app.commands().length >= 14, 'count=' + app.commands().length);

  const settings = await call('getSettings');
  t('getSettings + auto-unlock toggles', settings.showCardTracker === true && settings.threeMarkCosts.length === 2);

  const patched = await call('setSettings', { showThreeMark: false });
  t('setSettings broadcast', patched.showThreeMark === false && sent.some((s) => s.command === 'settingsChanged'));

  const savedComp = await call('setMyTeamComps', { name: '浏览器阵容', set: 18, units: [{ character_id: 'Teemo' }] });
  const comps = await call('getMyTeamComps', '');
  t('myTeamComps CRUD', !!savedComp.id && comps.length === 1 && sent.some((s) => s.command === 'myTeamCompsChanged'));
  await call('deleteMyTeamComps', savedComp.id);
  t('myTeamComps delete', (await call('getMyTeamComps', '')).length === 0);

  await call('setPinCompsInfo', { type: 'mycomps', set: 18, details: '{"units":[]}' });
  const pin = await call('getPinCompsInfo');
  t('pinComps set/get', pin.type === 'mycomps' && pin.details === '{"units":[]}');

  const features = await call('getFeaturesList');
  t('getFeaturesList', Array.isArray(features) && features.length === 4 && features.every((f) => f.unlocked));

  await call('setCurrentSet', 16);
  t('historical season rejected', (await call('getCurrentSet')) === 18 && !sent.some((s) => s.command === 'currentSetChanged'));

  // 9) 热键 / 录制 / 游戏数据（本轮新增）
  const TICK = String.fromCharCode(96); // 反引号，避免和外层模板字符串冲突
  const hk = await call('getShowMainHotkey');
  const hk2 = await call('setShowMainHotkey', 'ctrl+shift+m');
  t('hotkeys get/set/broadcast', hk.format === 'ctrl+' + TICK && hk2.format === 'ctrl+shift+m' && sent.some((s) => s.command === 'showMainHotkeyChanged'));

  const obs = await call('getObsState');
  const encoders = await call('getVideoEncoders');
  const recSet = await call('setRecordBaseSetting', { fps: 30 });
  t('recorder state/encoders/settings', obs.isRecord === false && encoders.length >= 1 && recSet.fps === 30);

  const chars = await call('getCharacters', 18);
  const items = await call('getItems');
  const traits = await call('getTraits');
  t('game data from extracted JSON', chars.length === 74 && items.length > 150 && traits.length > 30, 'chars=' + chars.length + ' items=' + items.length + ' traits=' + traits.length);

  const dataset = A.dataset;
  t('dataset lookups', dataset.characterById('DA_18_Caitlyn')?.display_name === '凯特琳' && dataset.itemBuildGraph('DA_Component_BFSword').into.length > 5);

  // 10) 回放器：把一段事件流重算成快照
  const jsonl = [
    { t: 0, key: 'tft_roster', value: JSON.stringify([{ summoner: 'Me', tag_line: '1', health: 100, index: 0 }, { summoner: 'Foe', tag_line: '2', health: 40, index: 1 }]) },
    { t: 900, key: 'players_info', value: JSON.stringify([{ summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 3 }] }, { summoner: 'Foe', tag_line: '2', champions: [{ name: 'DA_18_Caitlyn', level: 2 }] }]) },
  ].map((e) => JSON.stringify(e)).join('\\n');
  const replay = A.replayText(jsonl, { catalog: chars.map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost })) });
  t('replay jsonl -> snapshot', replay.events === 2 && replay.final.alive === 2 && replay.final.ownedByName['DA_18_Caitlyn'] === 12);

  t('unimplemented command -> undefined', (await call('rebuildGameinWindows')) === undefined);
  app.dispose();
} catch (e) {
  t('uncaught', false, String(e && e.message));
}
render();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(dist, 'demo.html'), html);
console.log('[demo] wrote dist/demo.html');
