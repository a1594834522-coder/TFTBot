import type { ReaderStatus } from '../recognition/status';
import type { MetatftComp, MetatftBuild } from './metatft-comps';
import { dataset, type Item } from './tft-data';
import { currentPool, normalizeShopHero, shopCatalog } from './shop-mechanics';
import {earlyStages,type EarlyStage} from './metatft-early';
import {CURRENT_SET} from './current-season';
import {aggregateChampions} from './roster';

export interface AdvisorItem { id:string; holder?:string }
export interface AdvisorInput {
  units:Record<string,number>;
  items:AdvisorItem[];
  opponents:Record<string,number>;
  level?:number|null;
  stage?:number|null;
  localComplete:boolean;
  poolComplete:boolean;
  inventoryComplete:boolean;
  inventorySource?:'native'|'manual';
  gold?:number|null;
  eliminated?:boolean;
}
export interface EquipmentMatch {unit:string;items:string[];matched:number;available:number;sample:number}
export interface CompSuggestion {
  key:string;name:string;units:string[];score:number;avgPlace:number;games:number;
  keep:string[];missing:string[];early:string[];
  components:{board:number;items:number|null;meta:number;contested:number|null};
  equipment:EquipmentMatch[];
  rivals:number;crowded:string[];blockedThree:string[];
  reasons:string[];
}
export interface AdvisorResult {ready:boolean;message:string;rows:CompSuggestion[];input:AdvisorInput}
export interface HoldCard {id:string;owned:number;shopSlots:number[];quantity:number;priority:number;reason:string;routes:string[]}
export interface EarlyBoardSuggestion {id:string;units:string[];held:string[];missing:string[];score:number;battleWinRate?:number;matchupCount?:number;avgPlace?:number;count?:number;associationCount?:number}
export interface EarlyHoldAdvice {ready:boolean;cards:HoldCard[];directions:Array<{key:string;name:string}>;boards:EarlyBoardSuggestion[];stage:number;stageEstimated:boolean}
const clamp=(n:number)=>Math.min(1,Math.max(0,n));
const known=new Map(shopCatalog.map(h=>[h.character_id,h]));
const normalizeCounts=(raw:Record<string,number>)=>{
  const counts:Record<string,number>={};
  for(const [rawId,n] of Object.entries(raw))if(Number.isFinite(n)&&n>0){const id=normalizeShopHero(rawId);if(known.has(id))counts[id]=(counts[id]??0)+n;}
  return counts;
};

/** Only the explicitly identified local player supplies personal assets. */
export function advisorInput(status:ReaderStatus|null,manualItems:string[]=[],now=Date.now()):AdvisorInput {
  const players=status?.tracker?.snapshot?.players??[];
  const locals=players.filter(p=>p.isLocal);
  const local=locals.length===1?locals[0]:undefined;
  const live=status?.phase==='receiving' && status.lastFrameAt!==null && now-status.lastFrameAt>=0 && now-status.lastFrameAt<=15000;
  const localComplete=!!live && !!local && local.health>0 && local.placements!==undefined && local.coverage!=='partial' && local.champions.every(c=>known.has(normalizeShopHero(c.name)));
  const alive=players.filter(p=>p.health>0);
  const poolComplete=localComplete && alive.length>0 && alive.every(p=>p.placements!==undefined && p.coverage!=='partial' && p.champions.every(c=>known.has(normalizeShopHero(c.name))));
  const holdings=status?.cards.ownHoldings;
  const own=holdings?.board!==null&&holdings?.board!==undefined&&holdings?.bench!==null&&holdings?.bench!==undefined?[...holdings.board,...holdings.bench]:null;
  const actual=own?aggregateChampions(own):local?.champions??[];
  const units=localComplete?normalizeCounts(Object.fromEntries(actual.map(c=>[c.name,c.copies]))):{};
  const opponents:Record<string,number>={};
  if(live)for(const p of alive.filter(p=>!p.isLocal))for(const c of p.champions){const id=normalizeShopHero(c.name);if(known.has(id))opponents[id]=(opponents[id]??0)+c.copies;}
  // Champion.items is already aggregated from placements; reading both would count equipment twice.
  const items:AdvisorItem[]=localComplete?actual.flatMap(c=>c.items.map(id=>({id,holder:normalizeShopHero(c.name)}))):[];
  const benches=localComplete?status?.cards.itemBenches?.filter(p=>p.summoner===local!.summoner&&p.tag_line===local!.tagLine):undefined;
  const nativeBench=benches?.length===1?benches[0]:undefined;
  // Once a complete native bench snapshot exists, old manual supplements must not duplicate it.
  if(nativeBench){for(const entry of nativeBench.bench_items)if(dataset.item(entry.name))for(let n=0;n<entry.count;n++)items.push({id:entry.name});}
  else {items.push(...manualItems.filter(id=>!!dataset.item(id)).map(id=>({id})));}
  return {units,items,opponents,level:status?.cards.level,stage:status?.cards.stage,localComplete,poolComplete,inventoryComplete:!!nativeBench,inventorySource:nativeBench?'native':'manual',gold:status?.cards.gold??null,eliminated:!!local && local.health<=0};
}

interface Allocation {credit:number;used:bigint}
/** Allocate a physical item at most once. Crafted pairs require both components, including duplicates. */
export function fitEquipment(build:MetatftBuild,inventory:AdvisorItem[],core:string[],items:Item[]=dataset.items):Allocation {
  const recipes=new Map(items.map(i=>[i.item_id,i.builds_from]));
  const cache=new Map<string,Allocation>();
  function search(slot:number,used:bigint):Allocation {
    if(slot===build.items.length)return {credit:0,used};
    const key=slot+':'+used;
    const hit=cache.get(key);if(hit)return hit;
    const desired=build.items[slot],recipe=recipes.get(desired)??[];
    const eligible=inventory.map((token,index)=>({token,index,bit:1n<<BigInt(index)})).filter(({token,bit})=>!(used&bit)&&(!token.holder||token.holder===build.unit||!core.includes(token.holder)));
    const choices:Array<{bits:bigint;credit:number}>=[{bits:0n,credit:0}];
    const dedup=new Set<string>();
    for(const a of eligible){
      const signature=a.token.id+':'+(a.token.holder??'');
      if(dedup.has(signature))continue;dedup.add(signature);
      if(a.token.id===desired)choices.push({bits:a.bit,credit:1});
      if(recipe.length===2 && recipe.includes(a.token.id)){
        choices.push({bits:a.bit,credit:.35});
        const other=recipe[a.token.id===recipe[0]?1:0];
        const b=eligible.find(b=>b.index!==a.index && b.token.id===other);
        if(b)choices.push({bits:a.bit|b.bit,credit:1});
      }
    }
    let best:Allocation={credit:-1,used};
    for(const choice of choices){const next=search(slot+1,used|choice.bits),candidate={credit:next.credit+choice.credit,used:next.used};if(candidate.credit>best.credit+1e-9)best=candidate;}
    cache.set(key,best);return best;
  }
  return search(0,0n);
}

export function recommendComps(input:AdvisorInput,comps:MetatftComp[],previousTop?:string):AdvisorResult {
  if(!input.localComplete)return {ready:false,message:input.eliminated?'本局已结束':'等待本方棋盘与备战席',rows:[],input};
  const units=normalizeCounts(input.units),opponents=normalizeCounts(input.opponents);
  const inventory=input.items.filter(i=>dataset.item(i.id)).map(i=>({...i,holder:i.holder?normalizeShopHero(i.holder):undefined}));
  const ownedIds=Object.keys(units);
  if(!ownedIds.length && !inventory.length)return {ready:false,message:'拿到第一张牌后开始推荐',rows:[],input};
  const value=(id:string)=>Math.min(units[id]??0,9)*(known.get(id)?.cost??0);
  const investment=ownedIds.reduce((n,id)=>n+value(id),0);
  const rows:CompSuggestion[]=[];
  for(const comp of comps){
    if(comp.source!=='metatft')continue;
    if(!Number.isFinite(comp.avgPlace)||!comp.games || comp.games<100)continue;
    const core=[...new Set(comp.units.map(u=>normalizeShopHero(u.character_id)))].filter(id=>known.has(id));
    if(!core.length)continue;
    const keep=core.filter(id=>units[id]>0);
    const earlyOptions=comp.details?.earlyOptions?.filter(o=>o.level<=6)??[];
    const early=earlyOptions.map(o=>({units:[...new Set(o.units.map(normalizeShopHero))],count:o.count??0})).sort((a,b)=>b.units.reduce((n,id)=>n+value(id),0)-a.units.reduce((n,id)=>n+value(id),0)||b.count-a.count)[0]?.units??[];
    const finalFit=investment?keep.reduce((n,id)=>n+value(id),0)/investment:0;
    const earlyFit=investment?early.reduce((n,id)=>n+value(id),0)/investment:0;
    const earlyWeight=input.level==null?.15:input.level<=6?.3:0;
    const board=clamp((1-earlyWeight)*finalFit+earlyWeight*earlyFit);
    const priorities=core.map(id=>{
      const stats=comp.details?.unitStats?.find(s=>normalizeShopHero(s.unit)===id);
      const equipped=stats?.numItems?.find(s=>s.items===3)?.count??0;
      const named=comp.name.includes(dataset.characterById(id)?.display_name??'\0');
      return {id,stats,importance:equipped/(comp.games??1)+(named ? .4 : 0)};
    }).sort((a,b)=>b.importance-a.importance || (known.get(b.id)?.cost??0)-(known.get(a.id)?.cost??0));
    const equipment:EquipmentMatch[]=[];
    let available=[...inventory],credit=0;
    // The holder order is fixed by common 3-item frequency, so a low-priority holder cannot
    // consume a carry's components first. This is a deterministic heuristic, not a win model.
    for(const priority of priorities.slice(0,3)){
      const builds=comp.details?.builds?.filter(b=>b.unit && normalizeShopHero(b.unit)===priority.id && (b.count??0)>=30).map(b=>({...b,unit:priority.id}))??[];
      let best:{build:MetatftBuild;fit:Allocation}|undefined;
      for(const build of builds){const fit=fitEquipment(build,available,core);if(!best || fit.credit>best.fit.credit+1e-9 || Math.abs(fit.credit-best.fit.credit)<1e-9 && (build.count??0)>(best.build.count??0))best={build,fit};}
      if(best){credit+=best.fit.credit;equipment.push({unit:priority.id,items:best.build.items,matched:best.fit.credit,available:best.build.items.length,sample:best.build.count??0});available=available.filter((_,i)=>!(best!.fit.used&(1n<<BigInt(i))));}
    }
    const inventoryValue=inventory.reduce((n,i)=>n+(dataset.item(i.id)?.builds_from.length===0 && i.id.includes('Component_')?.5:1),0);
    const itemFit=inventoryValue && equipment.length?clamp(credit/inventoryValue):null;
    const shrunk=((comp.avgPlace!*comp.games)+4.5*2000)/(comp.games+2000);
    const meta=clamp(.5+(4.5-shrunk)/2);
    const important=priorities.slice(0,2);
    const pressure=important.length?important.reduce((n,p)=>n+(opponents[p.id]??0)/(currentPool.poolByCost[known.get(p.id)!.cost as 1|2|3|4|5]??1),0)/important.length:0;
    const contested=input.poolComplete?1-clamp(pressure*2):null;
    const crowded=important.filter(p=>(opponents[p.id]??0)>=3).map(p=>p.id);
    const blockedThree=input.poolComplete?important.filter(p=>{
      const tiers=p.stats?.tiers??[];const three=tiers.find(t=>t.tier===3)?.count??0;
      const total=tiers.reduce((n,t)=>n+(t.count??0),0);
      const pool=currentPool.poolByCost[known.get(p.id)!.cost as 1|2|3|4|5]??0;
      return three>total*.5 && three>0 && pool-(opponents[p.id]??0)<9;
    }).map(p=>p.id):[];
    const weights=[{v:board,w:investment?40:0},{v:itemFit,w:itemFit===null?0:30},{v:meta,w:20},{v:contested,w:contested===null?0:10}];
    const score=Math.max(0,Math.min(100,100*weights.reduce((n,x)=>n+(x.v??0)*x.w,0)/weights.reduce((n,x)=>n+x.w,0)-blockedThree.length*12));
    const missing=priorities.filter(p=>!units[p.id]).map(p=>p.id);
    const name=(id:string)=>dataset.characterById(id)?.display_name??'待更新';
    const reasons=[keep.length?`沿用 ${keep.length} 张成型牌`:early.some(id=>units[id])?'可沿用当前过渡牌':'需要较多换牌'];
    if(itemFit!==null && credit>0)reasons.push(`现有装备可衔接${equipment.find(e=>e.matched>0)?' '+name(equipment.find(e=>e.matched>0)!.unit):''}`);
    if(crowded.length)reasons.push(`${crowded.map(name).join('、')} 有同行占牌`);
    if(blockedThree.length)reasons.push(`${blockedThree.map(name).join('、')} 追三受限`);
    rows.push({key:`metatft:${comp.id}`,name:comp.name,units:core,score:Math.round(score),avgPlace:comp.avgPlace!,games:comp.games,keep,missing,early,components:{board:Math.round(board*100),items:itemFit===null?null:Math.round(itemFit*100),meta:Math.round(meta*100),contested:contested===null?null:Math.round(contested*100)},equipment,rivals:important.reduce((n,p)=>n+(opponents[p.id]??0),0),crowded,blockedThree,reasons});
  }
  rows.sort((a,b)=>b.score-a.score || b.games-a.games || a.key.localeCompare(b.key));
  // Small score movements should not reorder the recommendation currently being read.
  const previous=rows.findIndex(r=>r.key===previousTop);
  if(previous>0 && rows[0].score-rows[previous].score<=4)rows.unshift(...rows.splice(previous,1));
  return {ready:true,message:input.poolComplete?'':'同行数据采集中',rows,input};
}

/** Before committing, keep several distinct routes open. Shop recommendations are quantities,
 * not click commands; no sell action or assumption about available gold is made here. */
export function earlyHoldAdvice(result:AdvisorResult,shop:ReaderStatus['cards']['shop'],stageOverride?:number|null,stages:EarlyStage[]=earlyStages(CURRENT_SET),focusId?:string|null):EarlyHoldAdvice {
  const stage=stageOverride??result.input.stage??((result.input.level??4)<=5?2:(result.input.level??6)<=7?3:4);
  const stageEstimated=!stageOverride&&!result.input.stage;
  if(!result.ready)return {ready:false,cards:[],directions:[],boards:[],stage,stageEstimated};
  const owned=result.input.units;
  const asset=(id:string)=>Math.min(owned[id]??0,9)*(known.get(id)?.cost??0);
  const investment=Object.keys(owned).reduce((n,id)=>n+asset(id),0);
  const shopIds=new Set(shop.filter(c=>c?.known && c.kind!=='wisp').map(c=>normalizeShopHero(c!.id)));
  const inventoryValue=result.input.items.reduce((n,i)=>n+(i.id.includes('Component_')?.5:1),0);
  const candidates:EarlyBoardSuggestion[]=(stages.find(s=>s.stage===stage)?.boards??[]).filter(b=>b.units.length>=3 && b.units.every(id=>known.has(normalizeShopHero(id))) && (b.matchupCount??0)>=100).map(b=>{
    const units=[...new Set(b.units.map(normalizeShopHero))],held=units.filter(id=>owned[id]>0),missing=units.filter(id=>!owned[id]);
    const retained=investment?held.reduce((n,id)=>n+asset(id),0)/investment:0;
    const coverage=held.length/units.length;
    const available=missing.filter(id=>shopIds.has(id)).length/units.length;
    const n=b.matchupCount??0,posterior=((b.battleWinRate??.5)*n+.5*300)/(n+300);
    const quality=clamp((posterior-.4)/.4);
    // Gear is secondary here. Use one holder's feasible allocation, never add repeated matches.
    const gear=Math.max(0,...result.rows.flatMap(r=>r.equipment.filter(e=>units.includes(e.unit)).map(e=>e.matched)));
    const equipment=inventoryValue?clamp(gear/inventoryValue):null;
    const score=100*(.45*retained+.15*coverage+.1*available+.2*quality+(equipment===null?0:.1*equipment))/(equipment===null?.9:1);
    return {...b,id:b.id??`early-${stage}-${units.join('|')}`,units,held,missing,score:Math.round(score)};
  }).sort((a,b)=>b.score-a.score||(b.matchupCount??0)-(a.matchupCount??0));
  const focus=candidates.findIndex(r=>r.id===focusId);
  if(focus>0)candidates.unshift(...candidates.splice(focus,1));
  const routes:EarlyBoardSuggestion[]=[];
  for(const row of candidates){
    if(routes.some(r=>{const a=new Set(r.units),intersection=row.units.filter(id=>a.has(id)).length;return intersection/(a.size+row.units.length-intersection)>=.6;}))continue;
    routes.push(row);if(routes.length===4)break;
  }
  const weights=routes.map(r=>focusId?(r.id===focusId?1:.2):Math.exp((r.score-(routes[0]?.score??0))/18));
  const total=weights.reduce((n,w)=>n+w,0)||1;
  const slots=new Map<string,number[]>();
  shop.forEach((card,i)=>{if(card?.known){const id=normalizeShopHero(card.id);if(known.has(id))slots.set(id,[...(slots.get(id)??[]),i]);}});
  const ids=new Set([...Object.keys(result.input.units),...slots.keys()]);
  const cards:HoldCard[]=[];
  for(const id of ids){
    const owned=result.input.units[id]??0,shopSlots=slots.get(id)??[];
    if(owned>=9)continue;
    const supporting=routes.map((r,i)=>({r,i})).filter(({r})=>r.units.includes(id));
    const shared=supporting.reduce((n,{i})=>n+weights[i],0)/total;
    const early=shared;
    const upgrades=owned<3 && owned+shopSlots.length>=3;
    const pair=owned===2 || owned<2&&owned+shopSlots.length>=2;
    const twoStar=owned>=3;
    const priority=Math.round(100*clamp(.6*shared+.15*early+(upgrades?.35:pair?.18:0)));
    // Preserve useful 2-stars as transition pieces, but do not recommend buying more copies
    // toward a 3-star until a comp is selected. This avoids filling the bench pre-commit.
    const score=twoStar?Math.max(priority,60):priority;
    if(score<35)continue;
    const reason=upgrades?`再留 ${3-owned} 张可升二星`:owned===2?'对子，优先等第三张':twoStar?'二星过渡，保留战力':supporting.length>=2?`${supporting.length} 条方向共用`:pair?'可组成对子':'可接当前过渡';
    const quantity=twoStar?0:upgrades?Math.min(shopSlots.length,3-owned):shopSlots.length?owned===0&&shopSlots.length>=2&&shared>=.5?2:1:0;
    cards.push({id,owned,shopSlots,quantity,priority:score,reason,routes:supporting.map(({r})=>r.units.map(id=>dataset.characterById(id)?.display_name).join(' / '))});
  }
  cards.sort((a,b)=>b.priority-a.priority || Number(b.quantity>0)-Number(a.quantity>0) || a.id.localeCompare(b.id));
  return {ready:true,cards:cards.slice(0,8),directions:[],boards:routes.slice(0,3),stage,stageEstimated};
}

export function createCompAdvisor(comps:MetatftComp[]) {
  let previousTop:string|undefined,lastKey='',lobby='',last:{result:AdvisorResult;holds:EarlyHoldAdvice}|undefined;
  return {evaluate(status:ReaderStatus|null,manualItems:string[]=[],now=Date.now(),stage?:number|null,boardId?:string|null){
    const nextLobby=status?.tracker?.snapshot?.players.map(p=>p.name).sort().join('|')??'';
    if(lobby!==nextLobby){lobby=nextLobby;previousTop=undefined;last=undefined;}
    const input=advisorInput(status,manualItems,now);
    const shop=status?.cards.shop??[];
    const key=JSON.stringify([input,shop.map(c=>c?.id),stage,boardId]);
    if(last && lastKey===key)return last;
    const raw=recommendComps(input,comps);
    const holds=earlyHoldAdvice(raw,shop,stage,undefined,boardId);
    const result=previousTop?recommendComps(input,comps,previousTop):raw;
    previousTop=result.rows[0]?.key;lastKey=key;last={result,holds};return last;
  }};
}
