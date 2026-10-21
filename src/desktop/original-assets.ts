import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
/** Loaded DLLs cannot be overwritten on Windows; immutable versioned assets must be reused. */
export async function ensureOriginalAsset(file: string, bytes: Buffer) {
  try {
    const existing = await fs.readFile(file);
    if (!existing.equals(bytes)) throw new Error('原版插件缓存校验失败，请保留现场后检查文件');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.writeFile(file, bytes, {flag:'wx'});
  }
}
/** Extract unchanged provider files under the portable installation, so the game can read them. */
export async function prepareOriginalAssets(cacheRoot: string): Promise<string> {
  const archive = await fs.readFile('E:/amumu/resources/apps/amumu.bin');
  let end = archive.length - 22;
  for (; end >= Math.max(0, archive.length - 65557); end--) if (archive.readUInt32LE(end) === 0x06054b50) break;
  if (end < 0 || archive.readUInt32LE(end) !== 0x06054b50) throw new Error('原版插件包格式无效');
  let position = archive.readUInt32LE(end + 16);
  const selected = new Map<string, Buffer>();
  for (let n = 0; n < archive.readUInt16LE(end + 10); n++) {
    if (archive.readUInt32LE(position) !== 0x02014b50) throw new Error('原版插件目录损坏');
    const length = archive.readUInt16LE(position + 28);
    const name = archive.subarray(position + 46, position + 46 + length).toString('utf8');
    if (['plugins/64/gep_tft.dll', 'plugins/64/libowgameevents64.dll', 'plugins/64/tft.node'].includes(name)) {
      const offset = archive.readUInt32LE(position + 42), size = archive.readUInt32LE(position + 20), expanded = archive.readUInt32LE(position + 24);
      if (expanded > 10_000_000 || archive.readUInt32LE(offset) !== 0x04034b50) throw new Error('原版插件长度无效');
      const start = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
      if (start + size > archive.length) throw new Error('原版插件已截断');
      const compressed = archive.subarray(start, start + size), method = archive.readUInt16LE(position + 10);
      const data = method === 8 ? inflateRawSync(compressed, { maxOutputLength: 10_000_000 }) : method === 0 ? compressed : null;
      if (!data || data.length !== expanded) throw new Error('原版插件解压校验失败');
      selected.set(path.basename(name), data);
    }
    position += 46 + length + archive.readUInt16LE(position + 30) + archive.readUInt16LE(position + 32);
  }
  if (selected.size !== 3) throw new Error('缺少最新赛季 GEP、全场记牌模块或其依赖');
  const target = path.join(cacheRoot, 'original-provider', createHash('sha256').update(archive).digest('hex').slice(0, 16));
  await fs.mkdir(target, { recursive: true });
  for (const [name, bytes] of selected) await ensureOriginalAsset(path.join(target, name), bytes);
  return path.join(target, 'gep_tft.dll');
}
