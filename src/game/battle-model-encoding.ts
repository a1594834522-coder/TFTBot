/** MetaTFT's shipped calculate_winrate encoder, expressed as pure numeric features.
 * Slots, .333 item scaling, unique-unit traits and empty tier/cost sentinels follow
 * WinRateModelImproved_BoardStrengthEA. No inference or browser dependency here. */
export interface BattleUnit {id:string;star:number;items:string[]}
export interface BattleBoard {units:BattleUnit[];augments:string[];charms?:string[]}
export interface BattleLookups {
  max_num_units:number;unit_len:number;role_len:number;item_len:number;trait_len:number;charm_len:number;augment_len:number;
  unit_encodings:Record<string,number>;unit_role_lookup:Record<string,number>;unit_costs:Record<string,number>;
  item_encodings:Record<string,number>;unit_traits:Record<string,string[]>;emblems:Record<string,string>;
  trait_mapping:Record<string,{encoding:number}>;augment_lookup:Record<string,{rarity?:string;manual_tags?:string[]}>;
  augment_traits:Record<string,string[]>;augment_tag_encodings:Record<string,number>;rarity_values:Record<string,number>;max_rarity_value:number;
  charm_encodings:Record<string,number>;board_strength_parameters?:{m:number;c:number};
}
export interface EncodedBattleBoard {inputs:Record<string,number[]>;unknown:string[];traitCounts:Record<string,number>}
function oneHot(index:number|undefined,length:number,value=1):number[]{
  const out=Array<number>(length).fill(0);
  if(index!==undefined&&Number.isInteger(index)&&index>=0&&index<length)out[index]=value;
  return out;
}
export function encodeBattleBoard(board:BattleBoard,lookup:BattleLookups,prefix:'player'|'opponent'):EncodedBattleBoard {
  if(!Array.isArray(board.units)||!Array.isArray(board.augments)||board.units.length>lookup.max_num_units)throw new Error('Invalid board or model unit capacity exceeded');
  const inputs:Record<string,number[]>={},unknown:string[]=[],traitCounts:Record<string,number>={},uniqueTraits=new Set<string>();
  const addTrait=(unit:string,trait:string)=>{const key=unit+'|'+trait;if(!uniqueTraits.has(key)){uniqueTraits.add(key);traitCounts[trait]=(traitCounts[trait]??0)+1;}};
  const augments=Array<number>(lookup.augment_len).fill(0);
  for(const id of board.augments){
    const a=lookup.augment_lookup[id];
    if(!a){unknown.push('augment:'+id);continue;}
    const tags=a.manual_tags??[],rarity=lookup.rarity_values[a.rarity??'Silver']??1;
    for(const tag of tags){const index=lookup.augment_tag_encodings[tag]??lookup.augment_tag_encodings.TagUnknown;if(index!==undefined&&index<augments.length)augments[index]=Math.min(1,augments[index]+rarity/tags.length/lookup.max_rarity_value);}
    // In the live-board encoder augment-provided traits are additive.
    for(const trait of lookup.augment_traits[id]??[])traitCounts[trait]=(traitCounts[trait]??0)+1;
  }
  for(let slot=0;slot<lookup.max_num_units;slot++){
    const unit=board.units[slot],base=`${prefix}_unit_${slot}_`;
    if(!unit){inputs[base+'unit']=oneHot(undefined,lookup.unit_len);inputs[base+'role']=oneHot(undefined,lookup.role_len);inputs[base+'tier']=[-1];inputs[base+'cost']=[-1];inputs[base+'items']=oneHot(undefined,lookup.item_len);continue;}
    if(!Number.isInteger(unit.star)||unit.star<1||unit.star>4||unit.items.length>3)throw new Error('Invalid star/item count');
    const encoding=lookup.unit_encodings[unit.id];
    if(encoding===undefined)unknown.push('unit:'+unit.id);
    inputs[base+'unit']=oneHot(encoding,lookup.unit_len);
    inputs[base+'role']=oneHot(lookup.unit_role_lookup[unit.id],lookup.role_len);
    inputs[base+'tier']=[unit.star/4];
    const cost=lookup.unit_costs[unit.id];inputs[base+'cost']=[cost!==undefined&&cost<=5?cost/5:0];
    const items=Array<number>(lookup.item_len).fill(0);
    for(const item of unit.items){
      const i=lookup.item_encodings[item];if(i===undefined)unknown.push('item:'+item);else items[i]+=.333;
      const trait=lookup.emblems[item];if(trait)addTrait(unit.id,trait);
    }
    inputs[base+'items']=items;
    for(const trait of lookup.unit_traits[unit.id]??[])addTrait(unit.id,trait);
  }
  const traits=Array<number>(lookup.trait_len).fill(0);
  for(const [trait,count]of Object.entries(traitCounts)){const t=lookup.trait_mapping[`${trait}_${count}`];if(t)traits[t.encoding]+=1;}
  const charms=Array<number>(lookup.charm_len).fill(0);
  for(const id of board.charms??[]){const index=lookup.charm_encodings[id];if(index===undefined){unknown.push('charm:'+id);continue;}charms[index]+=1;}
  inputs[prefix+'_augments']=augments;inputs[prefix+'_traits']=traits;inputs[prefix+'_charms']=charms;
  return {inputs,unknown:[...new Set(unknown)],traitCounts};
}
