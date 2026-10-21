import {describe,it,expect} from 'vitest';
import {createSSRApp,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {advisorDemo} from '../src/desktop/advisor-demo';
import {battleRequest,emptyBattleForecast} from '../src/game/battle-forecast';
import {shoppingInput,tradingRules} from '../src/decision/shopping-input';
import {shoppingTactics} from '../src/decision/shopping-tactics';
import {currentPurchases,selectedPurchase,purchaseHighlightSlots} from '../src/game/purchase-selection';
import PurchaseOpportunities from '../src/desktop/PurchaseOpportunities.vue';
const id='DA_18_Leona';
async function fixture(){
  const status=advisorDemo('ap'),now=status.lastFrameAt!;status.cards.gold=20;status.cards.level=2;
  status.cards.shop=[{id,name:'蕾欧娜',known:true},null,null,null,null];
  const board=[{name:id,level:1,position:0,area:'board' as const,items:[]}],bench=[{name:id,level:1,position:28,area:'bench' as const,items:[]}];
  status.cards.ownHoldings={board,bench};status.cards.battleBoards={local:{at:now,units:board},opponents:{}};
  const input=shoppingInput(status,now),request=battleRequest(status,now);if(!input.ready||!request)throw Error('Invalid fixture');
  const tactics=await shoppingTactics(input.state,tradingRules,request,pairs=>pairs.map(({player})=>({winRate:player.units.some(u=>u.star===2)?.8:.3})));
  if(!tactics.ready||!tactics.purchases.length)throw Error('Missing fixture purchase');
  return {status,now,forecast:{...emptyBattleForecast(),phase:'ready' as const,tactics},selection:{context:tactics.purchaseContext,id:tactics.purchases[0].id}};
}
describe('explicit current-shop bundle selection',()=>{
  it('keeps a manual bundle separate from mainline and highlights exactly the priced copies',async()=>{
    const {status,forecast,selection,now}=await fixture(),original=JSON.stringify(status);
    expect(currentPurchases(status,forecast,now)?.rows).toHaveLength(1);
    expect(purchaseHighlightSlots(status,forecast,null,now)).toEqual([]);
    expect(purchaseHighlightSlots(status,forecast,selection,now)).toEqual([0]);
    expect(selectedPurchase(status,forecast,selection,now)?.choice.upgraded[0]).toMatchObject({id,after:2});
    expect(JSON.stringify(status)).toBe(original);
  });
  it('invalidates on reroll, wallet, equipment, round, opponent or physical ownership changes, even if slot IDs repeat',async()=>{
    const {status,forecast,selection,now}=await fixture();
    const changed=[
      s=>{s.cards.shop[0]!.id='DA_18_Kayle';},s=>{s.cards.gold!--;},
      s=>{s.cards.ownHoldings!.board![0].items=['DA_InfinityEdge'];},
      s=>{s.cards.round='3-1';},s=>{s.tracker!.snapshot!.players.find(p=>!p.isLocal)!.health=0;},
      s=>{s.cards.ownHoldings!.bench=[];},
    ] as Array<(s:typeof status)=>void>;
    for(const mutate of changed){const altered=structuredClone(status);mutate(altered);expect(purchaseHighlightSlots(altered,forecast,selection,now)).toEqual([]);}
    expect(purchaseHighlightSlots(status,forecast,{...selection,id:'buy:4'},now)).toEqual([]);
    expect(purchaseHighlightSlots(status,forecast,{...selection,context:'old'},now)).toEqual([]);
  });
  it('removes overlays on hidden shop, stale input, stopped transport and forecast invalidation',async()=>{
    const {status,forecast,selection,now}=await fixture();
    status.cards.shopVisible=false;expect(purchaseHighlightSlots(status,forecast,selection,now)).toEqual([]);status.cards.shopVisible=true;
    expect(currentPurchases(status,forecast,now+15001)).toBeNull();
    expect(purchaseHighlightSlots(status,emptyBattleForecast(),selection,now)).toEqual([]);
    status.phase='stopped';expect(currentPurchases(status,forecast,now)).toBeNull();
  });
  it('renders concise Chinese cost, relative gain and manual selection without auto-choosing a route',async()=>{
    const {status,forecast,selection}=await fixture();
    const html=await renderToString(createSSRApp({render:()=>h(PurchaseOpportunities,{status,forecast,selection})}));
    expect(html).toContain('商店补强');expect(html).toContain('相对免费换牌');expect(html).toContain('蕾欧娜');
    expect(html).toContain('已高亮');expect(html).toContain('data-purchase-highlight="buy:0"');expect(html).toContain('升星');
    expect(html).not.toContain('设为主线');
  });
});
