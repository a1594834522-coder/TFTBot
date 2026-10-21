import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
/** A file means exactly that file. A directory means the retained ring, oldest
 * archive first and the active segment last. Never follow archive symlinks. */
export async function traceFiles(input){
  const root=path.resolve(input),stat=await fsp.lstat(root);
  if(!stat.isFile()&&(!stat.isDirectory()||stat.isSymbolicLink()))throw Error('Trace input must be a regular file or directory');
  const paths=stat.isFile()?[root]:(await fsp.readdir(root,{withFileTypes:true})).filter(e=>e.isFile()&&/^events(?:\.[1-9]\d*)?\.jsonl$/.test(e.name))
    .sort((a,b)=>Number(/\.(\d+)\.jsonl$/.exec(b.name)?.[1]??0)-Number(/\.(\d+)\.jsonl$/.exec(a.name)?.[1]??0)).map(e=>path.join(root,e.name));
  return Promise.all(paths.map(async file=>{const s=await fsp.lstat(file,{bigint:true});if(!s.isFile()||s.isSymbolicLink())throw Error('Trace segment changed during inventory');return {file,bytes:Number(s.size),identity:`${s.dev}:${s.ino}`};}));
}
export async function* traceLines(files){
  const opened=await Promise.all(files.map(async segment=>{
    try{const handle=await fsp.open(segment.file,'r');return {segment,handle};}catch(error){return {segment,error:String(error.message??error)};}
  }));
  try{for(const {segment,handle,error}of opened){
    const file=segment.file;let line=0;
    if(!handle){yield {file,line,error:error??'Trace segment unavailable'};continue;}
    let stream;
    try{
      const stat=await handle.stat({bigint:true});
      if(`${stat.dev}:${stat.ino}`!==segment.identity||stat.size<BigInt(segment.bytes))throw Error('Trace segment changed after inventory; repeat the read');
      if(!segment.bytes)continue;
      stream=handle.createReadStream({start:0,end:segment.bytes-1,autoClose:false});
      const reader=readline.createInterface({input:stream,crlfDelay:Infinity});let failed;
      stream.once('error',error=>{failed=error;reader.close();});
      for await(const text of reader){line++;if(text.trim())yield {file,line,text};}
      if(failed)throw failed;
      if(stream.bytesRead!==segment.bytes)throw Error('Trace segment truncated during read');
    }catch(error){yield {file,line,error:String(error.message??error)};}finally{stream?.destroy();}
  }}finally{await Promise.all(opened.map(row=>row.handle?.close()));}
}
export function decisionRecord(entry){
  const s=entry?.status,clock=Date.parse(entry?.at);
  if(entry?.type!=='decision-state'||entry.schema!==1||!Number.isFinite(clock)||!s||s.testMode!==false||s.transport!=='original-native'||!['stopped','waiting','connected','receiving','error'].includes(s.phase)||!Number.isSafeInteger(s.frames)||!s.cards||!Array.isArray(s.cards.shop)||!Array.isArray(s.cards.augments)||s.lastFrameAt!==null&&!Number.isFinite(s.lastFrameAt))return null;
  return {capturedAt:entry.at,clock,status:s};
}
