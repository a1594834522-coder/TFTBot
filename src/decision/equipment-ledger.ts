import type {EquipmentToken,ShopState,OwnedUnit} from './shop-ledger';
export interface ItemRule {unique:boolean;tags:string[];recipe:string[];traits:string[];incompatible:string[]}
export interface EquipmentRules {set:number;version:string;provisional:boolean;items:Record<string,ItemRule>;traits:Record<string,string[]>;source:{blockedAugments:Record<string,string>}}
export interface EquipMove {token:EquipmentToken;to:string;consumed:EquipmentToken[];result:EquipmentToken}
export type EquipResult={ok:false;reason:string}|{ok:true;state:ShopState;move:EquipMove};
const blocked=['Item.Equippable.Consumable','Item.Equippable.Item.Temporary','Item.Equippable.Item.Tacticians','Item.Equippable.Item.ThiefsGloves','Item.Equippable.CantBeCombined','Item.Equippable.Reusable.Selector.Riftbeast'];
export function portableItem(id:string,rules:EquipmentRules):boolean{
  const item=rules.items[id];return !!item&&item.tags.some(t=>t.startsWith('Item.Equippable.Item.'))&&!item.tags.some(t=>blocked.includes(t)||t.startsWith('Item.Equippable.Potion.'));
}
const component=(r:ItemRule)=>r.tags.includes('Item.Equippable.Item.Component');
/** Physical allocation, no clicks or gold changes. Existing worn items cannot
 * be removed here. Equipping two components consumes BOTH token identities. */
export function equipItem(state:ShopState,tokenKey:string,unitKey:string,rules:EquipmentRules):EquipResult{
  const token=state.itemRack.find(t=>t.key===tokenKey),unit=state.units.find(u=>u.key===unitKey);
  if(!token||!unit||unit.equipmentKnown===false||!portableItem(token.id,rules)||unit.items.some(t=>!portableItem(t.id,rules)))return {ok:false,reason:'装备或接装英雄规则待覆盖'};
  let rule=rules.items[token.id],result=token,consumed:EquipmentToken[]=[];
  if(component(rule)){
    const pieces=unit.items.filter(t=>rules.items[t.id]&&component(rules.items[t.id]));
    if(pieces.length>1)return {ok:false,reason:'等待英雄散件合成同步'};
    if(pieces.length){
      const piece=pieces[0],recipe=[piece.id,token.id].sort().join('|'),products=Object.entries(rules.items).filter(([,r])=>r.recipe.length===2&&r.recipe.slice().sort().join('|')===recipe);
      if(products.length!==1||!portableItem(products[0][0],rules))return {ok:false,reason:'配方或合成规则待覆盖'};
      consumed=[piece];result={id:products[0][0],key:'craft:'+JSON.stringify([piece.key,token.key].sort())};rule=products[0][1];
    }
  }
  const remaining=unit.items.filter(t=>!consumed.some(c=>c.key===t.key));
  if(remaining.length>=3||rule.unique&&remaining.some(t=>t.id===result.id))return {ok:false,reason:'装备栏位或唯一性冲突'};
  const traits=new Set([...(rules.traits[unit.combatId??unit.id]??[]),...remaining.flatMap(t=>rules.items[t.id]?.traits??[])]);
  if(rule.incompatible.length&&(!rules.traits[unit.combatId??unit.id]||rule.incompatible.some(t=>traits.has(t))))return {ok:false,reason:'装备与英雄羁绊冲突或未确认'};
  // Also check the reverse constraint of a currently worn emblem/item.
  if(remaining.some(t=>rules.items[t.id]?.incompatible.some(id=>rule.traits.includes(id))))return {ok:false,reason:'已有装备的羁绊限制冲突'};
  const units=state.units.map(u=>u.key===unitKey?{...u,items:[...remaining,result]}:u);
  return {ok:true,state:{...state,units,itemRack:state.itemRack.filter(t=>t.key!==tokenKey)},move:{token,to:unitKey,consumed,result}};
}
export interface EquipmentAllocation {state:ShopState;moves:EquipMove[];score:number}
/** Bounded candidate generation; frequency affinity orders exploration only,
 * never claims a combat or final-placement benefit. Keep the untouched case. */
export function equipmentAllocations(state:ShopState,recipients:string[],rules:EquipmentRules,affinity:(unit:OwnedUnit)=>number,limit=24):EquipmentAllocation[]{
  if(!Number.isSafeInteger(limit)||limit<1||limit>128)throw Error('Invalid equipment candidate limit');
  const signature=(s:ShopState)=>JSON.stringify([s.units.map(u=>[u.key,u.items.map(t=>t.id).sort()]),s.itemRack.map(t=>t.id).sort()]);
  const score=(s:ShopState)=>s.units.filter(u=>recipients.includes(u.key)).reduce((n,u)=>n+affinity(u),0);
  const initial={state,moves:[],score:score(state)};
  let layer:EquipmentAllocation[]=[initial];
  for(let depth=0;depth<state.itemRack.length;depth++){
    const next=new Map(layer.map(row=>[signature(row.state),row]));
    // Component order matters: sword+glove then rod is a different legal
    // result from sword+rod then glove. Explore revealed tokens in any order.
    for(const row of layer)for(const token of row.state.itemRack)for(const key of recipients){const result=equipItem(row.state,token.key,key,rules);if(result.ok){const node={state:result.state,moves:[...row.moves,result.move],score:score(result.state)},id=signature(node.state),old=next.get(id);if(!old||node.moves.length<old.moves.length)next.set(id,node);}}
    const ordered=[...next.values()].sort((a,b)=>b.score-a.score||a.moves.length-b.moves.length),chosen=new Map<string,EquipmentAllocation>();
    const add=(row:EquipmentAllocation|undefined)=>{if(row&&chosen.size<limit)chosen.set(signature(row.state),row);};add(initial);
    // Preserve full allocations even when an uncommon item's empirical fit is
    // unknown/zero, plus different slot-use patterns for joint core builds.
    for(const key of recipients)add(ordered.slice().sort((a,b)=>b.moves.filter(m=>m.to===key).length-a.moves.filter(m=>m.to===key).length||b.score-a.score)[0]);
    const patterns=new Set<string>();for(const row of ordered){const pattern=row.state.units.filter(u=>recipients.includes(u.key)).map(u=>u.items.length).join(':');if(!patterns.has(pattern)){patterns.add(pattern);add(row);}}
    for(const row of ordered)add(row);layer=[...chosen.values()];
  }
  return layer;
}
