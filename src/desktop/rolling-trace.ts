import fs from 'node:fs/promises';
import path from 'node:path';
export interface TraceLimits {maxFileBytes?:number;maxArchives?:number;maxQueuedBytes?:number;maxQueuedRecords?:number}
/** A single-writer ring of complete JSONL records. Only the reserved regular
 * files events.jsonl / events.N.jsonl inside this directory may be managed. */
export function createRollingTrace(directory:string,limits:TraceLimits={}){
  const root=path.resolve(directory),maxFileBytes=limits.maxFileBytes??16_000_000,maxArchives=limits.maxArchives??7;
  const maxQueuedBytes=limits.maxQueuedBytes??8_000_000,maxQueuedRecords=limits.maxQueuedRecords??2048;
  if(!Number.isSafeInteger(maxFileBytes)||maxFileBytes<512||maxFileBytes>50_000_000||!Number.isSafeInteger(maxArchives)||maxArchives<0||maxArchives>8)throw Error('Invalid trace retention limits');
  if(!Number.isSafeInteger(maxQueuedBytes)||maxQueuedBytes<512||maxQueuedBytes>64_000_000||!Number.isSafeInteger(maxQueuedRecords)||maxQueuedRecords<1||maxQueuedRecords>65536)throw Error('Invalid trace queue limits');
  const maxTotalBytes=maxFileBytes*(maxArchives+1),active=path.join(root,'events.jsonl');
  const slot=(index:number)=>path.join(root,`events.${index}.jsonl`);
  function checked(file:string){const relative=path.relative(root,file);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.dirname(relative)!=='.'||!/^events(?:\.[1-9]\d*)?\.jsonl$/.test(relative))throw Error('Trace path outside reserved files');return file;}
  async function inventory(){
    await fs.mkdir(root,{recursive:true});const archives:Array<{index:number;file:string;bytes:number}>=[];let bytes=0;
    for(const entry of await fs.readdir(root)){
      const index=/^events\.([1-9]\d*)\.jsonl$/.exec(entry);
      if(entry!=='events.jsonl'&&!index)continue;
      const file=checked(path.join(root,entry)),stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink())throw Error('Reserved trace path is not a regular file');
      if(index)archives.push({index:Number(index[1]),file,bytes:stat.size});else bytes=stat.size;
    }
    return {bytes,archives:archives.sort((a,b)=>b.index-a.index)};
  }
  let queue:Promise<void>=Promise.resolve(),queuedBytes=0,queuedRecords=0,droppedRecords=0,droppedBytes=0;
  function takeGap(){
    if(!droppedRecords)return '';
    const line=JSON.stringify({at:new Date().toISOString(),type:'trace-backpressure',records:droppedRecords,bytes:droppedBytes,reason:'write-queue-full'})+'\n';
    droppedRecords=0;droppedBytes=0;return line;
  }
  async function store(line:string){
      let size=Buffer.byteLength(line),state=await inventory();
      if(size>maxFileBytes){line=JSON.stringify({at:new Date().toISOString(),type:'trace-entry-omitted',bytes:size,reason:'entry-exceeds-segment'})+'\n';size=Buffer.byteLength(line);}
      if(state.bytes+size>maxFileBytes&&state.bytes){
        for(const entry of state.archives){
          if(entry.index>=maxArchives)await fs.unlink(checked(entry.file));
          else await fs.rename(checked(entry.file),checked(slot(entry.index+1)));
        }
        if(maxArchives)await fs.rename(checked(active),checked(slot(1)));else await fs.unlink(checked(active));
        state=await inventory();
      }
      let total=state.bytes+state.archives.reduce((n,e)=>n+e.bytes,0)+size;
      for(const entry of state.archives){
        if(entry.index<=maxArchives&&total<=maxTotalBytes)continue;
        await fs.unlink(checked(entry.file));total-=entry.bytes;
      }
      await fs.appendFile(checked(active),line,'utf8');
  }
  function append(line:string){
    const bytes=Buffer.byteLength(line);
    if(queuedBytes+bytes>maxQueuedBytes||queuedRecords>=maxQueuedRecords){droppedRecords++;droppedBytes+=bytes;return Promise.resolve(false);}
    const gap=takeGap();queuedBytes+=bytes;queuedRecords++;
    const task=queue.then(async()=>{if(gap)await store(gap);await store(line);return true;}).finally(()=>{queuedBytes-=bytes;queuedRecords--;});
    queue=task.then(()=>{},()=>{});return task;
  }
  function flush(){const gap=takeGap(),task=queue.then(async()=>{if(gap)await store(gap);});queue=task.catch(()=>{});return task;}
  return {append,flush,limits:{maxFileBytes,maxArchives,maxTotalBytes,maxQueuedBytes,maxQueuedRecords}};
}
