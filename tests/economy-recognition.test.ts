import {describe,it,expect} from 'vitest';
import {createOriginalRecognition} from '../src/recognition/original-events';
const packet=(key:string,value:unknown)=>JSON.stringify({type:'info',category:'game_info',key,value:JSON.stringify(value)});
describe('economic state contracts',()=>{
  it('retains zero gold, validates XP progress, and clears stale XP on level change',()=>{
    const r=createOriginalRecognition(()=>123);
    expect(r.accept(packet('tft_gold','29'))).toBe(true);expect(r.view().gold).toBe(29);
    expect(r.accept(packet('tft_gold',0))).toBe(true);expect(r.view()).toMatchObject({gold:0,goldAt:123});
    for(const raw of [null,{},-1,1.2,'-2'])expect(r.accept(packet('tft_gold',raw))).toBe(false);
    expect(r.view().gold).toBe(0);
    r.accept(packet('tft_xp',{xp_level:'5',xp_progress:'8',xp_progress_max:'20'}));expect(r.view()).toMatchObject({level:5,xpCurrent:8,xpMax:20});
    expect(r.accept(packet('tft_xp',{xp_level:5,xp_progress:21,xp_progress_max:20}))).toBe(false);
    r.accept(packet('tft_xp',{xp_level:6}));expect(r.view().xpCurrent).toBeNull();expect(r.view().xpMax).toBeNull();
  });
  it('retains identity-bound item bench quantities, physical board/bench and resets on lobby change',()=>{
    const r=createOriginalRecognition();r.accept(packet('tft_roster',[{summoner:'甲',tag_line:'1',health:100,is_locale:true}]));
    const items=[{summoner:'甲',tag_line:'1',bench_items:[{name:'DA_Component_RecurveBow',count:2}]}];
    expect(r.accept(packet('tft_item_bench',items))).toBe(true);expect(r.view().itemBenches).toEqual(items);
    r.accept(packet('tft_board',{cell_1:{name:'DA_18_Akali_AD',level:1}}));r.accept(packet('tft_bench',{cell_3:{name:'DA_18_Akali_AD',level:1}}));
    expect(r.view().ownHoldings?.bench?.[0]).toMatchObject({position:30,area:'bench'});
    r.accept(packet('tft_roster',[{summoner:'乙',health:100,is_locale:true}]));expect(r.view().itemBenches).toBeUndefined();expect(r.view().ownHoldings).toBeUndefined();
  });
});
