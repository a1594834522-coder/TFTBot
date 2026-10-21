import {createPoolKernel} from './pool-kernel';
import {pursuitSignature,referencePursuit,type PursuitPolicyInput,type PursuitOffer,type PursuitPurchase,type PursuitPolicy} from './pursuit-policy';

interface Value {lower:number;upper:number;cashLower:number;cashUpper:number;refresh:boolean}
export interface AdaptiveRoot {code:number;cash:number}
export type AdaptivePursuit={cancelled:true}|{cancelled:false;policy:PursuitPolicy;states:number;decisions:number;limited:boolean;bounds:Array<Value>};
const eps=1e-12,integer=(n:number,min=0)=>Number.isSafeInteger(n)&&n>=min;
/** Finite-wallet, observable-shop completion policy. Every affordable purchase
 * subset and stopping are compared. Goal completion is primary; saved cash is
 * only a tie-breaker. This is NOT a combat or final-placement objective.
 * Under a work limit, change the base action only when interval dominance is
 * established; unresolved branches retain the original observable-shop rule. */
export async function adaptivePursuit(input:PursuitPolicyInput,roots:AdaptiveRoot[],options:{kernel?:ReturnType<typeof createPoolKernel>;maxStates?:number;maxDecisions?:number;cancelled?:()=>boolean;yield?:()=>Promise<void>}={}):Promise<AdaptivePursuit>{
  const config=structuredClone(input),kernel=options.kernel??createPoolKernel(config),reference=referencePursuit(config,kernel),{targets}=config;
  if(kernel.signature!==JSON.stringify([config.targets,config.tierRemaining,config.tierOdds]))throw Error('Adaptive kernel does not match this pool');
  const cap=options.maxStates??20000,workCap=options.maxDecisions??2_000_000;
  if(!integer(cap,1)||!integer(workCap,1)||!integer(config.refreshPrice,1)||!integer(config.heroSlots,1)||config.heroSlots>5||config.owned.length!==targets.length||config.owned.some(n=>!integer(n))||!config.goals.length||
    new Set(config.goals.map(g=>g.id)).size!==config.goals.length||config.goals.some(g=>!g.id||!g.targets.length||g.targets.some(id=>!targets.some(t=>t.id===id)))||
    !roots.length||roots.some(r=>!integer(r.code)||r.code>=kernel.size||!integer(r.cash)||r.cash>200||kernel.decode(r.code).some((n,i)=>targets[i].needed-n>targets[i].remaining)))throw Error('Invalid adaptive pursuit input');
  const indices=new Map(targets.map((t,i)=>[t.id,i])),goals=config.goals.map(g=>[...new Set(g.targets)].map(id=>indices.get(id)!));
  const memo=new Map<string,Value>();let states=0,decisions=0,limited=false;
  const terminal=(lower:number,cash:number):Value=>({lower,upper:lower,cashLower:cash,cashUpper:cash,refresh:false});
  function trivial(code:number,cash:number):Value|null{
    const need=kernel.decode(code);if(reference.completed(code).length)return terminal(1,cash);
    const possible=goals.filter(g=>g.every(i=>targets[i].remaining>=targets[i].needed));
    const price=possible.length?Math.min(...possible.map(g=>g.reduce((n,i)=>n+need[i]*targets[i].price,0))):Infinity;
    return cash<config.refreshPrice+price?terminal(0,cash):null;
  }
  const unknown=(cash:number):Value=>({lower:0,upper:1,cashLower:0,cashUpper:cash,refresh:true});
  const lookup=(code:number,cash:number)=>trivial(code,cash)??memo.get(code+':'+cash)??unknown(cash);
  function choices(code:number,cash:number,offers:PursuitOffer[]):PursuitPurchase[]{
    const need=kernel.decode(code),result:PursuitPurchase[]=[],seen=new Set<string>(),selected:string[]=[];
    const referenceChoice=reference.buy(code,cash,offers);result.push(referenceChoice);seen.add(referenceChoice.code+':'+referenceChoice.cash);
    const taken=targets.map(()=>0);
    function select(index:number,next:number,money:number){
      if(index===offers.length){const key=next+':'+money;if(!seen.has(key)){seen.add(key);result.push({code:next,cash:money,bought:[...selected]});}return;}
      select(index+1,next,money);
      const offer=offers[index],i=offer.index;
      if(taken[i]>=need[i]||taken[i]>=targets[i].remaining-(targets[i].needed-need[i])||offer.price>money)return;
      taken[i]++;selected.push(targets[i].id);select(index+1,next-kernel.strides[i],money-offer.price);selected.pop();taken[i]--;
    }
    select(0,code,cash);return result;
  }
  function better(a:Value,b:Value){
    if(a.lower>b.upper+eps)return true;
    return a.upper-a.lower<eps&&b.upper-b.lower<eps&&Math.abs(a.lower-b.lower)<eps&&a.cashLower>b.cashUpper+eps;
  }
  function choose(list:PursuitPurchase[]){
    let best=list[0],value=lookup(best.code,best.cash);
    for(const candidate of list.slice(1)){const next=lookup(candidate.code,candidate.cash);if(better(next,value)){best=candidate;value=next;}}
    return {purchase:best,value};
  }
  function* solve(code:number,cash:number):Generator<void,Value,void>{
    const direct=trivial(code,cash);if(direct)return direct;
    const key=code+':'+cash,hit=memo.get(key);if(hit)return hit;
    if(states>=cap||decisions>=workCap){limited=true;return unknown(cash);}
    states++;if(states%64===0)yield;
    const need=kernel.decode(code),after=cash-config.refreshPrice;let lower=0,upper=0,cashLower=0,cashUpper=0,mass=0;
    for(const draw of kernel.outcomes(code,config.heroSlots)){
      if(decisions>=workCap){limited=true;break;}
      const all=kernel.decode(draw.next),offers=need.flatMap((n,i)=>Array.from({length:n-all[i]},()=>({index:i,price:targets[i].price}))),list=choices(code,after,offers);
      for(const candidate of list){
        if(decisions>=workCap){limited=true;break;}
        decisions++;if(decisions%1024===0)yield;
        yield* solve(candidate.code,candidate.cash);
      }
      const chosen=choose(list).value,p=draw.probability;
      lower+=p*chosen.lower;upper+=p*chosen.upper;cashLower+=p*chosen.cashLower;cashUpper+=p*chosen.cashUpper;mass+=p;
    }
    const remaining=Math.max(0,1-mass);upper+=remaining;cashUpper+=remaining*after;
    const boundedLower=Math.max(0,Math.min(1,lower));
    let result:Value={lower:boundedLower,upper:Math.max(boundedLower,Math.min(1,upper)),cashLower,cashUpper,refresh:true};
    const stop=terminal(0,cash);if(better(stop,result))result=stop;
    memo.set(key,result);return result;
  }
  function* prepare(){for(const root of roots)yield* solve(root.code,root.cash);}
  const runner=prepare();
  while(true){if(options.cancelled?.())return {cancelled:true};const step=runner.next();if(step.done)break;await options.yield?.();}
  if(options.cancelled?.())return {cancelled:true};
  // The prepared table is frozen from this point. A new shop may consult it,
  // but cannot change the continuation values cached by forward enumeration.
  const policy:PursuitPolicy={signature:pursuitSignature(config),refresh:(code,cash)=>lookup(code,cash).refresh,
    buy:(code,cash,offers)=>choose(choices(code,cash,offers)).purchase};
  return {cancelled:false,policy,states,decisions,limited,bounds:roots.map(r=>lookup(r.code,r.cash))};
}
