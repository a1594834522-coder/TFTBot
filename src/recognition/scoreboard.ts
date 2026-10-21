import {z} from 'zod';
import type {ChampionPlacement,PlayerInfo,RosterEntry} from '../core/events';
import {aggregateChampions} from '../game/roster';
import {normalizeShopHero,isGeneratedUnit} from '../game/shop-mechanics';

// Original tft.node serializes scoreboard armies, including board and bench.
const Unit=z.object({id:z.string().min(1).max(200),level:z.number().int().min(1).max(4),location:z.number().int().min(1).max(2).optional(),copies:z.number().int().min(1).max(27).optional()});
const Frame=z.object({players:z.array(z.object({index:z.number().int().min(0).max(7),champions:z.array(Unit).max(100)})).min(1).max(8)});
export const ScoreboardCalibration=z.object({rosterKey:z.string().max(5000),localIndex:z.number().int().min(0).max(7)});
export type ScoreboardCalibration=z.infer<typeof ScoreboardCalibration>;
export const scoreboardRosterKey=(roster:RosterEntry[])=>JSON.stringify(roster.map(p=>[p.index,p.summoner,p.tag_line]).sort((a,b)=>Number(a[0])-Number(b[0])));
function fingerprint(units:ChampionPlacement[]) {
  return aggregateChampions(units.filter(c=>!isGeneratedUnit(c.name)).map(c=>({...c,name:normalizeShopHero(c.name)})))
    .map(c=>`${c.name}:${c.copies}`).sort().join('|');
}
/** Gate index matching with an independent GEP board+bench check for the local player. */
export function mapScoreboard(value:unknown,roster:RosterEntry[]|null,own:ChampionPlacement[]|null,calibration?:ScoreboardCalibration|null):{players:PlayerInfo[];calibration:ScoreboardCalibration;error?:undefined}|{players:null;error:string} {
  const parsed=Frame.safeParse(value);
  if(!parsed.success)return {players:null,error:'全场快照格式无效'};
  if(!roster?.length)return {players:null,error:'等待玩家列表和本方棋盘、备战席核对'};
  const list=parsed.data.players;
  const indices=roster.map(p=>p.index);
  if(indices.some(i=>i===undefined)||new Set(indices).size!==roster.length||new Set(list.map(p=>p.index)).size!==list.length)return {players:null,error:'玩家索引缺失或重复'};
  const local=roster.filter(p=>p.is_locale||String(p.localplayer)==='1');
  const rosterKey=scoreboardRosterKey(roster);
  const calibrated=local.length===1 && calibration?.rosterKey===rosterKey && calibration.localIndex===local[0].index;
  const toUnits=(p:typeof list[number])=>p.champions.filter(c=>!isGeneratedUnit(c.id)).map(c=>({name:normalizeShopHero(c.id),level:c.level,...(c.location?{area:c.location===1?'board' as const:'bench' as const}:{})}));
  const localArmy=local.length===1?list.find(p=>p.index===local[0].index):undefined;
  if(!calibrated && !own?.length)return {players:null,error:'等待玩家列表和本方棋盘、备战席核对'};
  if(!localArmy || !calibrated && fingerprint(toUnits(localArmy))!==fingerprint(own!))return {players:null,error:'原生玩家索引尚未通过本方持牌核对'};
  // Once identity has been checked, use one coherent native frame. GEP deltas
  // arrive independently and must not invalidate identity whenever a hero is bought.
  return {calibration:{rosterKey,localIndex:local[0].index!},players:roster.flatMap(r=>{const p=list.find(p=>p.index===r.index);return p?[{summoner:r.summoner,tag_line:r.tag_line,is_locale:r===local[0],coverage:'full' as const,champions:toUnits(p)}]:[];})};
}
