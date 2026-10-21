import { describe, expect, it, vi } from 'vitest';
import { createShadowRecorder, parseShadowDump, SHADOW_DUMP_KEY, SHADOW_ENABLED_KEY } from '../src/core/shadow';
import { parseRecordedEvents, replayText } from '../src/core/replay';
import { createFakeCube } from './helpers/fakeCube';
import { boot } from '../src/boot/lean';
import { dataset } from '../src/game/tft-data';

const catalog = dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));

describe('Shadow 录制器', () => {
  it('环形缓冲：超过上限丢最旧的，并计数', () => {
    let t = 0;
    const rec = createShadowRecorder({ limit: 3, now: () => ++t });
    rec.record('a', 1);
    rec.record('b', 2);
    rec.record('c', 3);
    rec.record('d', 4);
    expect(rec.size()).toBe(3);
    expect(rec.dropped()).toBe(1);
    expect(rec.events().map((e) => e.key)).toEqual(['b', 'c', 'd']);
  });

  it('dump 是 JSONL，能被 parseShadowDump / replay 解析', () => {
    let t = 100;
    const rec = createShadowRecorder({ now: () => (t += 10) });
    const roster = [{ summoner: 'Me', tag_line: '1', health: 50 }];
    rec.record('tft_roster', JSON.stringify(roster));
    rec.record('players_info', JSON.stringify([{ summoner: 'Me', tag_line: '1', champions: [] }]));

    const dump = rec.dump();
    expect(dump.split('\n')).toHaveLength(2);
    const parsed = parseShadowDump(dump);
    expect(parsed.map((e) => e.key)).toEqual(['tft_roster', 'players_info']);

    // 与 replay 的输入格式一致：能直接重放出摘要
    const parsedEvents = parseRecordedEvents(dump);
    expect(parsedEvents.events).toHaveLength(2);
    expect(parsedEvents.invalid).toBe(0);
    const summary = replayText(dump, { catalog });
    expect(summary.events).toBe(2);
  });

  it('sink 每条都收到；sink 抛错不影响录制', () => {
    const seen: string[] = [];
    const rec = createShadowRecorder({
      sink: (line) => {
        seen.push(line);
        throw new Error('boom');
      },
    });
    expect(() => rec.record('x', { a: 1 })).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(rec.size()).toBe(1);
  });

  it('clear 重置缓冲与丢弃计数', () => {
    const rec = createShadowRecorder({ limit: 2 });
    rec.record('a', 1);
    rec.record('b', 2);
    rec.record('c', 3);
    rec.clear();
    expect(rec.size()).toBe(0);
    expect(rec.dropped()).toBe(0);
    expect(rec.dump()).toBe('');
  });

  it('导出键名稳定（外部脚本依赖）', () => {
    expect(SHADOW_ENABLED_KEY).toBe('tftbot:shadow');
    expect(SHADOW_DUMP_KEY).toBe('tftbot:shadow:dump');
  });
});

describe('boot 集成：开启 shadow 会录到事件', () => {
  it('shadow: true 时按 update-info 录制，并写入 dump 键', async () => {
    const f = createFakeCube({ windows: ['background', 'main', 'trick'] });
    const handle = await boot({ cube: f.cube as any, window: 'none', initialSet: 18, getOwner: () => 'local', shadow: true });
    expect(handle.shadow).not.toBeNull();

    f.emit('tft_roster', JSON.stringify([{ summoner: 'Me', tag_line: '1', health: 42 }]));
    f.emit('players_info', JSON.stringify([{ summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 2 }] }]));

    const dump = handle.shadow!.dump();
    const keys = parseShadowDump(dump).map((e) => e.key);
    expect(keys).toContain('tft_roster');
    expect(keys).toContain('players_info');
    handle.dispose();
  });

  it('默认不开 shadow（handle.shadow 为 null）', async () => {
    const f = createFakeCube({ windows: ['background', 'main'] });
    const handle = await boot({ cube: f.cube as any, window: 'none', getOwner: () => 'local' });
    expect(handle.shadow).toBeNull();
    handle.dispose();
  });
});
