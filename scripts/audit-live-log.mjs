import fsp from 'node:fs/promises';
import {traceFiles,traceLines} from './lib/trace-files.mjs';
const file=process.argv[2]??'dist/live-monitor',files=await traceFiles(file),readErrors=[];
const types={},packets={},rounds=new Set(),sessions=[];let first=null,last=null,invalid=0,total=0;
for await(const line of traceLines(files)){
 if(line.error){readErrors.push({file:line.file,error:line.error});continue;}
 let entry;try{entry=JSON.parse(line.text);}catch{invalid++;continue;}total++;if(entry.at){first=first===null||entry.at<first?entry.at:first;last=last===null||entry.at>last?entry.at:last;}types[entry.type]=(types[entry.type]??0)+1;
 if(entry.type==='monitor-start')sessions.push(entry.at);
 if(entry.type==='native-packet'||entry.type==='native-packet-detailed'){
  const key=entry.category+':'+entry.key,row=packets[key]??={samples:0,accepted:0,truncated:0,first:entry.at,last:entry.at};row.samples++;row.accepted+=Number(entry.accepted);row.last=entry.at;
  if(entry.truncated)row.truncated++;
  let raw=entry.sample;if(entry.raw){try{const packet=JSON.parse(entry.raw);raw=packet.value??packet.data;}catch{}}
  if(raw!==undefined){try{const sample=typeof raw==='string'?JSON.parse(raw):raw;if(entry.key==='tft_round')rounds.add(typeof sample==='string'?sample:sample?.stage);}catch{if(typeof raw==='string'&&raw.length>=24000)row.truncated++;}}
 }
}
const result={file,files,readErrors,total,first,last,invalid,sessions,types,rounds:[...rounds].sort(),packets};
await fsp.mkdir('dist/live-replay-audit',{recursive:true});await fsp.writeFile('dist/live-replay-audit/coverage.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({files:files.length,readErrors,total,first,last,invalid,sessions:sessions.length,types,rounds:result.rounds,packets}));if(readErrors.length)process.exitCode=1;
