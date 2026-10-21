import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createScoreboardReader,ORIGINAL_SCOREBOARD_CHANNEL} from './scoreboard-reader';
const requireNative=createRequire(__filename);
const send=(message:unknown)=>process.parentPort?.postMessage(message);
let serial=0;
const pending=new Map<number,{resolve(value:{success:boolean;message:string}):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>();
let channel=ORIGINAL_SCOREBOARD_CHANNEL;
// Recovery record only for a game already bound by a previous diagnostic build.
try{const saved=readFileSync(process.argv[3],'utf8').trim();if(/^\{[A-Fa-f0-9-]{36}\}$/.test(saved))channel=saved;}catch{}
const reader=createScoreboardReader({
  channel,
  module:requireNative(process.argv[2]),
  invoke(method,value){return new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('记分板连接请求超时'));},10000);pending.set(id,{resolve,reject,timer});send({type:'invoke',id,method,value});});},
  frame:value=>send({type:'scoreboard-frame',value}),
  status:(phase,message)=>send({type:'scoreboard-status',phase,message}),
});
process.parentPort?.on('message',event=>{
  const data=event.data;
  if(data==='stop'){reader.stop();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('记分板采集已停止'));}pending.clear();process.exit(0);}
  else if(data?.type==='invoke-result'){const p=pending.get(data.id);if(!p)return;clearTimeout(p.timer);pending.delete(data.id);p.resolve({success:!!data.success,message:String(data.message??'')});}
});
