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
});
