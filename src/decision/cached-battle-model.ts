import * as tf from '@tensorflow/tfjs';
import {encodeBattleBoard,type BattleBoard,type BattleLookups} from '../game/battle-model-encoding';

interface Representation {embedding:number[];strength:number}
/** Reuses the ORIGINAL trained layers. Cache unit embeddings and independent board
 * representations, so comparing one board to seven opponents doesn't run it seven times. */
export function createCachedBattleModel(original:tf.LayersModel,lookup:BattleLookups){
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
  const units=new Map<string,number[]>(),boards=new Map<string,Representation>();
  const unitKey=(u:BattleBoard['units'][number]|undefined)=>u?JSON.stringify([u.id,u.star,[...u.items].sort()]):'empty';
  const boardKey=(board:BattleBoard)=>JSON.stringify([board.units.map(unitKey).sort(),[...board.augments].sort(),[...(board.charms??[])].sort()]);
  function retain<T>(cache:Map<string,T>,key:string,value:T,limit:number){cache.delete(key);cache.set(key,value);if(cache.size>limit)cache.delete(cache.keys().next().value!);}
  let encodedUnits=0,encodedBoards=0;
  let disposed=false;
  function representations(input:BattleBoard[]):Representation[]{
    const wanted=new Map<string,{board:BattleBoard;features:ReturnType<typeof encodeBattleBoard>}>();
    for(const board of input){
      const key=boardKey(board);if(boards.has(key)||wanted.has(key))continue;
      const features=encodeBattleBoard(board,lookup,'player');
      if(features.unknown.length)throw new Error('Unsupported model features: '+features.unknown.join(','));
      wanted.set(key,{board,features});
    }
    const missing=new Map<string,number[][]>();
    for(const {board,features}of wanted.values())for(let i=0;i<lookup.max_num_units;i++){
      const key=unitKey(features.modeledUnits[i]);
      if(!units.has(key)&&!missing.has(key))missing.set(key,['unit','role','tier','cost','items'].map(type=>features.inputs[`player_unit_${i}_${type}`]));
    }
    const unitEntries=[...missing.entries()];
    for(let offset=0;offset<unitEntries.length;offset+=256){
      const chunk=unitEntries.slice(offset,offset+256);
      const rows=tf.tidy(()=>{
        const inputs=unitModel.inputs.map((t,index)=>tf.tensor2d(chunk.map(([,v])=>v[index]),[chunk.length,t.shape[1]!]));
        return Array.from((unitModel.predict(inputs) as tf.Tensor).dataSync());
      });
      chunk.forEach(([key],i)=>retain(units,key,rows.slice(i*256,(i+1)*256),8192));encodedUnits+=chunk.length;
    }
    const boardEntries=[...wanted.entries()];
    for(let offset=0;offset<boardEntries.length;offset+=256){
      const chunk=boardEntries.slice(offset,offset+256),pools=chunk.map(([,v])=>{
        const sum=new Float32Array(256);
        for(let i=0;i<lookup.max_num_units;i++){const vector=units.get(unitKey(v.features.modeledUnits[i]))!;for(let j=0;j<256;j++)sum[j]+=vector[j];}
        return Array.from(sum);
      });
      const results=tf.tidy(()=>{
        const inputs=[tf.tensor2d(pools,[chunk.length,256]),...['traits','augments','charms'].map(type=>{
          const rows=chunk.map(([,v])=>v.features.inputs['player_'+type]);return tf.tensor2d(rows,[chunk.length,rows[0].length]);
        })];
        return (boardModel.predict(inputs) as tf.Tensor[]).map(t=>Array.from(t.dataSync()));
      });
      chunk.forEach(([key],i)=>retain(boards,key,{embedding:results[0].slice(i*256,(i+1)*256),strength:results[1][i]},4096));encodedBoards+=chunk.length;
    }
    return input.map(board=>boards.get(boardKey(board))!);
  }
  return {
    predictBatch(pairs:Array<{player:BattleBoard;opponent:BattleBoard}>){
      if(disposed)throw new Error('Battle model disposed');
      if(!pairs.length)return [];
      if(pairs.length>256)throw new Error('Cached inference batch limit exceeded');
      const reps=representations(pairs.flatMap(p=>[p.player,p.opponent]));
      const probabilities=tf.tidy(()=>{
        const inputs=[tf.tensor2d(pairs.map((_,i)=>reps[i*2].embedding)),tf.tensor2d(pairs.map((_,i)=>reps[i*2+1].embedding)),tf.tensor2d(pairs.map((_,i)=>[reps[i*2].strength])),tf.tensor2d(pairs.map((_,i)=>[reps[i*2+1].strength]))];
        return Array.from((pairModel.predict(inputs) as tf.Tensor).dataSync());
      });
      return probabilities.map((winRate,i)=>({winRate,rawStrength:[reps[i*2].strength,reps[i*2+1].strength]}));
    },
    metrics:()=>({encodedUnits,encodedBoards,unitCache:units.size,boardCache:boards.size}),
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
      units.clear();boards.clear();
    },
  };
}
