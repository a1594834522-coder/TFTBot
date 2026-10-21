import { parseGameEvent, AugmentsPayload, type ShopPayload } from '../core/events';
import { z } from 'zod';
import { ChampionPlacement } from '../core/events';
import { mapScoreboard,ScoreboardCalibration,scoreboardRosterKey } from './scoreboard';
import { dataset } from '../game/tft-data';
import { bundledAugmentTiers } from '../game/metatft-augments';
import {knownWisp} from '../game/metatft-wisps';
import { chineseName } from '../game/names';
import type { RosterEntry, PlayerInfo } from '../core/events';
import { buildSnapshot, type RosterSnapshot } from '../game/roster';
import { normalizeShopHero, isGeneratedUnit } from '../game/shop-mechanics';

/** Contract recovered from the original GEP -> native IPC -> cube event chain. */
export const ORIGINAL_TFT_CHANNEL = '{8732C1E2-A2FD-4FF6-8330-FB43A9ABA45C}-5426';
export interface RecognitionCard { id: string; name: string; known: boolean; rating?: string;kind?:'hero'|'wisp' }
export interface RecognitionView {
  shop: Array<RecognitionCard | null>;
  augments: Array<RecognitionCard | null>;
  pickedAugment: RecognitionCard | null;
  shopReady: boolean;
  augmentsReady: boolean;
  level?: number | null;
  stage?:number|null;
  round?:string|null;
  shopVisible?:boolean;
  pickedAugments?:string[];
  pickedAugmentsComplete?:boolean;
  gold?:number;
  goldAt?:number;
  xpCurrent?:number|null;
  xpMax?:number|null;
  itemBenches?:Array<{summoner:string;tag_line:string;bench_items:Array<{name:string;count:number}>}>;
  itemBenchesAt?:number;
  ownHoldings?:{board:ChampionPlacement[]|null;bench:ChampionPlacement[]|null};
  battleBoards?:{local:{at:number;units:ChampionPlacement[]}|null;opponents:Record<string,{at:number;units:ChampionPlacement[]}>};
}
const NativeInteger=z.union([z.number(),z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(0).max(10000));
const NativeXP = z.object({xp_level:NativeInteger.pipe(z.number().min(1).max(11)),xp_progress:NativeInteger.optional(),xp_progress_max:NativeInteger.optional()}).refine(v=>v.xp_progress===undefined||v.xp_progress_max===undefined||v.xp_progress<=v.xp_progress_max);
// Item-bench array shape is documented by the provider; identity matching remains mandatory.
const NativeItemBenches=z.array(z.object({summoner:z.string().max(200),tag_line:z.string().max(100),bench_items:z.array(z.object({name:z.string().min(1).max(200),count:NativeInteger.pipe(z.number().max(100))})).max(100)})).max(8);
const NativeCells = z.record(z.string().regex(/^cell_\d+$/),ChampionPlacement).transform(v=>Object.entries(v).filter(([,c])=>c.name && c.name!=='Sold' && !isGeneratedUnit(c.name)).map(([key,c])=>({...c,position:Number(key.slice(5))-1})));
const CombatCells=z.record(z.string().regex(/^cell_\d+$/),ChampionPlacement).transform(v=>Object.entries(v).filter(([,c])=>c.name&&c.name!=='Sold').map(([key,c])=>({...c,position:Number(key.slice(5))-1,area:'board' as const})));
type OriginalRecognizedEvent = {key:'tft_gold';data:number}|{key:'tft_item_bench';data:z.infer<typeof NativeItemBenches>}|{key:'tft_round';data:string}|{key:'tft_shop_visible';data:boolean}|{key:'tft_opp';data:string}|{key:'tft_board_opponent';data:z.infer<typeof NativeCells>;combatData?:ChampionPlacement[]}| {key:'tft_xp';data:z.infer<typeof NativeXP>} | {key:'tft_board'|'tft_bench';data:z.infer<typeof NativeCells>;combatData?:ChampionPlacement[]} | { key: 'tft_roster'; data: RosterEntry[] } | { key: 'players_info'; data: PlayerInfo[] } | { key: 'tft_shop'; data: ShopPayload } | { key: 'tft_augments'; data: z.infer<typeof AugmentsPayload> } | { key: 'tft_picked_augment'; data: string;all?:string[] };
export function decodeOriginalInfo(payload: Uint8Array | string): OriginalRecognizedEvent | null {
  try {
    const text = typeof payload === 'string' ? payload : new TextDecoder('utf-8', { fatal: true }).decode(payload);
    if (text.length > 1_000_000) return null;
    const packet = JSON.parse(text);
    if(['info','event'].includes(packet?.type) && (packet.key??packet.name)==='tft_shop_visible'){
      const value=packet.value??packet.data;
      if(value===true||value==='true')return {key:'tft_shop_visible',data:true};
      if(value===false||value==='false')return {key:'tft_shop_visible',data:false};
      return null;
    }
    if (packet?.type !== 'info' || packet.category !== 'game_info' || typeof packet.key !== 'string' || typeof packet.value !== 'string') return null;
    if(packet.key==='tft_gold'||packet.key==='tft_item_bench'){
      let raw:unknown=packet.value;try{raw=JSON.parse(packet.value);}catch{}
      const result=(packet.key==='tft_gold'?NativeInteger:NativeItemBenches).safeParse(raw);
      return result.success?{key:packet.key,data:result.data} as OriginalRecognizedEvent:null;
    }
    if(packet.key==='tft_round'){
      let raw:unknown=packet.value;try{raw=JSON.parse(packet.value);}catch{}
      const round=typeof raw==='string'?raw:(raw as any)?.stage;
      return typeof round==='string' && /^[1-9]-[1-9]$/.test(round)?{key:'tft_round',data:round}:null;
    }
    if (['tft_xp','tft_board','tft_bench','tft_board_opponent'].includes(packet.key)) { const schema=packet.key==='tft_xp'?NativeXP:NativeCells;const raw=JSON.parse(packet.value),result=schema.safeParse(raw);const combat=['tft_board','tft_board_opponent'].includes(packet.key)?CombatCells.safeParse(raw):null;return result.success?{key:packet.key,data:result.data,...(combat?.success?{combatData:combat.data}:{})} as OriginalRecognizedEvent:null; }
    if(packet.key==='tft_opp') {let data=packet.value;try{data=JSON.parse(data);}catch{}return typeof data==='string'?{key:'tft_opp',data}:null;}
    if (!['tft_roster', 'players_info', 'tft_shop', 'tft_augments', 'tft_picked_augment'].includes(packet.key)) return null;
    if (packet.key === 'players_info') {
      const entries = JSON.parse(packet.value);
      if (!Array.isArray(entries) || entries.some(p => !Array.isArray(p?.champions))) return null;
    }
    const result = parseGameEvent(packet.key, packet.value);
    if(result.ok&&packet.key==='tft_picked_augment'){
      let raw;try{raw=JSON.parse(packet.value);}catch{}
      const all=raw&&typeof raw==='object'&&!Array.isArray(raw)?['slot_1','slot_2','slot_3','slot_4'].map(k=>raw[k]?.name).filter((id:any):id is string=>typeof id==='string'&&!!id):undefined;
      return {key:'tft_picked_augment',data:(result.data as any).data,all};
    }
    return result.ok ? result.data as OriginalRecognizedEvent : null;
  } catch { return null; }
}
const augmentRatings = new Map(bundledAugmentTiers.augments.map(a => [a.id, a]));
function hero(id: string): RecognitionCard | null {
  if (!id || id === 'Sold') return null;
  const wisp=knownWisp(id);if(wisp)return {...wisp,known:true,kind:'wisp'};
  id = normalizeShopHero(id);
  const entry = dataset.characterById(id);
  return { id, known: !!entry, name: entry?.display_name ?? '未识别英雄' };
}
function augment(id: string): RecognitionCard | null {
  if (!id) return null;
  const name = chineseName('augments', id);
  const rating = augmentRatings.get(id)?.rating;
  return { id, name: name === '名称待更新' ? '未识别海克斯' : name, known: name !== '名称待更新', rating };
}
const empty = (): RecognitionView => ({ shop: [], augments: [], pickedAugment: null, shopReady: false, augmentsReady: false, level: null });
export function createOriginalRecognition(now=Date.now) {
  let view = empty();
  let roster: RosterEntry[] | null = null;
  let players: PlayerInfo[] | null = null;
  let revision = 0;
  let scoreboard:PlayerInfo[]|null=null,scoreboardAt=0;
  let calibration:ScoreboardCalibration|null=null;
  let opponent='',opponentAt=0;
  const observed=new Map<string,{player:PlayerInfo;at:number}>();
  const ownUnits=()=>board!==null&&bench!==null?[...board,...bench.map(c=>({...c,position:(c.position??0)+28}))]:null;
  let board: z.infer<typeof NativeCells> | null = null, bench: z.infer<typeof NativeCells> | null = null;
  function livePlayers() {
    if(scoreboard && now()-scoreboardAt>12000){scoreboard=null;revision++;}
    if(scoreboard)return scoreboard;
    for(const [key,v] of observed)if(now()-v.at>60000){observed.delete(key);revision++;}
    const list=[...(scoreboard??players??Array.from(observed.values(),v=>v.player))];
    const local=roster?.find(p=>p.is_locale || String(p.localplayer)==='1');
    if(!local || board===null && bench===null)return list.length?list:null;
    return [...list.filter(p=>!(p.summoner===local.summoner && p.tag_line===local.tag_line)),{summoner:local.summoner,tag_line:local.tag_line,is_locale:true,coverage:board!==null && bench!==null?'full' as const:'partial' as const,champions:[...(board??[]),...(bench??[]).map(c=>({...c,position:(c.position??0)+28}))]}];
  }
  return {
    clearScoreboard(){if(scoreboard){scoreboard=null;revision++;}},
    scoreboardCalibration:()=>calibration,
    restoreScoreboardCalibration(value:unknown){const parsed=ScoreboardCalibration.safeParse(value);if(parsed.success)calibration=parsed.data;},
    acceptScoreboard(value:unknown){const result=mapScoreboard(value,roster,ownUnits(),calibration);if(!result.players){if(scoreboard){scoreboard=null;revision++;}return result.error;}calibration=result.calibration;scoreboard=result.players;scoreboardAt=now();revision++;return null;},
    view: () => structuredClone(view),
    tracker: (): { revision: number; snapshot: RosterSnapshot | null } => {const snapshot=roster?.length ? buildSnapshot(roster, livePlayers()) : null;return {revision,snapshot};},
    reset() { view = empty(); roster = null; players = null; board = null; bench = null;scoreboard=null;calibration=null;scoreboardAt=0;opponent='';observed.clear();revision++; },
    /** Invalid packets cannot erase a valid frame. Empty slot packets do clear stale cards. */
    accept(payload: Uint8Array | string): boolean {
      const event = decodeOriginalInfo(payload);
      if (!event) return false;
      if(event.key==='tft_opp'){opponent=event.data;opponentAt=now();}
      else if(event.key==='tft_gold'){view={...view,gold:event.data,goldAt:now()};}
      else if(event.key==='tft_item_bench'){view={...view,itemBenches:event.data,itemBenchesAt:now()};}
      else if(event.key==='tft_shop_visible'){view={...view,shopVisible:event.data};}
      else if(event.key==='tft_round'){
        const changed=!!view.round && view.round!==event.data;
        view={...view,round:event.data,stage:Number(event.data[0]),...(changed?{shop:[],shopReady:false}:{})};
      }
      else if(event.key==='tft_board_opponent'){
        const r=now()-opponentAt<=15000?roster?.find(p=>`${p.summoner}#${p.tag_line}`===opponent && p.health>0):null;
        if(!r)return false;
        observed.set(opponent,{at:now(),player:{summoner:r.summoner,tag_line:r.tag_line,champions:event.data,coverage:'partial'}});revision++;
        view={...view,battleBoards:{local:view.battleBoards?.local??null,opponents:{...view.battleBoards?.opponents,[opponent]:{at:now(),units:event.combatData??event.data}}}};
      }
      else if(event.key==='tft_xp') {const changed=view.level!==event.data.xp_level;view={...view,level:event.data.xp_level,xpCurrent:event.data.xp_progress??(changed?null:view.xpCurrent),xpMax:event.data.xp_progress_max??(changed?null:view.xpMax)}; }
      else if(event.key==='tft_board' || event.key==='tft_bench') {if(event.key==='tft_board'){board=event.data;view={...view,battleBoards:{local:{at:now(),units:event.combatData??event.data},opponents:view.battleBoards?.opponents??{}}};}else bench=event.data;view={...view,ownHoldings:{board,bench:bench?.map(c=>({...c,area:'bench',position:(c.position??0)+28}))??null}};revision++;}
      else if (event.key === 'tft_roster') {
        // Identity changes indicate a different lobby; never reuse its holdings.
        const identities = (list: RosterEntry[]) => list.map(p => `${p.summoner}#${p.tag_line}`).sort().join('|');
        if (!event.data.length || (roster && identities(roster) !== identities(event.data))) {players = null;board = null;bench = null;scoreboard=null;calibration=null;observed.clear();opponent='';view=empty();}
        if(calibration && calibration.rosterKey!==scoreboardRosterKey(event.data)){calibration=null;scoreboard=null;}
        roster = event.data; revision++;
        // GEP sends deltas. After an assistant restart xp_level may stay silent
        // until the next XP change; roster.xp is the original TGD player's level.
        const local=roster.find(p=>p.is_locale||String(p.localplayer)==='1');
        const level=Number(local?.xp);
        if(Number.isInteger(level)&&level>=1&&level<=11)view={...view,level};
      } else if (event.key === 'players_info') {
        players = event.data; revision++;
      } else if (event.key === 'tft_shop') {
        if (event.data.length > 5) return false;
        const shop = event.data.map(c => hero(c.name));
        view = { ...view, shop, shopReady: shop.length === 5 && shop.every(c => c===null || c.known) };
      } else if (event.key === 'tft_augments') {
        const augments = [event.data.augment_1, event.data.augment_2, event.data.augment_3].map(c => augment(c?.name ?? ''));
        view = { ...view, augments, augmentsReady: augments.every(c => !!c?.known && !!c.rating) };
      } else if (event.key === 'tft_picked_augment') {
        view = { ...view, pickedAugment: augment(event.data),pickedAugments:event.all??[...new Set([...(view.pickedAugments??[]),event.data].filter(Boolean))],pickedAugmentsComplete:event.all!==undefined, augments: [], augmentsReady: false };
      }
      return true;
    },
  };
}
