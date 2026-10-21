export const ORIGINAL_SCOREBOARD_CHANNEL='{CAB1E425-C0D0-407F-B6AF-CE68E4274079}';
export interface ScoreboardSession {stop():void}
export interface ScoreboardModule {start(channel:string,callback:(error:unknown,result:unknown)=>void):ScoreboardSession}
/** The original tgd page calls tft.start(channel, callback), then GEP.sgd(JSON channel). */
export function createScoreboardReader(options:{
  module:ScoreboardModule;
  invoke(method:string,value:unknown):Promise<{success:boolean;message:string}>;
  frame(value:unknown):void;
  status(phase:'waiting'|'receiving'|'error'|'stopped',message:string):void;
  delayMs?:number;
  channel?:string;
}) {
  // overlay_x64 keeps its first sgd connection for the lifetime of the game.
  // A new random channel after an assistant restart silently disconnects the reader.
  const channel=options.channel??ORIGINAL_SCOREBOARD_CHANNEL;
  let disposed=false,session:ScoreboardSession|undefined,timer:ReturnType<typeof setTimeout>|undefined,attempts=0,lastError='';
  const report=(phase:Parameters<typeof options.status>[0],message:string)=>{if(!disposed)options.status(phase,message);};
  async function attach(){
    if(disposed)return;
    try{const result=await options.invoke('sgd',channel);if(disposed)return;if(!result.success)throw new Error(result.message||'GEP 尚未准备好记分板通道');if(!lastError)report('waiting','全场记牌通道已连接，等待记分板快照');return;}
    catch(error){if(disposed)return;lastError=(error as Error)?.message??String(error);if(++attempts>=10){report('error',lastError);return;}timer=setTimeout(attach,2000);}
  }
  try{
    report('waiting','正在连接原版全场记牌模块，首次建立索引需要等待');
    session=options.module.start(channel,(error,result)=>{
      if(disposed)return;
      if(error){const message=(error as Error)?.message??String(error);if(message!==lastError){lastError=message;report('error',message);}return;}
      if(result){lastError='';options.frame(result);report('receiving','正在接收全场记分板持牌');}
    });
    timer=setTimeout(attach,options.delayMs??1000);
  }catch(error){report('error',(error as Error).message);}
  return {stop(){if(disposed)return;disposed=true;if(timer)clearTimeout(timer);try{session?.stop();}finally{options.status('stopped','全场记牌通道已停止');}}};
}
