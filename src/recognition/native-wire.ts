/** Minimal protobuf wire codec for the recovered native service protocol. */
export function varint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('无效原生协议整数');
  const bytes: number[] = [];
  do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}
export function field(number: number, value: string | number | Uint8Array): Buffer {
  if (typeof value === 'number') return Buffer.concat([varint(number * 8), varint(value)]);
  const data = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  return Buffer.concat([varint(number * 8 + 2), varint(data.length), data]);
}
export function fields(...entries: Buffer[]): Buffer { return Buffer.concat(entries); }
export function decodeWire(input: Uint8Array): Map<number, number | Buffer> {
  const data = Buffer.from(input);
  if (data.length > 1_000_000) throw new Error('原生服务响应过大');
  let position = 0;
  const read = () => {
    let value = 0, multiplier = 1;
    for (let n = 0; n < 8; n++) {
      if (position >= data.length) throw new Error('原生消息截断');
      const byte = data[position++]; value += (byte & 127) * multiplier;
      if (!Number.isSafeInteger(value)) throw new Error('原生整数溢出');
      if (!(byte & 128)) return value;
      multiplier *= 128;
    }
    throw new Error('原生整数过长');
  };
  const result = new Map<number, number | Buffer>();
  while (position < data.length) {
    const tag = read(), number = Math.floor(tag / 8), type = tag % 8;
    if (!number) throw new Error('无效原生字段');
    if (type === 0) result.set(number, read());
    else {
      const size = type === 2 ? read() : type === 1 ? 8 : type === 5 ? 4 : -1;
      if (size < 0 || position + size > data.length) throw new Error('无效原生字段长度');
      result.set(number, data.subarray(position, position + size)); position += size;
    }
  }
  return result;
}
export const CURRENT_GAME_RULE = {
  id: 54262, title: '云顶之弈', windowTitle: 'TFT  ', windowClass: 'UnrealWindow',
};
export function updateCurrentGameRule(): Buffer {
  const rule = fields(field(1, CURRENT_GAME_RULE.id), field(2, CURRENT_GAME_RULE.title), field(3, 1),
    field(4, 'HKEY_CURRENT_USER\\Software\\Tencent\\LOL/InstallPath'), field(5, '..\\tcls\\client.exe'),
    field(6, '.\\Game\\League of Legends.exe'), field(9, CURRENT_GAME_RULE.windowTitle), field(10, CURRENT_GAME_RULE.windowClass), field(11, 10902));
  return field(4, field(1, rule));
}
