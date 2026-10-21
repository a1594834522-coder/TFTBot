// Hidden, synthetic UI verification. Never connects to the original game reader.
const {app,BrowserWindow,protocol,net}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve('dist/desktop/renderer'),out=path.resolve('dist/advisor-ui');
const profile=path.join(out,'test-profile-'+process.pid);require('node:fs').mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
protocol.registerSchemesAsPrivileged([{scheme:'tftbot',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
 try{
  await fs.mkdir(out,{recursive:true});
  protocol.handle('tftbot',request=>{
   const url=new URL(request.url),file=path.resolve(root,'.'+decodeURIComponent(url.pathname)),relative=path.relative(root,file);
   return url.host!=='app'||relative.startsWith('..')||path.isAbsolute(relative)?new Response('Not found',{status:404}):net.fetch(pathToFileURL(file).toString());
  });
  const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  win.webContents.on('console-message',details=>{if(details.level==='error')console.error(details.message);});
  await win.loadURL('tftbot://app/index.html#advisor-design');
  const js=code=>win.webContents.executeJavaScript(code);
  const settle=()=>js(`(async()=>{await Promise.race([Promise.all(Array.from(document.images).filter(i=>{const r=i.getBoundingClientRect();return r.width>0&&r.bottom>0&&r.top<innerHeight;}).map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,1800))]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
  const wait=async code=>{for(let i=0;i<80;i++){if(await js(code))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Preview did not reach '+code);};
  await wait(`!!document.querySelector('[data-direction-advisor]')`);
  await js(`Array.from(document.querySelectorAll('.preview-toolbar button')).find(b=>b.textContent.includes('4-2')).click()`);
  await wait(`document.querySelector('[data-direction-advisor]')?.dataset.mode==='flex'`);
  if(await js(`!!document.querySelector('[data-game-overlay]')`))throw Error('Recommendations silently selected a comp');
  await fs.writeFile(path.join(out,'recommendations.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await js(`document.querySelector('[data-route-filter="four-cost"]').click()`);
  await wait(`document.querySelector('[data-route-filter="four-cost"]').classList.contains('active')`);
  await js(`(document.querySelector('[data-direction-pick]:not([data-late-count="0"])')??document.querySelector('[data-direction-pick]')).click()`);
  await wait(`document.querySelector('[data-direction-advisor]')?.dataset.mode==='selected'&&!!document.querySelector('[data-direction-search]')`);
  await js(`document.querySelector('[data-route-filter="all"]').click()`);
  const report={};
  if(await js(`!!document.querySelector('[data-nav="champions"]')`))throw Error('Removed champion library is still in navigation');
  await wait(`!!document.querySelector('[data-route-progress]')`);
  await js(`document.querySelector('[data-route-progress] summary').click()`);
  await wait(`document.querySelector('[data-route-progress]')?.open===true`);
  await new Promise(resolve=>setTimeout(resolve,1300));
  report.routeProgress=await js(`({open:document.querySelector('[data-route-progress]').open,text:document.querySelector('[data-route-progress]').textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
  if(!report.routeProgress.open||report.routeProgress.overflow||!report.routeProgress.text.includes('场上沿用')||!report.routeProgress.text.includes('标准买价')||!report.routeProgress.text.includes('已持待上'))throw Error('Route progress lost facts or collapsed on refresh');
  await js(`document.querySelector('[data-route-progress]').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await new Promise(resolve=>setTimeout(resolve,100));
  await fs.writeFile(path.join(out,'mainline-route-progress.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await js(`document.querySelector('[data-route-progress] summary').click()`);
  for(const budget of ['20','40','wallet']){
   await js(`document.querySelector('[data-search-budget="${budget}"]').click()`);
   await wait(`document.querySelector('[data-search-budget="${budget}"]').classList.contains('active')`);
   report[budget]=await js(`({text:document.querySelector('[data-direction-search]').textContent,mode:document.querySelector('[data-direction-advisor]').dataset.mode,rows:document.querySelectorAll('[data-direction-advisor] [data-suggestion]').length,overflow:document.documentElement.scrollWidth>innerWidth})`);
  }
  await js(`document.querySelector('.desktop-content').scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await fs.writeFile(path.join(out,'startup-desktop.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  if(report.wallet.overflow||report.wallet.rows<2||!report.wallet.text.includes('含买牌'))throw Error('Startup planning layout failed');
  if(report['20'].text===report['40'].text)throw Error('Budget controls did not change planning results');
  report.filters={};
  for(const [kind,label]of [['reroll','费赌狗'],['four-cost','84'],['legendary','95']]){
   await js(`document.querySelector('[data-route-filter="${kind}"]').click()`);
   await wait(`document.querySelector('[data-route-filter="${kind}"]').classList.contains('active')`);
   const types=await js(`Array.from(document.querySelectorAll('.direction-cards .card-heading>span')).map(e=>e.textContent)`);
   if(!types.length||types.some(t=>!t.includes(label)))throw Error('Strategy filter did not preserve '+kind+' choices');report.filters[kind]=types.length;
  }
  await js(`document.querySelector('[data-route-filter="all"]').click()`);
  await js(`document.querySelector('[data-direction-pick]').click()`);
  await wait(`!!document.querySelector('[data-game-overlay]')`);
  report.selected=await js(`({name:document.querySelector('.hud-header strong')?.textContent,units:document.querySelectorAll('[data-overlay-unit]').length,automaticEarly:document.querySelectorAll('[data-transition][aria-pressed="true"]').length})`);
  if(!report.selected.units)throw Error('Preview selection did not reach compact HUD');
  if(report.selected.automaticEarly)throw Error('Selecting a core variant silently highlighted an unchosen early transition');
  await wait(`document.querySelector('[data-direction-advisor]')?.dataset.mode==='selected'`);
  await wait(`!!document.querySelector('[data-mainline-transitions]')`);
  if(!await js(`!!document.querySelector('[data-mainline-transition]')`))await js(`document.querySelector('[data-toggle-transitions]').click()`);
  await wait(`document.querySelectorAll('[data-mainline-transition]').length===3`);
  const chosenTransition=await js(`document.querySelector('[data-mainline-transition]').dataset.mainlineTransition`);
  await js(`document.querySelector('[data-mainline-transition]').click()`);
  await wait(`document.querySelector('[data-transition][aria-pressed="true"]')?.dataset.transition===${JSON.stringify(chosenTransition)}`);
  const anotherTransition=await js(`Array.from(document.querySelectorAll('[data-transition]')).find(e=>e.dataset.transition!==${JSON.stringify(chosenTransition)}).dataset.transition`);
  await js(`Array.from(document.querySelectorAll('[data-transition]')).find(e=>e.dataset.transition===${JSON.stringify(anotherTransition)}).click()`);
  await wait(`document.querySelector('[data-mainline-transition][aria-pressed="true"]')?.dataset.mainlineTransition===${JSON.stringify(anotherTransition)}`);
  await js(`document.querySelector('[data-mainline-transitions]').scrollIntoView({block:'center'})`);
  await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await new Promise(resolve=>setTimeout(resolve,100));
  report.transitionPanel=await js(`({expanded:document.querySelector('[data-toggle-transitions]')?.getAttribute('aria-expanded'),choices:document.querySelectorAll('[data-mainline-transition]').length,chosen:document.querySelector('[data-mainline-transition][aria-pressed="true"]')?.dataset.mainlineTransition})`);
  if(report.transitionPanel.expanded!=='true'||report.transitionPanel.choices!==3||report.transitionPanel.chosen!==anotherTransition)throw Error('Mainline transition choice was lost after rendering');
  await fs.writeFile(path.join(out,'mainline-transitions.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await js(`document.querySelector('[data-overlay-unit]').click()`);
  await wait(`!!document.querySelector('[data-overlay-budget]')`);
  await new Promise(resolve=>setTimeout(resolve,1300));
  if(!await js(`!!document.querySelector('[data-overlay-budget]')`))throw Error('Live refresh closed the pinned hero detail');
  await js(`document.querySelector('[data-clear-transition]').click()`);
  await wait(`!document.querySelector('[data-transition][aria-pressed="true"]')`);
  report.transitionSync={desktopToHud:true,hudToDesktop:true,pinnedDetailSurvivesRefresh:true};
  if(await js(`!!document.querySelector('[data-late-variants]')`)){
   await js(`document.querySelector('[data-late-variants]').scrollIntoView({block:'center'})`);
   await fs.writeFile(path.join(out,'mainline-late-variants.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  }
  await js(`document.querySelector('[data-clear-direction]').click()`);
  await wait(`!document.querySelector('[data-game-overlay]')&&document.querySelector('[data-direction-advisor]')?.dataset.mode==='flex'`);
  // Verify the shared desktop shell at the supported minimum size and a wide window.
  report.responsive={};
  for(const [width,height] of [[1080,720],[1080,960],[1280,960],[1440,960]]){
   win.setSize(width,height);
   await js(`document.querySelector('.desktop-content').scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   const size=height===720?width+'x'+height:width;
   report.responsive[size]=await js(`({overflow:document.documentElement.scrollWidth>innerWidth||document.querySelector('.desktop-content').scrollWidth>document.querySelector('.desktop-content').clientWidth+2,sidebar:document.querySelector('.desktop-sidebar').getBoundingClientRect().width,tab:document.querySelector('[role=tab][aria-selected=true]')?.dataset.advisorWorkspace})`);
   if(report.responsive[size].overflow||report.responsive[size].sidebar<140||report.responsive[size].sidebar>200)throw Error('Advisor shell layout failed at '+size+': '+JSON.stringify(report.responsive[size]));
   await settle();
   await fs.writeFile(path.join(out,'advisor-'+size+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  }
  await js(`document.querySelector('[data-advisor-workspace="tactics"]').click();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  if(!await js(`getComputedStyle(document.querySelector('#advisor-pane-routes')).display==='none'&&getComputedStyle(document.querySelector('#advisor-pane-tactics')).display!=='none'`))throw Error('Workspace tab did not change visible content');
  await js(`document.querySelector('[data-advisor-workspace="routes"]').focus();document.querySelector('[data-advisor-workspace="routes"]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  if(!await js(`document.activeElement?.dataset.advisorWorkspace==='outlook'&&document.querySelector('[data-advisor-workspace="outlook"]').getAttribute('aria-selected')==='true'`))throw Error('Keyboard tab selection lost focus');
  await js(`document.querySelector('[data-nav="comps"]').click()`);
  await wait(`!!document.querySelector('[data-desktop-view="comps"]')`);
  report.compositions={};
  for(const width of [1080,1440]){
   win.setSize(width,960);
   await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   await settle();
   report.compositions[width]=await js(`({rows:document.querySelectorAll('[data-comp]').length,expandedWidth:document.querySelector('.comp-card.expanded')?.getBoundingClientRect().width,contentWidth:document.querySelector('.compositions').clientWidth,overflow:document.querySelector('.compositions').scrollWidth>document.querySelector('.compositions').clientWidth+2})`);
   if(report.compositions[width].rows<1||report.compositions[width].overflow||report.compositions[width].expandedWidth<report.compositions[width].contentWidth*.9)throw Error('Compositions layout failed at '+width);
   await fs.writeFile(path.join(out,'compositions-'+width+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  }
  await js(`document.querySelector('[data-pick-comp]').click()`);
  await wait(`document.querySelector('[data-pick-comp]').classList.contains('chosen')`);
  await js(`document.querySelector('[data-pick-comp]').click()`);
  await wait(`!document.querySelector('[data-pick-comp].chosen')`);
  report.compositionSelection=true;
  await fs.writeFile(path.join(out,'checks.json'),JSON.stringify(report,null,2));
  console.log('ADVISOR_DESIGN_SMOKE_PASS',JSON.stringify(report.selected));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
