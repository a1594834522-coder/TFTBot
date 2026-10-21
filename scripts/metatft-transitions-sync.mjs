/** Aggregate transition tables only; never downloads individual match histories. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'dist','transition-analysis');
fs.mkdirSync(directory,{recursive:true});
const headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.metatft.com/','Origin':'https://www.metatft.com'};
async function get(url){
  let error;
  for(let attempt=0;attempt<3;attempt++)try{
    const r=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch(e){error=e;}
  throw new Error(`${url}: ${error}`);
}
const endpoint='https://api.metatft.com/tft-early-comps/';
const startedAt=new Date().toISOString();
const overview=await get(endpoint+'comps_overview');
if(overview.tft_set!=='TFTSet18')throw new Error('仅接受当前 S18；保留原快照');
fs.writeFileSync(path.join(directory,'overview.json'),JSON.stringify(overview));
const tasks=Object.entries(overview.comps_overview).flatMap(([stage,v])=>v.comps.map(c=>({stage:Number(stage.split('-')[1]),cluster:String(c.cluster)})));
const details=[];let cursor=0,completed=0;
await Promise.all([0,1].map(async()=>{
  while(cursor<tasks.length){
    const {stage,cluster}=tasks[cursor++];
    const query=new URLSearchParams({stage:String(stage),cluster_id:cluster,clustering_id:String(overview.clustering_id)});
    const data=await get(endpoint+'comps_full?'+query);
    if(data.error||data.tft_set!==overview.tft_set||data.clustering_id!==overview.clustering_id||String(data.comps_full?.cluster)!==cluster)throw new Error(`版本/身份不匹配 ${stage}/${cluster}`);
    const record={stage,cluster,fetchedAt:new Date().toISOString(),data};
    details.push(record);
    fs.writeFileSync(path.join(directory,`full-${stage}-${cluster}.json`),JSON.stringify(record));
    completed++;
    if(completed%20===0||completed===tasks.length)console.log(`[transitions] ${completed}/${tasks.length}`);
  }
}));
const end=await get(endpoint+'comps_overview');
if(end.tft_set!==overview.tft_set||end.clustering_id!==overview.clustering_id)throw new Error('同步期间聚类变化；保留原快照');
const adapter=path.join(directory,'adapter.mjs');
await build({entryPoints:[path.join(root,'src/game/early-transition-graph.ts')],outfile:adapter,bundle:true,platform:'node',format:'esm'});
const {buildEarlyTransitionGraph}=await import(pathToFileURL(adapter));
const graph=buildEarlyTransitionGraph(overview,details);
graph.meta.startedAt=startedAt;graph.meta.completedAt=new Date().toISOString();
const target=path.join(root,'data/metatft-transitions.json');
// The rich item/holder marginals are large. Keep them offline; do not import this into the HUD bundle.
fs.writeFileSync(target+'.tmp',JSON.stringify(graph));
fs.renameSync(target+'.tmp',target);
console.log(JSON.stringify({nodes:graph.nodes.length,edges:graph.edges.length,exits:graph.exits.length,output:target}));
