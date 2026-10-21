import * as tf from '@tensorflow/tfjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {encodeBattleBoard,type BattleBoard,type BattleLookups} from '../game/battle-model-encoding';
import {createCachedBattleModel} from './cached-battle-model';

export interface BattlePrediction {winRate:number;strength:number[];modelVersion:string}
/** Offline runtime. Intended for the decision worker, never the UI or game reader thread. */
export async function loadBattleModel(directory:string){
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  if(manifest.set!==18)throw new Error('Battle model season mismatch');
  const files:Record<string,Buffer>={};
  for(const name of ['lookups.json','model.json','group1-shard1of1.bin']){
    const value=await fs.readFile(path.join(directory,name)),hash=createHash('sha256').update(value).digest('hex');
    if(hash!==manifest.files[name]?.sha256||value.length!==manifest.files[name]?.bytes)throw new Error('Battle model checksum mismatch: '+name);
    files[name]=value;
  }
  const raw=JSON.parse(files['model.json'].toString()),lookup=JSON.parse(files['lookups.json'].toString()) as BattleLookups;
  const inputLayers=raw.modelTopology?.model_config?.config?.layers?.filter((l:any)=>l.class_name==='InputLayer');
  if(!Array.isArray(inputLayers)||inputLayers.length!==2*(lookup.max_num_units*5+3))throw new Error('Model/lookup input contract mismatch');
  await tf.setBackend('cpu');await tf.ready();
  const specs=raw.weightsManifest.flatMap((group:any)=>group.weights);
  if(raw.weightsManifest.length!==1||raw.weightsManifest[0].paths.join()!=='group1-shard1of1.bin')throw new Error('Unsupported model shard layout');
  const weightData=Uint8Array.from(files['group1-shard1of1.bin']).buffer;
  // tfjs-layers applies four weight constraints while loading; their temporary
  // tensors otherwise outlive the model. Variables survive an engine scope.
  tf.engine().startScope('metatft-model-load');
  let model:tf.LayersModel;
  try{model=await tf.loadLayersModel(tf.io.fromMemory({modelTopology:raw.modelTopology,weightSpecs:specs,weightData}));}
  finally{tf.engine().endScope();}
  if(model.inputs.length!==inputLayers.length||model.outputs.length!==5){model.dispose();throw new Error('Unexpected battle model outputs');}
  const version=manifest.files['model.json'].sha256.slice(0,12)+':'+manifest.files['lookups.json'].sha256.slice(0,12);
  const cached=createCachedBattleModel(model,lookup);
  function predictBatch(pairs:Array<{player:BattleBoard;opponent:BattleBoard}>):BattlePrediction[]{
    if(!pairs.length)return [];
    if(pairs.length>256)throw new Error('Battle inference batch limit exceeded');
    const features=pairs.map(({player,opponent})=>{
      const a=encodeBattleBoard(player,lookup,'player'),b=encodeBattleBoard(opponent,lookup,'opponent');
      if(a.unknown.length||b.unknown.length)throw new Error('Unsupported model features: '+[...a.unknown,...b.unknown].join(','));
      return {...a.inputs,...b.inputs};
    });
    return tf.tidy(()=>{
      const tensors=model.inputs.map(input=>{
        const name=input.name.replace(/:\d+$/,''),rows=features.map(f=>f[name]);
        const width=input.shape[1];
        if(width===null||rows.some(r=>!r||r.length!==width))throw new Error('Model feature shape mismatch: '+name);
        return tf.tensor2d(rows,[pairs.length,width]);
      });
      const output=model.predict(tensors) as tf.Tensor[];
      const values=output.map(t=>Array.from(t.dataSync()));
      return pairs.map((_,i)=>{
        const winRate=values[4][i];if(!Number.isFinite(winRate)||winRate<0||winRate>1)throw new Error('Non-finite model prediction');
        const transform=lookup.board_strength_parameters;
        return {winRate,strength:[values[0][i],values[1][i]].map(v=>transform?v*transform.m+transform.c:v),modelVersion:version};
      });
    });
  }
  function predictCachedBatch(pairs:Array<{player:BattleBoard;opponent:BattleBoard}>):BattlePrediction[]{
    return cached.predictBatch(pairs).map(result=>{if(!Number.isFinite(result.winRate)||result.winRate<0||result.winRate>1)throw new Error('Non-finite cached model prediction');const transform=lookup.board_strength_parameters;return {winRate:result.winRate,strength:result.rawStrength.map(v=>transform?v*transform.m+transform.c:v),modelVersion:version};});
  }
  return {lookup,version,predictBatch,predictCachedBatch,cacheMetrics:cached.metrics,predict:(player:BattleBoard,opponent:BattleBoard)=>predictBatch([{player,opponent}])[0],dispose:cached.dispose,tensorCount:()=>tf.memory().numTensors};
}
