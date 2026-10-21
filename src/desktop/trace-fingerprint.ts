import type {ReaderStatus} from '../recognition/status';
function ageBucket(at:number|null|undefined,now:number){return at===null||at===undefined?'missing':now<at?'future':now-at<=15000?'fresh':now-at<=60000?'old':'expired';}
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
/** Ignore transport churn, preserving real values and the freshness boundaries
 * that change scouting/model eligibility. The trace itself keeps all timestamps. */
export function decisionFingerprint(status:ReaderStatus,now:number):string{
  const {goldAt:_goldAt,itemBenchesAt:_itemAt,battleBoards,...cards}=status.cards;
  const observation=(entry:{at:number;units:unknown[]}|null|undefined,scouted:boolean)=>{
    if(!entry)return entry;const {at,...data}=entry;return {...data,...(scouted?{freshness:ageBucket(at,now)}:{})};
  };
  return JSON.stringify(stable({phase:status.phase,transport:status.transport,testMode:status.testMode,
    liveFreshness:ageBucket(status.lastFrameAt,now),cards:{...cards,...(battleBoards?{battleBoards:{local:observation(battleBoards.local,false),opponents:Object.fromEntries(Object.entries(battleBoards.opponents).map(([id,board])=>[id,observation(board,true)]))}}:{})},
    tracker:status.tracker?.snapshot??null}));
}
