import {expect,it} from 'vitest';
import raw from '../data/metatft-wisps.json';
import {knownWisp,parseWispRatings,wispRatings} from '../src/game/metatft-wisps';
import {createOriginalRecognition} from '../src/recognition/original-events';
const packet=(key:string,value:unknown)=>JSON.stringify({type:'info',category:'game_info',key,value:JSON.stringify(value)});
it('当前仙灵作者评级和中文名可靠关联，仅包含明确作者评级',()=>{
  expect(Object.keys(wispRatings.ratings).length).toBeGreaterThan(170);
  expect(knownWisp('DA_18_LostTravelers')).toMatchObject({rating:'S'});
  expect(knownWisp('DA_AbandonShip18_Upgrade')?.rating).toBeUndefined();
  expect(knownWisp('unknown')).toBeNull();
});
it('错季、空列表或多数不匹配时拒绝更新',()=>{
  expect(()=>parseWispRatings({...raw,meta:{...raw.meta,set:17}})).toThrow();
  expect(()=>parseWispRatings({...raw,response:{content:{content:{tierList:[]}}}})).toThrow();
});
it('商店最右槽按仙灵ID识别评级，购买、换轮和重置清除旧显示',()=>{
  const r=createOriginalRecognition();const shop={slot_1:{name:'DA_18_Kayle'},slot_2:{name:'Sold'},slot_3:{name:'Sold'},slot_4:{name:'Sold'},slot_5:{name:'DA_18_LostTravelers'}};
  r.accept(packet('tft_round',{type:'PVP',stage:'2-1'}));
  r.accept(packet('tft_shop',shop));
  expect(r.view().shop[4]).toMatchObject({kind:'wisp',rating:'S'});expect(r.view().shopReady).toBe(true);
  r.accept(packet('tft_shop',{...shop,slot_5:{name:'Sold'}}));expect(r.view().shop[4]).toBeNull();
  r.accept(packet('tft_shop',shop));r.accept(packet('tft_round',{type:'PVP',stage:'2-2'}));
  expect(r.view().shop).toEqual([]);expect(r.view().stage).toBe(2);
  r.reset();expect(r.view().shop).toEqual([]);
});
it('商店隐藏事件被识别；未知末槽不能套用上一仙灵评级',()=>{
  const r=createOriginalRecognition();r.accept(packet('tft_shop',[{name:'Sold'},{name:'Sold'},{name:'Sold'},{name:'Sold'},{name:'DA_18_LostTravelers'}]));
  expect(r.accept(JSON.stringify({type:'event',key:'tft_shop_visible',value:'false'}))).toBe(true);
  expect(r.view().shopVisible).toBe(false);
  r.accept(packet('tft_shop',[{name:'Sold'},{name:'Sold'},{name:'Sold'},{name:'Sold'},{name:'unseen_wisp'}]));
  expect(r.view().shop[4]?.rating).toBeUndefined();expect(r.view().shopReady).toBe(false);
});
