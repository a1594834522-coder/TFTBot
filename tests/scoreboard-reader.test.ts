import {afterEach,it,expect,vi} from 'vitest';
import {createScoreboardReader,ORIGINAL_SCOREBOARD_CHANNEL} from '../src/desktop/scoreboard-reader';
afterEach(()=>vi.useRealTimers());
it('按原版顺序建立固定记牌通道，再调用 sgd；停止后不接受迟到结果',async()=>{
  vi.useFakeTimers();let callback:((e:unknown,r:unknown)=>void)|undefined;
  const stop=vi.fn(),start=vi.fn((channel:string,cb:typeof callback)=>{callback=cb;return {stop};});
  const invoke=vi.fn(async()=>({success:true,message:''})),frame=vi.fn(),status=vi.fn();
  const reader=createScoreboardReader({module:{start},invoke,frame,status});
  expect(start).toHaveBeenCalledOnce();expect(invoke).not.toHaveBeenCalled();
  expect(start.mock.calls[0][0]).toBe(ORIGINAL_SCOREBOARD_CHANNEL);
  await vi.advanceTimersByTimeAsync(1000);expect(invoke).toHaveBeenCalledWith('sgd',start.mock.calls[0][0]);
  callback?.(null,{players:[]});expect(frame).toHaveBeenCalledWith({players:[]});
  reader.stop();callback?.(null,{players:[{}]});expect(frame).toHaveBeenCalledOnce();expect(stop).toHaveBeenCalledOnce();
});
it('重启复用原通道；初始化同步报错不会被等待状态掩盖',async()=>{
  vi.useFakeTimers();const channels:string[]=[],status=vi.fn();
  const module={start:(channel:string,cb:(e:unknown,r:unknown)=>void)=>{channels.push(channel);cb(new Error('init failed'),null);return {stop(){}};}};
  const invoke=vi.fn(async()=>({success:true,message:''}));
  const a=createScoreboardReader({module,invoke,frame:vi.fn(),status});a.stop();
  const b=createScoreboardReader({module,invoke,frame:vi.fn(),status});await vi.advanceTimersByTimeAsync(1000);
  expect(channels).toEqual([ORIGINAL_SCOREBOARD_CHANNEL,ORIGINAL_SCOREBOARD_CHANNEL]);
  expect(invoke).toHaveBeenCalledOnce();expect(status).toHaveBeenLastCalledWith('error','init failed');b.stop();
});
it('单独的全场通道异常有界重试，不把空数据当作成功快照',async()=>{
  vi.useFakeTimers();const invoke=vi.fn(async()=>({success:false,message:'bridge unavailable'})),status=vi.fn();
  const reader=createScoreboardReader({module:{start:()=>({stop(){}})},invoke,frame:vi.fn(),status});
  await vi.advanceTimersByTimeAsync(21000);expect(invoke).toHaveBeenCalledTimes(10);expect(status).toHaveBeenLastCalledWith('error','bridge unavailable');reader.stop();
});
