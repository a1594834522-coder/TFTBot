// Warm worker simulation. Same local model cache on both sides; only the
// additional pursuit scratch workspace changes. All states are synthetic.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const out=path.resolve('dist/pursuit-workspace-audit');await fs.mkdir(out,{recursive:true});
const env={...process.env,TFTBOT_AUDIT_BUDGET:'40',TFTBOT_AUDIT_POLICY:'key-upgrade'};
for(const key of ['TFTBOT_AUDIT_STATES','TFTBOT_AUDIT_BOARDS','TFTBOT_AUDIT_NO_PAIR_CACHE','TFTBOT_AUDIT_NO_SCORE_CACHE'])delete env[key];
const run=spawnSync(process.execPath,['scripts/audit-search-landings.mjs','--current-purchases'],{env,windowsHide:true,encoding:'utf8',maxBuffer:4_000_000});
if(run.status!==0)throw Error('Fixture failed: '+String(run.stderr||run.error).slice(-2000));
const source=JSON.parse(await fs.readFile('dist/current-pursuit-audit/report.json','utf8'));
const runtime=await import(pathToFileURL(path.resolve('dist/current-pursuit-audit/runtime.mjs'))),model=await runtime.loadBattleModel(path.resolve('data/metatft-model'));
const workspace=new runtime.CurrentPursuitWorkspace();
const strategy=runtime.strategicInput(source.status,source.shopping);if(!strategy.ready)throw Error(strategy.reason);
// Replay at this synthetic snapshot's own timestamp. Long benchmark runs must
// not turn its fixed opponents into an expired live-read request.
const request=runtime.battleRequest(source.status,source.status.lastFrameAt);if(!request)throw Error('Synthetic request unavailable');
function same(a,b,where='result'){
  if(typeof a==='number'&&typeof b==='number'){if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>1e-8)throw Error(where+' changed: '+a+' / '+b);return;}
  if(a&&b&&typeof a==='object'&&typeof b==='object'){
    if(JSON.stringify(Object.keys(a))!==JSON.stringify(Object.keys(b)))throw Error(where+' keys changed');
    for(const key of Object.keys(a))same(a[key],b[key],where+'.'+key);return;
  }
  if(a!==b)throw Error(where+' changed');
}
const semantic=r=>({...r,adaptive:r.adaptive?.map(a=>({heroSlots:a.heroSlots,limited:a.limited}))});
async function evaluate(name,input,reuse){
  const context=runtime.battleTacticalContext(request,input.state,model.lookup);if(!context.ready)throw Error(context.reason);
  const phases={},at=performance.now(),result=await runtime.currentPursuit(source.advice,input,runtime.tradingRules,context.request,model.predictCachedBatch,{
    mode:'key-upgrade',...(reuse?{workspace}:{}),trace:(key,ms)=>{phases[key]=ms;},yield:()=>new Promise(resolve=>setImmediate(resolve)),
    auxiliary:context.auxiliary,acceptsLineup:context.accepts,supportsBoard:b=>runtime.encodeBattleBoard(b,model.lookup,'player').unknown.length===0});
  if(!result.ready||!result.paths.length)throw Error('No ready result for '+name);
  const report={name,milliseconds:performance.now()-at,phases,budget:input.state.gold,model:model.version,cache:workspace.policies.metrics,result};
  await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(report,null,2));return report;
}
try{
  const prime=await evaluate('prime',strategy,true);
  const repeatCold=await evaluate('repeat-no-workspace',strategy,false),repeatWarm=await evaluate('repeat-workspace',strategy,true);
  same(semantic(repeatCold.result),semantic(repeatWarm.result));
  if(!repeatWarm.result.adaptive.every(a=>a.reused))throw Error('Identical frozen policies were not reused');
  // An actually newly revealed shop, after paying one refresh. Holdings, pool,
  // declared candidate routes and opponents are held fixed to isolate reuse.
  const next=structuredClone(strategy);next.state.gold-=next.pool.refreshPrice;
  const offers=next.state.offers.filter(Boolean);next.state.offers=offers.slice(1).concat(offers.slice(0,1)).map((o,slot)=>({...o,slot}));
  const nextCold=await evaluate('new-shop-no-workspace',next,false),nextWarm=await evaluate('new-shop-workspace',next,true);
  same(semantic(nextCold.result),semantic(nextWarm.result));
  if(!nextWarm.result.adaptive.some(a=>a.reused&&!a.limited)||nextWarm.result.adaptive.some(a=>a.reused&&a.limited))throw Error('Descendant and limited-table reuse rules failed');
  const following=structuredClone(next);following.state.gold-=following.pool.refreshPrice;
  following.state.offers=following.state.offers.slice(1).concat(following.state.offers.slice(0,1)).map((o,slot)=>({...o,slot}));
  const followingCold=await evaluate('following-shop-no-workspace',following,false),followingWarm=await evaluate('following-shop-workspace',following,true);
  same(semantic(followingCold.result),semantic(followingWarm.result));
  if(!followingWarm.result.adaptive.every(a=>a.reused&&!a.limited))throw Error('Previously solved follow-up states were not reused');
  globalThis.gc?.();
  const report={scope:'Synthetic unchanged physical pool/candidate routes, new revealed shop after a paid refresh. Same real local model and its existing pair cache for both sides; not a worst-case guarantee or ranked validation.',model:model.version,heapMB:process.memoryUsage().heapUsed/1024**2,policyCache:workspace.policies.metrics,
    runs:[prime,repeatCold,repeatWarm,nextCold,nextWarm,followingCold,followingWarm].map(r=>({name:r.name,milliseconds:r.milliseconds,phases:r.phases,budget:r.budget,paths:r.result.paths.length,evaluations:r.result.evaluations,policy:r.result.adaptive}))};
  await fs.writeFile(path.join(out,'checks.json'),JSON.stringify(report,null,2));console.log('PURSUIT_WORKSPACE_AUDIT_PASS',JSON.stringify(report));
}finally{model.dispose();}
