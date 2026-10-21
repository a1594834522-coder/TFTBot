import names from '../../data/metatft-zh-names.json';
export type NameKind = 'units' | 'traits' | 'items' | 'augments';
export function chineseName(kind: NameKind, id: string): string {
  return (names[kind] as Record<string, string>)[id] ?? '名称待更新';
}
export function displayName(id: string): string {
  for (const kind of ['units', 'traits', 'items', 'augments'] as const) {
    const name = (names[kind] as Record<string, string>)[id];
    if (name) return name;
  }
  return '名称待更新';
}
