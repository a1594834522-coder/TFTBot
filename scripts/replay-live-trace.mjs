// Extract captured decision inputs with their ORIGINAL clock, never today's
// time. No game input, model claims, or network access. Output stays in dist/.
import fs from 'node:fs/promises';
import path from 'node:path';
import {traceFiles,traceLines,decisionRecord} from './lib/trace-files.mjs';
const input=process.argv[2]??'dist/live-monitor',files=await traceFiles(input),out=path.resolve(process.argv[3]??'dist/live-replay-audit/decision-states.jsonl');
const reportFile=path.join(path.dirname(out),path.basename(out,path.extname(out))+'.report.json');
const normalized=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
for(const target of [out,reportFile]){
  const stat=await fs.lstat(target,{bigint:true}).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(stat&&(!stat.isFile()||stat.isSymbolicLink()))throw Error('Replay output must be a regular file');
  if(files.some(segment=>normalized(segment.file)===normalized(target)||stat&&segment.identity===`${stat.dev}:${stat.ino}`))throw Error('Replay output must not overwrite an input');
}
await fs.mkdir(path.dirname(out),{recursive:true});
const output=await fs.open(out,'w'),errors=[];let decisions=0,invalid=0,omitted=0;
try{for await(const line of traceLines(files)){
  if(line.error){errors.push({file:line.file,error:line.error});continue;}
  let entry;try{entry=JSON.parse(line.text);}catch{invalid++;continue;}
  if(entry.type==='trace-entry-omitted')omitted++;
  if(entry.type!=='decision-state')continue;
  const frame=decisionRecord(entry);if(!frame){invalid++;continue;}
  await output.write(JSON.stringify(frame)+'\n');decisions++;
}}finally{await output.close();}
const report={input,files,output:out,decisions,invalid,omitted,readErrors:errors,scope:'Retained keyframes, not every game event. Evaluate each state using its captured clock. No ranked-performance claim.'};
await fs.writeFile(reportFile,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(errors.length)process.exitCode=1;
