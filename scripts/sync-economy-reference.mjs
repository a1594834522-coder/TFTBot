import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.env.METATFT_REFERENCE_DIR;
if(!root)throw Error('Set METATFT_REFERENCE_DIR to the local MetaTFT reference-data directory.');
const tablesText=await fs.readFile(path.join(root,'pbe_set18_tables.json'),'utf8'),lookupsText=await fs.readFile(path.join(root,'TFTSet18_latest_en_us.json'),'utf8');
const tables=JSON.parse(tablesText.replace(/^\uFEFF/,'')),lookups=JSON.parse(lookupsText.replace(/^\uFEFF/,''));
const byId=new Map(lookups.augments.map(a=>[a.apiName,a]));
const value=(id,row)=>{const points=byId.get(id)?.curveTable?.[row];if(!Array.isArray(points)||points.length!==1||points[0][0]!==1||!Number.isFinite(points[0][1]))throw Error('Unverified constant: '+id+'/'+row);return points[0][1];};
const modifiers={
  DA_LevelUp:{extraXpPerBuy:value('DA_LevelUp','AdditionalXP')},
  DA_UpwardMobility:{xpBuyDiscount:value('DA_UpwardMobility','ReducedXPCost'),freeShopsOnLevel:value('DA_UpwardMobility','RerollsOnLevelUp'),healthOnLevel:value('DA_UpwardMobility','HealthOnLevelUp')},
  DA_GoingLong:{interestDisabled:true},DA_Hustler:{interestDisabled:true},
  DA_HedgeFund:{interestCapBonus:value('DA_HedgeFund','IncMaxInterest')},
  DA_InvestmentStrategy:{interestCapBonus:value('DA_InvestmentStrategy','MaxInterestInc')},
};
const curve=tables.expPerLevel.ExpBreakpoints;
const xpRequired=Object.fromEntries(Array.from({length:9},(_,i)=>{const level=i+1;return [level,curve.filter(([l])=>l<=level).at(-1)[1]];}));
if(xpRequired[7]!==56||xpRequired[8]!==68||xpRequired[9]!==68)throw Error('XP table disagrees with official 18.2 mid-patch notes');
const result={version:'S18-18.4-economy-reference',provisional:true,source:{metadata:tables._metadata,tablesSha256:createHash('sha256').update(tablesText).digest('hex'),lookupsSha256:createHash('sha256').update(lookupsText).digest('hex'),officialXpCheck:'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-2/',officialBuyCostReference:'https://teamfighttactics.leagueoflegends.com/en-sg/news/game-updates/teamfight-tactics-hyper-roll/',note:'User-provided PBE constants. High-level XP thresholds cross-checked against 18.2 mid-patch notes. Current native XP max takes precedence; standard 4g/4XP and modifier values still reference rules, not a live purchase verification.'},xpRequired,goldPerBuy:4,xpPerBuy:4,maxLevel:10,modifiers};
await fs.writeFile('data/decision-economy-rules.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({xpRequired,modifiers}));
