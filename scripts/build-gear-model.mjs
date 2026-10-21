import fs from 'node:fs/promises';
import {build} from 'esbuild';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const out=path.resolve('dist/comp-profile-analysis');
await build({entryPoints:['src/decision/gear-affinity.ts'],outfile:path.join(out,'gear-adapter.mjs'),bundle:true,platform:'node',format:'esm'});
const {buildGearModel,gearAffinity,gearOrientation}=await import(pathToFileURL(path.join(out,'gear-adapter.mjs')));
const {profiles,meta}=JSON.parse(await fs.readFile('data/metatft-strategic-profiles.json','utf8')),roles=JSON.parse(await fs.readFile('data/decision-unit-roles.json','utf8')).units;
const items=JSON.parse(await fs.readFile('data/tft-sets.json','utf8')).items;
const model=buildGearModel(profiles,items,roles);await fs.writeFile('data/metatft-gear-model.json',JSON.stringify({meta:{...meta,model:'empirical item/component compatibility; not calibrated placement probability'},...model}));
const scenarios={AP:['DA_Component_NeedlesslyLargeRod','DA_Component_NeedlesslyLargeRod','DA_Component_TearOfTheGoddess'],AD:['DA_Component_BFSword','DA_Component_RecurveBow','DA_Component_SparringGloves'],shared:['DA_GuinsoosRageblade'],frontline:['DA_Component_ChainVest','DA_Component_NegatronCloak','DA_Component_GiantsBelt']};
const report={models:model.models.length,scenarios:Object.fromEntries(Object.entries(scenarios).map(([label,ids])=>{
  const tokens=ids.map(id=>({id})),ranked=profiles.map(p=>({name:p.name,regime:p.regime.primary,carry:p.regime.carry,orientation:model.models.find(m=>m.profile===p.key&&m.unit===p.regime.carry)?.orientation,...gearAffinity(model,p.key,p.regime.carry,tokens)})).sort((a,b)=>b.componentLift-a.componentLift||b.coreItemLift-a.coreItemLift);
  return [label,{orientation:gearOrientation(tokens,model),top:ranked.slice(0,6),positiveSharedFamilies:[...new Set(ranked.filter(r=>r.coreItemLift>0).map(r=>r.orientation))]}];
}))};
await fs.writeFile(path.join(out,'gear-audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({models:report.models,scenarios:Object.fromEntries(Object.entries(report.scenarios).map(([k,v])=>[k,{orientation:v.orientation,top:v.top.slice(0,3).map(r=>({name:r.name,carry:r.carry,componentLift:r.componentLift,coreItemLift:r.coreItemLift})),sharedFamilies:v.positiveSharedFamilies}]))}));
