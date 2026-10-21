import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {advisorDemo} from '../src/desktop/advisor-demo';
import {emptyBattleForecast} from '../src/game/battle-forecast';
import {directionAdvice} from '../src/decision/direction-advisor';
import type {DirectionCatalog} from '../src/decision/direction-catalog';
import type {GearModel} from '../src/decision/gear-affinity';
import catalog from '../data/metatft-direction-catalog.json';
import gear from '../data/metatft-gear-model.json';
const state=vi.hoisted(()=>({children:[] as any[]}));
vi.mock('electron',async()=>{
  const {EventEmitter}=await import('node:events');
  return {utilityProcess:{fork:()=>{const child=new EventEmitter() as any;child.postMessage=vi.fn();child.kill=vi.fn();state.children.push(child);return child;}}};
});
import {createBattleService} from '../src/desktop/battle-service';
function reply(child:any){
  const work=child.postMessage.mock.calls.findLast((args:any[])=>args[0]?.type==='evaluate')[0];
  const direction=directionAdvice(work.direction,catalog as unknown as DirectionCatalog,gear as unknown as GearModel);
  child.emit('message',{type:'result',id:work.id,forecast:{...emptyBattleForecast(),direction}});return direction;
}
beforeEach(()=>{vi.useFakeTimers();state.children=[];});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
describe('latest-state decision service',()=>{
  it('correlates stale and current results with their own dispatch clocks without allowing diagnostic failures to alter scheduling',()=>{
    const status=advisorDemo('ap'),events:Record<string,unknown>[]=[],service=createBattleService(()=>{},e=>{events.push(e);});
    service.update(status);vi.advanceTimersByTime(120);const child=state.children[0],first=child.postMessage.mock.calls.at(-1)[0];
    vi.advanceTimersByTime(500);service.update(status,[],null,null,'key-upgrade');vi.advanceTimersByTime(120);const second=child.postMessage.mock.calls.at(-1)[0];
    child.emit('message',{type:'result',id:first.id,forecast:emptyBattleForecast('stale')});
    expect(events.find(e=>e.event==='result'&&e.id===first.id)).toMatchObject({accepted:false,elapsedMs:620,currentId:second.id});expect(service.snapshot().message).not.toBe('stale');
    child.emit('message',{type:'result',id:second.id,forecast:emptyBattleForecast('new')});expect(events.find(e=>e.event==='result'&&e.id===second.id)).toMatchObject({accepted:true,elapsedMs:0});
    service.dispose();const broken=createBattleService(()=>{},()=>{throw Error('diagnostic only');});expect(()=>{broken.update(status);vi.advanceTimersByTime(120);}).not.toThrow();broken.dispose();
  });
  it('invalidates old policy results immediately and includes the manual pursuit objective in worker scheduling',()=>{
    const status=advisorDemo('ap'),service=createBattleService(()=>{});service.update(status);vi.advanceTimersByTime(120);const child=state.children[0],first=child.postMessage.mock.calls[0][0];
    child.emit('message',{type:'result',id:first.id,forecast:{...emptyBattleForecast(),pursuit:{ready:false,reason:'old policy'}}});
    service.update(status,[],null,null,'completion-first');expect(service.snapshot().pursuit).toBeUndefined();
    child.emit('message',{type:'result',id:first.id,forecast:emptyBattleForecast('stale policy')});expect(service.snapshot().message).not.toBe('stale policy');
    vi.advanceTimersByTime(120);expect(child.postMessage.mock.calls.at(-1)[0].pursuitMode).toBe('completion-first');service.dispose();
  });
  it('does not reschedule inference for presentation-only mainline transition updates',()=>{
    const status=advisorDemo('ap'),service=createBattleService(()=>{}),intent={key:'metatft:demo',units:['DA_18_Kayle'],directionId:'core',transitions:[{heldCount:0}]} as any;
    service.update(status,[],null,intent);vi.advanceTimersByTime(120);const child=state.children[0];
    expect(child.postMessage.mock.calls[0][0].direction.intent).toEqual({key:intent.key,units:intent.units,directionId:'core'});
    service.update(status,[],null,{...intent,transitions:[{heldCount:3}]});vi.advanceTimersByTime(120);expect(child.postMessage).toHaveBeenCalledTimes(1);service.dispose();
  });
  it('keeps planning visible during updates while invalidating automatic shop highlights',()=>{
    const status=advisorDemo('ap'),service=createBattleService(()=>{});service.update(status);vi.advanceTimersByTime(120);reply(state.children[0]);
    const before=service.snapshot().direction;if(!before?.ready)throw Error();
    status.cards.shop[0]={id:'DA_18_Kayle',known:true,name:'凯尔'};service.update(status);
    const pending=service.snapshot().direction;if(!pending?.ready)throw Error();
    expect(pending.updating).toBe(true);expect(pending.rows.map(r=>r.id)).toEqual(before.rows.map(r=>r.id));
    expect(pending.holds.cards.every(c=>c.quantity===0&&c.shopSlots.length===0)).toBe(true);
    vi.advanceTimersByTime(120);reply(state.children[0]);expect(service.snapshot().direction).toMatchObject({ready:true});
    expect(service.snapshot().direction?.ready&&(service.snapshot().direction as any).updating).toBeUndefined();service.dispose();
  });
  it('recovers a crashed child even if the game state itself has not changed',()=>{
    const service=createBattleService(()=>{});service.update(advisorDemo('ap'));vi.advanceTimersByTime(120);const first=state.children[0];reply(first);
    first.emit('exit',1);expect(service.snapshot().phase).toBe('error');
    vi.advanceTimersByTime(499);expect(state.children).toHaveLength(1);vi.advanceTimersByTime(1);expect(state.children).toHaveLength(2);
    reply(state.children[1]);expect(service.snapshot().direction).toMatchObject({ready:true});service.dispose();
  });
  it('rejects stale results and does not restart after disposal',()=>{
    const status=advisorDemo('ap'),service=createBattleService(()=>{});service.update(status);vi.advanceTimersByTime(120);const child=state.children[0],work=child.postMessage.mock.calls[0][0];
    status.cards.gold=1;service.update(status);child.emit('message',{type:'result',id:work.id,forecast:emptyBattleForecast('stale result')});
    expect(service.snapshot().message).not.toBe('stale result');service.dispose();child.emit('exit',1);vi.advanceTimersByTime(60000);expect(state.children).toHaveLength(1);
  });
});
