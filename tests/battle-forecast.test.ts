import {describe,it,expect} from 'vitest';
import {aggregateBattleForecast,battleRequest,opponentWeights,type BattleRequest} from '../src/game/battle-forecast';
import {createOriginalRecognition} from '../src/recognition/original-events';
import type {ReaderStatus} from '../src/recognition/status';
import live from './fixtures/native-scoreboard-s18.json';
const packet=(key:string,value:unknown)=>JSON.stringify({type:'info',category:'game_info',key,value:JSON.stringify(value)});
function reader(){const r=createOriginalRecognition(()=>1000);r.accept(packet('tft_roster',live.roster));r.accept(packet('tft_board',live.board));r.accept(packet('tft_bench',live.bench));expect(r.acceptScoreboard(live.frame)).toBeNull();return r;}
const status=(r:ReturnType<typeof reader>)=>({phase:'receiving',lastFrameAt:1000,cards:r.view(),tracker:r.tracker()} as ReaderStatus);
describe('weighted next-opponent evidence',()=>{
  it('uses explicit priors and excludes no opponent based on tft_opp scouting',()=>{
    expect(opponentWeights(['a','b'],'2-1')).toEqual({source:'uniform',weights:{a:.5,b:.5}});
    expect(opponentWeights(['a','b'],'2-1',{source:'native',round:'2-1',weights:{a:3,b:1}})).toEqual({source:'native',weights:{a:.75,b:.25}});
    expect(opponentWeights(['a','b'],'2-2',{source:'native',round:'2-1',weights:{a:1}}).source).toBe('uniform');
    expect(()=>opponentWeights(['a','b'],'2-1',{source:'manual',round:'2-1',weights:{ghost:1}})).toThrow();
    expect(()=>opponentWeights(['a','b'],'2-1',{source:'manual',round:'2-1',weights:{a:0}})).toThrow();
  });
  it('preserves board/bench locations from the real native fixture and never fights bench units',()=>{
    const r=reader(),request=battleRequest(status(r),1000)!;
    const own=request.local.units.map(u=>u.id);
    expect(own).toContain('DA_18_Leona');expect(own).not.toContain('DA_18_Kayle');
    const first=request.targets.find(t=>t.id==='玩家0#测试')!;
    expect(first.board?.units.filter(u=>u.id==='DA_18_Ornn')).toHaveLength(1);
    expect(first.gaps).toContain('装备未齐');expect(first.gaps).toContain('海克斯未齐');
  });
  it('does not infer naked equipment from missing fields; preserves observed personal equipment',()=>{
    const r=reader();r.accept(packet('tft_board',{cell_1:{name:'DA_18_Leona',level:2,item_1:'DA_InfinityEdge',item_2:'',item_3:''}}));
    const request=battleRequest(status(r),1000)!;
    expect(request.local.units[0].items).toEqual(['DA_InfinityEdge']);expect(request.localGaps).not.toContain('装备未齐');
    expect(request.localGaps).toContain('海克斯未齐');
    expect(battleRequest(status(r),16001)).toBeNull();
  });
  it('keeps observed opponent equipment separate from pool data, and invalidates it if the board changes',()=>{
    const r=reader();r.accept(packet('tft_opp','玩家0#测试'));
    r.accept(packet('tft_board_opponent',{cell_1:{name:'DA_18_Ornn',level:1,item_1:'DA_InfinityEdge',item_2:'',item_3:''},cell_2:{name:'DA_18_Leona',level:1,item_1:'',item_2:'',item_3:''}}));
    const matching=battleRequest(status(r),1000)!.targets.find(t=>t.id==='玩家0#测试')!;
    expect(matching.board?.units.some(u=>u.items.includes('DA_InfinityEdge'))).toBe(true);
    const changed=structuredClone(live.frame);changed.players[0].champions.find(c=>c.location===1)!.level=2;
    expect(r.acceptScoreboard(changed)).toBeNull();
    const target=battleRequest(status(r),1000)!.targets.find(t=>t.id==='玩家0#测试')!;
    expect(target.gaps).toContain('装备未齐');
    expect(target.board?.units.some(u=>u.items.includes('DA_InfinityEdge'))).toBe(false);
  });
  it('retains missing probability mass and never replaces weighted mean with mean of covered opponents',()=>{
    const b={units:[],augments:[]};
    const request:BattleRequest={round:'2-1',local:b,localGaps:[],weightSource:'native',targets:[{id:'a',name:'甲',weight:.75,board:b,gaps:[]},{id:'b',name:'乙',weight:.25,board:null,gaps:['场上棋盘未齐']}]};
    const partial=aggregateBattleForecast(request,{a:.8},'test',1000);
    expect(partial.winRate).toBeNull();expect(partial.coverage).toBe(.75);expect(partial.lower).toBeCloseTo(.6);expect(partial.upper).toBeCloseTo(.85);
    request.targets[1].board=b;
    const full=aggregateBattleForecast(request,{a:.8,b:.2},'test');expect(full.winRate).toBeCloseTo(.65);
    expect(aggregateBattleForecast(request,{a:NaN,b:.2},'test').coverage).toBe(.25);
  });
});
