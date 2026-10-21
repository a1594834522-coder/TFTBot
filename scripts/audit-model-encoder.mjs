// Compare numeric features against only the inspected, hash-pinned live-board
// functions from the user-supplied bundle. Never execute/import the application.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import * as tf from '@tensorflow/tfjs';
const root=process.env.METATFT_REFERENCE_DIR;if(!root)throw Error('Set METATFT_REFERENCE_DIR to the supplied reference directory');
const out=path.resolve('dist/model-encoder-audit');await fs.mkdir(path.join(out,'source'),{recursive:true});
const policy=JSON.parse(await fs.readFile('data/battle-unit-policy.json','utf8')),bytes=await fs.readFile(path.join(root,'main.js'));
const sha256=createHash('sha256').update(bytes).digest('hex');if(sha256!==policy.evidence.mainSha256)throw Error('Bundle identity changed; inspect the new source first');
const source=bytes.toString('utf8'),start=source.indexOf('async function ONt('),end=source.indexOf('async function jNt(',start),helperStart=source.indexOf('function Hme('),helperEnd=source.indexOf('var xB=new Map',helperStart);
if([start,end,helperStart,helperEnd].some(n=>n<0)||end-start>12000||helperEnd-helperStart>2000)throw Error('Inspected source boundaries changed');
const isolated=source.slice(helperStart,helperEnd)+'\n'+source.slice(start,end);
await fs.writeFile(path.join(out,'source/encoder.js'),isolated);
await build({entryPoints:['src/game/battle-model-encoding.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(out,'encoder.mjs')});
const {encodeBattleBoard}=await import(pathToFileURL(path.join(out,'encoder.mjs'))),lookup=JSON.parse(await fs.readFile('data/metatft-model/lookups.json','utf8'));
await tf.setBackend('cpu');await tf.ready();
let captured=[];
const sandbox=vm.createContext({xB:new Map([['TFTSet18',lookup]]),hA:new Map([['TFTSet18',{predict:tensors=>{captured=tensors.map(t=>Array.from(t.dataSync()));return Array.from({length:5},()=>tf.tensor([0]));}}]]),J3:new Map(),wB:new Map(),bl:'TFTSet18',Mc:tf.oneHot,Vi:tf.tensor,Ja:tf.sum,lr:tf.zeros,console:{log(){},warn(){}}});
const original=new vm.Script(isolated+'\nONt').runInContext(sandbox,{timeout:2000});
const unit=(id,star=2,items=[])=>({id,star,items}),base=()=>({units:[unit('DA_18_Shen'),unit('DA_18_Akali_AD',1,['DA_InfinityEdge'])],augments:[]});
const cases=[{name:'ordinary',board:base()}];
for(const id of policy.excluded)cases.push({name:'unencoded:'+id,board:{...base(),units:[unit(id,0),...base().units]}});
cases.push({name:'raw-count-over-14',board:{...base(),units:[...Array.from({length:20},()=>unit('DA_Elderwood18_StonebarkTree',0)),...base().units]}});
for(const id of Object.keys(policy.forms))cases.push({name:'battle-form:'+id,board:{...base(),units:[unit(id),...base().units]}});
for(const id of Object.keys(policy.auxiliaries))cases.push({name:'encoded-auxiliary:'+id,board:{...base(),units:[...base().units,unit(id)]}});
for(const id of ['DA_Golem','TFT_BlueGolem'])cases.push({name:'golem-encoding:'+id,board:{...base(),units:[...base().units,unit(id)]}});
const emblem=Object.keys(lookup.emblems)[0];if(emblem)cases.push({name:'dummy-emblem',board:{...base(),units:[...base().units,unit('DA_TrainingDummy',1,[emblem])]}});
for(const id of ['DA_TheTower','DA_Dummify','DA_18_SprykinAugment'].filter(id=>lookup.augment_lookup[id]))cases.push({name:'augment:'+id,board:{...base(),augments:[id]}});
const wire=(board,other)=>[...board.units.map(u=>({unit:u.id,tier:u.star,item_ids:u.items})),...(other.augments.length?[{unit:lookup.augment_holder,item_ids:other.augments}]:[])];
let maxError=0,values=0;const results=[];
for(const entry of cases){
  const opponent=base(),ours=encodeBattleBoard(entry.board,lookup,'player'),other=encodeBattleBoard(opponent,lookup,'opponent');
  if(ours.unknown.length||other.unknown.length)throw Error('Unexpected unsupported fixture: '+entry.name);
  const expected=[...Object.values(ours.inputs),...Object.values(other.inputs)],before=tf.memory().numTensors;
  tf.engine().startScope('original-encoder-contract');
  try{await original(wire(entry.board,opponent),wire(opponent,entry.board),'TFTSet18');}finally{tf.engine().endScope();}
  if(captured.length!==expected.length||tf.memory().numTensors!==before)throw Error('Encoder shape/tensor leak: '+entry.name);
  let error=0;
  for(let i=0;i<expected.length;i++){
    if(captured[i].length!==expected[i].length)throw Error('Input width differs: '+entry.name+'/'+i);
    for(let j=0;j<expected[i].length;j++){error=Math.max(error,Math.abs(captured[i][j]-expected[i][j]));values++;}
  }
  if(error>1e-6)throw Error('Original feature mismatch: '+entry.name+' '+error);
  maxError=Math.max(maxError,error);results.push({name:entry.name,maxError:error,excluded:ours.excludedUnits,traits:ours.traitCounts});
}
const report={bundleSha256:sha256,originalFunctionSha256:createHash('sha256').update(isolated).digest('hex'),sourceByteRange:[Buffer.byteLength(source.slice(0,start)),Buffer.byteLength(source.slice(0,end))],cases:results.length,values,maxError,results};
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log('ORIGINAL_ENCODER_PARITY_PASS',JSON.stringify({cases:results.length,values,maxError,bundleSha256:sha256}));
