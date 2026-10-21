import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, screen, session } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createFileStorage } from './storage';
import { createMetatftClient } from '../core/metatft';
import { parseAugmentTiers } from '../game/metatft-augments';
import { requireCurrentSeason } from '../game/current-season';
import { createNativeReader } from './native-reader';
import { createLiveMonitor } from './live-monitor';
import { resolveSelectedComp, highlightedCompUnits } from '../game/selected-comp';
import {createCompAdvisor} from '../game/comp-advisor';
import {metatftComps} from '../game/comps-sources';
import {earlyStages} from '../game/metatft-early';
import {dataset} from '../game/tft-data';
import {defaultAdvisorPreferences,type AdvisorPreferences} from '../game/advisor-preferences';
import {createBattleService} from './battle-service';
import {resolveHoldAdvice,directionBoardUnits} from '../game/resolve-hold-advice';
import {applyDirectionSelection} from '../game/direction-selection';

const smoke = process.argv.includes('--smoke');
const headlessSmoke=smoke&&process.argv.includes('--headless');
const smokeDir = process.env.TFTBOT_SMOKE_DIR;
app.setName('TFTBot');
if(smoke){const profile=path.resolve(smokeDir??app.getPath('temp'),`test-profile-${process.pid}`);mkdirSync(profile,{recursive:true});app.setPath('userData',profile);}
protocol.registerSchemesAsPrivileged([{ scheme: 'tftbot', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let augmentWindow: BrowserWindow | null = null;
if (!smoke && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.whenReady().then(start).catch(async (error) => {
    console.error(error);
    if (!smoke) dialog.showErrorBox('TFTBot 启动失败', String(error?.message ?? error));
    app.exit(1);
  });
}
app.on('window-all-closed', () => app.quit());

function trusted(event: IpcMainEvent | IpcMainInvokeEvent) {
  const url = new URL(event.senderFrame?.url ?? 'about:blank');
  if (![window?.webContents, overlayWindow?.webContents, augmentWindow?.webContents].includes(event.sender) || url.protocol !== 'tftbot:' || url.host !== 'app') throw new Error('无效桌面请求');
}

async function start() {
  const advisor=createCompAdvisor(metatftComps(18));
  let advisorPreferences=defaultAdvisorPreferences(),advisorLobby='';
  let selectedComp: ReturnType<typeof resolveSelectedComp> = null;
  function publishAdvisorPreferences(){for(const target of [window,overlayWindow,augmentWindow])if(target&&!target.isDestroyed())target.webContents.send('desktop:advisor:preferences',advisorPreferences);}
  function advice(status:ReturnType<typeof reader.snapshot>){
    const lobby=status.tracker?.snapshot?.players.map(p=>p.name).sort().join('|')??'';
    if(advisorLobby && lobby!==advisorLobby){advisorPreferences=defaultAdvisorPreferences();publishAdvisorPreferences();}
    advisorLobby=lobby;
    return advisor.evaluate(status,advisorPreferences.items,Date.now(),advisorPreferences.stage,advisorPreferences.boardId);
  }
  const nativeSmoke = process.argv.includes('--native-smoke');
  const monitor = process.env.TFTBOT_MONITOR_DIR && !smoke ? createLiveMonitor(path.resolve(process.env.TFTBOT_MONITOR_DIR)) : null;
  const battles=createBattleService(value=>{for(const target of [window,overlayWindow,augmentWindow])if(target&&!target.isDestroyed())target.webContents.send('desktop:battle:update',value);syncAugmentLayer(reader.snapshot());monitor?.note('battle-forecast',value);});
  const reader = createNativeReader(status => { advice(status);battles.update(status,advisorPreferences.items,advisorPreferences.searchBudget??null,selectedComp); for (const target of [window, overlayWindow, augmentWindow]) if (target && !target.isDestroyed()) target.webContents.send('desktop:reader:update', status); syncAugmentLayer(status); monitor?.status(status); }, { onNativeLog: message=>monitor?.note('native-overlay',message), onPacket: (payload, accepted) => monitor?.packet(payload,accepted), cacheRoot: path.join(path.dirname(app.getPath('exe')), 'resources', 'tftbot-native'), ...(nativeSmoke ? { testMode: true, channel: process.env.TFTBOT_TEST_CHANNEL } : {}) });
  const battleFreshnessTimer=setInterval(()=>battles.update(reader.snapshot(),advisorPreferences.items,advisorPreferences.searchBudget??null,selectedComp),1000);
  let capturedLiveView = false;
  const monitorTimer = monitor ? setInterval(async () => {
    monitor.status(reader.snapshot(),true);
    if(window && !window.isDestroyed() && reader.snapshot().frames>0){
      try {
        const view = await window.webContents.executeJavaScript(`({shop:Array.from(document.querySelectorAll('[data-shop-card]')).map(e=>e.querySelector('strong')?.textContent),augments:Array.from(document.querySelectorAll('[data-live-augment]')).map(e=>e.textContent),trackerReady:document.querySelector('[data-card-tracker]')?.getAttribute('data-ready'),trackerComplete:document.querySelector('[data-card-tracker]')?.getAttribute('data-complete'),boardReady:document.querySelector('.trick')?.getAttribute('data-ready')})`);
        monitor.note('renderer-health',view);
        if(overlayWindow && !overlayWindow.isDestroyed()){
          const overlay=await overlayWindow.webContents.executeJavaScript(`({ready:document.querySelector('[data-game-overlay]')?.getAttribute('data-ready'),slots:Array.from(document.querySelectorAll('[data-overlay-unit]')).map(e=>e.textContent),budget:document.querySelector('[data-overlay-budget]')?.textContent,visible:document.visibilityState})`);
          monitor.note('overlay-health',overlay);
        }
        if(!capturedLiveView && view.shop.length){capturedLiveView=true;await fs.writeFile(path.join(process.env.TFTBOT_MONITOR_DIR!,'latest-ui.png'),(await window.webContents.capturePage()).toPNG());}
      }catch(error){monitor.note('renderer-health-error',String(error));}
    }
  }, 5000) : null;
  app.once('before-quit', event => { event.preventDefault();clearInterval(battleFreshnessTimer);battles.dispose(); if(monitorTimer) clearInterval(monitorTimer); reader.dispose().then(()=>monitor?.flush()).finally(() => app.quit()); });
  ipcMain.handle('desktop:battle:snapshot',event=>{trusted(event);return battles.snapshot();});
  ipcMain.handle('desktop:reader:start', async event => { trusted(event); return reader.start(); });
  ipcMain.handle('desktop:reader:stop', event => { trusted(event); reader.stop(); });
  ipcMain.handle('desktop:reader:snapshot', event => { trusted(event); return reader.snapshot(); });
  let locked = false, collapsed = false;
  const overlayState = () => ({ visible: !!overlayWindow?.isVisible(), locked, collapsed });
  const publishOverlay = () => { for (const target of [window, overlayWindow]) if (target && !target.isDestroyed()) target.webContents.send('desktop:overlay:state', overlayState()); };
  async function showOverlay() {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      locked = false; collapsed = false;
      overlayWindow = new BrowserWindow({ title: 'TFTBot · 局内记牌器', width: 584, height: selectedComp ? 248 : 192, minWidth: 584, minHeight: 42, frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !smoke } });
      overlayWindow.setMenu(null);
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      overlayWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('tftbot://app/')) event.preventDefault(); });
      overlayWindow.once('closed', () => { overlayWindow = null; publishOverlay(); });
      await overlayWindow.loadURL('tftbot://app/index.html#overlay');
    }
    if(!headlessSmoke)overlayWindow.showInactive(); publishOverlay();
    if (reader.snapshot().phase === 'stopped') await reader.start();
  }
  function lockOverlay(value: boolean) { locked = value; overlayWindow?.setIgnoreMouseEvents(value, { forward: true }); publishOverlay(); }
  ipcMain.handle('desktop:overlay', async (event, action) => {
    trusted(event);
    if (action === 'show') await showOverlay();
    else if (action === 'hide') overlayWindow?.hide();
    else if (action === 'lock' || action === 'unlock') lockOverlay(action === 'lock');
    else if (action === 'collapse' || action === 'expand') { collapsed = action === 'collapse'; overlayWindow?.setSize(584, collapsed ? 42 : selectedComp ? 248 : 192); }
    else if (action !== 'snapshot') throw new Error('无效浮窗操作');
    publishOverlay(); return overlayState();
  });
  // F8 restores a hidden overlay; Ctrl+Shift+F8 recovers mouse interaction after locking.
  if (!smoke) {
    globalShortcut.register('F8', () => { if (overlayWindow?.isVisible()) { overlayWindow.hide(); publishOverlay(); } else void showOverlay(); });
    globalShortcut.register('CommandOrControl+Shift+F8', () => lockOverlay(!locked));
  }
  app.once('will-quit', () => globalShortcut.unregisterAll());
  function syncAugmentLayer(status: ReturnType<typeof reader.snapshot>) {
    if (!augmentWindow || augmentWindow.isDestroyed()) return;
    const bounds = nativeSmoke ? screen.getPrimaryDisplay().bounds : status.gameBounds ? screen.screenToDipRect(null, status.gameBounds) : null;
    const shopVisible=status.cards.shopVisible!==false;
    const holds=selectedComp?null:resolveHoldAdvice(battles.snapshot().direction,advice(status).holds,advisorPreferences);
    const hasContent = status.cards.augments.some(Boolean) || shopVisible && (status.cards.shop[4]?.kind==='wisp' || !!selectedComp && status.cards.shop.some(c=>c && highlightedCompUnits(selectedComp).includes(c.id)) || !!holds?.cards.some(c=>c.quantity>0));
    if (!bounds || !hasContent || ['error','stopped','waiting'].includes(status.phase)) { augmentWindow.hide(); return; }
    const prev = augmentWindow.getBounds();
    if (['x','y','width','height'].some(k => prev[k as keyof typeof prev] !== bounds[k as keyof typeof bounds])) augmentWindow.setBounds(bounds);
    if(!headlessSmoke)augmentWindow.showInactive();
  }
  const rendererRoot = path.join(__dirname, 'renderer');
  protocol.handle('tftbot', (request) => {
    const url = new URL(request.url);
    const file = path.resolve(rendererRoot, '.' + decodeURIComponent(url.pathname));
    const relative = path.relative(rendererRoot, file);
    if (url.host !== 'app' || relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const storage = createFileStorage(path.join(app.getPath('userData'), 'preferences.json'));
  if(process.argv.includes('--clear-selection'))await storage.removeItem('tftbot:desktop:selected-comp');
  try { selectedComp = resolveSelectedComp(await storage.getItem('tftbot:desktop:selected-comp')); } catch { /* stale season selection */ }
  try {const saved=JSON.parse(await storage.getItem('tftbot:desktop:selected-transition'));if(selectedComp && saved?.key===selectedComp.key)selectedComp=resolveSelectedComp(selectedComp.key,saved.id);}catch{}
  try {const saved=JSON.parse(await storage.getItem('tftbot:desktop:selected-direction'));if(selectedComp&&saved?.key===selectedComp.key)selectedComp=applyDirectionSelection(selectedComp,saved.id);}catch{}
  const publishSelectedComp=()=>{battles.update(reader.snapshot(),advisorPreferences.items,advisorPreferences.searchBudget??null,selectedComp);if(overlayWindow&&!overlayWindow.isDestroyed()&&!collapsed)overlayWindow.setSize(584,selectedComp?248:192);for(const target of [window,overlayWindow,augmentWindow])if(target && !target.isDestroyed())target.webContents.send('desktop:comp:update',selectedComp);syncAugmentLayer(reader.snapshot());};
  ipcMain.handle('desktop:advisor:get',event=>{trusted(event);return advisorPreferences;});
  ipcMain.handle('desktop:advisor:configure',(event,value:AdvisorPreferences)=>{
    trusted(event);
    const direction=battles.snapshot().direction;
    if(!value || !Array.isArray(value.items)||value.items.length>30||value.items.some(id=>typeof id!=='string'||!dataset.item(id)) || value.stage!==null&&![2,3,4,5].includes(value.stage) || value.boardId!==null&&!earlyStages(18).some(s=>s.boards.some(b=>b.id===value.boardId))&&!directionBoardUnits(value.boardId)&&!(direction?.ready&&direction.holds.boards.some(b=>b.id===value.boardId)))throw new Error('智能定阵输入无效');
    if(value.searchBudget!==undefined&&value.searchBudget!==null&&(!Number.isSafeInteger(value.searchBudget)||value.searchBudget<0||value.searchBudget>200))throw new Error('搜牌预算无效');
    advisorPreferences={items:[...value.items],stage:value.stage,boardId:value.boardId,searchBudget:value.searchBudget??null};publishAdvisorPreferences();battles.update(reader.snapshot(),advisorPreferences.items,advisorPreferences.searchBudget??null,selectedComp);syncAugmentLayer(reader.snapshot());return advisorPreferences;
  });
  ipcMain.handle('desktop:comp:get', event => { trusted(event); return selectedComp; });
  ipcMain.handle('desktop:comp:select', async (event,key,directionId?:string) => {
    trusted(event);
    if(key!==null && (typeof key!=='string' || key.length>256))throw new Error('阵容参数无效');
    if(directionId!==undefined&&(typeof directionId!=='string'||directionId.length>600))throw new Error('核心变体参数无效');
    const next=applyDirectionSelection(resolveSelectedComp(key,directionId?null:undefined),directionId);
    await storage.setItem('tftbot:desktop:selected-comp',next?.key??'');selectedComp=next;
    await storage.setItem('tftbot:desktop:selected-transition',JSON.stringify({key:next?.key,id:next?.transitionId}));
    await storage.setItem('tftbot:desktop:selected-direction',JSON.stringify({key:next?.key,id:next?.directionId}));
    publishSelectedComp();
    monitor?.note('selected-comp',selectedComp);
    syncAugmentLayer(reader.snapshot());
    return selectedComp;
  });
  ipcMain.handle('desktop:comp:transition',async(event,id)=>{
    trusted(event);if(id!==null && (typeof id!=='string'||id.length>100))throw new Error('过渡路线参数无效');
    if(!selectedComp)throw new Error('请先在软件中选择阵容');
    const next=applyDirectionSelection(resolveSelectedComp(selectedComp.key,id),selectedComp.directionId);
    await storage.setItem('tftbot:desktop:selected-transition',JSON.stringify({key:next!.key,id:next!.transitionId}));
    selectedComp=next;publishSelectedComp();monitor?.note('selected-transition',id);return selectedComp;
  });
  const augmentFile = path.join(app.getPath('userData'), 'metatft-augments.json');
  const client = createMetatftClient({ timeoutMs: 15_000, retries: 1 });
  ipcMain.handle('desktop:storage', async (event, action, key, value) => {
    trusted(event);
    if (action === 'get') return storage.getItem(key);
    if (action === 'set') return storage.setItem(key, value);
    if (action === 'remove') return storage.removeItem(key);
    throw new Error('无效存储操作');
  });
  ipcMain.handle('desktop:augments', async (event, cachedOnly) => {
    trusted(event);
    if (cachedOnly === true) {
      try { const cached = parseAugmentTiers(JSON.parse(await fs.readFile(augmentFile, 'utf8'))); requireCurrentSeason(cached.set); return cached; } catch { return null; }
    }
    const [patch, response] = await Promise.all([client.patch(), client.augmentTiers()]);
    const raw = { meta: { patch: patch.patch + patch.b_patch_version, fetchedAt: new Date().toISOString() }, response };
    const parsed = parseAugmentTiers(raw);
    requireCurrentSeason(parsed.set);
    await fs.mkdir(path.dirname(augmentFile), { recursive: true });
    await fs.writeFile(augmentFile + '.tmp', JSON.stringify(raw), 'utf8');
    await fs.rename(augmentFile + '.tmp', augmentFile);
    return parsed;
  });
  ipcMain.handle('desktop:recording', async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog(window!, { title: '打开对局事件录像', properties: ['openFile'], filters: [{ name: '对局录像', extensions: ['jsonl'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 5_000_000) throw new Error('录像超过 5 MB，请裁剪后导入');
    return { name: path.basename(file), text: await fs.readFile(file, 'utf8') };
  });
  ipcMain.handle('desktop:pin', (event, enabled) => { trusted(event); window!.setAlwaysOnTop(enabled === true); });
  window = new BrowserWindow({
    title: 'TFTBot · 云顶助手', width: 1440, height: 960, minWidth: 1080, minHeight: 720,
    backgroundColor: '#0b0f17', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !smoke },
  });
  window.once('closed', () => { overlayWindow?.close(); augmentWindow?.close(); app.quit(); });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('tftbot://app/')) event.preventDefault(); });
  window.webContents.on('render-process-gone', (_event, details) => { console.error('renderer stopped:', details.reason); monitor?.note('renderer-stopped',details); });
  window.webContents.on('console-message', (details) => { if (details.level === 'error') console.error('[renderer]', details.message); });
  augmentWindow = new BrowserWindow({ title: 'TFTBot · 海克斯卡片评级', ...screen.getPrimaryDisplay().bounds, frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true, focusable: false, movable: false, resizable: false, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !smoke } });
  augmentWindow.setAlwaysOnTop(true, 'screen-saver');
  augmentWindow.setIgnoreMouseEvents(true, { forward: true });
  augmentWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  augmentWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('tftbot://app/')) event.preventDefault(); });
  await augmentWindow.loadURL('tftbot://app/index.html#augment-overlay');
  const timeout = smoke ? setTimeout(() => { console.error('DESKTOP_SMOKE_TIMEOUT'); app.exit(1); }, 30_000) : null;
  ipcMain.once('desktop:ready', async (event, report) => {
    trusted(event);
    if (!smoke) {
      if(process.argv.includes('--background'))window!.showInactive();else{window!.show(); window!.focus();}
      if (process.argv.includes('--reader')) {
        await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="board"]').click()`);
        await reader.start();
      }
      if (process.argv.includes('--overlay')) await showOverlay();
      return;
    }
    try {
      if (!(report?.comps > 0 && report?.champions > 0 && report?.augments > 0)) throw new Error('桌面数据或界面未加载');
      // Vue can mount before remote images finish; do not quit while loadURL is pending.
      if (window!.webContents.isLoadingMainFrame()) await new Promise<void>(resolve => window!.webContents.once('did-finish-load', () => resolve()));
      if (smokeDir) {
        await fs.mkdir(smokeDir, { recursive: true });
        await fs.writeFile(path.join(smokeDir, 'desktop-ready.json'), JSON.stringify(report, null, 2));
        if(!headlessSmoke)window!.showInactive();
        await new Promise((resolve) => setTimeout(resolve, 300));
        await fs.writeFile(path.join(smokeDir, 'desktop.png'), (await window!.webContents.capturePage()).toPNG());
        const initial = await window!.webContents.executeJavaScript(`({
          primary: document.querySelector('[data-source="metatft"]')?.classList.contains('chosen'),
          cards: document.querySelectorAll('article[data-comp]').length,
          chinese: [...document.querySelectorAll('.comp-title strong')].every(n => /[\\u3400-\\u9fff]/.test(n.textContent)),
          historicalSwitcher: !!document.querySelector('select[aria-label="赛季"]')
        })`);
        if (!initial.primary || !initial.cards || !initial.chinese || initial.historicalSwitcher) throw new Error('默认 MetaTFT、中文名称或最新赛季约束未生效');
        for (const page of ['advisor','augments', 'champions', 'board', 'settings', 'comps']) {
          await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="${page}"]').click()`);
          await new Promise(resolve => setTimeout(resolve, 150));
          const visible = await window!.webContents.executeJavaScript(`!!document.querySelector('[data-nav="${page}"].current') && !!document.querySelector('.desktop-content')?.textContent.trim()`);
          if (!visible) throw new Error(`桌面页面 ${page} 未显示`);
          if (page === 'augments') {
            const count = await window!.webContents.executeJavaScript(`document.querySelectorAll('[data-rating]').length`);
            if (count !== report.augments) throw new Error('海克斯评级页未加载');
            await fs.writeFile(path.join(smokeDir, 'augments.png'), (await window!.webContents.capturePage()).toPNG());
          }
        }
        await fs.writeFile(path.join(smokeDir, 'ui-checks.json'), JSON.stringify(initial, null, 2));
        if (nativeSmoke) {
          await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="comps"]').click()`);
          await new Promise(resolve => setTimeout(resolve, 50));
          await window!.webContents.executeJavaScript(`document.querySelector('[data-pick-comp]').click()`);
          await new Promise(resolve => setTimeout(resolve, 80));
          if (!selectedComp) throw new Error('选用阵容未同步到主进程');
          await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="board"]').click()`);
          await new Promise(resolve => setTimeout(resolve, 100));
          await window!.webContents.executeJavaScript(`document.querySelector('[data-reader-start]').click()`);
          let received = false;
          for (let attempt = 0; attempt < 40; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 150));
            received = await window!.webContents.executeJavaScript(`document.querySelectorAll('[data-shop-card]').length === 5 && document.querySelectorAll('[data-live-augment]').length === 3 && document.querySelector('[data-card-tracker]')?.dataset.complete === 'true' && document.querySelector('[data-roll-estimate]')?.textContent.includes('金币')`);
            if (received) break;
          }
          if (!received || !reader.snapshot().testMode) throw new Error('原生 IPC -> 桌面识别链路失败');
          await fs.writeFile(path.join(smokeDir, 'recognition.json'), JSON.stringify(reader.snapshot(), null, 2));
          await fs.writeFile(path.join(smokeDir, 'recognition.png'), (await window!.webContents.capturePage()).toPNG());
          await window!.webContents.executeJavaScript(`document.querySelector('[data-card-tracker]').scrollIntoView({block:'start'})`);
          await new Promise(resolve => setTimeout(resolve, 100));
          await fs.writeFile(path.join(smokeDir, 'tracker.png'), (await window!.webContents.capturePage()).toPNG());
          const trackerCheck = await window!.webContents.executeJavaScript(`({rows:document.querySelectorAll('[data-tracker-hero]').length,text:document.querySelector('[data-card-tracker]').textContent})`);
          if (trackerCheck.rows !== 65 || !trackerCheck.text.includes('测试玩家#001 ×4')) throw new Error('记牌器星级合并或全英雄展示失败');
          await showOverlay();
          let overlayReady = false;
          for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            overlayReady = await overlayWindow!.webContents.executeJavaScript(`document.querySelector('[data-game-overlay]')?.dataset.ready === 'true' && document.querySelectorAll('[data-overlay-unit]').length > 0`);
            if (overlayReady) break;
          }
          if (!overlayReady || !overlayWindow!.isAlwaysOnTop() || overlayWindow!.isVisible() !== !headlessSmoke) throw new Error('局内浮窗数据同步或置顶失败');
          for(let i=0;i<40&&battles.snapshot().phase!=='ready';i++)await new Promise(resolve=>setTimeout(resolve,100));
          const forecast=battles.snapshot();
          if(forecast.phase!=='ready'||forecast.coverage!==1||forecast.winRate===null||forecast.opponents.length!==1)throw new Error('原生棋盘→本地模型→全场加权胜率失败：'+JSON.stringify(forecast));
          if(!forecast.direction?.ready||forecast.direction.rows.length!==3||!forecast.direction.holds.boards.length)throw new Error('个人持牌未进入关键节点定阵与实际过渡关联');
          await fs.writeFile(path.join(smokeDir,'direction-advisor.json'),JSON.stringify(forecast.direction,null,2));
          console.log('DIRECTION_ADVISOR_SMOKE_PASS');
          const winBadge=await overlayWindow!.webContents.executeJavaScript(`document.querySelector('[data-win-chance]')?.textContent`);
          if(!winBadge.includes('%'))throw new Error('加权模型胜率未同步到浮窗');
          for(let i=0;i<40&&!battles.snapshot().tactics?.ready;i++)await new Promise(resolve=>setTimeout(resolve,100));
          const tactics=battles.snapshot().tactics;
          if(!tactics?.ready||!tactics.choices.length||tactics.searchedPlans<2)throw new Error('原生经济数据未进入合法购买组合搜索：'+JSON.stringify(tactics));
          if(tactics.choices.some(c=>c.delta!==null&&c.delta< -1e-6))throw new Error('战术方案错误地排除了真实不动棋盘对照');
          await fs.writeFile(path.join(smokeDir,'shopping-tactics.json'),JSON.stringify(tactics,null,2));
          console.log('SHOPPING_TACTICS_SMOKE_PASS');
          for(let i=0;i<80&&!battles.snapshot().strategy?.ready;i++)await new Promise(resolve=>setTimeout(resolve,100));
          const strategy=battles.snapshot().strategy;
          if(!strategy?.ready||!strategy.rows.length||strategy.rows.some(row=>row.goal.evidence.length===0))throw new Error('原生全场持牌未进入跨阶段核心目标规划：'+JSON.stringify(strategy));
          await fs.writeFile(path.join(smokeDir,'strategic-options.json'),JSON.stringify(strategy,null,2));
          console.log('STRATEGIC_OPTIONS_SMOKE_PASS');
          await fs.writeFile(path.join(smokeDir,'battle-forecast.json'),JSON.stringify(forecast,null,2));
          console.log('BATTLE_FORECAST_SMOKE_PASS');
          const anchored = await augmentWindow!.webContents.executeJavaScript(`({width:innerWidth,ratings:Array.from(document.querySelectorAll('[data-anchored-rating]')).map(e=>{const r=e.getBoundingClientRect();return {rating:e.querySelector('b').textContent,center:(r.left+r.right)/2};})})`);
          const highlights = await augmentWindow!.webContents.executeJavaScript(`document.querySelectorAll('[data-shop-highlight]').length`);
          if (!highlights) throw new Error('选用阵容未高亮游戏商店目标卡');
          if (anchored.ratings.length !== 3 || augmentWindow!.isVisible() !== !headlessSmoke || augmentWindow!.isFocusable()) throw new Error('海克斯独立透明叠加层失败');
          await fs.writeFile(path.join(smokeDir,'anchor-geometry.json'),JSON.stringify(anchored,null,2));
          if (anchored.ratings.some((r:{center:number},i:number)=>Math.abs(r.center/anchored.width - (.145+.71*(i+.5)/3))>.003)) throw new Error('海克斯评级三列锚点偏移');
          const augmentCapture = await augmentWindow!.webContents.capturePage();
          if (augmentCapture.toBitmap()[3] !== 0) throw new Error('海克斯叠加层背景不透明');
          await fs.writeFile(path.join(smokeDir, 'augment-overlay.png'), augmentCapture.toPNG());
          await fs.writeFile(path.join(smokeDir, 'overlay.png'), (await overlayWindow!.webContents.capturePage()).toPNG());
          const wisp=await augmentWindow!.webContents.executeJavaScript(`({id:document.querySelector('[data-wisp-rating]')?.getAttribute('data-wisp-rating'),tier:document.querySelector('[data-wisp-rating] b')?.textContent})`);
          if(wisp.tier!=='S')throw new Error('仙灵原生槽位到独立评级叠加失败');
          await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="advisor"]').click()`);
          await new Promise(resolve=>setTimeout(resolve,100));
          const ranked=await window!.webContents.executeJavaScript(`document.querySelector('[data-smart-advisor]')?.dataset.ready==='true'&&document.querySelectorAll('[data-suggestion]').length===3`);
          if(!ranked)throw new Error('真实协议输入未进入智能定阵');
          const directionPanel=await window!.webContents.executeJavaScript(`['flex','selected'].includes(document.querySelector('[data-direction-advisor]')?.dataset.mode)&&document.querySelectorAll('[data-direction-advisor] [data-advisor-pick]').length===3`);
          if(!directionPanel)throw new Error('关键节点定阵仍显示旧规则排序');
          await window!.webContents.executeJavaScript(`document.querySelector('[data-direction-advisor]').scrollIntoView({block:'center'})`);
          await new Promise(resolve=>setTimeout(resolve,100));
          await fs.writeFile(path.join(smokeDir,'direction-advisor.png'),(await window!.webContents.capturePage()).toPNG());
          const tacticalPanel=await window!.webContents.executeJavaScript(`document.querySelector('[data-shopping-tactics]')?.dataset.ready==='true'&&document.querySelectorAll('[data-tactical-choice]').length>0`);
          if(!tacticalPanel)throw new Error('商店战术方案未显示在智能定阵页面');
          const strategicPanel=await window!.webContents.executeJavaScript(`document.querySelector('[data-strategic-options]')?.dataset.ready==='true'&&document.querySelectorAll('[data-strategic-route]').length>0`);
          if(!strategicPanel)throw new Error('真实转型规划未显示在智能定阵页面');
          await window!.webContents.executeJavaScript(`document.querySelector('[data-strategic-options]').scrollIntoView({block:'center'})`);
          await new Promise(resolve=>setTimeout(resolve,100));
          await fs.writeFile(path.join(smokeDir,'strategic-options.png'),(await window!.webContents.capturePage()).toPNG());
          await window!.webContents.executeJavaScript(`document.querySelector('[data-shopping-tactics]').scrollIntoView({block:'center'})`);
          await new Promise(resolve=>setTimeout(resolve,100));
          await fs.writeFile(path.join(smokeDir,'shopping-tactics.png'),(await window!.webContents.capturePage()).toPNG());
          const firstDirection=battles.snapshot().direction;
          if(!firstDirection?.ready)throw new Error('定阵结果丢失');
          await window!.webContents.executeJavaScript(`document.querySelector('[data-direction-pick]').click()`);
          await new Promise(resolve=>setTimeout(resolve,100));
          if(selectedComp?.directionId!==firstDirection.rows[0].id||!firstDirection.rows[0].units.every(id=>selectedComp!.units.includes(id)))throw new Error('选用核心变体未同步真实英雄名单');
          for(let i=0;i<40;i++){const d=battles.snapshot().direction;if(d?.ready&&!d.updating&&d.mode==='selected'&&d.focusId===selectedComp.directionId)break;await new Promise(resolve=>setTimeout(resolve,100));}
          const selectedAdvice=battles.snapshot().direction;
          if(!selectedAdvice?.ready||selectedAdvice.updating||selectedAdvice.mode!=='selected'||selectedAdvice.focusId!==selectedComp.directionId)throw new Error('手选阵容未进入后台规划');
          await window!.webContents.executeJavaScript(`window.tftDesktop.selectComp(null)`);
          for(let i=0;i<40;i++){const d=battles.snapshot().direction;if(d?.ready&&!d.updating&&d.mode!=='selected')break;await new Promise(resolve=>setTimeout(resolve,100));}
          const early=await overlayWindow!.webContents.executeJavaScript(`document.querySelector('.hud-header strong')?.textContent==='灵活留牌'&&document.querySelectorAll('[data-early-choice]').length>0`);
          if(!early||overlayWindow!.getSize()[1]!==192)throw new Error('未定阵灵活留牌未同步到紧凑浮窗');
          await overlayWindow!.webContents.executeJavaScript(`document.querySelector('[data-early-choice]').click()`);
          await new Promise(resolve=>setTimeout(resolve,100));
          if(!advisorPreferences.boardId)throw new Error('前期过渡选择未通过IPC同步');
          const focusedHold=resolveHoldAdvice(battles.snapshot().direction,advice(reader.snapshot()).holds,advisorPreferences);
          const hudIds=await overlayWindow!.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-overlay-unit]')).map(e=>e.dataset.overlayUnit).sort()`);
          if(JSON.stringify(hudIds)!==JSON.stringify(focusedHold.cards.map(c=>c.id).sort()))throw new Error('关键节点留牌在浮窗与主进程不一致');
          const anchorSlots=await augmentWindow!.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-shop-highlight]')).map(e=>Number(e.dataset.shopHighlight)-1).sort()`);
          const expectedSlots=focusedHold.cards.flatMap(c=>c.shopSlots.slice(0,c.quantity)).sort();
          if(JSON.stringify(anchorSlots)!==JSON.stringify(expectedSlots))throw new Error('关键节点留牌在商店高亮与浮窗不一致');
          await fs.writeFile(path.join(smokeDir,'advisor-smoke.json'),JSON.stringify({wisp,ranked,early,preferences:advisorPreferences},null,2));
          console.log('ADVISOR_AND_WISP_SMOKE_PASS');
          await overlayWindow!.webContents.executeJavaScript(`window.tftDesktop.overlay('collapse')`);
          if (overlayWindow!.getSize()[1] !== 42) throw new Error('浮窗收起失败');
          await overlayWindow!.webContents.executeJavaScript(`window.tftDesktop.overlay('expand')`);
          await overlayWindow!.webContents.executeJavaScript(`window.tftDesktop.overlay('lock')`);
          if (!locked) throw new Error('浮窗穿透失败');
          await window!.webContents.executeJavaScript(`window.tftDesktop.overlay('unlock')`);
          if (locked) throw new Error('主窗口恢复浮窗交互失败');
          await window!.webContents.executeJavaScript(`window.tftDesktop.overlay('hide')`);
          if (overlayWindow!.isVisible()) throw new Error('浮窗隐藏失败');
          console.log('OVERLAY_SMOKE_PASS');
          console.log('NATIVE_RECOGNITION_SMOKE_PASS');
        }
        if (process.argv.includes('--provider-smoke')) {
          await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="board"]').click()`);
          await new Promise(resolve => setTimeout(resolve, 100));
          await window!.webContents.executeJavaScript(`document.querySelector('[data-reader-start]').click()`);
          for (let attempt = 0; attempt < 60; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 150));
            if (reader.snapshot().message.includes('原生检测服务已连接')) break;
            if (reader.snapshot().phase === 'error') throw new Error(reader.snapshot().message);
          }
          if (!reader.snapshot().message.includes('原生检测服务已连接')) throw new Error('原版采集服务握手超时');
          await fs.writeFile(path.join(smokeDir, 'provider.json'), JSON.stringify(reader.snapshot(), null, 2));
          console.log('ORIGINAL_PROVIDER_HANDSHAKE_PASS');
        }
      }
      console.log('DESKTOP_SMOKE_PASS', JSON.stringify(report));
      if (timeout) clearTimeout(timeout);
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
  window.once('ready-to-show', () => { if (!smoke && !process.argv.includes('--background')) window!.show(); });
  await window.loadURL('tftbot://app/index.html');
}
