import { it,expect } from 'vitest';
import { createOriginalRecognition } from '../src/recognition/original-events';
import { shopCatalog } from '../src/game/shop-mechanics';
import { bundledAugmentTiers } from '../src/game/metatft-augments';
// Shapes observed in the real game, with player identities replaced.
const packet=(key:string,value:unknown)=>JSON.stringify({type:'info',category:'game_info',key,value:JSON.stringify(value)});
it('真实五槽对象、Sold 空槽、数字字符串血量与等级',()=>{
  const r=createOriginalRecognition(),id=shopCatalog[0].character_id;
  expect(r.accept(packet('tft_shop',{slot_1:{name:'Sold'},slot_2:{name:id},slot_3:{name:'Sold'},slot_4:{name:'Sold'},slot_5:{name:id}}))).toBe(true);
  expect(r.view().shopReady).toBe(true);expect(r.view().shop[0]).toBeNull();expect(r.view().shop[1]?.known).toBe(true);
  expect(r.accept(packet('tft_roster',[{summoner:'本机',tag_line:'01',health:'95',index:'0',localplayer:'1',xp:'5'},{summoner:'对手',tag_line:'02',health:'90',index:'1'}]))).toBe(true);
  expect(r.tracker().snapshot?.alive).toBe(2);
  expect(r.accept(packet('tft_xp',{xp_level:'5',xp_progress:'2',xp_progress_max:'20'}))).toBe(true);expect(r.view().level).toBe(5);
});
it('自有棋盘和备战席可以记牌，对手明细不会被伪造成完整',()=>{
  const r=createOriginalRecognition(),id=shopCatalog[0].character_id;
  r.accept(packet('tft_roster',[{summoner:'本机',tag_line:'01',health:'100',localplayer:'1'},{summoner:'对手',tag_line:'02',health:'100'}]));
  r.accept(packet('tft_board',{cell_1:{name:id,level:'2'}}));
  expect(r.tracker().snapshot?.players.find(p=>p.isLocal)?.coverage).toBe('partial');
  r.accept(packet('tft_bench',{cell_2:{name:id,level:'1'}}));
  const s=r.tracker().snapshot!;expect(s.ownedByName[id]).toBe(4);expect(s.players.find(p=>p.isLocal)?.coverage).toBe('full');expect(s.players.find(p=>!p.isLocal)?.placements).toBeUndefined();
  r.accept(packet('tft_bench',{}));expect(r.tracker().snapshot?.ownedByName[id]).toBe(3);
});
it('原生已选海克斯对象清空三选一，不残留旧评级',()=>{
  const r=createOriginalRecognition(),id=bundledAugmentTiers.augments[0].id;
  r.accept(packet('tft_augments',{augment_1:{name:id},augment_2:{name:id},augment_3:{name:id}}));
  expect(r.view().augmentsReady).toBe(true);
  expect(r.accept(packet('tft_picked_augment',{slot_1:{name:id},slot_2:{name:''},slot_3:{name:''},slot_4:{name:''}}))).toBe(true);
  expect(r.view().pickedAugment?.id).toBe(id);expect(r.view().augments).toEqual([]);
});
