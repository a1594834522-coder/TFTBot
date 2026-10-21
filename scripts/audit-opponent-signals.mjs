import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'node:readline';
const file=process.argv[2]??'dist/live-monitor/events.jsonl';
const signals=new Map(),rounds=new Set();let samples=0,invalid=0;
for await(const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})){
  let entry;try{entry=JSON.parse(line);}catch{invalid++;continue;}
  if(entry.type!=='opponent-signal-probe')continue;
  samples++;if(entry.round)rounds.add(entry.round);
  const key=entry.category+':'+entry.key,row=signals.get(key)??{key,count:0,accepted:0,first:entry.at,last:entry.at,rounds:new Set(),fields:new Set(),extraRosterFields:new Set()};
  row.count++;row.accepted+=Number(entry.accepted);row.last=entry.at;if(entry.round)row.rounds.add(entry.round);
  for(const field of Object.keys(entry.fields??{}))row.fields.add(field);
  for(const field of entry.extraRosterFields??[])row.extraRosterFields.add(field.path);
  signals.set(key,row);
}
const result={file,samples,invalid,rounds:[...rounds].sort(),interpretation:'Contract evidence only. No field has been verified as next-opponent eligibility.',
  signals:[...signals.values()].map(r=>({...r,rounds:[...r.rounds].sort(),fields:[...r.fields].sort(),extraRosterFields:[...r.extraRosterFields].sort()}))};
await fsp.mkdir('dist/opponent-signals',{recursive:true});await fsp.writeFile('dist/opponent-signals/report.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
