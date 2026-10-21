import * as tf from '@tensorflow/tfjs';
import {encodeBattleBoard,type BattleBoard,type BattleLookups} from '../game/battle-model-encoding';

interface Representation {embedding:number[];strength:number}
interface PairPrediction {winRate:number;rawStrength:[number,number]}
export interface BattleCacheOptions {unitCacheLimit?:number;boardCacheLimit?:number;pairCacheLimit?:number}
export function battleCacheLimits(options:BattleCacheOptions={}){
  const unitLimit=options.unitCacheLimit??8192,boardLimit=options.boardCacheLimit??4096,pairLimit=options.pairCacheLimit??32768;
  if(!Number.isSafeInteger(unitLimit)||unitLimit<1||!Number.isSafeInteger(boardLimit)||boardLimit<1||!Number.isSafeInteger(pairLimit)||pairLimit<0)throw Error('Invalid battle cache limits');
  return {unitLimit,boardLimit,pairLimit};
}
/** Reuses the ORIGINAL trained layers. Cache unit embeddings and independent board
 * representations, so comparing one board to seven opponents doesn't run it seven times. */
export function createCachedBattleModel(original:tf.LayersModel,lookup:BattleLookups,options:BattleCacheOptions={}){
  const {unitLimit,boardLimit,pairLimit}=battleCacheLimits(options);
  const apply=(name:string,input:tf.SymbolicTensor|tf.SymbolicTensor[])=>original.getLayer(name).apply(input) as tf.SymbolicTensor;
  const unitModel=tf.model({inputs:original.inputs.slice(0,5),outputs:original.getLayer('multiply').getOutputAt(0) as tf.SymbolicTensor});
  const pool=tf.input({shape:[256]}),traits=tf.input({shape:[lookup.trait_len]}),augments=tf.input({shape:[lookup.augment_len]}),charms=tf.input({shape:[lookup.charm_len]});
  const cat=(inputs:tf.SymbolicTensor[])=>tf.layers.concatenate({axis:-1}).apply(inputs) as tf.SymbolicTensor;
  const synergy=apply('synergy_processing',cat([traits,augments,charms]));
  const scaled=tf.layers.multiply().apply([pool,synergy]) as tf.SymbolicTensor;
  const embedding=apply('bs_comp_embeddings',cat([scaled,traits]));
  const strength=apply('strength_output',apply('strength_hidden',embedding));
  const boardModel=tf.model({inputs:[pool,traits,augments,charms],outputs:[embedding,strength]});
  const a=tf.input({shape:[256]}),b=tf.input({shape:[256]}),sa=tf.input({shape:[1]}),sb=tf.input({shape:[1]});
  const embeddingChance=apply('win_chance_embedding',apply('comparison',cat([a,b])));
  const strengthChance=apply('win_chance_strength',apply('strength_scale',apply('strength_diff_dense',cat([sa,sb]))));
  const prediction=apply('win_chance_combined',cat([embeddingChance,strengthChance]));
  const pairModel=tf.model({inputs:[a,b,sa,sb],outputs:prediction});
  const units=new Map<string,number[]>(),boards=new Map<string,Representation>(),pairsCache=new Map<string,PairPrediction>();
  const unitKey=(u:BattleBoard['units'][number]|undefined)=>u?JSON.stringify([u.id,u.star,[...u.items].sort()]):'empty';
  const boardKey=(board:BattleBoard)=>JSON.stringify([board.units.map(unitKey).sort(),[...board.augments].sort(),[...(board.charms??[])].sort()]);
  function retain<T>(cache:Map<string,T>,key:string,value:T,limit:number){cache.delete(key);cache.set(key,value);if(cache.size>limit)cache.delete(cache.keys().next().value!);}
  let encodedUnits=0,encodedBoards=0,pairRequests=0,inferredPairs=0;
  let disposed=false;
  function representations(input:BattleBoard[]):Representation[]{
    // A result required by this batch must survive eviction from the bounded
    // cross-batch cache. This also applies to unit vectors used by new boards.
    const pinnedBoards=new Map<string,Representation>(),pinnedUnits=new Map<string,number[]>();
    const wanted=new Map<string,{board:BattleBoard;features:ReturnType<typeof encodeBattleBoard>}>();
    for(const board of input){
      const key=boardKey(board),hit=boards.get(key);if(hit){pinnedBoards.set(key,hit);continue;}if(wanted.has(key))continue;
      const features=encodeBattleBoard(board,lookup,'player');
      if(features.unknown.length)throw new Error('Unsupported model features: '+features.unknown.join(','));
      wanted.set(key,{board,features});
    }
    const missing=new Map<string,number[][]>();
    for(const {board,features}of wanted.values())for(let i=0;i<lookup.max_num_units;i++){
      const key=unitKey(features.modeledUnits[i]);
      const hit=units.get(key);if(hit)pinnedUnits.set(key,hit);
      else if(!missing.has(key))missing.set(key,['unit','role','tier','cost','items'].map(type=>features.inputs[`player_unit_${i}_${type}`]));
    }
    const unitEntries=[...missing.entries()];
    for(let offset=0;offset<unitEntries.length;offset+=256){
      const chunk=unitEntries.slice(offset,offset+256);
      const rows=tf.tidy(()=>{
        const inputs=unitModel.inputs.map((t,index)=>tf.tensor2d(chunk.map(([,v])=>v[index]),[chunk.length,t.shape[1]!]));
        return Array.from((unitModel.predict(inputs) as tf.Tensor).dataSync());
      });
      chunk.forEach(([key],i)=>{const value=rows.slice(i*256,(i+1)*256);pinnedUnits.set(key,value);retain(units,key,value,unitLimit);});encodedUnits+=chunk.length;
    }
    const boardEntries=[...wanted.entries()];
    for(let offset=0;offset<boardEntries.length;offset+=256){
      const chunk=boardEntries.slice(offset,offset+256),pools=chunk.map(([,v])=>{
        const sum=new Float32Array(256);
        for(let i=0;i<lookup.max_num_units;i++){const vector=pinnedUnits.get(unitKey(v.features.modeledUnits[i]))!;for(let j=0;j<256;j++)sum[j]+=vector[j];}
        return Array.from(sum);
      });
      const results=tf.tidy(()=>{
        const inputs=[tf.tensor2d(pools,[chunk.length,256]),...['traits','augments','charms'].map(type=>{
          const rows=chunk.map(([,v])=>v.features.inputs['player_'+type]);return tf.tensor2d(rows,[chunk.length,rows[0].length]);
        })];
        return (boardModel.predict(inputs) as tf.Tensor[]).map(t=>Array.from(t.dataSync()));
      });
      chunk.forEach(([key],i)=>{const value={embedding:results[0].slice(i*256,(i+1)*256),strength:results[1][i]};pinnedBoards.set(key,value);retain(boards,key,value,boardLimit);});encodedBoards+=chunk.length;
    }
    return input.map(board=>pinnedBoards.get(boardKey(board))!);
  }
  return {
    predictBatch(pairs:Array<{player:BattleBoard;opponent:BattleBoard}>){
      if(disposed)throw new Error('Battle model disposed');
      if(!pairs.length)return [];
      if(pairs.length>256)throw new Error('Cached inference batch limit exceeded');
      const keys=pairs.map(p=>JSON.stringify([boardKey(p.player),boardKey(p.opponent)])),ready=new Map<string,PairPrediction>(),missing=new Map<string,typeof pairs[number]>();
      keys.forEach((key,i)=>{const hit=pairsCache.get(key);if(hit)ready.set(key,hit);else if(!missing.has(key))missing.set(key,pairs[i]);});
      const jobs=[...missing];
      if(jobs.length){
        const reps=representations(jobs.flatMap(([,p])=>[p.player,p.opponent]));
        const probabilities=tf.tidy(()=>{
          const inputs=[tf.tensor2d(jobs.map((_,i)=>reps[i*2].embedding)),tf.tensor2d(jobs.map((_,i)=>reps[i*2+1].embedding)),tf.tensor2d(jobs.map((_,i)=>[reps[i*2].strength])),tf.tensor2d(jobs.map((_,i)=>[reps[i*2+1].strength]))];
          return Array.from((pairModel.predict(inputs) as tf.Tensor).dataSync());
        });
        if(probabilities.some(winRate=>!Number.isFinite(winRate)||winRate<0||winRate>1))throw Error('Non-finite cached pair prediction');
        probabilities.forEach((winRate,i)=>{
          const value:PairPrediction={winRate,rawStrength:[reps[i*2].strength,reps[i*2+1].strength]};
          ready.set(jobs[i][0],value);if(pairLimit)retain(pairsCache,jobs[i][0],value,pairLimit);
        });
        inferredPairs+=jobs.length;
      }
      pairRequests+=pairs.length;
      return keys.map(key=>{const value=ready.get(key)!;return {winRate:value.winRate,rawStrength:[...value.rawStrength]};});
    },
    metrics:()=>({encodedUnits,encodedBoards,unitCache:units.size,boardCache:boards.size,pairRequests,inferredPairs,reusedPairs:pairRequests-inferredPairs,pairCache:pairsCache.size}),
    dispose(){
      if(disposed)return;disposed=true;
      // Models share original symbolic layers; disposing containers independently can
      // dispose a shared Concatenate twice. Release each owned layer's public references
      // exactly to zero instead, including the original graph's multi-call Dense layers.
      const layers=new Set([original,unitModel,boardModel,pairModel].flatMap(model=>model.layers));
      for(const layer of layers){
        if(layer.getClassName()==='InputLayer')continue;
        let result=layer.dispose();while(result.refCountAfterDispose>0)result=layer.dispose();
      }
      units.clear();boards.clear();pairsCache.clear();
    },
  };
}
