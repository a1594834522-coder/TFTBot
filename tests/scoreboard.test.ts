import {expect,it} from 'vitest';
import {mapScoreboard} from '../src/recognition/scoreboard';
import {createOriginalRecognition} from '../src/recognition/original-events';
import {isGeneratedUnit,normalizeShopHero} from '../src/game/shop-mechanics';
import {copiesFromLevel} from '../src/game/roster';
import live from './fixtures/native-scoreboard-s18.json';
const roster=Array.from({length:8},(_,index)=>({index,summoner:`玩家${index}`,tag_line:'测试',health:index===7?0:100-index,localplayer:index===3?'1':'0'}));
const frame={players:roster.map(r=>({index:r.index,champions:[{id:r.index===3?'DA_18_Xayah':'DA_18_Yorick',level:r.index===3?2:1}]}))};
const own=[{name:'DA_18_Xayah',level:2}];
const packet=(key:string,value:unknown)=>JSON.stringify({type:'info',category:'game_info',key,value:typeof value==='string'?value:JSON.stringify(value)});
it('重连后从已核实的 roster.xp 恢复本方等级，不把其他玩家等级或坏值用于估算',()=>{
  const r=createOriginalRecognition();r.accept(packet('tft_roster',[{index:0,summoner:'本方',health:100,localplayer:'1',xp:'6'},{index:1,summoner:'对方',health:100,xp:'9'}]));
  expect(r.view().level).toBe(6);
  r.accept(packet('tft_roster',[{index:0,summoner:'本方',health:100,localplayer:'1',xp:'bad'},{index:1,summoner:'对方',health:100,xp:'9'}]));
  expect(r.view().level).toBe(6);
});
it('MetaTFT 标记的非商店对象不占池，纳尔和伊莉丝变身占原池，四星折算27张',()=>{
  for(const id of ['DA_Elderwood18_Lifeblossom','DA_Elderwood18_StonebarkTree','DA_18_AzirSoldier','DA_18_Zyra_ThornSpitter'])expect(isGeneratedUnit(id)).toBe(true);
  expect(isGeneratedUnit('unknown_future_unit')).toBe(false);expect(isGeneratedUnit('DA_18_GnarBig')).toBe(false);
  expect(normalizeShopHero('DA_18_GnarBig')).toBe('DA_18_GnarSmall');expect(normalizeShopHero('DA_18_EliseSpider')).toBe('DA_18_Elise');expect(copiesFromLevel(4)).toBe(27);
});
it('脱敏真实八人帧通过独立 GEP 本方棋盘和备战席核对，并保留全部玩家持牌',()=>{
  const r=createOriginalRecognition();r.accept(packet('tft_roster',live.roster));r.accept(packet('tft_board',live.board));r.accept(packet('tft_bench',live.bench));
  expect(r.acceptScoreboard(live.frame)).toBeNull();
  const s=r.tracker().snapshot!;expect(s.alive).toBe(8);
  expect(s.players.every(p=>p.coverage==='full')).toBe(true);
  expect(s.players.find(p=>p.isLocal)?.champions.map(c=>[c.name,c.copies]).sort()).toEqual([['DA_18_Leona',1],['DA_18_Ornn',1],['DA_18_Kayle',1]].sort());
  expect(Object.values(s.ownedByName).reduce((a,b)=>a+b,0)).toBe(36);
});
it('同局身份校准后买牌与升星不被滞后的 GEP 明细打回未齐；本方也使用最新全场快照',()=>{
  const r=createOriginalRecognition();r.accept(packet('tft_roster',live.roster));r.accept(packet('tft_board',live.board));r.accept(packet('tft_bench',live.bench));r.acceptScoreboard(live.frame);
  const changed={players:live.frame.players.map(p=>p.index===2?{...p,champions:[{id:'DA_18_Camille',level:2,location:1,copies:3}]}:p)};
  expect(r.acceptScoreboard(changed)).toBeNull();
  expect(r.tracker().snapshot?.players.find(p=>p.isLocal)?.champions).toMatchObject([{name:'DA_18_Camille',copies:3}]);
  const b=createOriginalRecognition();b.restoreScoreboardCalibration(r.scoreboardCalibration());b.accept(packet('tft_roster',live.roster));
  expect(b.acceptScoreboard(changed)).toBeNull();
  b.accept(packet('tft_roster',live.roster.map(p=>({...p,summoner:'另一局'+p.index}))));
  expect(b.acceptScoreboard(changed)).not.toBeNull();
});
it('八名玩家按索引绑定；血量重排不交换持牌，不把一个人的棋子复制给全场',()=>{
  const result=mapScoreboard(frame,[...roster].reverse(),own);
  expect(result.players).toHaveLength(8);
  expect(result.players?.find(p=>p.summoner==='玩家3')?.champions).toEqual(own);
  expect(result.players?.find(p=>p.summoner==='玩家0')?.champions[0].name).toBe('DA_18_Yorick');
});
it('实测召唤物不占牌池，但未知英雄仍保留以阻止错误声明完整数据',()=>{
  const result=mapScoreboard({players:frame.players.map(p=>({...p,champions:[...p.champions,{id:'DA_18_Yorick_Spirit',level:2,location:1},{id:'DA_Krug18_MiniKrug',level:3,location:1},...(p.index===0?[{id:'unknown_future_unit',level:1}]:[])]}))},roster,own);
  expect(result.players?.find(p=>p.summoner==='玩家3')?.champions).toEqual(own);
  expect(result.players?.find(p=>p.summoner==='玩家0')?.champions.map(c=>c.name)).toEqual(['DA_18_Yorick','unknown_future_unit']);
});
it('缺少棋盘、玩家索引重复、错误身份对应、空快照均不能声明全场有效',()=>{
  for(const [value,rs,units] of [[frame,roster,null],[frame,[{...roster[0],localplayer:'1'}],own],[{players:[frame.players[0],frame.players[0]]},roster,own],[{players:[]},roster,own]] as const)
    expect(mapScoreboard(value,rs as typeof roster,units as typeof own).players).toBeNull();
});
it('全场快照对接记牌器，淘汰归还、超时清理、换局清理；不影响商店或海克斯',()=>{
  let time=0;const r=createOriginalRecognition(()=>time);
  r.accept(packet('tft_roster',roster));r.accept(packet('tft_board',{cell_1:own[0]}));r.accept(packet('tft_bench',{}));
  expect(r.acceptScoreboard(frame)).toBeNull();
  expect(r.tracker().snapshot?.ownedByName).toEqual({'DA_18_Yorick':6,'DA_18_Xayah':3});
  r.acceptScoreboard({players:[]});expect(r.tracker().snapshot?.ownedByName).toEqual({'DA_18_Xayah':3});
  r.acceptScoreboard(frame);
  time=12001;expect(r.tracker().snapshot?.ownedByName).toEqual({'DA_18_Xayah':3});
  r.acceptScoreboard(frame);r.accept(packet('tft_roster',roster.map(p=>({...p,summoner:`新${p.index}`}))));
  expect(r.tracker().snapshot?.ownedByName).toEqual({});
});
it('只收到当前对手棋盘时按身份计数并标记部分，备战席保持未知；不关联无主或过期棋盘',()=>{
  let time=0;const r=createOriginalRecognition(()=>time);r.accept(packet('tft_roster',roster));
  const board={cell_1:{name:'DA_18_Yorick',level:'3'}};
  expect(r.accept(packet('tft_board_opponent',board))).toBe(false);
  r.accept(packet('tft_opp','玩家1#测试'));expect(r.accept(packet('tft_board_opponent',board))).toBe(true);
  expect(r.tracker().snapshot?.ownedByName['DA_18_Yorick']).toBe(9);
  expect(r.tracker().snapshot?.players.find(p=>p.summoner==='玩家1')?.coverage).toBe('partial');
  time=16000;expect(r.accept(packet('tft_board_opponent',board))).toBe(false);
  time=60001;expect(r.tracker().snapshot?.ownedByName).toEqual({});
});
