import {describe,it,expect} from 'vitest';
import {combatHeroId,combatFormName} from '../src/game/combat-unit-identity';
import {normalizeShopHero} from '../src/game/shop-mechanics';
import {shoppingInput,tradingRules} from '../src/decision/shopping-input';
import {battleRequest} from '../src/game/battle-forecast';
import {lineupCandidates} from '../src/decision/lineup-search';
import {trade,unitCopyCounts} from '../src/decision/shop-ledger';
import {advisorDemo} from '../src/desktop/advisor-demo';
import {createOriginalRecognition} from '../src/recognition/original-events';
const form='DA_18_Lux_Elderwood',base='DA_Lux18_Base';
function fixture(){
  const status=advisorDemo('ap');status.cards.gold=40;status.cards.level=8;status.cards.shopReady=true;status.cards.shop=[null,null,null,null,null];
  const board=[{name:form,level:2,position:0,area:'board' as const,items:['DA_InfinityEdge']}];
  status.cards.ownHoldings={board,bench:[]};status.cards.battleBoards={local:{at:Date.now(),units:board},opponents:{}};return status;
}
describe('pool identity and actual combat form',()=>{
  it('uses one pool identity but retains the form and Chinese trait label for battle',()=>{
    expect(normalizeShopHero(form)).toBe(base);expect(combatHeroId(form)).toBe(form);expect(combatFormName(form)).toBe('永恒之森');
    expect(combatHeroId('TFT18_GnarBig')).toBe('DA_18_GnarSmall');
  });
  it('retains the raw native shop form before canonical display and pool normalization',()=>{
    const reader=createOriginalRecognition();reader.accept(JSON.stringify({type:'info',category:'game_info',key:'tft_shop',value:JSON.stringify([form,'Sold','Sold','Sold','Sold'].map(name=>({name})))}));
    const view=reader.view();expect(view.shop[0]).toMatchObject({id:base,combatId:form,known:true});
    const status=fixture();status.cards.shop=view.shop;status.cards.shopReady=view.shopReady;const input=shoppingInput(status);if(!input.ready)throw Error(input.reason);
    expect(input.state.offers[0]).toMatchObject({id:base,combatId:form});
  });
  it('preserves the native form through recognition input, trading state and the deployed model board',()=>{
    const status=fixture(),input=shoppingInput(status);if(!input.ready)throw Error(input.reason);
    expect(input.state.units[0]).toMatchObject({id:base,combatId:form,star:2});expect(unitCopyCounts(input.state.units)).toEqual({[base]:3});
    expect(battleRequest(status)?.local.units[0].id).toBe(form);
    expect(lineupCandidates(input.state,[])[0].board.units[0].id).toBe(form);
  });
  it('keeps an explicit shop form and a usual same-form natural merge, refusing ambiguous mixed-form merges',()=>{
    const status=fixture();status.cards.shop[0]={id:form,name:'拉克丝',known:true};const input=shoppingInput(status);if(!input.ready)throw Error(input.reason);
    const bought=trade(input.state,{type:'buy',slot:0},tradingRules);if(!bought.ok)throw Error(bought.reason);
    expect(bought.state.units.find(u=>u.key==='shop:0')?.combatId).toBe(form);
    const state={...input.state,units:[0,1].map(slot=>({...input.state.units[0],star:1,key:'board:'+slot,slot,items:[]})),offers:[{slot:0,id:base,price:5}]};
    const merged=trade(state,{type:'buy',slot:0},tradingRules);if(!merged.ok)throw Error(merged.reason);
    expect(merged.state.units[0]).toMatchObject({id:base,combatId:form,star:2});
    state.units[1].combatId='DA_Lux18_Blackthorn';expect(trade(state,{type:'buy',slot:0},tradingRules)).toMatchObject({ok:false,reason:'unsupported-merge-form'});
  });
  it('does not borrow old scout equipment from a different explicit Lux form, while a pool-only ID can use the fresh observed form',()=>{
    const status=fixture(),opponent=status.tracker!.snapshot!.players.find(p=>!p.isLocal)!;
    opponent.placements=[{name:'DA_Lux18_Blackthorn',level:2,area:'board',items:[]}];
    status.cards.battleBoards!.opponents[opponent.name]={at:Date.now(),units:[{name:form,level:2,area:'board',items:['DA_InfinityEdge']}]};
    const changed=battleRequest(status)!.targets.find(t=>t.id===opponent.name)!;
    expect(changed.board?.units[0]).toMatchObject({id:'DA_Lux18_Blackthorn',items:[]});
    opponent.placements[0].name=base;
    expect(battleRequest(status)!.targets.find(t=>t.id===opponent.name)?.board?.units[0]).toMatchObject({id:form,items:['DA_InfinityEdge']});
  });
});
