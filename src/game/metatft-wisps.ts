import raw from '../../data/metatft-wisps.json';
import {CURRENT_SET} from './current-season';
import {AUGMENT_TIERS,type AugmentRating} from './metatft-augments';
export interface WispDefinition {name:string;upgradeOf?:string}
export interface WispRatings {set:number;author:string;updatedAt:string;fetchedAt:string;ratings:Record<string,AugmentRating>;definitions:Record<string,WispDefinition>}
export function parseWispRatings(input:unknown):WispRatings {
  const data=input as any,tiers=data?.response?.content?.content?.tierList;
  if(data?.meta?.set!==CURRENT_SET || !Array.isArray(tiers) || !data.definitions || typeof data.definitions!=='object')throw new Error('仙灵评级赛季或结构无效');
  const ratings:Record<string,AugmentRating>={};let total=0,matched=0;
  for(const tier of tiers){if(!AUGMENT_TIERS.includes(tier.label)||!Array.isArray(tier.content))continue;for(const entry of tier.content){
    if(entry?.type!=='wisp'||typeof entry.id!=='string')continue;
    total++;if(!data.definitions[entry.id])continue;matched++;
    if(ratings[entry.id])throw new Error('仙灵评级 ID 重复');
    ratings[entry.id]=tier.label;
  }}
  if(matched<10 || matched/Math.max(1,total)<.95)throw new Error('仙灵评级与当前赛季定义不匹配，保留缓存');
  const author=data.response.content.author??{};
  return {set:CURRENT_SET,author:[author.gameName,author.tagLine].filter(Boolean).join('#'),updatedAt:data.response.content.updated_at??'',fetchedAt:data.meta.fetchedAt??'',ratings,definitions:data.definitions};
}
export const wispRatings=parseWispRatings(raw);
export function knownWisp(id:string):{id:string;name:string;rating?:AugmentRating}|null {
  const definition=wispRatings.definitions[id];
  // Upgrade effects are not assigned the base effect's grade without an explicit author entry.
  return definition?{id,name:definition.name,rating:wispRatings.ratings[id]}:null;
}
