import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeReader } from '../src/desktop/native-reader';
import { dataset } from '../src/game/tft-data';
import { bundledAugmentTiers } from '../src/game/metatft-augments';
import { utilityProcess } from 'electron';

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));
vi.mock('../src/desktop/original-assets', () => ({ prepareOriginalAssets: vi.fn(async () => 'test-provider.dll') }));
class Worker extends EventEmitter {
  kill = vi.fn(() => { this.emit('exit', 0); return true; });
  postMessage(message: string) { if (message === 'stop') queueMicrotask(() => this.emit('exit', 0)); }
}
let workers: Worker[];
beforeEach(() => {
  vi.restoreAllMocks(); workers = [];
  vi.spyOn(fs, 'access').mockResolvedValue();
  vi.mocked(utilityProcess.fork).mockImplementation(() => { const worker = new Worker(); workers.push(worker); return worker as any; });
});
const frame = (key: string, value: unknown) => ({ type: 'frame', payload: new TextEncoder().encode(JSON.stringify({ type: 'info', category: 'game_info', key, value: JSON.stringify(value) })) });
describe('独立原生采集子进程生命周期', () => {
  it('全场模块独立崩溃不会清掉商店与海克斯，停止时拒绝迟到快照',async()=>{
    const reader=createNativeReader(()=>{},{cacheRoot:'test',testMode:true});await reader.start();
    workers[0].emit('message',frame('tft_shop',dataset.characters.slice(0,5).map(c=>({name:c.character_id}))));
    workers[0].emit('message',{type:'scoreboard-ready',file:'test-tft.node'});
    expect(workers).toHaveLength(2);
    workers[1].emit('message',{type:'scoreboard-status',phase:'error',message:'UE5 object walker initialization failed'});
    expect(reader.snapshot().scoreboard?.phase).toBe('error');
    expect(reader.snapshot().cards.shopReady).toBe(true);
    workers[1].emit('exit',1);
    expect(reader.snapshot().cards.shopReady).toBe(true);
    expect(reader.snapshot().phase).toBe('receiving');
    reader.stop();workers[1].emit('message',{type:'scoreboard-frame',value:{players:[]}});
    expect(reader.snapshot().scoreboard?.phase).toBe('stopped');await reader.dispose();
  });
  it('游戏窗口矩形验证，生命周期结束清空玩家和定位', async () => {
    const reader = createNativeReader(() => {}, { cacheRoot: 'test', testMode: true });
    await reader.start();
    workers[0].emit('message', {type:'window-bounds',bounds:{x:10,y:20,width:1920,height:1080}});
    expect(reader.snapshot().gameBounds?.width).toBe(1920);
    workers[0].emit('message', frame('tft_roster', [{summoner:'甲',health:100}]));
    workers[0].emit('message', frame('players_info', [{summoner:'甲',champions:[]}]));
    expect(reader.snapshot().tracker?.snapshot?.alive).toBe(1);
    workers[0].emit('message', {type:'provider-status',message:'对局结束',reset:true});
    expect(reader.snapshot().tracker?.snapshot).toBeNull();
    expect(reader.snapshot().gameBounds).toBeNull();
    workers[0].emit('message', {type:'window-bounds',bounds:{x:0,y:0,width:-1,height:1080}});
    expect(reader.snapshot().gameBounds).toBeNull();
    await reader.dispose();
  });
  it('重复连接只启动一个子进程，停止后忽略迟到事件', async () => {
    const reader = createNativeReader(() => {}, { cacheRoot: 'test', testMode: true });
    await Promise.all([reader.start(), reader.start()]);
    expect(workers).toHaveLength(1);
    workers[0].emit('message', frame('tft_shop', dataset.characters.slice(0, 5).map(c => ({ name: c.character_id }))));
    expect(reader.snapshot().cards.shopReady).toBe(true);
    reader.stop();
    workers[0].emit('message', frame('tft_shop', dataset.characters.slice(0, 5).map(c => ({ name: c.character_id }))));
    expect(reader.snapshot().phase).toBe('stopped');
    expect(reader.snapshot().cards.shop).toEqual([]);
    await reader.dispose();
  });
  it('错误可以重连；断开连接清空旧海克斯和接收时间', async () => {
    const reader = createNativeReader(() => {}, { cacheRoot: 'test', testMode: true });
    await reader.start(); workers[0].emit('message', { type: 'error', message: 'native error' });
    await reader.start(); expect(workers).toHaveLength(2);
    const choices = Object.fromEntries(bundledAugmentTiers.augments.slice(0, 3).map((a, i) => [`augment_${i + 1}`, { name: a.id }]));
    workers[1].emit('message', frame('tft_augments', choices));
    expect(reader.snapshot().cards.augmentsReady).toBe(true);
    workers[1].emit('message', { type: 'disconnect' });
    expect(reader.snapshot().cards.augments).toEqual([]);
    expect(reader.snapshot().lastFrameAt).toBeNull();
    await reader.dispose();
  });
});
