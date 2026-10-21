// Import names, icons and recipe relations from the supplied MetaTFT definitions.
// Numeric PBE balance values are deliberately excluded.
import fs from 'node:fs';
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/current-season-data.mjs <TFTSet_latest_en_us.json>');
const definitions = JSON.parse(fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, ''));
const file = 'data/tft-sets.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const set = Math.max(...Object.keys(data.characters).map(Number));
if (definitions._metadata?.set !== `TFTSet${set}`) throw new Error('定义表赛季与当前英雄目录不符');
const zh = JSON.parse(fs.readFileSync('data/metatft-zh-names.json', 'utf8'));
if (zh.meta.set !== set) throw new Error('缺少当前赛季中文名称表');
data.characters = { [set]: data.characters[set] };
const image = (kind, id) => `https://cdn.metatft.com/file/metatft/${kind}/${id.toLowerCase()}.png`;
const items = [...definitions.items, ...(definitions.armory_items ?? [])];
data.items = items.map(i => ({ item_id: i.apiName, display_name: i.name, builds_from: i.composition ?? [], builds_into: items.filter(other => other.composition?.includes(i.apiName)).map(other => other.apiName), type: i.apiName.startsWith('DA_Component_') ? 1 : i.composition?.length ? 2 : 3, image_path: image('items', i.apiName) }));
data.traits = definitions.traits.map(t => ({ trait_id: t.apiName, display_name: t.name, image_path: image('traits', t.apiName), type: t.type }));
data.augments = definitions.augments.map(a => ({ augment_id: a.apiName, display_name: a.name, tier: { Silver: 1, Gold: 2, Prismatic: 3 }[a.rarity] }));
for (const i of data.items) i.display_name = zh.items[i.item_id] ?? '名称待更新';
for (const t of data.traits) t.display_name = zh.traits[t.trait_id] ?? '名称待更新';
for (const a of data.augments) a.display_name = zh.augments[a.augment_id] ?? '名称待更新';
fs.writeFileSync(file, JSON.stringify(data) + '\n');
const compsFile = 'data/comps.json';
const comps = JSON.parse(fs.readFileSync(compsFile, 'utf8'));
comps.sets = { [set]: comps.sets[set] };
fs.writeFileSync(compsFile, JSON.stringify(comps) + '\n');
console.log(JSON.stringify({ set, characters: data.characters[set].length, items: data.items.length, traits: data.traits.length, augments: data.augments.length }));
