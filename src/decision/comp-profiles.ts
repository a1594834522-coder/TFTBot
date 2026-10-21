import {normalizeShopHero} from '../game/shop-mechanics';
export type StrategyRegime='reroll'|'four-cost'|'legendary';
export interface UnitRole {cost:number;role:string;tags:string[];traits:string[];shop?:boolean}
/** Provider roleTags sometimes contain only Role.Magic.Marksman. Derive its
 * documented parents, rather than treating a known AP unit as unknown/hybrid. */
export function normalizeRoleTags(raw:string[]):string[]{
  const result=new Set(raw);
  for(const tag of raw){if(!tag.startsWith('Role.'))continue;const parts=tag.split('.');
    for(const parent of ['Magic','Attack','Tank','Marksman','Caster','Fighter','Assassin','Specialist','Manaless'])if(parts.includes(parent))result.add('Role.'+parent);
  }
  return [...result];
}
export interface ProfileUnit {id:string;count:number;avg:number|null;tiers:Array<{star:number;count:number;avg:number|null}>;threeItems:number}
export interface ProfileBoard {level:number;units:string[];poolUnits:string[];count:number;avg:number|null}
export interface ProfileEarly extends ProfileBoard {battleWinRate:number|null}
export interface ProfileBuild {unit:string;items:string[];count:number;avg:number|null}
export interface CompProfile {
  key:string;name:string;count:number;avg:number;
  namedUnits?:string[];
  units:ProfileUnit[];boards:ProfileBoard[];early:ProfileEarly[];builds:ProfileBuild[];
  rolling:Array<{level:number;average:number;matches:number}>;
  finalLevels:Array<{level:number;count:number;avg:number|null}>;
  regime:{primary:StrategyRegime;alternatives:StrategyRegime[];rollLevel:number;carry:string;tank:string|null;carryStar:number;evidence:string[]};
}
const positive=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const average=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=1&&n<=8?n:null;
const array=(n:unknown):any[]=>Array.isArray(n)?n:[];
const ids=(raw:unknown)=>typeof raw==='string'?[...new Set(raw.split('&').map(normalizeShopHero))]:[];
const modalStar=(u:ProfileUnit)=>[...u.tiers].sort((a,b)=>b.count-a.count||a.star-b.star)[0]?.star??1;

/** Keep all aggregate variants returned by the API. A board observation is not
 * automatically a unique game; early row counts can exceed a comp's player count. */
export function parseCompProfile(key:string,name:string,raw:any,roles:Record<string,UnitRole>,namedUnits:string[]=[]):CompProfile{
  const r=raw?.results;
  if(raw?.tft_set!=='TFTSet18'||Number(raw?.queue_id)!==1100||!r||!positive(r.overall?.count)||average(r.overall?.avg)===null)throw new Error('Unsupported comp profile scope');
  const identity=/^metatft:(\d+):(\d+)$/.exec(key);
  if(identity&&(Number(raw.cluster_id)!==Number(identity[1])||String(r.cluster)!==identity[2]))throw new Error('Comp profile cluster identity differs from its name');
  const units:ProfileUnit[]=array(r.unit_stats).flatMap(u=>{
    const id=normalizeShopHero(String(u.unit??''));if(!roles[id]||!positive(u.count))return [];
    return [{id,count:u.count,avg:average(u.avg),tiers:array(u.tiers).filter(t=>Number.isInteger(t.tier)&&t.tier>=1&&t.tier<=4&&positive(t.count)).map(t=>({star:t.tier,count:t.count,avg:average(t.avg)})),threeItems:array(u.num_items).find(n=>n.num_items===3&&positive(n.count))?.count??0}];
  });
  function boards(source:unknown):ProfileBoard[]{
    return Object.entries(source??{}).flatMap(([level,rows])=>array(rows).flatMap(row=>{
      const units=ids(row.units_list??row.unit_list);
      if(!Number.isInteger(Number(level))||!units.length||units.some(id=>!roles[id])||!positive(row.count))return [];
      return [{level:Number(level),units,poolUnits:units.filter(id=>roles[id].shop!==false),count:row.count,avg:average(row.avg)}];
    }));
  }
  const early=boards(r.early_options).map(board=>{
    const original=array(r.early_options[String(board.level)]).find(row=>ids(row.unit_list??row.units_list).join('|')===board.units.join('|'));
    return {...board,battleWinRate:typeof original?.win==='number'&&original.win>=0&&original.win<=1?original.win:null};
  });
  const builds:ProfileBuild[]=array(r.builds).flatMap(b=>{
    const unit=normalizeShopHero(String(b.unit??'')),items=array(b.buildName).filter((v):v is string=>typeof v==='string'&&!!v);
    return roles[unit]&&items.length>=1&&items.length<=3&&positive(b.count)?[{unit,items,count:b.count,avg:average(b.avg)}]:[];
  });
  const rolling=Object.entries(r.rerolls??{}).flatMap(([level,v]:[string,any])=>{
    if(!Number.isInteger(Number(level))||Number(level)<3||Number(level)>11||!positive(v?.matches)||typeof v.rerolls!=='number'||!Number.isFinite(v.rerolls)||v.rerolls<0)return [];
    return [{level:Number(level),average:v.rerolls/v.matches,matches:v.matches}];
  }).sort((a,b)=>a.level-b.level);
  const finalLevels=array(r.final_levels).filter(v=>Number.isInteger(Number(v.level))&&positive(v.count)).map(v=>({level:Number(v.level),count:v.count,avg:average(v.avg)}));
  const itemized=[...units].filter(u=>u.threeItems>0&&roles[u.id].shop!==false).sort((a,b)=>b.threeItems-a.threeItems||b.count-a.count);
  // Failed rerolls often finish at two stars. Modal final stars alone would
  // misclassify them as level-8 strategies and would miss a tank reroll carry.
  const commonThree=(u:ProfileUnit)=>roles[u.id].cost<=3&&(u.tiers.find(t=>t.star===3)?.count??0)>=Math.max(30,u.count*.1);
  // Cluster naming is independent evidence of the intended cheap focus. A tank
  // carrying slightly more items must not erase the named Tristana reroll goal.
  // High-cost family names do not override actual legendary carry/level evidence.
  const focal=itemized.find(u=>namedUnits.includes(u.id)&&commonThree(u))??itemized[0];
  const focalReroll=focal&&commonThree(focal);
  const carry=focalReroll?focal:itemized.find(u=>!roles[u.id].tags.includes('Role.Tank'))??itemized[0];
  if(!carry)throw new Error('No itemized carry evidence');
  const tank=itemized.find(u=>u.id!==carry.id&&roles[u.id].tags.includes('Role.Tank'))??null;
  const carryStar=modalStar(carry),cost=roles[carry.id].cost;
  const peak=[...rolling].filter(v=>v.matches>=30&&v.level>=5).sort((a,b)=>b.average-a.average)[0];
  const finalMode=[...finalLevels].sort((a,b)=>b.count-a.count)[0]?.level;
  const reroll=commonThree(carry),legendary=cost===5&&(finalMode!==undefined&&finalMode>=9||peak!==undefined&&peak.level>=9);
  const primary:StrategyRegime=reroll?'reroll':legendary?'legendary':'four-cost';
  const alternatives:StrategyRegime[]=[];
  if(reroll&&(carry.tiers.find(t=>t.star===2)?.count??0)>(carry.tiers.find(t=>t.star===3)?.count??0)/2)alternatives.push('four-cost');
  if(!reroll&&!legendary&&cost<=3&&(carry.tiers.find(t=>t.star===3)?.count??0)>0)alternatives.push('reroll');
  if(!legendary&&itemized.some(u=>roles[u.id].cost===5)&&finalMode!==undefined&&finalMode>=9)alternatives.push('legendary');
  const rollLevel=primary==='reroll'?[...rolling].filter(v=>v.level>=5&&v.level<=7&&v.matches>=30).sort((a,b)=>b.average-a.average)[0]?.level??(cost===1?5:cost===2?6:7):primary==='legendary'?Math.max(9,peak?.level??9):8;
  return {key,name,count:r.overall.count,avg:r.overall.avg,namedUnits,units,boards:boards(r.options),early,builds,rolling,finalLevels,regime:{primary,alternatives:[...new Set(alternatives)],rollLevel,carry:carry.id,tank:tank?.id??null,carryStar,evidence:[`itemized focal cost=${cost}, modal observed star=${carryStar}, three-star observations=${carry.tiers.find(t=>t.star===3)?.count??0}`,`peak observed rerolls=${peak?.level??'unknown'}, modal final level=${finalMode??'unknown'}`,`named cluster focus=${namedUnits.join(',')}`]}};
}
