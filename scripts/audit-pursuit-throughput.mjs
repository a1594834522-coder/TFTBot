// Separate cold processes, the same synthetic holdings/pool/opponent and real
// checksummed model. No game connection, provider requests or ranking claims.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('dist/pursuit-throughput');await fs.mkdir(out,{recursive:true});
const reports=[];
for(const [name,boards,disabled]of [['reference-192',192,true],['reuse-192',192,false],['reuse-384',384,false]]){
  const env={...process.env,TFTBOT_AUDIT_BUDGET:'40',TFTBOT_AUDIT_BOARDS:String(boards),TFTBOT_AUDIT_POLICY:'upgrade-first'};
  delete env.TFTBOT_AUDIT_STATES;delete env.TFTBOT_AUDIT_NO_PAIR_CACHE;delete env.TFTBOT_AUDIT_NO_SCORE_CACHE;
  if(disabled){env.TFTBOT_AUDIT_NO_PAIR_CACHE='1';env.TFTBOT_AUDIT_NO_SCORE_CACHE='1';}
  const run=spawnSync(process.execPath,['scripts/audit-search-landings.mjs','--current-purchases'],{env,windowsHide:true,encoding:'utf8',maxBuffer:4_000_000});
  if(run.status!==0)throw Error(name+' failed: '+String(run.stderr||run.error||run.stdout).slice(-3000));
  const text=await fs.readFile('dist/current-pursuit-audit/report.json','utf8'),report=JSON.parse(text);await fs.writeFile(path.join(out,name+'.json'),text);
  if(!report.result.ready)throw Error(name+' did not produce comparisons');reports.push(report);
}
const [reference,reuse,expanded]=reports,close=(a,b)=>Math.abs(a-b)<1e-6;
let narrowed=0,largestDifference=0;
for(const result of reports){
  if(result.modelVersion!==reference.modelVersion||JSON.stringify(result.shopping)!==JSON.stringify(reference.shopping))throw Error('Benchmark context changed');
  if(result.result.paths.length!==reference.result.paths.length)throw Error('Benchmark dropped purchase roots');
}
for(const [i,p]of reference.result.paths.entries())for(const [j,b]of p.bands.entries()){
  const same=reuse.result.paths[i],more=expanded.result.paths[i];if(same.id!==p.id||more.id!==p.id)throw Error('Purchase order changed');
  const r=same.bands[j],e=more.bands[j];
  for(const field of ['completion','expectedGold'])for(const side of ['lower','upper'])if(!close(b[field][side],r[field][side])||!close(b[field][side],e[field][side]))throw Error(field+' changed under score reuse');
  for(const side of ['lower','upper']){const delta=Math.abs(b.combat[side]-r.combat[side]);largestDifference=Math.max(largestDifference,delta);if(delta>1e-6)throw Error('Cache changed model value');}
  if(e.evaluatedMass+1e-7<b.evaluatedMass||e.combat.lower+1e-6<b.combat.lower||e.combat.upper>b.combat.upper+1e-6)throw Error('Additional evaluations widened the model bounds');
  if(e.combat.upper-e.combat.lower<b.combat.upper-b.combat.lower-1e-6)narrowed++;
}
const report={scope:'Synthetic fixed-context engineering audit, not real ranked benefit or a worst-case latency guarantee.',model:reference.modelVersion,paths:reference.result.paths.length,bands:reference.result.paths.reduce((n,p)=>n+p.bands.length,0),largestDifference,narrowed,
  runs:reports.map((r,i)=>({name:['reference-192','reuse-192','reuse-384'][i],milliseconds:r.milliseconds,phases:r.phases,evaluations:r.result.evaluations,cache:r.cache,skip:r.result.paths[0].bands.map(b=>({slots:b.heroSlots,coverage:b.evaluatedMass,combat:b.combat}))}))};
await fs.writeFile(path.join(out,'checks.json'),JSON.stringify(report,null,2));console.log('PURSUIT_THROUGHPUT_AUDIT_PASS',JSON.stringify(report));
