import type {ReaderStatus} from '../recognition/status';
import {battleRequest,type BattleForecast} from './battle-forecast';
import type {PurchaseSelection} from './advisor-preferences';
import {shoppingInput} from '../decision/shopping-input';
import {shoppingContextKey,type PurchaseOpportunity} from '../decision/shopping-tactics';

/** A highlight is an explicit, read-only bundle selection. All physical assets,
 * shop slots, budget, round and opponents must still match the evaluated frame.
 * A recycled slot ID or yesterday's recommendation can never target new cards. */
export function currentPurchases(status:ReaderStatus|null,forecast:BattleForecast|null|undefined,now=Date.now()):{
  context:string;rows:PurchaseOpportunity[];
}|null{
  const tactics=forecast?.tactics;if(!tactics?.ready)return null;
  const input=shoppingInput(status,now),request=battleRequest(status,now);
  if(!input.ready||!request||shoppingContextKey(input.state,request)!==tactics.purchaseContext)return null;
  return {context:tactics.purchaseContext,rows:tactics.purchases};
}
export function selectedPurchase(status:ReaderStatus|null,forecast:BattleForecast|null|undefined,selection:PurchaseSelection|null|undefined,now=Date.now()):PurchaseOpportunity|null{
  if(!selection||typeof selection.context!=='string'||typeof selection.id!=='string')return null;
  const current=currentPurchases(status,forecast,now);
  return current?.context===selection.context?current.rows.find(row=>row.id===selection.id)??null:null;
}
export function purchaseHighlightSlots(status:ReaderStatus|null,forecast:BattleForecast|null|undefined,selection:PurchaseSelection|null|undefined,now=Date.now()):number[]{
  if(status?.cards.shopVisible===false)return [];
  return selectedPurchase(status,forecast,selection,now)?.choice.buy.flatMap(b=>b.slots)??[];
}
