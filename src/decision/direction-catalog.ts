import type {CompProfile,StrategyRegime,UnitRole,ProfileBoard,ProfileEarly,ProfileUnit} from './comp-profiles';
export interface AugmentFact {
  id:string;traits:string[];incompatible:string[];tags:string[];manual:string[];rounds:string[];
  description:string;curves:Record<string,Array<[number,number]>>;
  reroll:boolean;scalingXp:boolean;grant:{cost:number;star:number;trigger:'instant'|'next-purchase'}|null;
  focusCosts:number[];offense:'physical'|'magic'|null;moveLocked:boolean;
}
export interface CorePair {id:string;profile:string;carry:string;tank:string;carryStar:number;tankStar:number;regime:StrategyRegime;support:number;templates:ProfileBoard[];lateTemplates?:ProfileBoard[]}
export interface DirectionProfile {key:string;name:string;count:number;avg:number;regime:CompProfile['regime'];early:ProfileEarly[];units:ProfileUnit[];pairs:CorePair[]}
export interface DirectionCatalog {profiles:DirectionProfile[];roles:Record<string,UnitRole>;augments:Record<string,AugmentFact>;traitThresholds:Record<string,number>}
const mode=(u:ProfileUnit)=>[...u.tiers].sort((a,b)=>b.count-a.count||a.star-b.star)[0]?.star??1;

/** Candidate generation from ACTUAL aggregate board variants. Carries and tanks
 * are paired only when observed together, never cross-joined across unrelated boards. */
export function compileDirectionProfiles(profiles:CompProfile[],roles:Record<string,UnitRole>):DirectionProfile[]{
  return profiles.map(profile=>{
    const eligible=profile.units.filter(u=>roles[u.id]?.shop!==false&&u.threeItems>=Math.max(30,profile.count*.1)).sort((a,b)=>b.threeItems-a.threeItems);
    const damage=eligible.filter(u=>!roles[u.id].tags.includes('Role.Tank'));
    // A secondary Azir in an observed level-8 board is not a new Azir reroll
    // family; a late Elder Dragon in a Gromp reroll board is not an 84 carry.
    // Family structure and its actual modal stars determine the search phase.
    const focal=eligible.find(u=>u.id===profile.regime.carry),tankFocal=profile.regime.primary==='reroll'&&focal&&roles[focal.id].tags.includes('Role.Tank');
    const carries=tankFocal?[focal!]:damage.filter(u=>profile.regime.primary==='reroll'?roles[u.id].cost<=3&&(u.id===profile.regime.carry||mode(u)>=3):
      profile.regime.primary==='legendary'?roles[u.id].cost===5:roles[u.id].cost===4).slice(0,3);
    const tanks=(tankFocal?damage:eligible.filter(u=>roles[u.id].tags.includes('Role.Tank'))).slice(0,3);
    const pairs:CorePair[]=[];
    for(const carry of carries)for(const tank of tanks){
      const boards=profile.boards.filter(b=>b.poolUnits.includes(carry.id)&&b.poolUnits.includes(tank.id)&&b.count>0);
      // Support belongs to the observed PAIR, not one exact eight-unit variant.
      if(boards.reduce((sum,b)=>sum+b.count,0)<30)continue;
      const carryStar=mode(carry),tankStar=mode(tank),regime=profile.regime.primary;
      const targetLevel=regime==='reroll'?profile.regime.rollLevel:regime==='legendary'?9:8;
      const late=new Map<string,ProfileBoard>();
      for(const board of [...boards].filter(b=>b.level>=9&&b.poolUnits.length>=8&&b.poolUnits.length<=b.level&&b.count>=30).sort((a,b)=>b.count-a.count)){
        const key=board.level+':'+board.poolUnits.slice().sort().join('|');if(!late.has(key))late.set(key,board);
      }
      pairs.push({id:profile.key+'|'+carry.id+'|'+tank.id,profile:profile.key,carry:carry.id,tank:tank.id,carryStar,tankStar,regime,support:boards.reduce((sum,b)=>sum+b.count,0),templates:[...boards].sort((a,b)=>Math.abs(a.level-targetLevel)-Math.abs(b.level-targetLevel)||b.count-a.count).slice(0,3),lateTemplates:[...late.values()].slice(0,3)});
    }
    return {key:profile.key,name:profile.name,count:profile.count,avg:profile.avg,regime:profile.regime,early:profile.early,units:profile.units,pairs};
  });
}
export function compileAugmentFact(raw:any):AugmentFact{
  const curves=raw.curveTable??{},constant=(key:string)=>Array.isArray(curves[key])&&curves[key].length===1&&curves[key][0][0]===1?curves[key][0][1]:undefined;
  const cost=constant('UnitCost')??constant('CostChamps'),star=constant('ActorLevel');
  const tags=Array.isArray(raw.tags)?raw.tags:[],description:string=typeof raw.desc==='string'?raw.desc:'';
  const rendered=description.replace(/<TFTCurveTable\b[^>]*\brow="([^"]+)"[^>]*\/>/gi,(_,key)=>String(constant(key)??'?'));
  const focusCosts=[...new Set([...rendered.matchAll(/([1-5](?:\s*(?:and|,)\s*[1-5])*)-cost champions/gi)].flatMap(m=>[...m[1].matchAll(/[1-5]/g)].map(n=>Number(n[0]))))];
  const global=/Your (?:team|champions|allies)/i.test(description),ad=/Attack Damage/i.test(description),ap=/Ability Power/i.test(description);
  return {id:raw.apiName,traits:raw.associatedTraits??[],incompatible:raw.incompatibleTraits??[],tags,manual:raw.manual_tags??[],rounds:raw.rounds??[],description,curves,
    reroll:tags.includes('Augment.Category.Reroll')||/lesser champion duplicator|free Shop reroll/i.test(description),
    scalingXp:constant('AdditionalXP')>0||/XP (?:after|at the start of) (?:every|player combat)/i.test(description)||['DA_ClearMind','DA_ClutteredMind','DA_UpwardMobility','DA_GoingLong','DA_LateGameScaling'].includes(raw.apiName),
    grant:Number.isInteger(cost)&&cost>0&&cost<=5&&Number.isInteger(star)&&star>=2&&star<=4?{cost,star,trigger:/^The next /i.test(description)?'next-purchase':'instant'}:null,
    focusCosts,offense:global&&ad&&!ap?'physical':global&&ap&&!ad?'magic':null,moveLocked:/cannot be benched or sold/i.test(description)};
}
