import fs from 'node:fs';
const read = name => JSON.parse(fs.readFileSync(`data/${name}.json`, 'utf8'));
const data = read('tft-sets');
const set = Math.max(...Object.keys(data.characters).map(Number));
const onlyCurrent = (keys, label) => { if (keys.length !== 1 || Number(keys[0]) !== set) throw new Error(`${label} 必须仅包含 S${set}`); };
onlyCurrent(Object.keys(data.characters), '英雄');
const official = read('comps');
const mt = read('metatft-comps');
const early = read('metatft-early');
for (const [label, d] of [['阵容', official], ['MetaTFT', mt], ['前期阵容', early]]) onlyCurrent(Object.keys(d.sets), label);
const zh = read('metatft-zh-names');
if (zh.meta.set !== set || read('metatft-augment-names').meta.set !== set) throw new Error('中文名称表赛季不符');
const ratings = read('metatft-augments.raw').response;
for (const value of [mt.meta.tft_set, early.meta.tft_set, ratings.tft_set, ratings.tier_list_set]) if (value !== `TFTSet${set}`) throw new Error('外部来源赛季不符');
const comps = [...official.sets[set].flatMap(g => g.comps), ...mt.sets[set]];
const heroes = new Set(data.characters[set].map(c => c.character_id));
const items = new Set(data.items.map(i => i.item_id));
const traits = new Set(data.traits.map(t => t.trait_id));
for (const c of data.characters[set]) for (const t of c.trait_ids) if (!traits.has(t)) throw new Error(`英雄羁绊缺失 ${t}`);
for (const c of comps) for (const u of c.units) {
  if (!heroes.has(u.character_id)) throw new Error(`阵容英雄缺失 ${u.character_id}`);
  for (const i of u.items ?? []) if (!items.has(i)) throw new Error(`阵容装备缺失 ${i}`);
}
const names = [...data.characters[set], ...data.items, ...data.traits, ...data.augments].map(e => e.display_name).concat(comps.map(c => c.name));
// Official Chinese names can include Roman tiers and terms such as “DD街区”.
if (names.some(name => !name || !/[\u3400-\u9fff]/.test(name) || /(?:DA_|TFT\d+_)/.test(name))) throw new Error('存在缺失或非中文显示名称');
console.log(`[data] S${set} only · 中文名称和阵容引用校验通过`);
