/** A physical, deterministic trading ledger. Rule values are injected and versioned;
 * this module never invents gold, discounts, unit copies or equipment. */
export interface EquipmentToken {key:string;id:string}
export interface OwnedUnit {key:string;id:string;star:number;area:'board'|'bench';slot:number;items:EquipmentToken[];equipmentKnown?:boolean}
export interface HeroOffer {slot:number;id:string;price:number}
export interface TradingRules {
  version:string;provisional:boolean;
  heroes:Record<string,{cost:number;maxStar:number;sellValues:Record<number,number>}>;
  benchCapacity:number;itemRackCapacity:number|null;
  interestStep:number;interestCap:number;victoryGoldBeforeInterest:number;
}
export interface ShopState {
  gold:number;level:number;boardCapacity:number;
  units:OwnedUnit[];offers:Array<HeroOffer|null>;itemRack:EquipmentToken[];
}
export type TradeAction={type:'buy';slot:number}|{type:'sell';key:string}|{type:'stage';key:string;slot:number};
export interface MergeEffect {id:string;star:number;consumed:string[];result:string}
export type TradeFailure='invalid-action'|'gold'|'bench-full'|'board-full'|'unsupported-merge-equipment'|'unsupported-item-overflow';
export type TradeResult={ok:true;state:ShopState;merges:MergeEffect[]}|{ok:false;reason:TradeFailure};
const integer=(v:number,min=0)=>Number.isSafeInteger(v)&&v>=min;
export const copies=(star:number)=>3**(star-1);
const clone=(s:ShopState):ShopState=>({...s,units:s.units.map(u=>({...u,items:[...u.items]})),offers:[...s.offers],itemRack:[...s.itemRack]});
export function validateShopState(s:ShopState,r:TradingRules):void {
  if(!integer(s.gold)||!integer(s.level,1)||!integer(s.boardCapacity)||s.boardCapacity>28||!integer(r.benchCapacity)||r.benchCapacity>20||!integer(r.interestStep,1)||!integer(r.interestCap)||!integer(r.victoryGoldBeforeInterest))throw new Error('Invalid trading state/rules');
  if(s.offers.length>5||s.units.length>48)throw new Error('Trading state capacity exceeded');
  for(const hero of Object.values(r.heroes))if(!integer(hero.cost,1)||!integer(hero.maxStar,1)||hero.maxStar>4||Array.from({length:hero.maxStar},(_,i)=>i+1).some(star=>!integer(hero.sellValues[star])))throw new Error('Incomplete hero trading rules');
  const keys=new Set<string>(),places=new Set<string>(),tokens=new Set<string>();
  for(const unit of s.units){
    const hero=r.heroes[unit.id],place=unit.area+':'+unit.slot;
    if(!hero||!integer(hero.cost,1)||!integer(hero.maxStar,1)||hero.maxStar>4||!integer(unit.star,1)||unit.star>hero.maxStar||!integer(hero.sellValues[unit.star])||!integer(unit.slot)||unit.slot>=(unit.area==='bench'?r.benchCapacity:28)||!['board','bench'].includes(unit.area)||keys.has(unit.key)||places.has(place)||unit.items.length>3)throw new Error('Invalid physical unit');
    keys.add(unit.key);places.add(place);
    for(const token of unit.items){if(!token.key||!token.id||tokens.has(token.key))throw new Error('Duplicate/missing equipment token');tokens.add(token.key);}
  }
  for(const token of s.itemRack){if(!token.key||!token.id||tokens.has(token.key))throw new Error('Duplicate/missing equipment token');tokens.add(token.key);}
  if(s.units.filter(u=>u.area==='board').length>s.boardCapacity||s.units.filter(u=>u.area==='bench').length>r.benchCapacity)throw new Error('Too many physical units');
  if(r.itemRackCapacity!==null&&(!integer(r.itemRackCapacity)||s.itemRack.length>r.itemRackCapacity))throw new Error('Invalid item rack');
  const slots=new Set<number>();
  s.offers.forEach((offer,i)=>{if(offer&&(!integer(offer.slot)||offer.slot!==i||!r.heroes[offer.id]||!integer(offer.price)||slots.has(offer.slot)))throw new Error('Invalid physical offer');if(offer)slots.add(offer.slot);});
}
export const interest=(gold:number,r:TradingRules)=>Math.min(r.interestCap,Math.floor(gold/r.interestStep));
export const liquidation=(s:ShopState,r:TradingRules)=>s.gold+s.units.reduce((sum,u)=>sum+r.heroes[u.id].sellValues[u.star],0);
export function unitCopyCounts(units:OwnedUnit[]):Record<string,number>{
  const result:Record<string,number>={};for(const u of units)result[u.id]=(result[u.id]??0)+copies(u.star);return result;
}
function combine(s:ShopState,id:string,r:TradingRules):MergeEffect[]|TradeFailure{
  const effects:MergeEffect[]=[];
  for(let star=1;star<r.heroes[id].maxStar;star++){
    let group=s.units.filter(u=>u.id===id&&u.star===star);
    while(group.length>=3){
      // Board position has priority; a single equipped source transfers without ambiguity.
      group.sort((a,b)=>Number(b.area==='board')-Number(a.area==='board')||a.slot-b.slot||a.key.localeCompare(b.key));
      const merging=group.slice(0,3),equipped=merging.filter(u=>u.items.length);
      // Multiple equipped holders can trigger auto-crafting/overflow/unique-item rules.
      // The common single-holder upgrade is exact; unsupported cases are explicit.
      if(equipped.length>1||merging.some(u=>u.equipmentKnown===false))return 'unsupported-merge-equipment';
      const survivor=merging[0],consumed=merging.map(u=>u.key);
      const result={...survivor,star:star+1,items:equipped[0]?.items??[]};
      s.units=[...s.units.filter(u=>!consumed.includes(u.key)),result];
      effects.push({id,star:star+1,consumed,result:result.key});
      group=s.units.filter(u=>u.id===id&&u.star===star);
    }
  }
  return effects;
}
/** Atomic: failures never mutate the caller's state. Purchases may immediately merge on a full bench. */
export function trade(s:ShopState,action:TradeAction,r:TradingRules):TradeResult {
  const next=clone(s);
  if(action.type==='sell'){
    const unit=next.units.find(u=>u.key===action.key);
    if(!unit)return {ok:false,reason:'invalid-action'};
    if(unit.equipmentKnown===false||unit.items.length&&(r.itemRackCapacity===null||next.itemRack.length+unit.items.length>r.itemRackCapacity))return {ok:false,reason:'unsupported-item-overflow'};
    next.gold+=r.heroes[unit.id].sellValues[unit.star];next.units=next.units.filter(u=>u!==unit);next.itemRack.push(...unit.items);
    return {ok:true,state:next,merges:[]};
  }
  if(action.type==='stage'){
    const unit=next.units.find(u=>u.key===action.key&&u.area==='bench');
    if(!unit||!integer(action.slot)||action.slot>=28||next.units.some(u=>u.area==='board'&&u.slot===action.slot))return {ok:false,reason:'invalid-action'};
    if(next.units.filter(u=>u.area==='board').length>=next.boardCapacity)return {ok:false,reason:'board-full'};
    unit.area='board';unit.slot=action.slot;return {ok:true,state:next,merges:[]};
  }
  if(!integer(action.slot)||action.slot>=next.offers.length)return {ok:false,reason:'invalid-action'};
  const offer=next.offers[action.slot];
  if(!offer||next.units.some(u=>u.key===`shop:${action.slot}`))return {ok:false,reason:'invalid-action'};
  if(next.gold<offer.price)return {ok:false,reason:'gold'};
  next.gold-=offer.price;next.offers[action.slot]=null;
  const taken=new Set(next.units.filter(u=>u.area==='bench').map(u=>u.slot));
  const slot=Array.from({length:r.benchCapacity},(_,i)=>i).find(i=>!taken.has(i))??r.benchCapacity;
  next.units.push({key:`shop:${action.slot}`,id:offer.id,star:1,area:'bench',slot,items:[]});
  const effects=combine(next,offer.id,r);
  if(typeof effects==='string')return {ok:false,reason:effects};
  if(next.units.filter(u=>u.area==='bench').length>r.benchCapacity)return {ok:false,reason:'bench-full'};
  // A temporary full-bench purchase may survive a merge; assign it the newly freed slot.
  const overflow=next.units.find(u=>u.area==='bench'&&u.slot>=r.benchCapacity);
  if(overflow){const used=new Set(next.units.filter(u=>u.area==='bench'&&u!==overflow).map(u=>u.slot));overflow.slot=Array.from({length:r.benchCapacity},(_,i)=>i).find(i=>!used.has(i))!;}
  return {ok:true,state:next,merges:effects};
}

export interface ShoppingPlan {
  state:ShopState;actions:TradeAction[];merges:MergeEffect[];
  buySlots:number[];sellKeys:string[];spent:number;refund:number;
  interestIfLose:number;interestIfWin:number;liquidation:number;
}
export interface ShoppingSearch {
  plans:ShoppingPlan[];examined:number;failures:Partial<Record<TradeFailure,number>>;
  /** All buy/sell subsets, with the first legal execution order for each asset combination. */
  scope:{sellCandidates:string[];offers:number[];exhaustiveSubsets:true;limitations:string[]};
}
const signature=(s:ShopState)=>JSON.stringify([s.gold,s.units.map(u=>[u.id,u.star,u.area,u.items.map(i=>i.key).sort()]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),s.itemRack.map(t=>t.key).sort()]);
export function enumerateShoppingPlans(initial:ShopState,r:TradingRules,options:{sellCandidates?:string[];stageToFreeBench?:boolean}={}):ShoppingSearch {
  validateShopState(initial,r);
  const sellKeys=options.sellCandidates??initial.units.filter(u=>u.area==='bench'&&!u.items.length&&u.equipmentKnown!==false).map(u=>u.key);
  if(sellKeys.length>9||new Set(sellKeys).size!==sellKeys.length||sellKeys.some(key=>!initial.units.some(u=>u.key===key)))throw new Error('Declare at most nine unique initial sale candidates');
  const offers=initial.offers.filter((o):o is HeroOffer=>!!o),plans:ShoppingPlan[]=[],seen=new Set<string>();
  const failures:ShoppingSearch['failures']={};let examined=0;
  function failed(reason:TradeFailure){failures[reason]=(failures[reason]??0)+1;}
  function purchase(state:ShopState,remaining:HeroOffer[],actions:TradeAction[],merges:MergeEffect[]):{state:ShopState;actions:TradeAction[];merges:MergeEffect[]}|null{
    if(!remaining.length)return {state,actions,merges};
    for(const offer of remaining){
      let current=state,extra:TradeAction[]=[];
      let result=trade(current,{type:'buy',slot:offer.slot},r);
      if(!result.ok&&result.reason==='bench-full'&&options.stageToFreeBench!==false){
        const unit=current.units.filter(u=>u.area==='bench').sort((a,b)=>a.key.localeCompare(b.key))[0];
        const boardSlots=new Set(current.units.filter(u=>u.area==='board').map(u=>u.slot));
        const slot=Array.from({length:28},(_,i)=>i).find(i=>!boardSlots.has(i));
        if(unit&&slot!==undefined){const action:TradeAction={type:'stage',key:unit.key,slot};const staged=trade(current,action,r);if(staged.ok){current=staged.state;extra=[action];result=trade(current,{type:'buy',slot:offer.slot},r);}}
      }
      if(!result.ok){failed(result.reason);continue;}
      const rest=purchase(result.state,remaining.filter(o=>o!==offer),[...actions,...extra,{type:'buy',slot:offer.slot}],[...merges,...result.merges]);
      if(rest)return rest;
    }
    return null;
  }
  for(let saleMask=0;saleMask<2**sellKeys.length;saleMask++){
    let soldState=initial;const sold:string[]=[],saleActions:TradeAction[]=[];let refund=0,valid=true;
    for(let i=0;i<sellKeys.length;i++)if(saleMask&(1<<i)){
      const key=sellKeys[i],unit=initial.units.find(u=>u.key===key)!,action:TradeAction={type:'sell',key};
      const result=trade(soldState,action,r);if(!result.ok){failed(result.reason);valid=false;break;}
      soldState=result.state;sold.push(key);saleActions.push(action);refund+=r.heroes[unit.id].sellValues[unit.star];
    }
    if(!valid)continue;
    for(let buyMask=0;buyMask<2**offers.length;buyMask++){
      examined++;
      const selected=offers.filter((_,i)=>buyMask&(1<<i)),spent=selected.reduce((n,o)=>n+o.price,0);
      if(spent>soldState.gold){failed('gold');continue;}
      const result=purchase(soldState,selected,saleActions,[]);if(!result)continue;
      const key=signature(result.state);if(seen.has(key))continue;seen.add(key);
      plans.push({...result,buySlots:selected.map(o=>o.slot),sellKeys:sold,spent,refund,interestIfLose:interest(result.state.gold,r),interestIfWin:interest(result.state.gold+r.victoryGoldBeforeInterest,r),liquidation:liquidation(result.state,r)});
    }
  }
  return {plans,examined,failures,scope:{sellCandidates:sellKeys,offers:offers.map(o=>o.slot),exhaustiveSubsets:true,limitations:['Only declared initial units may be sold','One executable purchase order per subset; final deployment is a separate search','Ambiguous multi-holder equipment merges are excluded','Combat restrictions and special-price modifiers must be resolved by the caller']}};
}
