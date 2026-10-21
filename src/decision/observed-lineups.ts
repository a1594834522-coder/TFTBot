import type {BattleUnit} from '../game/battle-model-encoding';
import type {ShopState,OwnedUnit} from './shop-ledger';
import type {DirectionAdvice} from './direction-advisor';
import {materializeLineup,type LineupCandidate} from './lineup-search';

export interface ObservedLineupTemplate {
  id:string;units:string[];priorityIds?:string[];source:'metatft-early'|'metatft-core'|'metatft-late';
}
export interface ObservedLineupOptions {
  templates:ObservedLineupTemplate[];maxSwaps?:number;maxTemplates?:number;
  maxPerTemplate?:number;maxExaminedPerTemplate?:number;
}
export interface ObservedLineups {
  candidates:LineupCandidate[];templates:number;templateIds:string[];examined:number;limited:boolean;maxSwaps:number;
}

/** These are actual aggregate boards already used by the direction adviser,
 * never unions of mutually exclusive variants. Early play uses its observed
 * transition rather than projecting a terminal roster onto a level-four board. */
export function tacticalLineupTemplates(advice:DirectionAdvice|undefined,level:number):ObservedLineupTemplate[]{
  if(!advice?.ready||advice.updating)return [];
  const templates:ObservedLineupTemplate[]=[],seen=new Set<string>();
  const add=(id:string,units:string[]|undefined,source:ObservedLineupTemplate['source'],priorityIds:string[])=>{
    if(!units?.length)return;
    const normalized=[...new Set(units)].sort(),key=normalized.join('|');
    if(seen.has(key)||normalized.length<3||normalized.length>12)return;
    seen.add(key);templates.push({id,units:normalized,priorityIds:[...priorityIds],source});
  };
  for(const row of advice.rows){
    if(level<=7)add(row.id+':early',row.early?.units,'metatft-early',[row.carry,row.tank]);
    if(level>=7)add(row.id+':core',row.units,'metatft-core',[row.carry,row.tank]);
  }
  if(level>=8){
    const main=advice.mode==='selected'?advice.rows.find(r=>r.id===advice.focusId):null;
    for(const [index,board]of (main?.lateBoards??[]).entries())add(main!.id+':late:'+index,board.poolUnits,'metatft-late',[main!.carry,main!.tank]);
  }
  return templates;
}

/** Extend the exact two-swap neighborhood with three/four-unit mixed boards.
 * New entities must occur together in a real observed template, but retained
 * workers need not. No template is forced wholesale: three-unit partial entry
 * is still explored when all four target bench heroes are available.
 * Each replacement count and each template has its own candidate allowance.
 * Template membership, core identity and physical stars only order exploration;
 * the combat model ranks the resulting actual boards. This is a bounded proposal
 * search, not a full four-swap optimizer, and worn equipment never moves. */
export function observedLineups(state:ShopState,augments:string[],options:ObservedLineupOptions,charms:string[]=[],auxiliary:BattleUnit[]=[]):ObservedLineups{
  const maxSwaps=options.maxSwaps??4,maxTemplates=options.maxTemplates??8,maxPerTemplate=options.maxPerTemplate??96,maxExamined=options.maxExaminedPerTemplate??512;
  if(!Number.isInteger(maxSwaps)||maxSwaps<3||maxSwaps>4||![maxTemplates,maxPerTemplate,maxExamined].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096))throw Error('Invalid observed lineup bound');
  const current=state.units.filter(u=>u.area==='board'),size=Math.min(state.boardCapacity,state.units.length),vacancies=size-current.length;
  const output=new Map<string,LineupCandidate>(),templateIds:string[]=[];let examined=0,limited=false;
  const seen=new Set<string>(),usable:ObservedLineupTemplate[]=[];
  for(const template of options.templates){
    if(!template.id||template.units.length<3||template.units.length>12||new Set(template.units).size!==template.units.length||template.units.some(id=>typeof id!=='string'||!id))continue;
    const key=[...template.units].sort().join('|');if(seen.has(key))continue;seen.add(key);usable.push(template);
  }
  if(usable.length>maxTemplates)limited=true;
  function choose<T>(items:T[],count:number,visit:(picked:T[])=>void,stopped:()=>boolean){
    const picked:T[]=[];
    function next(start:number){
      if(stopped())return;
      if(picked.length===count){visit([...picked]);return;}
      for(let i=start;i<=items.length-(count-picked.length)&&!stopped();i++){picked.push(items[i]);next(i+1);picked.pop();}
    }
    if(count>=0&&count<=items.length)next(0);
  }
  for(const template of usable.slice(0,maxTemplates)){
    const wanted=new Set(template.units),priority=new Set(template.priorityIds??[]);
    const groups=[...wanted].sort().map(id=>state.units.filter(u=>u.area==='bench'&&u.id===id&&u.equipmentKnown!==false).sort((a,b)=>b.star-a.star||b.items.length-a.items.length||a.key.localeCompare(b.key))).filter(g=>g.length);
    groups.sort((a,b)=>Number(priority.has(b[0].id))-Number(priority.has(a[0].id))||b[0].star-a[0].star||b[0].items.length-a[0].items.length||a[0].id.localeCompare(b[0].id));
    const levels=[4,3].filter(n=>n<=maxSwaps&&n<=current.length&&n+vacancies<=groups.length);
    if(!levels.length)continue;
    templateIds.push(template.id);let visited=0;
    const fillers=[...current].sort((a,b)=>Number(wanted.has(b.id))-Number(wanted.has(a.id))||b.star-a.star||b.items.length-a.items.length||a.key.localeCompare(b.key));
    for(const [levelIndex,removed]of levels.entries()){
      const quota=Math.floor(maxPerTemplate/levels.length)+(levelIndex<maxPerTemplate%levels.length?1:0);
      if(!quota){limited=true;continue;}
      let emitted=0,stopped=false;
      const stop=()=>stopped;
      choose(groups,removed+vacancies,selectedGroups=>{
        const picked:OwnedUnit[]=[];
        function entities(index:number){
          if(stop())return;
          if(index<selectedGroups.length){for(const unit of selectedGroups[index]){if(stop())break;picked.push(unit);entities(index+1);picked.pop();}return;}
          choose(fillers,current.length-removed,fill=>{
            if(visited>=maxExamined||emitted>=quota){limited=true;stopped=true;return;}
            visited++;examined++;emitted++;
            const candidate=materializeLineup(state,[...picked,...fill],augments,charms,auxiliary),existing=output.get(candidate.key);
            if(existing){if(!existing.observedSources!.includes(template.id))existing.observedSources!.push(template.id);return;}
            candidate.observedSources=[template.id];output.set(candidate.key,candidate);
          },stop);
        }
        entities(0);
      },stop);
      if(visited>=maxExamined){limited=true;break;}
    }
  }
  return {candidates:[...output.values()],templates:templateIds.length,templateIds,examined,limited,maxSwaps};
}
