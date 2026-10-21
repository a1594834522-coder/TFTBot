/** Passive contract discovery only. Neither event names nor changing booleans
 * establish matchmaking eligibility; this module never produces opponent weights. */
export function createOpponentSignalProbe(){
  let round:string|null=null;
  const states=new Map<string,{fingerprint:string;at:number;count:number}>();
  const bytes={roster:0,context:0,unknown:0};
  const healthOnly=new Set(['health','hp','xp','xp_level','xp_progress','xp_progress_max','gold','index','rank']);
  const identity=new Set(['summoner','tag_line','name','localplayer','is_locale']);
  function scalarProjection(value:unknown,roster=false,depth=0):unknown{
    if(depth>6)return '[depth-limit]';
    if(Array.isArray(value))return value.slice(0,32).map(v=>scalarProjection(v,roster,depth+1));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).slice(0,128)
      .filter(([k])=>!roster||!healthOnly.has(k)).map(([k,v])=>[k,scalarProjection(v,roster,depth+1)]));
    return typeof value==='string'?value.slice(0,256):value;
  }
  function fieldTypes(value:unknown,path='$',result:Record<string,string>={},depth=0){
    if(Object.keys(result).length>=256||depth>6)return result;
    result[path]=value===null?'null':Array.isArray(value)?'array':typeof value;
    if(Array.isArray(value))for(const v of value.slice(0,8))fieldTypes(v,path+'[]',result,depth+1);
    else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value).slice(0,128))fieldTypes(v,path+'.'+k,result,depth+1);
    return result;
  }
  return {observe(packet:Record<string,unknown>,accepted:boolean,now=Date.now()){
    const key=typeof packet.key==='string'?packet.key:typeof packet.name==='string'?packet.name:null;
    const category=typeof packet.category==='string'?packet.category:typeof packet.feature==='string'?packet.feature:'';
    if(!key||key.length>160||category.length>160)return null;
    const raw=packet.value??packet.data;let value:unknown=raw;
    if(typeof raw==='string'){if(raw.length>65536)return null;try{value=JSON.parse(raw);}catch{}}
    if(key==='tft_round'||key==='round_type'){
      const stage=typeof value==='string'?value:(value as any)?.stage;
      if(typeof stage==='string'&&/^[1-9]-[1-9]$/.test(stage))round=stage;
    }
    const roster=key==='tft_roster'||key==='player_status';
    const contextual=/^(tft_round|round_type|tft_combat|battle_state|battle_start|battle_end|round_start|round_end|tft_opp|team_opp|opponent|tft_round_outcome|round_outcome|match_state|match_start|match_end)$/.test(key);
    const named=/oppon|enemy|candidate|matchmak|target|eligible|indicator/i.test(key);
    if(!roster&&!contextual&&!named&&accepted)return null;
    const id=category+':'+key,old=states.get(id);
    if(!old&&states.size>=128)return null;
    // New-round context matters even when a candidate flag set is unchanged.
    const projected=scalarProjection(value,roster),fingerprint=JSON.stringify([round,projected]);
    if(old?.fingerprint===fingerprint)return null;
    if(old&&now-old.at<250)return null;
    if(old&&old.count>=1000)return null;
    const encoded=typeof raw==='string'?raw:JSON.stringify(raw??null);
    if(encoded.length>65536)return null;
    const bucket=roster?'roster':contextual?'context':'unknown',size=new TextEncoder().encode(encoded).byteLength;
    if(bytes[bucket]+size>(bucket==='roster'?3_000_000:bucket==='context'?1_000_000:500_000))return null;
    bytes[bucket]+=size;
    states.set(id,{fingerprint,at:now,count:(old?.count??0)+1});
    const extras=roster?Object.entries(fieldTypes(value)).filter(([path])=>{
      const leaf=path.split('.').at(-1)??'';return !healthOnly.has(leaf)&&!identity.has(leaf)&&path!=='$'&&path!=='$[]';
    }).map(([path,type])=>({path,type})):[];
    return {round,category,key,accepted,packetType:packet.type??null,fields:fieldTypes(value),extraRosterFields:extras,
      sample:encoded,truncated:false,interpretation:'unverified-contract-only'};
  }};
}
