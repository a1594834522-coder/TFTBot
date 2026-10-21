import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadBattleModel} from '../src/decision/battle-model';
import {encodeBattleBoard,type BattleBoard,type BattleLookups} from '../src/game/battle-model-encoding';

let runtime:Awaited<ReturnType<typeof loadBattleModel>>,lookup:BattleLookups;
beforeAll(async()=>{runtime=await loadBattleModel(path.resolve('data/metatft-model'));lookup=runtime.lookup;});
afterAll(()=>{runtime?.dispose();expect(runtime?.tensorCount()).toBe(0);});
const board=(star:number,items:string[]=[]):BattleBoard=>({units:[{id:'DA_18_Akali_AD',star,items},{id:'DA_18_Shen',star,items:[]}],augments:[]});
describe('MetaTFT original model and encoding',()=>{
  it('reproduces the shipped item scaling, duplicate-unit trait deduplication and empty sentinels',()=>{
    const a=board(2,['DA_InfinityEdge']);a.units.push({...a.units[0],items:[]});
    const result=encodeBattleBoard(a,lookup,'player');
    expect(result.inputs.player_unit_0_tier).toEqual([.5]);
    expect(result.inputs.player_unit_0_items[lookup.item_encodings.DA_InfinityEdge]).toBe(.333);
    expect(result.inputs.player_unit_3_tier).toEqual([-1]);
    expect(result.inputs.player_unit_3_cost).toEqual([-1]);
    for(const trait of lookup.unit_traits.DA_18_Akali_AD)expect(result.traitCounts[trait]).toBe(1+(lookup.unit_traits.DA_18_Shen.includes(trait)?1:0));
    expect(Object.keys(result.inputs)).toHaveLength(73);
  });
  it('uses real offline weights; star and gear changes affect single-fight estimates',()=>{
    const a=board(1),b=board(2),c=board(1,['DA_InfinityEdge','DA_LastWhisper','DA_GuinsoosRageblade']);
    const mirror=runtime.predict(a,a),up=runtime.predict(b,a),down=runtime.predict(a,b),gear=runtime.predict(c,a);
    expect(mirror.winRate).toBeGreaterThan(.4);expect(mirror.winRate).toBeLessThan(.6);
    expect(up.winRate).toBeGreaterThan(mirror.winRate);expect(down.winRate).toBeLessThan(mirror.winRate);
    expect(gear.winRate).toBeGreaterThan(mirror.winRate);
    expect(up.strength[0]).toBeGreaterThan(up.strength[1]);
    // The original model has a small orientation bias; do not claim mathematical complementarity.
    expect(Math.abs(up.winRate+down.winRate-1)).toBeLessThan(.1);
  });
  it('is invariant to unit ordering and matches batched vs individual inference',()=>{
    const a=board(1),b=board(2),r=runtime.predict(a,b);
    expect(runtime.predict({...a,units:[...a.units].reverse()},b).winRate).toBeCloseTo(r.winRate,5);
    expect(runtime.predictBatch([{player:a,opponent:b}])[0].winRate).toBeCloseTo(r.winRate,5);
  });
  it('does not leak tensors across repeated prediction and refuses unknown features',()=>{
    const before=runtime.tensorCount();
    for(let i=0;i<30;i++)runtime.predict(board(1),board(2));
    expect(runtime.tensorCount()).toBe(before);
    expect(()=>runtime.predict(board(1,['NOT_AN_ITEM']),board(2))).toThrow(/Unsupported/);
    expect(()=>runtime.predict({...board(1),units:Array(15).fill(board(1).units[0])},board(2))).toThrow(/capacity/);
  });
  it('reuses original layers and matches full inference across varied boards without tensor growth',()=>{
    const ids=['DA_18_Akali_AD','DA_18_Leona','DA_18_Shen','DA_18_Kayle','DA_18_Varus','DA_18_Rakan','DA_18_Ornn'];
    const pairs=Array.from({length:40},(_,i)=>({player:{units:ids.slice(0,i%7+1).map((id,j)=>({id,star:(i+j)%3+1,items:j===0&&i%2?['DA_InfinityEdge']:[]})),augments:[]},opponent:{units:ids.slice(i%4).map((id,j)=>({id,star:(i+j+1)%3+1,items:[]})),augments:[]}}));
    const before=runtime.tensorCount(),original=runtime.predictBatch(pairs),cached=runtime.predictCachedBatch(pairs);
    for(let i=0;i<pairs.length;i++){expect(cached[i].winRate).toBeCloseTo(original[i].winRate,5);expect(cached[i].strength[0]).toBeCloseTo(original[i].strength[0],4);}
    const metrics=runtime.cacheMetrics();runtime.predictCachedBatch(pairs);
    expect(runtime.cacheMetrics().encodedBoards).toBe(metrics.encodedBoards);expect(runtime.cacheMetrics().encodedUnits).toBe(metrics.encodedUnits);
    expect(runtime.tensorCount()).toBe(before);
  });
  it('rejects a mixed-season model before loading weights',async()=>{
    const directory=path.resolve('dist/test-temp/battle-season');await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({set:17}));
    await expect(loadBattleModel(directory)).rejects.toThrow(/season/);
  });
  it('compacts known unencoded summons exactly like the original source without rejecting a valid board',()=>{
    const original=board(2),withSummons={...original,units:[{id:'DA_Elderwood18_StonebarkTree',star:0,items:[]},original.units[0],{id:'DA_18_AzirSoldier',star:0,items:[]},original.units[1]]};
    const encoded=encodeBattleBoard(withSummons,lookup,'player');
    expect(encoded.unknown).toEqual([]);expect(encoded.modeledUnits).toEqual(original.units);expect(encoded.excludedUnits).toHaveLength(2);
    expect(encoded.inputs).toEqual(encodeBattleBoard(original,lookup,'player').inputs);
    expect(runtime.predict(withSummons,original).winRate).toBeCloseTo(runtime.predict(original,original).winRate,6);
    expect(()=>runtime.predict({...original,units:[{id:'FUTURE_UNKNOWN_HERO',star:1,items:[]},...original.units]},original)).toThrow(/Unsupported/);
  });
  it('keeps cached unit keys aligned to the compacted slots, even with interleaved and many summons',()=>{
    const pairs=Array.from({length:12},(_,i)=>({player:{units:[...Array.from({length:18},()=>({id:'DA_Elderwood18_Lifeblossom',star:0,items:[]})),...board(i%3+1).units].reverse(),augments:[]},opponent:board((i+1)%3+1)}));
    const before=runtime.tensorCount(),full=runtime.predictBatch(pairs),cached=runtime.predictCachedBatch(pairs);
    cached.forEach((p,i)=>expect(p.winRate).toBeCloseTo(full[i].winRate,5));expect(runtime.tensorCount()).toBe(before);
    const modified={...lookup,unit_traits:{...lookup.unit_traits,DA_Elderwood18_Lifeblossom:['Sprykin']}};
    expect(encodeBattleBoard(pairs[0].player,modified,'player').traitCounts.Sprykin).toBe(1);
  });
  it('preserves a Lux form trait even when its embedding and shared-pool identity match base Lux',()=>{
    const form=encodeBattleBoard({units:[{id:'DA_18_Lux_Elderwood',star:2,items:[]}],augments:[]},lookup,'player');
    const base=encodeBattleBoard({units:[{id:'DA_Lux18_Base',star:2,items:[]}],augments:[]},lookup,'player');
    expect(form.inputs.player_unit_0_unit).toEqual(base.inputs.player_unit_0_unit);
    expect(form.traitCounts.Elderwood).toBe(1);expect(base.traitCounts.Elderwood).toBeUndefined();
  });
  it('reuses ordered whole-pair results including batch duplicates, while preserving original outputs and caller isolation',()=>{
    const a={...board(3,['DA_InfinityEdge','DA_LastWhisper']),augments:[Object.keys(lookup.augment_lookup)[0]],charms:Object.keys(lookup.charm_encodings).slice(0,1)},b=board(2,['DA_WarmogsArmor']);
    const pairs=[{player:a,opponent:b},{player:b,opponent:a},{player:a,opponent:b}],before=runtime.cacheMetrics(),full=runtime.predictBatch(pairs),cached=runtime.predictCachedBatch(pairs);
    cached.forEach((p,i)=>expect(p.winRate).toBeCloseTo(full[i].winRate,5));
    expect(runtime.cacheMetrics().inferredPairs-before.inferredPairs).toBe(2);
    const count=runtime.cacheMetrics().inferredPairs,original=cached[0].winRate,originalStrength=cached[0].strength[0];cached[0].winRate=0;cached[0].strength[0]=-999;
    const again=runtime.predictCachedBatch([{player:{...a,units:[...a.units].reverse().map(u=>({...u,items:[...u.items].reverse()}))},opponent:b}]);
    expect(again[0].winRate).toBe(original);expect(again[0].strength[0]).toBe(originalStrength);expect(runtime.cacheMetrics().inferredPairs).toBe(count);
    expect(()=>runtime.predictCachedBatch([{player:board(1,['NOT_AN_ITEM']),opponent:b}])).toThrow(/Unsupported/);
  });
  it('keeps current batch data pinned even when unit, board and pair caches evict most of that batch',async()=>{
    const before=runtime.tensorCount(),small=await loadBattleModel(path.resolve('data/metatft-model'),{unitCacheLimit:2,boardCacheLimit:2,pairCacheLimit:1});
    try{
      small.predictCachedBatch([{player:board(1),opponent:board(2)}]);
      const pairs=[{player:board(1),opponent:board(2)},{player:board(3,['DA_InfinityEdge']),opponent:board(2)},{player:board(1),opponent:board(3,['DA_WarmogsArmor'])}];
      const full=small.predictBatch(pairs),tensors=small.tensorCount();
      for(let n=0;n<4;n++){
        const actual=small.predictCachedBatch(pairs);actual.forEach((p,i)=>expect(p.winRate).toBeCloseTo(full[i].winRate,5));
        expect(small.cacheMetrics().unitCache).toBeLessThanOrEqual(2);expect(small.cacheMetrics().boardCache).toBeLessThanOrEqual(2);expect(small.cacheMetrics().pairCache).toBeLessThanOrEqual(1);expect(small.tensorCount()).toBe(tensors);
      }
    }finally{small.dispose();small.dispose();expect(small.cacheMetrics().pairCache).toBe(0);}
    expect(runtime.tensorCount()).toBe(before);
  });
  it('separates form-specific results and rejects invalid cache settings before loading tensors',async()=>{
    const before=runtime.tensorCount();
    for(const options of [{pairCacheLimit:-1},{boardCacheLimit:0},{unitCacheLimit:1.5}])await expect(loadBattleModel(path.resolve('data/metatft-model'),options)).rejects.toThrow(/cache limits/);
    expect(runtime.tensorCount()).toBe(before);
    const partner=Object.keys(lookup.unit_traits).find(id=>!id.includes('Lux')&&lookup.unit_encodings[id]!==undefined&&lookup.unit_traits[id].includes('Elderwood'))!;
    const base={units:[{id:'DA_Lux18_Base',star:2,items:[]},{id:partner,star:2,items:[]}],augments:[]},form={...base,units:[{...base.units[0],id:'DA_18_Lux_Elderwood'},base.units[1]]},pairs=[{player:base,opponent:board(2)},{player:form,opponent:board(2)}];
    const full=runtime.predictBatch(pairs),cached=runtime.predictCachedBatch(pairs);cached.forEach((p,i)=>expect(p.winRate).toBeCloseTo(full[i].winRate,5));
    expect(runtime.predictCachedBatch(pairs)).toEqual(cached);
  });
});
