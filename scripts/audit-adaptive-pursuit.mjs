// Compare actual forward distributions under two observable policies, never
// cherry-pick only their successful terminal boards. Synthetic data only.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('dist/adaptive-pursuit-audit');await fs.mkdir(out,{recursive:true});
const checks=[];
for(const budget of [20,40]){
  const reports=[];
  for(const mode of ['upgrade-first','completion-first']){
    const env={...process.env,TFTBOT_AUDIT_BUDGET:String(budget),TFTBOT_AUDIT_POLICY:mode};
    for(const key of ['TFTBOT_AUDIT_STATES','TFTBOT_AUDIT_BOARDS','TFTBOT_AUDIT_NO_PAIR_CACHE','TFTBOT_AUDIT_NO_SCORE_CACHE'])delete env[key];
    const run=spawnSync(process.execPath,['scripts/audit-search-landings.mjs','--current-purchases'],{env,windowsHide:true,encoding:'utf8',maxBuffer:4_000_000});
    if(run.status!==0)throw Error(mode+' failed: '+String(run.stderr||run.error).slice(-2000));
    const text=await fs.readFile('dist/current-pursuit-audit/report.json','utf8'),report=JSON.parse(text);await fs.writeFile(path.join(out,budget+'-'+mode+'.json'),text);
    if(!report.result.ready||report.result.mode!==mode)throw Error('No policy result');reports.push(report);
  }
  const [base,adaptive]=reports;
  if(base.modelVersion!==adaptive.modelVersion||JSON.stringify(base.shopping)!==JSON.stringify(adaptive.shopping)||base.result.paths.length!==adaptive.result.paths.length)throw Error('Policy context changed');
  let improved=0;
  for(const [i,p]of base.result.paths.entries())for(const [j,b]of p.bands.entries()){
    const next=adaptive.result.paths[i],band=next.bands[j];if(p.id!==next.id||b.heroSlots!==band.heroSlots)throw Error('Changed current purchase roots');
    if(b.unresolved>1e-8||band.unresolved>1e-8)throw Error('Fixture requires fully expanded forward distributions');
    if(band.completion.lower+1e-8<b.completion.lower)throw Error('Adaptive completion fell below its base policy');
    if(band.completion.lower>b.completion.lower+1e-8)improved++;
    if(band.combat.lower<0||band.combat.upper>1||band.combat.lower>band.combat.upper||band.expectedGold.lower>next.goldAfter+1e-7)throw Error('Invalid physical outcome bounds');
  }
  checks.push({budget,paths:base.result.paths.length,improved,baseMs:base.milliseconds,adaptiveMs:adaptive.milliseconds,policy:adaptive.result.adaptive,
    skip:reports.map(r=>({mode:r.result.mode,bands:r.result.paths[0].bands.map(b=>({slots:b.heroSlots,completion:b.completion,combat:b.combat,gold:b.expectedGold,coverage:b.evaluatedMass}))}))});
}
const report={scope:'Synthetic fixed-level, fixed-pool, fixed-opponent model comparison. Completion is not combat or ranked benefit.',checks};
await fs.writeFile(path.join(out,'checks.json'),JSON.stringify(report,null,2));console.log('ADAPTIVE_PURSUIT_AUDIT_PASS',JSON.stringify(report));
