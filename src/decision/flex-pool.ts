import {createPoolKernel} from './pool-kernel';
export interface FlexCard {id:string;cost:number;remaining:number;price:number;resale:number}
export interface FlexGoal {id:string;units:string[];value?:number}
export interface FlexPoolInput {
  cards:FlexCard[];goals:FlexGoal[];tierRemaining:Record<number,number>;tierOdds:Record<number,number>;
  /** Pool totals include the optional held copies, which the kernel removes per state. */
  held:string[];visible?:string[];cash:number;refreshPrice:number;heroSlotsCycle:number[];
  baselineValue?:number;maxStates?:number;
  /** Optional declared next-phase value after liquidating OTHER optional first
   * copies. This restricts the policy to first-copy flex -> committed pursuit;
   * it does not pretend to solve unrestricted multi-copy flex. */
  continuation?:(goal:FlexGoal,cash:number)=>{value:number;completionProbability:number};
}
export interface FlexPoolResult {
  value:number;completionProbability:number;expectedCashAtExit:number;
  keep:string[];buy:string[];sell:string[];completed:string[];
  next:'core-collected'|'refresh'|'hold';
  states:number;transitions:number;initialWealth:number;
}
type Value={value:number;completion:number;cash:number;refresh:boolean;goal:number|null};
const integer=(n:number,min=0)=>Number.isSafeInteger(n)&&n>=min;
/** Exact first-copy portfolio model. Optional naked 1-star cards must resell at
 * their purchase price. The player manages space. Buying a second copy/merging
 * and pursuing 2-stars belongs to the next, committed phase, not this state space.
 * Sales before a refresh are chosen BEFORE seeing its contents; post-shop choices
 * may adapt to revealed cards. Thus it never chooses a route with future knowledge. */
export function flexPool(input:FlexPoolInput):FlexPoolResult{
  const cards=input.cards,cycle=input.heroSlotsCycle,cap=input.maxStates??100000,baseline=input.baselineValue??0;
  if(!cards.length||cards.length>10||!input.goals.length||new Set(cards.map(c=>c.id)).size!==cards.length||!integer(input.cash)||input.cash>500||!integer(input.refreshPrice,1)||!integer(cap,1)||!cycle.length||cycle.length>4||cycle.some(n=>!integer(n,1)||n>5)||!Number.isFinite(baseline)||baseline<0||baseline>1)throw new Error('Invalid flex portfolio input');
  if(cards.some(c=>!integer(c.price,1)||c.price!==c.resale))throw new Error('Flex liquidity requires refundable first copies');
  const byId=new Map(cards.map((c,i)=>[c.id,i])),full=(1<<cards.length)-1;
  function mask(ids:string[]){let m=0;for(const id of new Set(ids)){const i=byId.get(id);if(i===undefined)throw new Error('Unknown portfolio hero');m|=1<<i;}return m;}
  const held=mask(input.held),visible=mask(input.visible??[]),goals=input.goals.map(g=>{
    const value=g.value??1;if(!g.id||!g.units.length||!Number.isFinite(value)||value<0||value>1)throw new Error('Invalid portfolio goal');
    return {...g,mask:mask(g.units),value};
  });
  if(cards.some((c,i)=>!!(held&(1<<i))&&c.remaining<1))throw new Error('Base pool must include optional held copies');
  if(new Set(goals.map(g=>g.id)).size!==goals.length)throw new Error('Duplicate portfolio goal');
  const kernel=createPoolKernel({targets:cards.map(c=>({...c,needed:1})),tierRemaining:input.tierRemaining,tierOdds:input.tierOdds});
  const costs=Array<number>(full+1).fill(0);for(let m=1;m<=full;m++){const bit=m&-m,index=31-Math.clz32(bit);costs[m]=costs[m^bit]+cards[index].price;}
  const wealth=input.cash+costs[held];
  const subsets=new Map<string,number[]>();
  function feasible(m:number,money:number,maximal=true){
    const key=m+':'+money+':'+Number(maximal),cached=subsets.get(key);if(cached)return cached;
    const result:number[]=[];for(let s=m;;s=(s-1)&m){
      if(costs[s]<=money&&(!maximal||!cards.some((_,i)=>!!(m&(1<<i))&&!(s&(1<<i))&&costs[s]+cards[i].price<=money)))result.push(s);
      if(!s)break;
    }
    subsets.set(key,result);return result;
  }
  const memo=new Map<number,Value>();let states=0;
  const better=(a:Value,b:Value)=>a.value>b.value+1e-12||Math.abs(a.value-b.value)<=1e-12&&a.cash>b.cash+1e-10;
  function value(m:number,money:number,phase:number):Value{
    const key=(m*(wealth+1)+money)*cycle.length+phase,cached=memo.get(key);if(cached)return cached;
    if(++states>cap)throw new Error('Flex state budget exceeded; narrow the declared route portfolio');
    let best:Value={value:baseline,completion:0,cash:money,refresh:false,goal:null};
    goals.forEach((goal,index)=>{if((m&goal.mask)===goal.mask){
      const cash=money-costs[goal.mask],next=input.continuation?.(goal,cash);
      if(next&&(!Number.isFinite(next.value)||next.value<0||next.value>1||!Number.isFinite(next.completionProbability)||next.completionProbability<0||next.completionProbability>1))throw new Error('Invalid continuation value');
      const candidate={value:next?.value??goal.value,completion:next?.completionProbability??1,cash,refresh:false,goal:index};if(better(candidate,best))best=candidate;
    }});
    if(money>=input.refreshPrice&&best.value<1){
      const after=money-input.refreshPrice;
      // Liquidate only after choosing what to retain, then draw from THAT pool.
      for(const kept of feasible(m,after)){
        const outcomes=kernel.outcomes(full^kept,cycle[phase]);let expected=0,completion=0,cash=0;
        for(const draw of outcomes){
          const available=full^draw.next;let chosen:Value|undefined;
          for(const next of feasible(available,after)){
            const candidate=value(next,after,(phase+1)%cycle.length);if(!chosen||better(candidate,chosen))chosen=candidate;
          }
          expected+=draw.probability*chosen!.value;completion+=draw.probability*chosen!.completion;cash+=draw.probability*chosen!.cash;
        }
        const candidate={value:expected,completion,cash,refresh:true,goal:null};if(better(candidate,best))best=candidate;
      }
    }
    memo.set(key,best);return best;
  }
  let best:Value|undefined,chosenMask=held,operations=Infinity;
  // The known shop permits every affordable subset. On equal future value, avoid
  // superfluous current buys/sales even when extra holdings would be harmless.
  for(const m of feasible(held|visible,wealth,false)){
    const result=value(m,wealth,0),count=cards.reduce((n,_,i)=>n+Number(!!((m^held)&(1<<i))),0);
    if(!best||better(result,best)||Math.abs(result.value-best.value)<=1e-12&&Math.abs(result.cash-best.cash)<=1e-10&&count<operations){best=result;chosenMask=m;operations=count;}
  }
  // Terminal cash assumes unrelated optional copies were liquidated. Report
  // that same concrete retention decision, not a contradictory keep list.
  if(best!.goal!==null)chosenMask=goals[best!.goal].mask;
  const ids=(m:number)=>cards.flatMap((c,i)=>m&(1<<i)?[c.id]:[]),completed=goals.filter(g=>(chosenMask&g.mask)===g.mask).map(g=>g.id);
  return {value:best!.value,completionProbability:best!.completion,expectedCashAtExit:best!.cash,keep:ids(chosenMask),buy:ids(chosenMask&~held),sell:ids(held&~chosenMask),completed,next:best!.refresh?'refresh':best!.goal===null?'hold':'core-collected',states,transitions:kernel.transitionCount,initialWealth:wealth};
}
