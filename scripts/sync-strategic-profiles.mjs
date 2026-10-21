/** Whole aggregate comp profiles: no individual match histories. */
import fs from 'node:fs/promises';
import path from 'node:path';
const base=JSON.parse(await fs.readFile('data/metatft-comps.json','utf8'));
const out=path.resolve('dist/comp-profile-analysis');await fs.mkdir(out,{recursive:true});
const headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.metatft.com/','Origin':'https://www.metatft.com'};
async function get(url){let error;for(let attempt=0;attempt<3;attempt++)try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}catch(e){error=e;}throw error;}
const endpoint='https://api-hc.metatft.com/tft-comps-api/';
const cluster=await get(endpoint+'latest_cluster_id');if(cluster.tft_set!=='TFTSet18'||cluster.cluster_id!==base.meta.cluster_id)throw Error('Season/cluster differs from named comp catalogue');
const list=base.sets['18'],records=[];let cursor=0;
await Promise.all([0,1].map(async()=>{while(cursor<list.length){
  const comp=list[cursor++],id=comp.id.split(':').at(-1),url=endpoint+'comp_details?'+new URLSearchParams({comp:id,cluster_id:String(cluster.cluster_id),queue:'1100'});
  const raw=await get(url);if(raw.tft_set!==cluster.tft_set||raw.cluster_id!==cluster.cluster_id||Number(raw.queue_id)!==1100||String(raw.results?.cluster)!==id)throw Error('Profile scope mismatch: '+id);
  records.push({key:comp.id,name:comp.name,fetchedAt:new Date().toISOString(),url,raw});
  await fs.writeFile(path.join(out,id+'.json'),JSON.stringify(raw));
  if(records.length%10===0)console.log('[comp profiles] '+records.length+'/'+list.length);
}}));
const end=await get(endpoint+'latest_cluster_id');if(end.cluster_id!==cluster.cluster_id||end.tft_set!==cluster.tft_set)throw Error('Cluster changed during sync');
await fs.writeFile(path.join(out,'index.json'),JSON.stringify({meta:{set:'TFTSet18',clusterId:cluster.cluster_id,queue:1100,fetchedAt:new Date().toISOString(),window:'API default aggregate window; patch/rank scope is not declared in each detail response',source:endpoint},records:records.map(r=>({...r,raw:undefined}))},null,2));
console.log(JSON.stringify({profiles:records.length,source:out}));
