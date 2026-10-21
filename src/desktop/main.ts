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
import {createCompAdvisor,advisorInput} from '../game/comp-advisor';
import {withMainlineTransitions} from '../game/mainline-transitions';
import {metatftComps} from '../game/comps-sources';
import {earlyStages} from '../game/metatft-early';
import {dataset} from '../game/tft-data';
import {defaultAdvisorPreferences,type AdvisorPreferences} from '../game/advisor-preferences';
import {createBattleService} from './battle-service';
import {resolveHoldAdvice,directionBoardUnits} from '../game/resolve-hold-advice';
import {applyDirectionSelection} from '../game/direction-selection';
import {purchaseHighlightSlots,selectedPurchase} from '../game/purchase-selection';

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
  function refreshTransitions(status:ReturnType<typeof reader.snapshot>){
    const next=withMainlineTransitions(selectedComp,advisorInput(status,advisorPreferences.items));
    if(JSON.stringify(next)===JSON.stringify(selectedComp))return;
    selectedComp=next;
    for(const target of [window,overlayWindow,augmentWindow])if(target&&!target.isDestroyed())target.webContents.send('desktop:comp:update',selectedComp);
  }
  const nativeSmoke = process.argv.includes('--native-smoke');
  const monitorDirectory=path.resolve(process.env.TFTBOT_MONITOR_DIR||path.join(app.getPath('userData'),'live-monitor'));
  const monitor = !smoke ? createLiveMonitor(monitorDirectory) : null;
  const battles=createBattleService(value=>{for(const target of [window,overlayWindow,augmentWindow])if(target&&!target.isDestroyed())target.webContents.send('desktop:battle:update',value);syncAugmentLayer(reader.snapshot());monitor?.note('battle-forecast',value);});
  const reader = createNativeReader(status => { advice(status);refreshTransitions(status);battles.update(status,advisorPreferences.items,advisorPreferences.searchBudget??null,selectedComp,advisorPreferences.pursuitMode??'upgrade-first'); for (const target of [window, overlayWindow, augmentWindow]) if (target && !target.isDestroyed()) target.webContents.send('desktop:reader:update', status); syncAugmentLayer(status); monitor?.status(status); }, { onNativeLog: message=>monitor?.note('native-overlay',message), onPacket: (payload, accepted) => monitor?.packet(payload,accepted), cacheRoot: path.join(path.dirname(app.getPath('exe')), 'resources', 'tftbot-native'), ...(nativeSmoke ? { testMode: true, channel: process.env.TFTBOT_TEST_CHANNEL } : {}) });
  const battleFreshnessTimer=setInterval(()=>{const status=reader.snapshot();refreshTransitions(status);battles.update(status,advisorPreferences.items,advisorPreferences.searchBudget??null,selectedComp,advisorPreferences.pursuitMode??'upgrade-first');},1000);
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
        if(!capturedLiveView && view.shop.length){capturedLiveView=true;await fs.writeFile(path.join(monitorDirectory,'latest-ui.png'),(await window.webContents.capturePage()).toPNG());}
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
    const hasContent = status.cards.augments.some(Boolean) || shopVisible && (status.cards.shop[4]?.kind==='wisp' || !!selectedComp && status.cards.shop.some(c=>c && highlightedCompUnits(selectedComp).includes(c.id)) || !!holds?.cards.some(c=>c.quantity>0) || purchaseHighlightSlots(status,battles.snapshot(),advisorPreferences.purchase).length>0);
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
  try {const saved=JSON.parse(await storage.getItem('tftbot:desktop:selected-direction'));if(selectedComp&&saved?.key===selectedComp.key)selectedComp=applyDirectionSelection(selectedComp,saved.id);}catch{}
  try {const saved=JSON.parse(await storage.getItem('tftbot:desktop:selected-transition'));if(selectedComp&&saved?.key===selectedComp.key)selectedComp=withMainlineTransitions(selectedComp,advisorInput(reader.snapshot()),saved.id??null);}catch{}
  selectedComp=withMainlineTransitions(selectedComp,advisorInput(reader.snapshot()));
  const publishSelectedComp=()=>{battles.update(reader.snapshot(),advisorPreferences.items,advisorPreferences.searchBudget??null,selectedComp,advisorPreferences.pursuitMode??'upgrade-first');if(overlayWindow&&!overlayWindow.isDestroyed()&&!collapsed)overlayWindow.setSize(584,selectedComp?248:192);for(const target of [window,overlayWindow,augmentWindow])if(target && !target.isDestroyed())target.webContents.send('desktop:comp:update',selectedComp);syncAugmentLayer(reader.snapshot());};
  ipcMain.handle('desktop:advisor:get',event=>{trusted(event);return advisorPreferences;});
  ipcMain.handle('desktop:advisor:configure',(event,value:AdvisorPreferences)=>{
    trusted(event);
    const direction=battles.snapshot().direction;
    if(!value || !Array.isArray(value.items)||value.items.length>30||value.items.some(id=>typeof id!=='string'||!dataset.item(id)) || value.stage!==null&&![2,3,4,5].includes(value.stage) || value.boardId!==null&&!earlyStages(18).some(s=>s.boards.some(b=>b.id===value.boardId))&&!directionBoardUnits(value.boardId)&&!(direction?.ready&&direction.holds.boards.some(b=>b.id===value.boardId)))throw new Error('阵容助手输入无效');
    if(value.searchBudget!==undefined&&value.searchBudget!==null&&(!Number.isSafeInteger(value.searchBudget)||value.searchBudget<0||value.searchBudget>200))throw new Error('搜牌预算无效');
    if(value.pursuitMode!==undefined&&!['upgrade-first','completion-first','key-upgrade'].includes(value.pursuitMode))throw new Error('留牌策略无效');
    const purchase=selectedPurchase(reader.snapshot(),battles.snapshot(),value.purchase)?{context:value.purchase!.context,id:value.purchase!.id}:null;
    advisorPreferences={items:[...value.items],stage:value.stage,boardId:value.boardId,searchBudget:value.searchBudget??null,pursuitMode:value.pursuitMode??'upgrade-first',purchase};publishAdvisorPreferences();battles.update(reader.snapshot(),advisorPreferences.items,advisorPreferences.searchBudget??null,selectedComp,advisorPreferences.pursuitMode??'upgrade-first');syncAugmentLayer(reader.snapshot());return advisorPreferences;
  });
  ipcMain.handle('desktop:comp:get', event => { trusted(event); return selectedComp; });
  ipcMain.handle('desktop:comp:select', async (event,key,directionId?:string) => {
    trusted(event);
    if(key!==null && (typeof key!=='string' || key.length>256))throw new Error('阵容参数无效');
    if(directionId!==undefined&&(typeof directionId!=='string'||directionId.length>600))throw new Error('核心变体参数无效');
    const next=withMainlineTransitions(applyDirectionSelection(resolveSelectedComp(key,null),directionId),advisorInput(reader.snapshot(),advisorPreferences.items));
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
    const next=withMainlineTransitions(applyDirectionSelection(resolveSelectedComp(selectedComp.key,null),selectedComp.directionId),advisorInput(reader.snapshot(),advisorPreferences.items),id);
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
    backgroundColor: '#242422', show: false, autoHideMenuBar: true,
    titleBarStyle:'hidden',titleBarOverlay:{color:'#1e1e1c',symbolColor:'#b6b3a8',height:44},
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
  const timeout = smoke ? setTimeout(() => { console.error('DESKTOP_SMOKE_TIMEOUT'); app.exit(1); }, process.env.TFTBOT_TEST_HANDOFF==='1'?60_000:30_000) : null;
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
        for (const page of ['advisor','augments', 'board', 'settings', 'comps']) {
          await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="${page}"]').click()`);
          await new Promise(resolve => setTimeout(resolve, 150));
          await window!.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          const visible = await window!.webContents.executeJavaScript(`!!document.querySelector('[data-nav="${page}"].current') && !!document.querySelector('.desktop-content')?.textContent.trim()`);
          if (!visible) throw new Error(`桌面页面 ${page} 未显示`);
          if(page==='settings'){
            const layout=await window!.webContents.executeJavaScript(`(()=>{const panel=document.querySelector('[data-settings]'),content=document.querySelector('.desktop-content');return {ready:!!panel,display:panel?getComputedStyle(panel).display:null,overflow:content.scrollWidth>content.clientWidth+2};})()`);
            if(!layout.ready||layout.display!=='grid'||layout.overflow)throw Error('设置页面布局或内容异常：'+JSON.stringify(layout));
            await fs.writeFile(path.join(smokeDir,'settings-layout.json'),JSON.stringify(layout,null,2));
          }
          if(page==='settings')await fs.writeFile(path.join(smokeDir,page+'.png'),(await window!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
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
          const availableId=reader.snapshot().cards.shop.find(c=>c?.known&&c.kind!=='wisp')!.id;
          await overlayWindow!.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-overlay-unit]')).find(e=>e.dataset.overlayUnit===${JSON.stringify(availableId)}).click()`);
          for(let i=0;i<20;i++){if(await overlayWindow!.webContents.executeJavaScript(`!!document.querySelector('[data-current-shop-copy]')`))break;await new Promise(resolve=>setTimeout(resolve,50));}
          const directCopy=await overlayWindow!.webContents.executeJavaScript(`({text:document.querySelector('[data-overlay-budget]')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
          if(!directCopy.text?.includes('无需刷新')||directCopy.text.includes('平均刷新')||directCopy.text.includes('90%')||directCopy.overflow)throw Error('当前商店副本仍被显示为未来刷牌预算');
          await overlayWindow!.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await new Promise(resolve=>setTimeout(resolve,100));
          await fs.writeFile(path.join(smokeDir,'shop-copy-overlay.png'),(await overlayWindow!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
          await overlayWindow!.webContents.executeJavaScript(`document.querySelector('[aria-label="关闭英雄详情"]').click()`);
          console.log('CURRENT_SHOP_COPY_SMOKE_PASS');
          const visibleShop=new Set(reader.snapshot().cards.shop.flatMap(c=>c?.known?[c.id]:[]));
          const futureId=selectedComp!.units.find(id=>!visibleShop.has(id)&&(dataset.characterById(id)?.cost??99)<=3);
          if(!futureId)throw Error('测试阵容缺少尚未在商店中的低费目标');
          await overlayWindow!.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-overlay-unit]')).find(e=>e.dataset.overlayUnit===${JSON.stringify(futureId)}).click()`);
          await overlayWindow!.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await new Promise(resolve=>setTimeout(resolve,100));
          const futureCopy=await overlayWindow!.webContents.executeJavaScript(`({text:document.querySelector('[data-overlay-budget]')?.textContent,gold:document.querySelector('[data-overlay-budget] .gold-line b')?.textContent})`);
          if(!futureCopy.text?.includes('平均刷新')||!futureCopy.gold?.includes('–')||futureCopy.text.includes('无需刷新'))throw Error('未来下一张的四至五英雄格范围未显示');
          await fs.writeFile(path.join(smokeDir,'future-roll-overlay.png'),(await overlayWindow!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
          await overlayWindow!.webContents.executeJavaScript(`document.querySelector('[aria-label="关闭英雄详情"]').click()`);
          console.log('FUTURE_ROLL_RANGE_SMOKE_PASS');
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
          if(tactics.maxSwaps<2||tactics.maxSwaps>4||tactics.deploymentSearch&&tactics.deploymentSearch.exactMaxSwaps!==2||tactics.choices.some(c=>c.id!=='mainline'&&c.delta!==null&&c.delta< -1e-6))throw new Error('战术方案错误地排除了真实不动棋盘对照');
          if(tactics.choices.some(c=>!c.incoming||!c.outgoing||!c.onBoardItems||c.onBoardItems.length!==c.onBoard.length))throw new Error('换牌方案缺少实际上下场与装备去向');
          if(process.env.TFTBOT_TEST_COMBAT_AUX==='1'){
            if(!forecast.gaps.some(g=>g.includes('召唤单位'))||tactics.choices.some(c=>!c.auxiliary.some(u=>u.id==='DA_TheTower_TrainingDummy'&&u.items.includes('DA_WarmogsArmor'))))throw new Error('原生非商店单位未正确进入模型与换牌保留');
            if(reader.snapshot().cards.ownHoldings?.board?.some(c=>c.name==='DA_TheTower_TrainingDummy'))throw new Error('独立单位错误地进入普通持牌账本');
            console.log('COMBAT_AUXILIARY_SMOKE_PASS');
          }
          await fs.writeFile(path.join(smokeDir,'shopping-tactics.json'),JSON.stringify(tactics,null,2));
          console.log('SHOPPING_TACTICS_SMOKE_PASS');
          if(process.env.TFTBOT_TEST_MIXED==='1'){
            const intent=JSON.parse(await fs.readFile(path.join(smokeDir,'mixed-intent.json'),'utf8'));
            await fs.writeFile(path.join(smokeDir,'mixed-start'),'1');
            await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="advisor"]').click();window.tftDesktop.selectComp(${JSON.stringify(intent.key)},${JSON.stringify(intent.directionId)})`);
            for(let i=0;i<100;i++){
              const current=battles.snapshot();
              if(current.direction?.ready&&!current.direction.updating&&current.direction.focusId===intent.directionId&&current.tactics?.ready&&current.tactics.choices.some(c=>c.observedSources?.length&&c.outgoing.length>=3))break;
              await new Promise(resolve=>setTimeout(resolve,100));
            }
            const mixed=battles.snapshot().tactics;
            if(!mixed?.ready||!mixed.deploymentSearch?.observedBoards||!mixed.choices.some(c=>c.observedSources?.length&&c.incoming.length>=3&&c.outgoing.length>=3)||selectedComp?.directionId!==intent.directionId)throw Error('多牌重组未进入桌面或改变玩家主线');
            await window!.webContents.executeJavaScript(`document.querySelector('[data-advisor-workspace="tactics"]').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await window!.webContents.executeJavaScript(`document.querySelector('[data-shopping-tactics]').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            const visibleChanges=await window!.webContents.executeJavaScript(`(()=>{const changes=document.querySelector('.tactical-changes'),r=changes?.getBoundingClientRect();return !!changes&&!changes.closest('details')&&r.width>0&&r.height>0&&changes.querySelectorAll('img').length>=6;})()`);
            if(!visibleChanges)throw Error('默认换牌方案仍未直接显示上下场头像');
            await fs.writeFile(path.join(smokeDir,'mixed-lineups-summary.png'),(await window!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            await window!.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-tactical-details]')).find(e=>e.querySelector('.tactical-source'))?.querySelector('summary').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await window!.webContents.executeJavaScript(`document.querySelector('[data-shopping-tactics]').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await new Promise(resolve=>setTimeout(resolve,100));
            const layout=await window!.webContents.executeJavaScript(`(()=>{const panel=document.querySelector('[data-shopping-tactics]'),r=panel.getBoundingClientRect();return {text:panel.textContent,open:!!panel.querySelector('details[open] .tactical-source'),top:r.top,bottom:r.bottom,height:innerHeight,overflow:document.querySelector('.desktop-content').scrollWidth>document.querySelector('.desktop-content').clientWidth+2};})()`);
            if(!layout.open||layout.overflow||layout.top<60||layout.bottom>layout.height||!layout.text.includes('含观测重组')||!layout.text.includes('换上')||!layout.text.includes('换下'))throw Error('多牌重组明细布局异常：'+JSON.stringify(layout));
            await fs.writeFile(path.join(smokeDir,'mixed-lineups.json'),JSON.stringify(mixed,null,2));
            await fs.writeFile(path.join(smokeDir,'mixed-layout.json'),JSON.stringify(layout,null,2));
            await fs.writeFile(path.join(smokeDir,'mixed-lineups.png'),(await window!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            console.log('OBSERVED_MIXED_LINEUPS_SMOKE_PASS');if(timeout)clearTimeout(timeout);app.quit();return;
          }
          if(process.env.TFTBOT_TEST_HANDOFF==='1'){
            const intent=JSON.parse(await fs.readFile(path.join(smokeDir,'handoff-intent.json'),'utf8'));
            await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="advisor"]').click();window.tftDesktop.selectComp(${JSON.stringify(intent.key)},${JSON.stringify(intent.id)})`);
            for(let i=0;i<100;i++){const value=battles.snapshot();if(value.direction?.ready&&!value.direction.updating&&value.direction.focusId===intent.id&&value.handoffs?.ready)break;await new Promise(resolve=>setTimeout(resolve,100));}
            const handoffs=battles.snapshot().handoffs;
            if(!handoffs?.ready||!handoffs.choices.length||handoffs.choices.some(c=>!c.moves.length||c.goldAfter!==reader.snapshot().cards.gold!+c.refund-c.spent))throw Error('原生装备未进入承接比较：'+JSON.stringify(handoffs));
            const pursuit=battles.snapshot().pursuit;
            if(!pursuit?.ready||pursuit.paths.length<2||!pursuit.paths.some(p=>p.id==='skip'))throw Error('原生核心商店未进入留牌比较：'+JSON.stringify(pursuit));
            await window!.webContents.executeJavaScript(`document.querySelector('[data-advisor-workspace="tactics"]').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await window!.webContents.executeJavaScript(`document.querySelector('[data-pursuit-slots="5"]').click();document.querySelector('[data-current-pursuit]').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await new Promise(resolve=>setTimeout(resolve,100));
            const pursuitLayout=await window!.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[data-current-pursuit]'),r=el?.getBoundingClientRect();return {text:el?.textContent,top:r?.top,bottom:r?.bottom,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth||el?.scrollWidth>el?.clientWidth+2,rows:el?.querySelectorAll('[data-pursuit-path]').length,five:document.querySelector('[data-pursuit-slots="5"]')?.getAttribute('aria-pressed')};})()`);
            if(pursuitLayout.overflow||pursuitLayout.top<80||pursuitLayout.bottom>pursuitLayout.height||pursuitLayout.rows<2||pursuitLayout.five!=='true'||!pursuitLayout.text?.includes('预计余金')||!pursuitLayout.text.includes('跳过这家店')||selectedComp?.directionId!==intent.id)throw Error('留牌比较界面或手选主线保持失败：'+JSON.stringify(pursuitLayout));
            await fs.writeFile(path.join(smokeDir,'current-pursuit.json'),JSON.stringify(pursuit,null,2));
            await fs.writeFile(path.join(smokeDir,'pursuit-layout.json'),JSON.stringify(pursuitLayout,null,2));
            await fs.writeFile(path.join(smokeDir,'current-pursuit.png'),(await window!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            console.log('CURRENT_PURSUIT_SMOKE_PASS');
            const budgetSync=await window!.webContents.executeJavaScript(`(async()=>{const el=document.querySelector('[data-pursuit-budget]');el.value='20';el.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,150));const p=await window.tftDesktop.advisorPreferences();return p.searchBudget===20&&document.querySelector('[data-search-budget="20"]')?.classList.contains('active');})()`);
            if(!budgetSync)throw Error('留牌表预算未与主线搜牌预算同步');
            for(let i=0;i<100;i++){if(battles.snapshot().handoffs?.ready)break;await new Promise(resolve=>setTimeout(resolve,100));}
            console.log('PURSUIT_BUDGET_SYNC_PASS');
            await window!.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[data-pursuit-mode]');el.value='completion-first';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
            for(let i=0;i<120;i++){const value=battles.snapshot().pursuit;if(value?.ready&&value.mode==='completion-first')break;await new Promise(resolve=>setTimeout(resolve,100));}
            const adaptive=battles.snapshot().pursuit;
            const adaptiveView=await window!.webContents.executeJavaScript(`(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const el=document.querySelector('[data-current-pursuit]'),p=await window.tftDesktop.advisorPreferences();return {ready:el?.dataset.pursuitState,rows:el?.querySelectorAll('[data-pursuit-path]').length,mode:document.querySelector('[data-pursuit-mode]')?.value,preference:p.pursuitMode,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
            if(!adaptive?.ready||adaptive.mode!=='completion-first'||!adaptive.adaptive?.length||adaptiveView.ready!=='ready'||adaptiveView.rows<2||adaptiveView.mode!=='completion-first'||adaptiveView.preference!=='completion-first'||adaptiveView.overflow||selectedComp?.directionId!==intent.id)throw Error('补齐优先策略未完成实际界面切换：'+JSON.stringify(adaptiveView));
            await window!.webContents.executeJavaScript(`document.querySelector('[data-current-pursuit]').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await new Promise(resolve=>setTimeout(resolve,100));
            await fs.writeFile(path.join(smokeDir,'adaptive-pursuit.json'),JSON.stringify(adaptive,null,2));
            await fs.writeFile(path.join(smokeDir,'adaptive-pursuit.png'),(await window!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            console.log('ADAPTIVE_PURSUIT_SWITCH_PASS');
            await window!.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[data-pursuit-mode]');el.value='key-upgrade';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
            for(let i=0;i<120;i++){const value=battles.snapshot().pursuit;if(value?.ready&&value.mode==='key-upgrade')break;await new Promise(resolve=>setTimeout(resolve,100));}
            const keyUpgrade=battles.snapshot().pursuit;
            const keyView=await window!.webContents.executeJavaScript(`(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const el=document.querySelector('[data-current-pursuit]');return {state:el?.dataset.pursuitState,text:el?.textContent,rows:el?.querySelectorAll('[data-pursuit-path]').length,mode:document.querySelector('[data-pursuit-mode]')?.value,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
            if(!keyUpgrade?.ready||keyUpgrade.mode!=='key-upgrade'||keyUpgrade.milestone.kind!=='new-two-star'||!keyUpgrade.paths.some(p=>p.bands.some(b=>b.completion.upper>0))||keyView.state!=='ready'||keyView.mode!=='key-upgrade'||!keyView.text?.includes('新增二星')||keyView.rows<2||keyView.overflow||selectedComp?.directionId!==intent.id)throw Error('关键二星未通过原生切换：'+JSON.stringify(keyView));
            await window!.webContents.executeJavaScript(`document.querySelector('[data-current-pursuit]').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await new Promise(resolve=>setTimeout(resolve,100));
            await fs.writeFile(path.join(smokeDir,'key-upgrade-pursuit.json'),JSON.stringify(keyUpgrade,null,2));
            await fs.writeFile(path.join(smokeDir,'key-upgrade-pursuit.png'),(await window!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            console.log('KEY_UPGRADE_PURSUIT_SWITCH_PASS');
            const returnStarted=Date.now();
            await window!.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[data-pursuit-mode]');el.value='upgrade-first';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
            for(let i=0;i<120;i++){const value=battles.snapshot();if(value.pursuit?.ready&&value.pursuit.mode==='upgrade-first'&&value.handoffs?.ready)break;await new Promise(resolve=>setTimeout(resolve,100));}
            const returned=battles.snapshot();if(!returned.pursuit?.ready||returned.pursuit.mode!=='upgrade-first'||!returned.handoffs?.ready||advisorPreferences.pursuitMode!=='upgrade-first')throw Error('留牌目标切回未完成');
            console.log('ADAPTIVE_PURSUIT_RETURN_PASS',Date.now()-returnStarted);
            await window!.webContents.executeJavaScript(`document.querySelector('[data-advisor-workspace="tactics"]').click();document.querySelector('[data-handoff-details] summary').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await window!.webContents.executeJavaScript(`document.querySelector('[data-equipment-handoffs]').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await new Promise(resolve=>setTimeout(resolve,100));
            const layout=await window!.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[data-equipment-handoffs]'),r=el?.getBoundingClientRect();return {text:el?.textContent,top:r?.top,bottom:r?.bottom,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,buttons:el?.querySelectorAll('button').length};})()`);
            if(layout.overflow||layout.top<80||layout.bottom>layout.height||layout.buttons||!layout.text?.includes('不出售参考')||!layout.text.includes('装备栏需空')||selectedComp?.directionId!==intent.id)throw Error('承接界面或手选主线保持失败：'+JSON.stringify(layout));
            await fs.writeFile(path.join(smokeDir,'equipment-handoffs.json'),JSON.stringify(handoffs,null,2));
            await fs.writeFile(path.join(smokeDir,'handoff-layout.json'),JSON.stringify(layout,null,2));
            await fs.writeFile(path.join(smokeDir,'equipment-handoffs.png'),(await window!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            console.log('EQUIPMENT_HANDOFF_SMOKE_PASS');if(timeout)clearTimeout(timeout);app.quit();return;
          }
          if(process.env.TFTBOT_TEST_LANDING==='1'){
            await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="advisor"]').click()`);
            for(let i=0;i<30;i++){if(await window!.webContents.executeJavaScript(`!!document.querySelector('[data-route-filter="four-cost"]')`))break;await new Promise(resolve=>setTimeout(resolve,50));}
            await window!.webContents.executeJavaScript(`document.querySelector('[data-route-filter="four-cost"]').click()`);
            await window!.webContents.executeJavaScript(`document.querySelector('[data-advisor-workspace="routes"]').click();document.querySelector('[data-direction-pick]').click()`);
            for(let i=0;i<100;i++){const value=battles.snapshot().landings;if(value?.ready&&value.plans[0].id===selectedComp?.directionId)break;await new Promise(resolve=>setTimeout(resolve,100));}
            const landings=battles.snapshot().landings;
            if(!landings?.ready||!landings.plans.length||landings.budget!==20||landings.plans[0].id!==selectedComp?.directionId)throw Error('原生输入未进入预算落点：'+JSON.stringify(landings));
            const mainlineBefore=selectedComp?.directionId;
            await window!.webContents.executeJavaScript(`document.querySelector('[data-advisor-workspace="outlook"]').click();document.querySelector('[data-landing-slots="5"]').click();document.querySelector('[data-search-landings] summary').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await window!.webContents.executeJavaScript(`document.querySelector('[data-search-landings]').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await new Promise(resolve=>setTimeout(resolve,100));
            const view=await window!.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[data-search-landings]'),rect=el?.getBoundingClientRect();return {text:el?.textContent,overflow:document.documentElement.scrollWidth>innerWidth,top:rect?.top,bottom:rect?.bottom,height:innerHeight,five:document.querySelector('[data-landing-slots="5"]')?.classList.contains('active')};})()`);
            if(!view.five||view.overflow||view.top<80||view.bottom>view.height||!view.text?.includes('核心未齐')||!view.text.includes('没抽齐时')||selectedComp?.directionId!==mainlineBefore)throw Error('预算落点显示或主线保持失败：'+JSON.stringify(view));
            await fs.writeFile(path.join(smokeDir,'landing-layout.json'),JSON.stringify(view,null,2));
            await fs.writeFile(path.join(smokeDir,'search-landings.json'),JSON.stringify(landings,null,2));
            await fs.writeFile(path.join(smokeDir,'search-landings.png'),(await window!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            console.log('SEARCH_LANDINGS_SMOKE_PASS');
            if(timeout)clearTimeout(timeout);app.quit();return;
          }
          if(process.env.TFTBOT_TEST_PURCHASE==='1'){
            if(!tactics.purchases.length)throw Error('购买组合测试没有产生额外补强：'+JSON.stringify(tactics.choices));
            await window!.webContents.executeJavaScript(`document.querySelector('[data-nav="advisor"]').click()`);
            for(let i=0;i<30;i++){if(await window!.webContents.executeJavaScript(`!!document.querySelector('[data-purchase-highlight]:not(:disabled)')`))break;await new Promise(resolve=>setTimeout(resolve,50));}
            const mainlineBefore=JSON.stringify(selectedComp);
            await window!.webContents.executeJavaScript(`document.querySelector('[data-advisor-workspace="tactics"]').click();document.querySelector('[data-purchase-highlight]').click()`);
            for(let i=0;i<30&&!advisorPreferences.purchase;i++)await new Promise(resolve=>setTimeout(resolve,50));
            const selected=selectedPurchase(reader.snapshot(),battles.snapshot(),advisorPreferences.purchase);
            if(!selected||JSON.stringify(selectedComp)!==mainlineBefore)throw Error('购买组合选择未同步或改变了玩家主线：'+JSON.stringify({selection:!!advisorPreferences.purchase,selected:!!selected,mainlineChanged:JSON.stringify(selectedComp)!==mainlineBefore,phase:battles.snapshot().phase,ui:await window!.webContents.executeJavaScript(`({buttons:Array.from(document.querySelectorAll('[data-purchase-highlight]')).map(e=>({text:e.textContent,pressed:e.getAttribute('aria-pressed')})),text:document.querySelector('[data-purchase-opportunities]')?.textContent})`)}));
            await new Promise(resolve=>setTimeout(resolve,100));
            const slots=await augmentWindow!.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-shop-highlight]')).map(e=>Number(e.dataset.shopHighlight)-1)`);
            if(!selected.choice.buy.flatMap(b=>b.slots).every(slot=>slots.includes(slot)))throw Error('购买组合未同步到游戏商店高亮');
            await window!.webContents.executeJavaScript(`document.querySelector('[data-purchase-opportunities]').scrollIntoView({block:'center'});document.querySelector('[data-purchase-opportunities] summary').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            await new Promise(resolve=>setTimeout(resolve,100));
            const view=await window!.webContents.executeJavaScript(`({text:document.querySelector('[data-purchase-opportunities]')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
            if(view.overflow||!view.text?.includes('已高亮')||!view.text.includes('相对免费换牌'))throw Error('购买组合说明或桌面布局异常');
            await fs.writeFile(path.join(smokeDir,'purchase-opportunities.png'),(await window!.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            await window!.webContents.executeJavaScript(`document.querySelector('[data-purchase-highlight][aria-pressed="true"]').click()`);
            for(let i=0;i<30&&advisorPreferences.purchase;i++)await new Promise(resolve=>setTimeout(resolve,50));
            if(advisorPreferences.purchase)throw Error('取消购买组合高亮失败');
            console.log('PURCHASE_SELECTION_SMOKE_PASS');
            if(timeout)clearTimeout(timeout);app.quit();return;
          }
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
          if(!ranked)throw new Error('真实协议输入未进入阵容助手');
          const directionPanel=await window!.webContents.executeJavaScript(`['flex','selected'].includes(document.querySelector('[data-direction-advisor]')?.dataset.mode)&&document.querySelectorAll('[data-direction-advisor] [data-advisor-pick]').length===3`);
          if(!directionPanel)throw new Error('关键节点定阵仍显示旧规则排序');
          await window!.webContents.executeJavaScript(`document.querySelector('[data-direction-advisor]').scrollIntoView({block:'center'})`);
          await new Promise(resolve=>setTimeout(resolve,100));
          await fs.writeFile(path.join(smokeDir,'direction-advisor.png'),(await window!.webContents.capturePage()).toPNG());
          const tacticalPanel=await window!.webContents.executeJavaScript(`document.querySelector('[data-shopping-tactics]')?.dataset.ready==='true'&&document.querySelectorAll('[data-tactical-choice]').length>0`);
          if(!tacticalPanel)throw new Error('商店战术方案未显示在阵容助手页面');
          const strategicPanel=await window!.webContents.executeJavaScript(`document.querySelector('[data-strategic-options]')?.dataset.ready==='true'&&document.querySelectorAll('[data-strategic-route]').length>0`);
          if(!strategicPanel)throw new Error('真实转型规划未显示在阵容助手页面');
          await window!.webContents.executeJavaScript(`document.querySelector('[data-advisor-workspace="outlook"]').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await new Promise(resolve=>setTimeout(resolve,100));
          await window!.webContents.executeJavaScript(`document.querySelector('[data-strategic-options]').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await fs.writeFile(path.join(smokeDir,'strategic-options.png'),(await window!.webContents.capturePage()).toPNG());
          await window!.webContents.executeJavaScript(`document.querySelector('[data-advisor-workspace="tactics"]').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await window!.webContents.executeJavaScript(`document.querySelector('[data-tactical-details] summary').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await window!.webContents.executeJavaScript(`document.querySelector('[data-shopping-tactics]').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
          await new Promise(resolve=>setTimeout(resolve,100));
          const tacticalDetails=await window!.webContents.executeJavaScript(`({open:document.querySelector('[data-tactical-details]')?.open,text:document.querySelector('[data-tactical-details]')?.closest('article')?.textContent,rows:document.querySelector('[data-tactical-details]')?.closest('article')?.querySelectorAll('.tactical-diff').length,overflow:document.documentElement.scrollWidth>innerWidth})`);
          if(!tacticalDetails.open||tacticalDetails.overflow||![0,2].includes(tacticalDetails.rows)||tacticalDetails.rows===2&&(!tacticalDetails.text.includes('换上')||!tacticalDetails.text.includes('换下')))throw new Error('换牌明细未渲染或出现横向溢出');
          if(process.env.TFTBOT_TEST_COMBAT_AUX==='1'&&!await window!.webContents.executeJavaScript(`document.querySelector('.tactical-auxiliary')?.textContent.includes('巨塔假人')`))throw new Error('保留独立单位的中文说明未显示');
          await fs.writeFile(path.join(smokeDir,'shopping-tactics.png'),(await window!.webContents.capturePage()).toPNG());
          const firstDirection=battles.snapshot().direction;
          if(!firstDirection?.ready)throw new Error('定阵结果丢失');
          await window!.webContents.executeJavaScript(`document.querySelector('[data-advisor-workspace="routes"]').click();document.querySelector('[data-direction-pick]').click()`);
          await new Promise(resolve=>setTimeout(resolve,100));
          if(selectedComp?.directionId!==firstDirection.rows[0].id||!firstDirection.rows[0].units.every(id=>selectedComp!.units.includes(id)))throw new Error('选用核心变体未同步真实英雄名单');
          for(let i=0;i<40;i++){const d=battles.snapshot().direction;if(d?.ready&&!d.updating&&d.mode==='selected'&&d.focusId===selectedComp.directionId)break;await new Promise(resolve=>setTimeout(resolve,100));}
          const selectedAdvice=battles.snapshot().direction;
          if(!selectedAdvice?.ready||selectedAdvice.updating||selectedAdvice.mode!=='selected'||selectedAdvice.focusId!==selectedComp.directionId)throw new Error('手选阵容未进入后台规划');
          if(selectedComp.transitionId)throw new Error('选择主线时不应自动勾选过渡');
          if(!await window!.webContents.executeJavaScript(`!!document.querySelector('[data-mainline-transition]')`))await window!.webContents.executeJavaScript(`document.querySelector('[data-toggle-transitions]')?.click()`);
          const chosenTransition=await window!.webContents.executeJavaScript(`document.querySelector('[data-mainline-transition]')?.dataset.mainlineTransition`);
          if(!chosenTransition)throw new Error('已选主线缺少桌面过渡选择');
          await window!.webContents.executeJavaScript(`document.querySelector('[data-mainline-transition]').click()`);
          for(let i=0;i<30&&selectedComp?.transitionId!==chosenTransition;i++)await new Promise(resolve=>setTimeout(resolve,50));
          const hudTransition=await overlayWindow!.webContents.executeJavaScript(`document.querySelector('[data-transition][aria-pressed="true"]')?.dataset.transition`);
          if(selectedComp?.transitionId!==chosenTransition||hudTransition!==chosenTransition)throw new Error('桌面选择过渡未同步局内浮窗');
          const otherTransition=await overlayWindow!.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-transition]')).find(e=>e.dataset.transition!==${JSON.stringify(chosenTransition)})?.dataset.transition`);
          if(!otherTransition)throw new Error('缺少可切换的第二条过渡');
          await overlayWindow!.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-transition]')).find(e=>e.dataset.transition===${JSON.stringify(otherTransition)}).click()`);
          for(let i=0;i<30&&selectedComp?.transitionId!==otherTransition;i++)await new Promise(resolve=>setTimeout(resolve,50));
          const desktopTransition=await window!.webContents.executeJavaScript(`document.querySelector('[data-mainline-transition][aria-pressed="true"]')?.dataset.mainlineTransition`);
          if(desktopTransition!==otherTransition||selectedComp?.transitionId!==otherTransition)throw new Error('局内切换过渡未同步桌面');
          const transitionHudIds=await overlayWindow!.webContents.executeJavaScript(`Array.from(new Set(Array.from(document.querySelectorAll('[data-overlay-unit]')).map(e=>e.dataset.overlayUnit))).sort()`);
          if(JSON.stringify(transitionHudIds)!==JSON.stringify(highlightedCompUnits(selectedComp).slice().sort()))throw new Error('主线与过渡的浮窗名单不一致');
          console.log('MAINLINE_TRANSITION_SYNC_PASS');
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
