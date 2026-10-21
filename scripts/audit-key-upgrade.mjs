// Real local MetaTFT model; synthetic observable-shop state, never a live game.
// This goal differs from completing a whole core pair: do not compare their
// completion numbers as if a larger percentage proved a better strategy.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('dist/key-upgrade-audit');await fs.mkdir(out,{recursive:true});
const checks=[];
for(const budget of [20,40]){
  const env={...process.env,TFTBOT_AUDIT_BUDGET:String(budget),TFTBOT_AUDIT_POLICY:'key-upgrade'};
  for(const key of ['TFTBOT_AUDIT_STATES','TFTBOT_AUDIT_BOARDS','TFTBOT_AUDIT_NO_PAIR_CACHE','TFTBOT_AUDIT_NO_SCORE_CACHE'])delete env[key];
  const run=spawnSync(process.execPath,['scripts/audit-search-landings.mjs','--current-purchases'],{env,windowsHide:true,encoding:'utf8',maxBuffer:4_000_000});
  if(run.status!==0)throw Error('Key-upgrade audit failed: '+String(run.stderr||run.error).slice(-2000));
  const text=await fs.readFile('dist/current-pursuit-audit/report.json','utf8'),report=JSON.parse(text),r=report.result;
  await fs.writeFile(path.join(out,budget+'.json'),text);
  if(!r.ready||r.mode!=='key-upgrade'||r.budget!==budget||r.milestone.kind!=='new-two-star'||!r.adaptive?.some(a=>a.states>0))throw Error('Milestone policy did not expand');
  const owned={};for(const u of report.shopping.state.units)owned[u.id]=(owned[u.id]??0)+3**(u.star-1);
  const expected=[...new Set(r.routes.flatMap(row=>row.cores))].filter(id=>(owned[id]??0)<3);
  if(JSON.stringify(r.milestone.targets)!==JSON.stringify(expected))throw Error('Existing upgrades credited as a new milestone');
  let bands=0;
  for(const p of r.paths){
    if(p.spent<0||p.spent>budget||p.goldAfter!==budget-p.spent||p.bands.length!==2)throw Error('Current purchase cost or scenarios changed');
    for(const b of p.bands){
      for(const bound of [b.combat,b.completion])if(!Number.isFinite(bound.lower)||!Number.isFinite(bound.upper)||bound.lower<0||bound.upper>1||bound.lower>bound.upper)throw Error('Invalid outcome bounds');
      if(b.expectedGold.lower<0||b.expectedGold.lower>b.expectedGold.upper||b.expectedGold.upper>p.goldAfter+1e-7||b.evaluatedMass+b.retainedFloorMass+b.unresolved>1+1e-7)throw Error('Cash or probability mass invalid');
      bands++;
    }
  }
  if(!r.paths.some(p=>!p.buy.length)||!r.paths.some(p=>p.buy.length))throw Error('Current buy/skip choices disappeared');
  checks.push({budget,model:report.modelVersion,milliseconds:report.milliseconds,phases:report.phases,paths:r.paths.length,bands,policy:r.adaptive,
    skip:r.paths.find(p=>!p.buy.length).bands.map(b=>({slots:b.heroSlots,completion:b.completion,combat:b.combat,gold:b.expectedGold,coverage:b.evaluatedMass,unresolved:b.unresolved}))});
}
if(checks[0].model!==checks[1].model)throw Error('Model version changed between budgets');
const report={scope:'One new two-star among initially unupgraded cores. Synthetic state and real local model, not ranked benefit or a whole-pair objective.',checks};
await fs.writeFile(path.join(out,'checks.json'),JSON.stringify(report,null,2));console.log('KEY_UPGRADE_AUDIT_PASS',JSON.stringify(report));
