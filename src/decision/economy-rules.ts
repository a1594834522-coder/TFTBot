import file from '../../data/decision-economy-rules.json';
import type {TradingRules} from './shop-ledger';
export interface EconomyReference {
  version:string;provisional:boolean;goldPerBuy:number;xpPerBuy:number;maxLevel:number;xpRequired:Record<number,number>;
  modifiers:Record<string,{extraXpPerBuy?:number;xpBuyDiscount?:number;freeShopsOnLevel?:number;healthOnLevel?:number;interestDisabled?:boolean;interestCapBonus?:number}>;
}
export interface EconomyRules {
  version:string;provisional:boolean;goldPerBuy:number;xpPerBuy:number;maxLevel:number;
  xpRequired:Record<number,number>;freeShopsOnLevel:number;healthOnLevel:number;
  trading:TradingRules;gaps:string[];
}
export const economyReference=file as EconomyReference;
/** Instant gold/XP grants are already present in the native state, never applied twice. */
export function resolveEconomyRules(base:TradingRules,augments:string[],complete:boolean,reference:EconomyReference=economyReference):EconomyRules{
  let goldPerBuy=reference.goldPerBuy,xpPerBuy=reference.xpPerBuy,freeShopsOnLevel=0,healthOnLevel=0,interestCap=base.interestCap,disabled=false;
  const ids=[...new Set(augments)].sort();
  for(const id of ids){const m=reference.modifiers[id];if(!m)continue;
    goldPerBuy-=m.xpBuyDiscount??0;xpPerBuy+=m.extraXpPerBuy??0;freeShopsOnLevel+=m.freeShopsOnLevel??0;healthOnLevel+=m.healthOnLevel??0;interestCap+=m.interestCapBonus??0;disabled||=m.interestDisabled??false;
  }
  if(!Number.isSafeInteger(goldPerBuy)||goldPerBuy<1||!Number.isSafeInteger(xpPerBuy)||xpPerBuy<1)throw new Error('Unsupported XP purchase rules');
  const version=reference.version+':'+ids.filter(id=>reference.modifiers[id]).join(',');
  return {version,provisional:reference.provisional||base.provisional,goldPerBuy,xpPerBuy,maxLevel:reference.maxLevel,xpRequired:reference.xpRequired,freeShopsOnLevel,healthOnLevel,trading:{...base,version:base.version+'|'+version,interestCap:disabled?0:interestCap},gaps:complete?[]:['已选海克斯未齐，经验与利息按已知规则参考']};
}
export interface LevelStep {from:number;to:number;cost:number;buys:number;xpAfter:number;freeShops:number;health:number}
/** Collapse partial XP buys until the next reachable level. Native current threshold
 * overrides the table; a mismatch disables extrapolation beyond that first level. */
export function levelSteps(level:number,xp:number|null|undefined,xpMax:number|null|undefined,rules:EconomyRules):{steps:LevelStep[];gaps:string[]}{
  if(!Number.isSafeInteger(level)||level<1||level>=rules.maxLevel)return {steps:[],gaps:[]};
  if(!Number.isSafeInteger(xp)||!Number.isSafeInteger(xpMax)||xp!<0||xpMax!<=0||xp!>=xpMax!)return {steps:[],gaps:['等待当前经验进度']};
  const mismatch=rules.xpRequired[level]!==xpMax,steps:LevelStep[]=[];let current=level,progress=xp!,threshold=xpMax!;
  while(current<rules.maxLevel){
    const from=current,buys=Math.ceil((threshold-progress)/rules.xpPerBuy);progress+=buys*rules.xpPerBuy;
    do{progress-=threshold;current++;threshold=rules.xpRequired[current]??0;}while(current<rules.maxLevel&&threshold>0&&progress>=threshold&&!mismatch);
    steps.push({from,to:current,cost:buys*rules.goldPerBuy,buys,xpAfter:progress,freeShops:(current-from)*rules.freeShopsOnLevel,health:(current-from)*rules.healthOnLevel});
    if(mismatch||!Number.isSafeInteger(threshold)||threshold<=0)break;
  }
  return {steps,gaps:mismatch?['当前经验阈值不同于参考表，仅比较下一次升级']:[]};
}
