import fs from 'node:fs';
import { createHash } from 'node:crypto';
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/chinese-names.mjs <MetaTFT Chinese lookup JSON>');
const raw = JSON.parse(fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, ''));
const set = Number(/^TFTSet(\d+)$/.exec(raw._metadata?.set)?.[1]);
const data = JSON.parse(fs.readFileSync('data/tft-sets.json', 'utf8'));
if (!data.characters[set] || Object.keys(data.characters).length !== 1) throw new Error('中文名称表与当前赛季不符');
const meta = { set, locale: 'zh_CN', source: `https://data.metatft.com/lookups/TFTSet${set}_latest_zh_cn.json`, fetchedAt: new Date().toISOString(), generated: raw._metadata.generated, scope: 'names-only', overrides: { DA_ChallengersGrace: '挑战者的恩典' } };
Object.assign(meta.overrides, { DA_18_FloraFatalisAugmentPlus: '致命丽花+', DA_DoubleTrouble: '好事成双' });
const names = { meta, units: {}, traits: {}, items: {}, augments: {} };
meta.sha256 = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
for (const u of raw.units) {
  if (!u.name) continue;
  for (const id of [u.apiName, ...(u.assetNames ?? [])]) names.units[id] = u.name;
}
for (const t of raw.traits) names.traits[t.apiName] = t.name;
for (const i of [...raw.items, ...(raw.armory_items ?? [])]) names.items[i.apiName] = i.name;
for (const a of raw.augments) names.augments[a.apiName] = meta.overrides[a.apiName] ?? a.name;
Object.assign(names.augments, meta.overrides);
for (const [kind, entries] of Object.entries(names).filter(([k]) => k !== 'meta')) {
  if (Object.values(entries).some(name => !/[\u3400-\u9fff]/.test(name))) throw new Error(`${kind} 存在未翻译名称`);
}
fs.writeFileSync('data/metatft-zh-names.json', JSON.stringify(names, null, 2) + '\n');
// Restore a game ID accidentally altered by an earlier branding pass.
for (const file of ['data/tft-sets.json', 'data/comps.json', 'data/metatft-comps.json', 'data/metatft-early.json']) {
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('DA_tftbot18', 'DA_Amumu18').replaceAll('tft18_tftbot_square', 'tft18_amumu_square'));
}
const catalog = JSON.parse(fs.readFileSync('data/tft-sets.json', 'utf8'));
for (const c of catalog.characters[set]) { if (!names.units[c.character_id]) throw new Error(`缺少英雄中文名 ${c.character_id}`); c.display_name = names.units[c.character_id]; }
for (const i of catalog.items) i.display_name = names.items[i.item_id];
for (const t of catalog.traits) t.display_name = names.traits[t.trait_id];
for (const a of catalog.augments) a.display_name = names.augments[a.augment_id];
fs.writeFileSync('data/tft-sets.json', JSON.stringify(catalog) + '\n');
const augmentNames = JSON.parse(fs.readFileSync('data/metatft-augment-names.json', 'utf8'));
for (const [id, entry] of Object.entries(augmentNames.augments)) entry.name = names.augments[id] ?? '名称待更新';
for (const [id, name] of Object.entries(names.augments)) if (!augmentNames.augments[id]) augmentNames.augments[id] = { name };
augmentNames.meta = meta;
fs.writeFileSync('data/metatft-augment-names.json', JSON.stringify(augmentNames, null, 2) + '\n');
for (const file of ['data/comps.json', 'data/metatft-comps.json']) {
  const fileData = JSON.parse(fs.readFileSync(file, 'utf8'));
  const comps = file.endsWith('/comps.json') ? fileData.sets[set].flatMap(g => g.comps) : fileData.sets[set];
  for (const c of comps) {
    c.name = c.name.replace(/(?:DA_|TFT\d+_)[A-Za-z0-9_]+/g, id => names.units[id] ?? names.traits[id] ?? '待更新').replace(/(\d+)D/g, '$1级搜牌');
    if (/[A-Za-z]/.test(c.name)) {
      const traits = [...(c.synergy ?? [])].sort((a, b) => b.count - a.count).slice(0, 2).map(t => `${t.count}${names.traits[t.trait_id] ?? '羁绊'}`);
      c.name = `${traits.join(' / ') || '精选阵容'} · ${c.units.length}人`;
    }
  }
  fs.writeFileSync(file, JSON.stringify(fileData) + '\n');
}
console.log(`[zh_CN] S${set}: 英雄、羁绊、装备、海克斯及阵容已统一中文名称`);
