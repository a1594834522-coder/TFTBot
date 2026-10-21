import fs from 'node:fs/promises';
import path from 'node:path';

export function createFileStorage(file: string) {
  let values: Record<string, string> = Object.create(null);
  let loaded: Promise<void> | null = null;
  let writes = Promise.resolve();
  const load = () => loaded ??= fs.readFile(file, 'utf8').then((text) => {
    const raw = JSON.parse(text);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      values = Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.startsWith('tftbot:') && typeof value === 'string')) as Record<string, string>;
    }
  }).catch((error) => { if (error.code !== 'ENOENT') throw new Error('本地配置损坏或无法读取，请保留原文件后检查'); });
  const checkKey = (key: string) => {
    if (typeof key !== 'string' || !key.startsWith('tftbot:') || key.length > 256) throw new Error('无效存储键');
  };
  const persist = () => {
    const snapshot = JSON.stringify(values);
    const pending = writes.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file + '.tmp', snapshot, 'utf8');
      await fs.rename(file + '.tmp', file);
    });
    writes = pending.catch(() => {});
    return pending;
  };
  return {
    async getItem(key: string) { checkKey(key); await load(); return values[key] ?? ''; },
    async setItem(key: string, value: string) {
      checkKey(key);
      if (typeof value !== 'string' || value.length > 2_000_000) throw new Error('存储内容过大或格式无效');
      await load(); values[key] = value; await persist();
    },
    async removeItem(key: string) { checkKey(key); await load(); delete values[key]; await persist(); },
  };
}
