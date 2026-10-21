import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.env.METATFT_REFERENCE_DIR;
if(!root)throw Error('Set METATFT_REFERENCE_DIR to the supplied MetaTFT reference directory');
const hash=s=>createHash('sha256').update(s).digest('hex');
const [main,seasonText,lookupText,nonPoolText,mechanicsText,localeText]=await Promise.all([
  fs.readFile(path.join(root,'main.js')),fs.readFile(path.join(root,'TFTSet18_latest_en_us.json'),'utf8'),
  fs.readFile('data/metatft-model/lookups.json','utf8'),fs.readFile('data/current-non-pool-units.json','utf8'),
  fs.readFile('data/current-shop-mechanics.json','utf8'),fs.readFile('data/tft-sets.json','utf8')]);
const season=JSON.parse(seasonText.replace(/^\uFEFF/,'')),lookup=JSON.parse(lookupText),nonPool=JSON.parse(nonPoolText),mechanics=JSON.parse(mechanicsText),locale=JSON.parse(localeText);
if(season._metadata.set!=='TFTSet18'||nonPool.set!==18)throw Error('Battle policy season mismatch');
// Explicitly version the observed contract. An unrelated future bundle must
// be inspected again, rather than silently inheriting this interpretation.
const source=main.toString('utf8');
if(!source.includes('if(w.unit in a.unit_encodings&&v<y)')||!source.includes('w.unit in a.unit_traits'))throw Error('Live-board source contract changed');
const forms=Object.fromEntries(Object.entries(mechanics.aliases).filter(([id,base])=>id!==base&&lookup.unit_encodings[id]!==undefined&&JSON.stringify(lookup.unit_traits[id])!==JSON.stringify(lookup.unit_traits[base])).map(([id,poolId])=>{
  const traits=[...new Set(lookup.unit_traits[id]??[])].filter(t=>!lookup.unit_traits[poolId]?.includes(t));
  const key=id=>id.replace(/^(?:DA_|TFT)/,'').replace(/[\d_]/g,'').toLowerCase();
  const name=traits.map(trait=>{const entry=locale.traits.find(t=>key(t.trait_id)===trait.toLowerCase());if(!entry)throw Error('Missing Chinese battle form trait: '+trait);return entry.display_name;}).join(' / ');
  return [id,{poolId,traits,name}];
}));
const sprykinMinimum=Math.min(...season.traits.find(t=>t.apiName.endsWith('_Sprykin')).effects.map(e=>e.minUnits).filter(n=>n>0));
if(!Number.isFinite(sprykinMinimum))throw Error('Sprykin activation threshold unavailable');
const auxiliaries={
  DA_TheTower_TrainingDummy:{name:'巨塔假人',augments:['DA_TheTower'],contextTraits:[]},
  DA_TrainingDummy:{name:'训练假人',augments:['DA_Dummify','DA_TheTower'],contextTraits:[]},
  TFT_TrainingDummy:{name:'训练假人',augments:['DA_Dummify','DA_TheTower'],contextTraits:[]},
  DA_18_SprykinAugmentSummonMelee:{name:'伙伴召唤物',augments:['DA_18_SprykinAugment'],contextTraits:['Sprykin'],minimumTraits:{Sprykin:sprykinMinimum}},
  TFT18_SprykinSummonMelee:{name:'伙伴召唤物',augments:['DA_18_SprykinAugment'],contextTraits:['Sprykin'],minimumTraits:{Sprykin:sprykinMinimum}}
};
for(const [id,rule]of Object.entries(auxiliaries)){
  if(lookup.unit_encodings[id]===undefined||!nonPool.ids.includes(id)||rule.augments.some(id=>!season.augments.some(a=>a.apiName===id)))throw Error('Auxiliary source fact unavailable: '+id);
}
const result={set:18,evidence:{mainSha256:hash(main),lookupSha256:hash(lookupText),nonPoolSha256:hash(nonPoolText),seasonSha256:hash(seasonText),
  encoder:'ONt live-board path: unencoded units skip embeddings; traits processed separately',
  auxiliaryFacts:season.augments.filter(a=>['DA_TheTower','DA_Dummify','DA_18_SprykinAugment'].includes(a.apiName)).map(a=>({id:a.apiName,description:a.desc}))},
  forms,excluded:nonPool.ids.filter(id=>lookup.unit_encodings[id]===undefined).sort(),auxiliaries};
await fs.writeFile('data/battle-unit-policy.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({forms:Object.keys(forms).length,excluded:result.excluded.length,auxiliaries:Object.keys(auxiliaries).length,mainSha256:result.evidence.mainSha256}));
