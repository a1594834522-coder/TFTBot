/** Reproduce the parameter names used by the official Explorer client, with controls. */
import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve('dist/condition-audit');fs.mkdirSync(out,{recursive:true});
const headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.metatft.com/','Origin':'https://www.metatft.com'};
async function get(url){const r=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(r.status+' '+url);return r.json();}
const patch=await get('https://api-hc.metatft.com/tft-stat-api/patch');
const base=new URLSearchParams({queue:'1100',patch:patch.patch,b_patch:patch.b_patch_version,formatnoarray:'true',compact:'true'});
const cases=process.argv.includes('--extended')?[
  ['extended_base',{}],
  ['holder_item',{unit_item_unique:'DA_18_Kayle-1&DA_GuinsoosRageblade-1'}],
  ['holder_impossible_item',{unit_item_unique:'DA_18_Kayle-1&__TFTBOT_NONEXISTENT__-1'}],
  ['star2',{unit_tier_numitems_unique:'DA_18_Kayle-1_2_.*'}],
  ['star3',{unit_tier_numitems_unique:'DA_18_Kayle-1_3_.*'}],
  ['star4',{unit_tier_numitems_unique:'DA_18_Kayle-1_4_.*'}],
  ['augment',{augment:'DA_PandorasBench'}],
  ['two_units',{unit_unique:['DA_18_Kayle-1','DA_18_Leona-1']}],
  ['two_units_impossible',{unit_unique:['DA_18_Kayle-1','__TFTBOT_NONEXISTENT__-1']}],
]:[
  ['base',{}],
  ['unit',{unit_unique:'DA_18_Kayle-1'}],
  ['unit_item',{unit_unique:'DA_18_Kayle-1',item_unique:'DA_GuinsoosRageblade-1'}],
  ['without_unit',{unit_unique:'!DA_18_Kayle-1'}],
  ['impossible',{unit_unique:'__TFTBOT_NONEXISTENT__-1'}],
  ['old_plural',{units:'DA_18_Kayle'}],
];
const report={at:new Date().toISOString(),patch,cases:[]};
for(const [name,filters]of cases){
  const q=new URLSearchParams(base);for(const [k,v]of Object.entries(filters))for(const value of Array.isArray(v)?v:[v])q.append(k,value);
  const url='https://api-hc.metatft.com/tft-explorer-api/total?'+q;
  const data=await get(url);fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(data));
  const rows=Array.isArray(data)?data:data.data??[];
  const first=rows[0]??{};const counts=first.placement_count;
  const count=Array.isArray(counts)?counts.reduce((n,v)=>n+v,0):first.total_games??null;
  const row={name,filters,count,first,rootKeys:Object.keys(data),url};report.cases.push(row);console.log(JSON.stringify(row));
}
fs.writeFileSync(path.join(out,process.argv.includes('--extended')?'extended-report.json':'report.json'),JSON.stringify(report,null,2));
