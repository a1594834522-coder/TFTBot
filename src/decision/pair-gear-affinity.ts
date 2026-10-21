import {gearAffinity,type GearModel,type GearToken,type GearAffinity} from './gear-affinity';
export interface GearAssignment {index:number;unit:string;id:string;transfer:boolean;holder?:string}
export interface PairGearAffinity {
  first:GearAffinity;second:GearAffinity;assignments:GearAssignment[];
  protected:number[];unassigned:number[];ambiguous:number[];
  matchedCompleted:number;matchedComponents:number;knownTokens:number;
  jointCoreLift:number;jointComponentLift:number;
}
interface Node {c0:number;r0:number;c1:number;r1:number;lift:number;choices:Array<[number,0|1]>}
const empty=():GearAffinity=>({componentLift:0,coreItemLift:0,damageComponents:0,supporting:[],known:false,buildWeight:0});
/** Physical two-core compatibility allocation. Existing core items stay bound;
 * retained third heroes keep theirs. Only actual transition holders may donate
 * items in this FUTURE planning scenario (no sale/equip command is generated).
 *
 * A 256-state capacity DP covers as many supported completed items, then loose
 * pieces as possible, and breaks ties by empirical log-frequency lift. Free
 * tokens with no nonnegative fit remain explicit leftovers. Three completed
 * slots / six component-equivalents bound each core; this is a compatibility
 * budget, not a claim that every proposed craft/item stack is a legal build. */
export function pairGearAffinity(model:GearModel,profile:string,first:string,second:string,tokens:GearToken[],retained:string[]=[]):PairGearAffinity{
  if(first===second||tokens.length>128)throw Error('Invalid bounded pair inventory');
  const units=[first,second],protectedHolders=new Set(retained),bound=[[] as number[],[] as number[]],protectedTokens:number[]=[],ambiguous:number[]=[],free:number[]=[];
  const affinities=new Map<string,GearAffinity>();
  const tokenFit=(actor:0|1,id:string)=>{const key=actor+'|'+id;let fit=affinities.get(key);if(!fit){fit=gearAffinity(model,profile,units[actor],[{id}]);affinities.set(key,fit);}return fit;};
  let knownTokens=0;
  tokens.forEach((token,index)=>{
    const actor=token.holder?units.indexOf(token.holder):-1;
    if(actor>=0)bound[actor].push(index);
    else if(token.holder&&protectedHolders.has(token.holder))protectedTokens.push(index);
    else free.push(index);
  });
  // The aggregate holder ID cannot disambiguate multiple equipped copies of a
  // hero. Do not squeeze four+ worn items into one fictitious final entity.
  const blocked=bound.map(indices=>indices.length>3);
  for(let actor=0;actor<2;actor++)if(blocked[actor]){ambiguous.push(...bound[actor]);bound[actor]=[];}
  const initial:Node={c0:0,r0:0,c1:0,r1:0,lift:0,choices:[]};
  const add=(node:Node,actor:0|1,index:number,fit:GearAffinity):Node|null=>{
    const component=tokens[index].id.includes('Component_'),c=actor===0?node.c0:node.c1,r=actor===0?node.r0:node.r1;
    if(c+Number(!component)>3||r+Number(component)>6-2*(c+Number(!component)))return null;
    return {...node,...(actor===0?{c0:c+Number(!component),r0:r+Number(component)}:{c1:c+Number(!component),r1:r+Number(component)}),
      lift:node.lift+fit.componentLift+fit.coreItemLift,choices:[...node.choices,[index,actor]]};
  };
  let start=initial;
  for(let actor=0;actor<2;actor++)for(const index of bound[actor]){
    const fit=tokenFit(actor as 0|1,tokens[index].id);if(fit.known)knownTokens++;
    const next=add(start,actor as 0|1,index,fit);if(!next)throw Error('Bound core inventory exceeds compatibility budget');start=next;
  }
  const key=(n:Node)=>n.c0+':'+n.r0+':'+n.c1+':'+n.r1;
  let layer=new Map<string,Node>([[key(start),start]]);
  free.sort((a,b)=>tokens[a].id.localeCompare(tokens[b].id)||(tokens[a].holder??'').localeCompare(tokens[b].holder??'')||a-b);
  for(const index of free){
    const fits=([0,1] as const).map(actor=>blocked[actor]?empty():tokenFit(actor,tokens[index].id));
    if(fits.some(f=>f.known))knownTokens++;
    const next=new Map(layer);
    for(const node of layer.values())for(const actor of [0,1] as const){
      const fit=fits[actor];if(!fit.known||fit.componentLift+fit.coreItemLift< -1e-10)continue;
      const candidate=add(node,actor,index,fit);if(!candidate)continue;
      const k=key(candidate),old=next.get(k);if(!old||candidate.lift>old.lift+1e-10)next.set(k,candidate);
    }
    layer=next;
  }
  const better=(a:Node,b:Node)=>a.c0+a.c1>b.c0+b.c1||a.c0+a.c1===b.c0+b.c1&&(a.r0+a.r1>b.r0+b.r1||a.r0+a.r1===b.r0+b.r1&&a.lift>b.lift+1e-10);
  let best=start;for(const node of layer.values())if(better(node,best))best=node;
  const assigned=new Set(best.choices.map(([index])=>index)),allBlocked=new Set([...protectedTokens,...ambiguous]);
  const firstTokens=best.choices.filter(([,actor])=>actor===0).map(([index])=>tokens[index]),secondTokens=best.choices.filter(([,actor])=>actor===1).map(([index])=>tokens[index]);
  const a=blocked[0]?empty():gearAffinity(model,profile,first,firstTokens),b=blocked[1]?empty():gearAffinity(model,profile,second,secondTokens);
  const fits=best.choices.map(([index,actor])=>({index,fit:tokenFit(actor,tokens[index].id)}));
  return {first:a,second:b,assignments:best.choices.map(([index,actor])=>({index,id:tokens[index].id,unit:units[actor],transfer:!!tokens[index].holder&&tokens[index].holder!==units[actor],holder:tokens[index].holder})),
    protected:protectedTokens,ambiguous,unassigned:tokens.flatMap((_,index)=>!assigned.has(index)&&!allBlocked.has(index)?[index]:[]),knownTokens,
    matchedCompleted:fits.filter(({index,fit})=>!tokens[index].id.includes('Component_')&&fit.known&&fit.coreItemLift>=-1e-10).length,
    matchedComponents:fits.filter(({index,fit})=>tokens[index].id.includes('Component_')&&fit.known&&fit.componentLift>=-1e-10).length,
    jointCoreLift:a.coreItemLift+b.coreItemLift,jointComponentLift:a.componentLift+b.componentLift};
}
