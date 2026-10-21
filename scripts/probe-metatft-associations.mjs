import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('dist/association-audit');await fs.mkdir(out,{recursive:true});
const headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.metatft.com/','Origin':'https://www.metatft.com'};
const cases=process.argv.includes('--augments')?[['levelup',{augment:'DA_LevelUp'}],['trade_sector',{augment:'DA_TradeSector'}],['pandoras',{augment:'DA_PandorasBench'}],['augment_impossible',{augment:'__TFTBOT_NONEXISTENT__'}]]:[['rageblade',{item_unique:'DA_GuinsoosRageblade-1'}],['infinityedge',{item_unique:'DA_InfinityEdge-1'}],['kayle',{unit_unique:'DA_18_Kayle-1'}],['impossible',{unit_unique:'__TFTBOT_NONEXISTENT__-1'}]];
for(const [name,filters]of cases){
  const query=new URLSearchParams({tft_set:'TFTSet18',...filters,top_k:'10',format:'full',composite:'true'});
  const url='https://api-hc.metatft.com/tft-explorer-predictions/prediction?'+query;
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(25000)}),text=await response.text();
  let data;try{data=JSON.parse(text);}catch{data={body:text.slice(0,500)};}
  await fs.writeFile(path.join(out,name+'.json'),JSON.stringify({at:new Date().toISOString(),url,status:response.status,data},null,2));
  console.log(JSON.stringify({name,status:response.status,keys:Object.keys(data),metadata:data.metadata,success:data.success,error:data.error,predictions:data.predictions?.parsed?.slice(0,3)}));
}
