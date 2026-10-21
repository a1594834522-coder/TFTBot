import fs from 'node:fs/promises';
import {build} from 'esbuild';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const folder=path.resolve('dist/comp-profile-analysis'),index=JSON.parse(await fs.readFile(path.join(folder,'index.json'),'utf8'));
const referenceDir=process.env.METATFT_REFERENCE_DIR;
if(!referenceDir)throw Error('Set METATFT_REFERENCE_DIR to the local MetaTFT reference-data directory. Normal builds use the committed snapshots and do not need it.');
const lookup=JSON.parse((await fs.readFile(path.join(referenceDir,'TFTSet18_latest_en_us.json'),'utf8')).replace(/^\uFEFF/,''));
const naming=JSON.parse(await fs.readFile('dist/metatft-audit-latest_cluster_info.json','utf8'));
if(naming.cluster_info?.cluster_id!==index.meta.clusterId||naming.tft_set!=='TFTSet18')throw Error('Cluster naming scope differs from aggregate profiles');
const named=new Map(naming.cluster_info.cluster_details.clusters.map(c=>[String(c.Cluster),c.name.filter(p=>p.type==='unit').map(p=>p.name)]));
const aliases=JSON.parse(await fs.readFile('data/current-shop-mechanics.json','utf8')).aliases;
const adapter=path.join(folder,'profile-adapter.mjs');await build({entryPoints:['src/decision/comp-profiles.ts'],outfile:adapter,bundle:true,platform:'node',format:'esm'});
const {parseCompProfile,normalizeRoleTags}=await import(pathToFileURL(adapter));
const roles={};for(const u of lookup.units)for(const id of [u.apiName,...u.assetNames??[]])roles[id]={cost:u.cost,role:u.role??'',tags:normalizeRoleTags(u.roleTags??[]),traits:u.traitApiNames??[],shop:!!u.shopUnit};
await fs.writeFile('data/decision-unit-roles.json',JSON.stringify({meta:lookup._metadata,units:roles}));


const profiles=[];for(const record of index.records){const id=record.key.split(':').at(-1),raw=JSON.parse(await fs.readFile(path.join(folder,id+'.json'),'utf8'));profiles.push(parseCompProfile(record.key,record.name,raw,roles,(named.get(id)??[]).map(id=>aliases[id]??id)));}
await fs.writeFile('data/metatft-strategic-profiles.json',JSON.stringify({meta:{...index.meta,scope:'Full aggregate variants and provided early-board observations; early counts are not unique-game counts'},profiles}));
const report={profiles:profiles.length,boards:profiles.reduce((n,p)=>n+p.boards.length,0),early:profiles.reduce((n,p)=>n+p.early.length,0),builds:profiles.reduce((n,p)=>n+p.builds.length,0),regimes:Object.fromEntries(['reroll','four-cost','legendary'].map(kind=>[kind,profiles.filter(p=>p.regime.primary===kind).map(p=>({name:p.name,...p.regime}))]))};
await fs.writeFile(path.join(folder,'regime-audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({profiles:report.profiles,boards:report.boards,early:report.early,builds:report.builds,regimes:Object.fromEntries(Object.entries(report.regimes).map(([k,v])=>[k,v.length]))}));
