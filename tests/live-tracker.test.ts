import { describe, it, expect } from 'vitest';
import { createOriginalRecognition } from '../src/recognition/original-events';
import { estimateRoll } from '../src/game/roll-odds';
import { analyzePool } from '../src/game/cardTracker';
import { currentPool, normalizeShopHero, shopCatalog, tierOdds } from '../src/game/shop-mechanics';
import { createDesktopSession } from '../src/desktop/session';
import type { DesktopBridge } from '../src/desktop/bridge';
import type { ReaderStatus } from '../src/recognition/status';
import live from './fixtures/native-scoreboard-s18.json';
import {createSSRApp,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import TrackerPanel from '../src/desktop/TrackerPanel.vue';
const packet = (key:string,value:unknown) => JSON.stringify({type:'info',category:'game_info',key,value:JSON.stringify(value)});
describe('原版记牌协议与 S18 牌池',()=>{
  it('真实八人快照经桌面控制器显示完整明细和金币预算，不再被滞后的本方 GEP 覆盖',async()=>{
    const bridge={storage:{getItem:async()=>'',setItem:async()=>{},removeItem:async()=>{}}} as unknown as DesktopBridge;
    const session=await createDesktopSession(bridge),r=createOriginalRecognition();
    r.accept(packet('tft_roster',live.roster));r.accept(packet('tft_board',live.board));r.accept(packet('tft_bench',live.bench));r.acceptScoreboard(live.frame);
    const status={tracker:r.tracker(),cards:{level:8,shop:[]},testMode:false} as unknown as ReaderStatus;
    session.applyLiveStatus(status);
    const html=await renderToString(createSSRApp({render:()=>h(TrackerPanel,{controller:session.controller,status})}));
    expect(html).toContain('data-complete="true"');expect(html).toContain('平均刷新花费');expect(html).not.toContain('暂不输出金币数值');
    expect(session.controller.state().players).toHaveLength(8);session.dispose();
  });
  it('桌面实时状态驱动控制器，卡片帧不重复覆盖，断开清空',async()=>{
    const values = new Map<string,string>();
    const bridge = {storage:{getItem:async(k:string)=>values.get(k)??'',setItem:async(k:string,v:string)=>{values.set(k,v);},removeItem:async(k:string)=>{values.delete(k);}}} as DesktopBridge;
    const session=await createDesktopSession(bridge), r=createOriginalRecognition();
    const id=shopCatalog[0].character_id;
    r.accept(packet('tft_roster',[{summoner:'甲',health:100,is_locale:true}]));
    r.accept(packet('players_info',[{summoner:'甲',champions:[{name:id,level:2}]}]));
    const status=()=>({tracker:r.tracker(),testMode:true} as ReaderStatus);
    session.applyLiveStatus(status());expect(session.controller.state().me?.champions[0].copies).toBe(3);
    session.controller.select(id);r.accept(packet('tft_shop',[]));session.applyLiveStatus(status());expect(session.controller.state().selected).toBe(id);
    r.reset();session.applyLiveStatus(status());expect(session.controller.state().ready).toBe(false);session.dispose();
  });
  it('乱序明细、星级折算、淘汰归池和重置',()=>{
    const r=createOriginalRecognition(), id=shopCatalog[0].character_id;
    r.accept(packet('players_info',[{summoner:'甲',tag_line:'1',champions:[{name:id,level:2},{name:id,level:1}]},{summoner:'乙',tag_line:'2',champions:[{name:id,level:3}]}]));
    expect(r.tracker().snapshot).toBeNull();
    const roster=[{summoner:'甲',tag_line:'1',health:90},{summoner:'乙',tag_line:'2',health:80}];
    r.accept(packet('tft_roster',roster));expect(r.tracker().snapshot?.ownedByName[id]).toBe(13);
    r.accept(packet('tft_roster',[roster[0],{...roster[1],health:0}]));expect(r.tracker().snapshot?.ownedByName[id]).toBe(4);
    expect(r.accept(packet('players_info',[{summoner:'甲'}]))).toBe(false);
    expect(r.tracker().snapshot?.ownedByName[id]).toBe(4);
    r.reset();expect(r.tracker().snapshot).toBeNull();
  });
  it('空明细与缺失明细不同，新名单清空旧棋子',()=>{
    const r=createOriginalRecognition();r.accept(packet('tft_roster',[{summoner:'甲',health:100},{summoner:'乙',health:100}]));
    r.accept(packet('players_info',[{summoner:'甲',champions:[]}]));
    const s=r.tracker().snapshot!;expect(s.players.find(p=>p.summoner==='甲')?.placements).toEqual([]);expect(s.players.find(p=>p.summoner==='乙')?.placements).toBeUndefined();
    r.accept(packet('tft_roster',[{summoner:'丙',health:100}]));expect(r.tracker().snapshot?.players[0].placements).toBeUndefined();
  });
  it('65 个商店英雄，共享拉克丝形态牌池',()=>{
    expect(shopCatalog).toHaveLength(65);
    const rows=analyzePool({DA_Lux18_Base:3,DA_Lux18_Blackthorn:1},shopCatalog,{pool:currentPool,normalizeName:normalizeShopHero});
    expect(rows.find(r=>r.champion==='DA_Lux18_Base')).toMatchObject({owned:4,remaining:5});
    expect(rows.reduce((n,r)=>n+r.pool,0)).toBe(1227);
    for(let level=1;level<=11;level++)expect([1,2,3,4,5].reduce((n,c)=>n+tierOdds(level,c as 1),0)).toBeCloseTo(1);
  });
});
describe('下一张指定英雄的金币预算',()=>{
  it('确定性费用下与超几何分布一致，预算是几何分布分位数',()=>{
    const v=estimateRoll({tierProbability:1,remaining:1,tierRemaining:10});
    expect(v.hit).toBeCloseTo(.5);expect(v.meanGold).toBeCloseTo(4);expect(v.gold50).toBe(2);expect(v.gold90).toBe(8);
  });
  it('所有同费牌均为目标时与五次独立费用抽取一致',()=>{
    expect(estimateRoll({tierProbability:.2,remaining:20,tierRemaining:20}).hit).toBeCloseTo(1-.8**5);
  });
  it('池空、等级概率零、已在商店、非法输入',()=>{
    expect(estimateRoll({tierProbability:.1,remaining:0,tierRemaining:40}).meanGold).toBeNull();
    expect(estimateRoll({tierProbability:0,remaining:5,tierRemaining:40}).meanGold).toBeNull();
    expect(estimateRoll({tierProbability:.1,remaining:5,tierRemaining:40,inShop:true}).meanGold).toBe(0);
    expect(()=>estimateRoll({tierProbability:.1,remaining:41,tierRemaining:40})).toThrow();
  });
});
