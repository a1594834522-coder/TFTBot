import { describe, expect, it } from 'vitest';
import { CURRENT_GAME_RULE, decodeWire, field, fields, updateCurrentGameRule, varint } from '../src/recognition/native-wire';
describe('原版原生服务协议', () => {
  it('按已恢复的 protobuf 字段序列编码，保留 UTF-8 和 Win32 进程编号', () => {
    expect(field(1, 150).toString('hex')).toBe('089601');
    const decoded = decodeWire(fields(field(4, 12345), field(5, 99), field(10, '云顶之弈')));
    expect(decoded.get(4)).toBe(12345);
    expect(decoded.get(5)).toBe(99);
    expect((decoded.get(10) as Buffer).toString()).toBe('云顶之弈');
  });
  it('只登记已核对的当前云顶 UnrealWindow 规则，不把普通联盟窗口当云顶', () => {
    const envelope = decodeWire(updateCurrentGameRule());
    const list = decodeWire(envelope.get(4) as Buffer);
    const rule = decodeWire(list.get(1) as Buffer);
    expect(rule.get(1)).toBe(CURRENT_GAME_RULE.id);
    expect((rule.get(9) as Buffer).toString()).toBe('TFT  ');
    expect((rule.get(10) as Buffer).toString()).toBe('UnrealWindow');
  });
  it('拒绝截断、超长整数、未知 wire type 和错误长度', () => {
    for (const bytes of [[8, 128], [10, 9, 1], [15], [0], [8, ...Array(9).fill(255)]]) expect(() => decodeWire(Buffer.from(bytes))).toThrow();
    expect(() => varint(-1)).toThrow();
  });
});
