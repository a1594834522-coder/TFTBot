import type {CompProfile,UnitRole} from './comp-profiles';
import type {Item} from '../game/tft-data';
export interface GearToken {id:string;holder?:string}
export interface GearDistribution {profile:string;unit:string;components:Record<string,number>;items:Record<string,number>;componentMass:number;itemMass:number;buildWeight:number;orientation:'physical'|'magic'|'hybrid'|'frontline'|'frontline-carry'}
export interface GearModel {models:GearDistribution[];backgroundComponents:Record<string,number>;backgroundItems:Record<string,number>;recipes:Record<string,string[]>;damageItems:string[]}
export interface GearAffinity {componentLift:number;coreItemLift:number;damageComponents:number;supporting:string[];known:boolean;buildWeight:number}
const modelIndices=new WeakMap<GearModel,Map<string,GearDistribution>>();
function distributionFor(model:GearModel,profile:string,unit:string){
  let index=modelIndices.get(model);if(!index){index=new Map(model.models.map(m=>[m.profile+'|'+m.unit,m]));modelIndices.set(model,index);}
  return index.get(profile+'|'+unit);
}
function expand(id:string,recipes:Record<string,string[]>,seen=new Set<string>()):string[]{
  if(id.includes('Component_'))return [id];
  if(seen.has(id))return [];const next=new Set(seen).add(id),parts=recipes[id]??[];
  return parts.length===2?parts.flatMap(p=>expand(p,recipes,next)):[];
}
/** Empirical compatibility, not a calibrated outcome model. Completed 3-item
 * observations teach component and core-item frequencies without demanding a
 * literal three-item match. Every physical token is read once. */
export function buildGearModel(profiles:CompProfile[],items:Item[],roles:Record<string,UnitRole>):GearModel{
  const recipes=Object.fromEntries(items.map(i=>[i.item_id,i.builds_from])),models:GearDistribution[]=[];
  const usage=new Map<string,{damage:number;tank:number}>();
  for(const profile of profiles)for(const unit of profile.units){
    if(!roles[unit.id]||roles[unit.id].shop===false)continue;
    const rows=profile.builds.filter(b=>b.unit===unit.id&&b.items.length===3),dedup=new Map<string,typeof rows[number]>();
    for(const row of rows){const key=[...row.items].sort().join('|');if((dedup.get(key)?.count??0)<row.count)dedup.set(key,row);}
    if(!dedup.size)continue;
    const components:Record<string,number>={},itemWeights:Record<string,number>={};let buildWeight=0;
    const tags=roles[unit.id].tags,tank=tags.includes('Role.Tank');
    for(const row of dedup.values()){
      buildWeight+=row.count;
      for(const id of row.items){
        itemWeights[id]=(itemWeights[id]??0)+row.count;
        const use=usage.get(id)??{damage:0,tank:0};use[tank?'tank':'damage']+=row.count;usage.set(id,use);
        for(const component of expand(id,recipes))components[component]=(components[component]??0)+row.count;
      }
    }
    const tankCarry=tank&&profile.regime?.primary==='reroll'&&profile.regime.carry===unit.id;
    models.push({profile:profile.key,unit:unit.id,components,items:itemWeights,componentMass:Object.values(components).reduce((n,v)=>n+v,0),itemMass:Object.values(itemWeights).reduce((n,v)=>n+v,0),buildWeight,orientation:tankCarry?'frontline-carry':tank?'frontline':tags.includes('Role.Magic')&&!tags.includes('Role.Attack')?'magic':tags.includes('Role.Attack')&&!tags.includes('Role.Magic')?'physical':'hybrid'});
  }
  // Each hero contributes equally to the reference distribution. A popular comp
  // must not turn its own gear into the definition of universal compatibility.
  function background(field:'components'|'items',mass:'componentMass'|'itemMass'){
    const heroes=new Map<string,GearDistribution[]>();for(const m of models)heroes.set(m.unit,[...heroes.get(m.unit)??[],m]);
    const sums:Record<string,number>={};let n=0;
    for(const group of heroes.values()){
      const valid=group.filter(m=>m[mass]>0);if(!valid.length)continue;n++;
      for(const m of valid)for(const [id,count]of Object.entries(m[field]))sums[id]=(sums[id]??0)+count/m[mass]/valid.length;
    }
    return Object.fromEntries(Object.entries(sums).map(([id,p])=>[id,p/n]));
  }
  return {models,backgroundComponents:background('components','componentMass'),backgroundItems:background('items','itemMass'),recipes,damageItems:[...usage].filter(([,v])=>v.damage>=v.tank).map(([id])=>id)};
}
export function gearAffinity(model:GearModel,profile:string,unit:string,tokens:GearToken[],protectedHolders:string[]=[]):GearAffinity{
  const distribution=distributionFor(model,profile,unit),supporting:string[]=[];
  if(!distribution)return {componentLift:0,coreItemLift:0,damageComponents:0,supporting,known:false,buildWeight:0};
  let componentLift=0,coreItemLift=0,count=0,itemEvidence=0;
  const protectedIds=new Set(protectedHolders);
  for(const token of tokens){
    if(token.holder&&token.holder!==unit&&protectedIds.has(token.holder))continue;
    // Only LOOSE components inform component allocation. A finished item is not
    // dismantled into spendable parts, nor counted twice as item + components.
    for(const component of token.id.includes('Component_')?[token.id]:[]){
      const background=model.backgroundComponents[component];if(!background)continue;
      // One ordinary 3-item observation (six components) is the explicit prior mass.
      const p=((distribution.components[component]??0)+6*background)/(distribution.componentMass+6);
      componentLift+=Math.log(p/background);count++;
    }
    if(token.id.includes('Component_'))continue;
    const background=model.backgroundItems[token.id];if(!background)continue;
    itemEvidence++;
    const p=((distribution.items[token.id]??0)+3*background)/(distribution.itemMass+3),lift=Math.log(p/background);
    coreItemLift+=lift;if(lift>0)supporting.push(token.id);
  }
  return {componentLift,coreItemLift,damageComponents:count,supporting:[...new Set(supporting)],known:count>0||itemEvidence>0,buildWeight:distribution.buildWeight};
}
export function gearOrientation(tokens:GearToken[],model:Pick<GearModel,'recipes'>&Partial<Pick<GearModel,'models'|'backgroundItems'>>):'physical'|'magic'|'flex'{
  let swords=0,rods=0;
  for(const token of tokens){
    const background=model.backgroundItems?.[token.id],families=new Set<string>();
    if(background)for(const distribution of model.models??[])if((distribution.items[token.id]??0)>0&&((distribution.items[token.id]??0)+3*background)/(distribution.itemMass+3)>=background-1e-12)families.add(distribution.orientation);
    if(!token.id.includes('Component_')){
      if(families.has('physical')&&!families.has('magic'))swords++;
      if(families.has('magic')&&!families.has('physical'))rods++;
      continue;
    }
    if(token.id==='DA_Component_BFSword')swords++;if(token.id==='DA_Component_NeedlesslyLargeRod')rods++;
  }
  return swords>rods?'physical':rods>swords?'magic':'flex';
}
