import {describe,it,expect} from 'vitest';
import {shoppingTactics,type BatchPredictor} from '../src/decision/shopping-tactics';
import {observedLineups,tacticalLineupTemplates,type ObservedLineupTemplate} from '../src/decision/observed-lineups';
import type {OwnedUnit,ShopState,TradingRules} from '../src/decision/shop-ledger';
import type {BattleRequest} from '../src/game/battle-forecast';
import type {DirectionAdvice} from '../src/decision/direction-advisor';
import {searchLandings} from '../src/decision/search-landings';
import type {StrategicInput} from '../src/decision/strategic-input';

const entity=(id:string,area:'board'|'bench',slot:number):OwnedUnit=>({key:area+':'+id,id,area,slot,star:1,items:[],equipmentKnown:true});
const fixture=():ShopState=>({gold:30,level:4,boardCapacity:4,units:[...'ABCD'].map((id,i)=>entity(id,'board',i)).concat([...'EFG'].map((id,i)=>entity(id,'bench',i))),offers:[],itemRack:[]});
const rules:TradingRules={version:'test',provisional:false,heroes:Object.fromEntries([...'ABCDEFGHIJKLMNOP'].map(id=>[id,{cost:4,maxStar:3,sellValues:{1:4,2:11,3:35}}])),benchCapacity:9,itemRackCapacity:10,interestStep:10,interestCap:5,victoryGoldBeforeInterest:1};
const request=(state:ShopState):BattleRequest=>({round:'4-2',weightSource:'uniform',local:{units:state.units.filter(u=>u.area==='board').map(u=>({id:u.combatId??u.id,star:u.star,items:u.items.map(t=>t.id)})),augments:[]},localGaps:[],targets:[{id:'opp',name:'对手',weight:1,board:{units:[{id:'P',star:1,items:[]}],augments:[]},gaps:[]}]});
const template=(units:string,id=units):ObservedLineupTemplate=>({id,units:[...units],source:'metatft-core'});
const model=(value:(ids:string[])=>number):BatchPredictor=>pairs=>pairs.map(({player})=>({winRate:value(player.units.map(u=>u.id))}));
const all=(ids:string[],target:string)=>[...target].every(id=>ids.includes(id));
function combinations<T>(items:T[],n:number):T[][]{if(!n)return [[]];if(items.length<n)return [];return items.flatMap((item,i)=>combinations(items.slice(i+1),n-1).map(rest=>[item,...rest]));}

describe('physical mixed boards from observed MetaTFT rosters',()=>{
  it('crosses a three-unit synergy valley and matches an independent complete small-board oracle',async()=>{
    const state=fixture(),before=JSON.stringify(state),r=request(state);
    const value=(ids:string[])=>all(ids,'DEFG')?.9:all(ids,'ABCD')?.5:.3;
    const narrow=await shoppingTactics(state,rules,r,model(value));
    const mixed=await shoppingTactics(state,rules,r,model(value),{observedLineups:{templates:[template('DEFG')]}});
    if(!narrow.ready||!mixed.ready)throw Error();
    expect(narrow.choices[0].winRate).toBe(.5);
    expect(mixed.choices[0].winRate).toBe(Math.max(...combinations(state.units,4).map(board=>value(board.map(u=>u.id)))));
    expect(mixed.choices[0].incoming.map(u=>u.id).sort()).toEqual([...'EFG']);
    expect(mixed.choices[0].outgoing.map(u=>u.id).sort()).toEqual([...'ABC']);
    expect(mixed.choices[0]).toMatchObject({actions:[],goldAfter:30,observedSources:['DEFG']});
    expect(mixed.deploymentSearch).toMatchObject({exactMaxSwaps:2,observedMaxSwaps:4,templates:1,observedBoards:4,limited:false});
    expect(JSON.stringify(state)).toBe(before);
  });
  it('never inserts a missing target; four-way entry requires the real affordable shop purchase',async()=>{
    const state=fixture(),value=(ids:string[])=>all(ids,'EFGH')?.95:all(ids,'ABCD')?.6:.2;
    const options={observedLineups:{templates:[template('EFGH')]}};
    const missing=await shoppingTactics(state,rules,request(state),model(value),options);
    if(!missing.ready)throw Error();expect(missing.choices[0].winRate).toBe(.6);
    state.offers=[{slot:0,id:'H',price:4}];
    const bought=await shoppingTactics(state,rules,request(state),model(value),options);
    if(!bought.ready)throw Error();
    const entry=bought.choices.find(c=>c.winRate===.95)!;
    expect(entry).toMatchObject({goldAfter:26,observedSources:['EFGH']});expect(entry.buy).toEqual([{id:'H',slots:[0],quantity:1}]);
    expect(entry.outgoing).toHaveLength(4);expect(entry.onBoard.sort()).toEqual([...'EFGH']);
    state.gold=3;
    const poor=await shoppingTactics(state,rules,request(state),pairs=>{expect(pairs.every(p=>p.player.units.every(u=>u.id!=='H'))).toBe(true);return model(value)(pairs);},options);
    if(!poor.ready)throw Error();expect(poor.choices[0].winRate).toBe(.6);
  });
  it('deducts the stronger FREE mixed deployment before assigning any extra gain to buying',async()=>{
    const state=fixture();state.offers=[{slot:0,id:'H',price:4}];
    const value=(ids:string[])=>all(ids,'DEFG')||all(ids,'EFGH')?.9:all(ids,'EH')?.8:all(ids,'ABCD')?.5:.3;
    const narrow=await shoppingTactics(state,rules,request(state),model(value));
    const mixed=await shoppingTactics(state,rules,request(state),model(value),{observedLineups:{templates:[template('DEFG'),template('EFGH')]}});
    if(!narrow.ready||!mixed.ready)throw Error();
    expect(narrow.purchases.some(row=>row.choice.buy.some(b=>b.id==='H'))).toBe(true);
    expect(mixed.purchaseBaseline).toBe(.9);expect(mixed.purchases).toEqual([]);
    expect(mixed.choices[0]).toMatchObject({buy:[],goldAfter:30,winRate:.9});
  });
  it('retains physical forms, worn items, charms and source guards through a multi-unit replacement',async()=>{
    const state=fixture(),a=state.units.find(u=>u.id==='A')!,e=state.units.find(u=>u.id==='E')!;
    a.items=[{key:'a-bound',id:'SOURCE'}];e.items=[{key:'e-bound',id:'GEAR'}];e.star=2;e.combatId='E_form';
    const r=request(state),auxiliary=[{id:'Dummy',star:1,items:['AUX']}];r.local.units.push(...auxiliary);r.local.charms=['CHARM'];
    const result=await shoppingTactics(state,rules,r,pairs=>{
      for(const {player}of pairs){expect(player.units.some(u=>u.id==='Dummy'&&u.items.includes('AUX'))).toBe(true);expect(player.charms).toEqual(['CHARM']);expect(player.units.every(u=>!u.items.includes('SOURCE')||u.id==='A')).toBe(true);}
      return pairs.map(({player})=>({winRate:all(player.units.map(u=>u.id),'FG')&&player.units.some(u=>u.id==='E_form'&&u.star===2&&u.items.includes('GEAR'))?.9:.5}));
    },{auxiliary,observedLineups:{templates:[template('DEFG'),template('AEFG')]},acceptsLineup:lineup=>lineup.units.some(u=>u.key===a.key)});
    if(!result.ready)throw Error();
    expect(result.choices[0].onBoard.sort()).toEqual([...'AEFG']);expect(result.choices[0].observedSources).toContain('AEFG');
    expect(result.choices[0].incoming.find(u=>u.id==='E')).toMatchObject({combatId:'E_form',star:2,items:['GEAR']});
  });
  it('preserves missing opponent probability and never evaluates an unknown bench item set as naked',async()=>{
    const state=fixture(),r=request(state);r.targets[0].weight=.75;r.targets.push({id:'missing',name:'未齐',weight:.25,board:null,gaps:['未齐']});
    const options={observedLineups:{templates:[template('DEFG')]}};
    const result=await shoppingTactics(state,rules,r,model(ids=>all(ids,'DEFG')?.9:.5),options);
    if(!result.ready)throw Error();expect(result.choices[0].winRate).toBeNull();expect(result.choices[0].delta).toBeNull();expect(result.choices[0].coverage).toBe(.75);
    expect(result.choices[0].lowerDelta).toBeCloseTo(.05);expect(result.choices[0].upperDelta).toBeCloseTo(.55);
    state.units.find(u=>u.id==='F')!.equipmentKnown=false;
    const unknown=await shoppingTactics(state,rules,request(state),pairs=>{expect(pairs.every(p=>p.player.units.every(u=>u.id!=='F'))).toBe(true);return pairs.map(()=>({winRate:.5}));},options);
    if(!unknown.ready)throw Error();expect(unknown.choices[0].observedSources).toBeUndefined();
  });
  it('gives each observed template its own bound, is order-stable, and never exceeds four removals',()=>{
    const state=fixture();state.level=8;state.boardCapacity=8;state.units=[...'ABCDEFGH'].map((id,i)=>entity(id,'board',i)).concat([...'IJKLMN'].map((id,i)=>entity(id,'bench',i)));
    const options={templates:[template('IJK'),template('LMN')],maxPerTemplate:1};
    const first=observedLineups(state,[],options),reordered=observedLineups({...state,units:[...state.units].reverse()},[],options);
    expect(first.limited).toBe(true);expect(first.candidates).toHaveLength(2);
    expect(new Set(first.candidates.flatMap(c=>c.observedSources!))).toEqual(new Set(['IJK','LMN']));
    expect(first.candidates.map(c=>c.key)).toEqual(reordered.candidates.map(c=>c.key));
    for(const candidate of first.candidates){expect(candidate.units).toHaveLength(8);expect(new Set(candidate.units.map(u=>u.key)).size).toBe(8);expect(state.units.filter(u=>u.area==='board'&&!candidate.units.includes(u))).toHaveLength(3);}
    state.units=[...'ABCDEF'].map((id,i)=>entity(id,'board',i)).concat([...'GHIJKL'].map((id,i)=>entity(id,'bench',i)));state.boardCapacity=6;
    const partial=observedLineups(state,[],{templates:[template('GHIJKL')]});expect(partial.candidates.length).toBeGreaterThan(0);for(const c of partial.candidates)expect(state.units.filter(u=>u.area==='board'&&!c.units.includes(u)).length).toBeLessThanOrEqual(4);
  });
  it('keeps alternative physical copies of the same hero rather than silently stripping or upgrading them',()=>{
    const state=fixture(),one=state.units.find(u=>u.id==='E')!;
    one.items=[{key:'one-item',id:'ITEM'}];state.units.push({...entity('E','bench',4),key:'E-two',star:2});
    const result=observedLineups(state,[],{templates:[template('DEFG')]});
    const choices=result.candidates.map(c=>c.units.find(u=>u.id==='E')!);
    expect(choices.some(u=>u.star===1&&u.items[0]?.key==='one-item')).toBe(true);
    expect(choices.some(u=>u.star===2&&u.items.length===0)).toBe(true);
    expect(choices.every(u=>u.star!==2||!u.items.some(t=>t.key==='one-item'))).toBe(true);
  });
  it('retains a strong equipped worker even when all four terminal targets are already available',async()=>{
    const state=fixture();state.units.push(entity('H','bench',4));state.units[0].star=2;state.units[0].items=[{key:'worker-gear',id:'ITEM'}];
    const value=(ids:string[])=>all(ids,'AEFG')?.95:all(ids,'EFGH')?.2:all(ids,'ABCD')?.5:.3;
    const result=await shoppingTactics(state,rules,request(state),model(value),{observedLineups:{templates:[template('EFGH')]}});
    if(!result.ready)throw Error();expect(result.choices[0].winRate).toBe(.95);expect(result.choices[0].onBoard.sort()).toEqual([...'AEFG']);expect(result.choices[0].outgoing).toHaveLength(3);
    expect(result.choices[0].onBoardItems.some(items=>items.includes('ITEM'))).toBe(true);
  });
  it('uses observed early boards before level seven and does not silently add unselected late families',()=>{
    const advice={ready:true,mode:'selected',focusId:'main',rows:[{id:'main',units:[...'DEFG'],early:{units:[...'ABC']},lateBoards:[{poolUnits:[...'EFGH']}]},{id:'other',units:[...'IJKL'],early:{units:[...'ABD']},lateBoards:[{poolUnits:[...'MNOP']}]}]} as unknown as Extract<DirectionAdvice,{ready:true}>;
    expect(tacticalLineupTemplates(advice,4).every(t=>t.source==='metatft-early')).toBe(true);
    expect(tacticalLineupTemplates(advice,7).map(t=>t.source)).toContain('metatft-core');
    const late=tacticalLineupTemplates(advice,8).filter(t=>t.source==='metatft-late');expect(late.map(t=>t.units.join(''))).toEqual(['EFGH']);
    expect(tacticalLineupTemplates({...advice,updating:true},8)).toEqual([]);
  });
  it('uses the same free mixed reference and mixed deployment in zero-budget failed search landings',async()=>{
    const state=fixture();state.gold=0;state.level=8;state.boardCapacity=8;state.units=[...'ABCDEFGH'].map((id,i)=>entity(id,'board',i)).concat([...'IJK'].map((id,i)=>entity(id,'bench',i)));
    const advice={ready:true,mode:'selected',focusId:'main',rows:[{id:'main',name:'主线',carry:'I',tank:'J',regime:'four-cost',units:[...'DEFGHIJK']}]} as unknown as DirectionAdvice;
    const input:Extract<StrategicInput,{ready:true}>={ready:true,stage:4,state,gaps:[],pool:{complete:true,remaining:{I:5,J:5},tierRemaining:{1:20,2:20,3:20,4:40,5:20},tierOdds:{1:0,2:0,3:0,4:1,5:0},refreshPrice:2,heroSlotsCycle:[4]}};
    const result=await searchLandings(advice,input,rules,request(state),model(ids=>all(ids,'IJK')?.9:.5));
    if(!result.ready)throw Error(result.reason);expect(result.baseline).toBe(.9);expect(result.observedDeployment).toBe(true);
    for(const band of result.plans[0].bands){expect(band.combat).toEqual({lower:.9,upper:.9});expect(band.failureCombat).toEqual({lower:.9,upper:.9});expect(band.weaker).toEqual({lower:0,upper:0});}
  });
});
