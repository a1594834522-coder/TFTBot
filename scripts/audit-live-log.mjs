import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'node:readline';
const file=process.argv[2]??'dist/live-monitor/events.jsonl';
const types={},packets={},rounds=new Set(),sessions=[];let first=null,last=null,invalid=0,total=0;
for await(const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})){
 let entry;try{entry=JSON.parse(line);}catch{invalid++;continue;}total++;first??=entry.at;last=entry.at;types[entry.type]=(types[entry.type]??0)+1;
 if(entry.type==='monitor-start')sessions.push(entry.at);
 if(entry.type==='native-packet'){
  const key=entry.category+':'+entry.key,row=packets[key]??={samples:0,accepted:0,truncated:0,first:entry.at,last:entry.at};row.samples++;row.accepted+=Number(entry.accepted);row.last=entry.at;
  if(entry.sample){try{const sample=JSON.parse(entry.sample);if(entry.key==='tft_round')rounds.add(typeof sample==='string'?sample:sample.stage);}catch{if(entry.sample.length>=24000)row.truncated++;}}
 }
}
const result={file,total,first,last,invalid,sessions,types,rounds:[...rounds].sort(),packets};
await fsp.mkdir('dist/live-replay-audit',{recursive:true});await fsp.writeFile('dist/live-replay-audit/coverage.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({total,first,last,invalid,sessions:sessions.length,types,rounds:result.rounds,packets}));
