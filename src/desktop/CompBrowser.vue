<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { dataset } from '../game/tft-data';
import { sourceOfComp, sourcesFor, type CompsSource } from '../game/comps-sources';
import type { OfficialComp, CompUnit } from '../game/comps-data';
import type { MetatftComp } from '../game/metatft-comps';
import { displayName } from '../game/names';
import { iconUrl } from '../core/metatft';

const props = defineProps<{ comps: OfficialComp[]; set: number; source: CompsSource | 'all'; snapshotDate: string; selectedKey?: string | null }>();
const emit = defineEmits<{ (event: 'update:source', source: CompsSource | 'all'): void; (event: 'selectCharacter', id: string): void; (event: 'selectComp', key: string | null): void }>();
const tab = ref<'champions' | 'traits' | 'items'>('champions');
const search = ref('');
const filter = ref('');
const expanded = ref<string | null>(null);
const tier = ref<number | null>(null);
const query = computed(() => search.value.trim().toLowerCase());
const catalog = computed(() => {
  const entries = tab.value === 'champions' ? dataset.charactersOf(props.set).map(c => ({ id: c.character_id, name: c.display_name, image: c.image_path, cost: c.cost }))
    : tab.value === 'traits' ? dataset.traits.map(t => ({ id: t.trait_id, name: t.display_name, image: t.image_path, cost: 0 }))
    : dataset.items.map(i => ({ id: i.item_id, name: i.display_name, image: i.image_path, cost: 0 }));
  return entries.filter(e => (e.name + e.id).toLowerCase().includes(query.value));
});
function pickTab(next: typeof tab.value) { tab.value = next; search.value = ''; filter.value = ''; }
const unit = (id: string) => dataset.character(props.set, id);
const unitName = (id: string) => unit(id)?.display_name ?? displayName(id);
const itemName = (id: string) => dataset.item(id)?.display_name ?? displayName(id);
const portrait = (id: string) => unit(id)?.image_path ?? iconUrl('champions', id);
const compKey = (c: OfficialComp) => `${sourceOfComp(c)}:${c.id}`;
const meta = (c: OfficialComp) => sourceOfComp(c) === 'metatft' ? c as MetatftComp : null;
const sourceLabel = (c: OfficialComp) => ({ official: '官网', blitz: 'Blitz', metatft: 'MetaTFT' })[sourceOfComp(c)];
const tiers = ['OP', 'S', 'A', 'B', 'C', 'D'];
const rows = computed(() => props.comps.filter(c => {
  if (props.source !== 'all' && sourceOfComp(c) !== props.source) return false;
  if (tier.value !== null && c.tier !== tier.value) return false;
  if (!filter.value) return true;
  if (tab.value === 'champions') return c.units.some(u => u.character_id === filter.value);
  if (tab.value === 'traits') return c.synergy?.some(t => t.trait_id === filter.value) || c.units.some(u => unit(u.character_id)?.trait_ids.includes(filter.value));
  return c.units.some(u => u.items?.includes(filter.value)) || meta(c)?.details?.builds?.some(b => b.items.includes(filter.value));
}).sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99)));
watch(rows, list => { if (!list.some(c => compKey(c) === expanded.value)) expanded.value = list[0] ? compKey(list[0]) : null; }, { immediate: true });
const filterLabel = computed(() => catalog.value.find(e => e.id === filter.value)?.name ?? filter.value);
function background(c: OfficialComp) {
  return [...c.units].sort((a, b) => (unit(b.character_id)?.cost ?? 0) - (unit(a.character_id)?.cost ?? 0)).map(u => unit(u.character_id)?.background_path).find(Boolean);
}
function positioned(c: OfficialComp) { return c.units.filter(u => typeof u.position === 'number' && u.position >= 0 && u.position < 28); }
function cell(c: OfficialComp, position: number): CompUnit | undefined { return positioned(c).find(u => u.position === position); }
function early(c: OfficialComp): CompUnit[] { return c.early_units?.length ? c.early_units : (meta(c)?.details?.earlyOptions?.[0]?.units ?? []).map(character_id => ({ character_id })); }
function levels(c: OfficialComp) {
  const seen = new Set<number>();
  return [...(meta(c)?.details?.levels ?? [])].sort((a, b) => a.stage - b.stage || a.round - b.round).filter(l => l.stage > 0 && !seen.has(l.level) && !!seen.add(l.level)).slice(0, 6);
}
</script>
<template>
  <div class="comp-browser" data-desktop-view="comps">
    <aside class="catalog-panel">
      <div class="catalog-tabs"><button v-for="t in (['champions', 'traits', 'items'] as const)" :key="t" :data-kind="t" :class="{ chosen: tab === t }" @click="pickTab(t)">{{ { champions: '英雄', traits: '羁绊', items: '装备' }[t] }}</button></div>
      <div class="catalog-search"><span>⌕</span><input  :value="search" @input="search = ($event.target as HTMLInputElement).value" aria-label="搜索资料" placeholder="搜索名称…" /></div>
      <button v-if="filter" class="clear-filter" @click="filter = ''">{{ filterLabel }} × 清除筛选</button>
      <div class="catalog-grid"><button v-for="e in catalog" :key="e.id" :data-filter="e.id" :title="e.name + (tab === 'champions' ? ' · 双击查看资料' : '')" :aria-label="e.name" :aria-pressed="filter === e.id" :class="['portrait', `cost-${e.cost}`, { picked: filter === e.id }]" @click="filter = filter === e.id ? '' : e.id" @dblclick="tab === 'champions' && emit('selectCharacter', e.id)"><img :src="e.image" :alt="e.name" loading="lazy" /></button><p v-if="!catalog.length" class="muted">没有匹配资料</p></div>
      <div class="catalog-caption">S{{ set }} · {{ catalog.length }} 项<br />单击筛选阵容 · 双击英雄查看资料</div>
    </aside>
    <section class="compositions">
      <div class="comp-heading"><div><span class="eyebrow">TEAMFIGHT TACTICS · S{{ set }}</span><h1>阵容资料</h1><p>从数据中找到你的下一套阵容</p></div><div class="snapshot-note">本地快照<span>{{ snapshotDate }}</span></div></div>
      <div class="source-tabs"><button :class="{ chosen: source === 'all' }" @click="emit('update:source', 'all')">全部阵容</button><button v-for="s in sourcesFor(set).sort((a, b) => Number(b.id === 'metatft') - Number(a.id === 'metatft'))" :key="s.id" :data-source="s.id" :class="{ chosen: source === s.id }" @click="emit('update:source', s.id)">{{ s.label }} <small>{{ s.count }}</small></button></div>
      <div class="tier-filters"><span>{{ rows.length }} 套阵容</span><button :class="{ chosen: tier === null }" @click="tier = null">全部评级</button><button v-for="(label, index) in tiers.slice(0, 5)" :key="label" :class="{ chosen: tier === index }" @click="tier = index">{{ label }}</button></div>
      <div class="comp-cards">
        <article v-for="c in rows" :key="compKey(c)" :data-comp="compKey(c)" :class="['comp-card', { expanded: expanded === compKey(c) }]">
          <img v-if="background(c)" class="comp-art" :src="background(c)" alt="" loading="lazy" />
          <button class="comp-summary" :aria-expanded="expanded === compKey(c)" @click="expanded = expanded === compKey(c) ? null : compKey(c)">
            <span :class="['comp-tier', `tier-${c.tier}`]">{{ tiers[c.tier ?? -1] ?? '—' }}</span><span class="comp-title"><strong>{{ c.name }}</strong><small>{{ sourceLabel(c) }}<i v-for="tag in c.play_tags?.slice(0, 2)" :key="tag">{{ tag }}</i></small></span>
            <span class="summary-units"><span v-for="(u, i) in c.units" :key="u.character_id + i" :class="['portrait', `cost-${unit(u.character_id)?.cost}`]" :title="unitName(u.character_id)"><img :src="portrait(u.character_id)" :alt="unitName(u.character_id)" loading="lazy" /><span v-if="u.level && u.level > 1" class="stars">{{ '★'.repeat(u.level) }}</span></span></span><span class="chevron">{{ expanded === compKey(c) ? '⌃' : '⌄' }}</span>
          </button>
          <div class="comp-pick"><button :class="{ chosen: selectedKey === compKey(c) }" :data-pick-comp="compKey(c)" @click="emit('selectComp', selectedKey === compKey(c) ? null : compKey(c))">{{ selectedKey === compKey(c) ? '已选用 · 点击取消' : '选用阵容 · 高亮目标牌' }}</button></div>
          <div v-if="expanded === compKey(c)" class="comp-expanded">
            <div class="early-section"><h3>前期过渡</h3><div v-if="early(c).length" class="unit-strip"><button v-for="(u, i) in early(c)" :key="u.character_id + i" class="portrait" :title="unitName(u.character_id)" @click="emit('selectCharacter', u.character_id)"><img :src="portrait(u.character_id)" :alt="unitName(u.character_id)" loading="lazy" /></button></div><p v-else class="muted">此来源未提供过渡阵容</p><h3>核心装备</h3><div v-for="(b, i) in (meta(c)?.details?.builds ?? c.units.filter(u => u.items?.length).map(u => ({ unit: u.character_id, items: u.items! }))).slice(0, 3)" :key="i" class="build-row"><span>{{ b.unit ? unitName(b.unit) : '装备组合' }}</span><img v-for="(id, n) in b.items" :key="id + n" :src="dataset.item(id)?.image_path ?? iconUrl('items', id)" :title="itemName(id)" :alt="itemName(id)" loading="lazy" /></div></div>
            <div class="traits-section"><h3>羁绊</h3><div class="trait-chips"><span v-for="s in c.synergy" :key="s.trait_id" :title="dataset.trait(s.trait_id)?.display_name"><img :src="dataset.trait(s.trait_id)?.image_path ?? iconUrl('traits', s.trait_id)" alt="" />{{ dataset.trait(s.trait_id)?.display_name ?? displayName(s.trait_id) }}<b>{{ s.count }}</b></span><p v-if="!c.synergy?.length" class="muted">此来源未提供羁绊组合</p></div><template v-if="levels(c).length"><h3>升级节奏 <small>样本常见节点</small></h3><div class="level-steps"><span v-for="l in levels(c)" :key="l.level">{{ l.stage }}-{{ l.round }}<b>升 {{ l.level }}</b></span></div></template><div v-if="meta(c)?.avgPlace != null" class="comp-stats"><span>平均名次 <b>{{ meta(c)!.avgPlace!.toFixed(2) }}</b></span><span v-if="meta(c)?.games != null">样本 <b>{{ meta(c)!.games!.toLocaleString() }}</b></span></div></div>
            <div class="position-section"><h3>推荐站位 <small>{{ positioned(c).length ? '阵容参考' : '暂无站位数据' }}</small></h3><div class="mini-board"><div v-for="row in 4" :key="row" class="hex-row"><button v-for="col in 7" :key="col" class="hex" :disabled="!cell(c, (row - 1) * 7 + col - 1)" :title="cell(c, (row - 1) * 7 + col - 1) ? unitName(cell(c, (row - 1) * 7 + col - 1)!.character_id) : ''" @click="emit('selectCharacter', cell(c, (row - 1) * 7 + col - 1)!.character_id)"><img v-if="cell(c, (row - 1) * 7 + col - 1)" :src="portrait(cell(c, (row - 1) * 7 + col - 1)!.character_id)" alt="" loading="lazy" /></button></div></div></div>
          </div>
        </article>
        <div v-if="!rows.length" class="empty-comps"><h3>没有匹配的阵容</h3><p>试试其他数据源或清除筛选。</p><button @click="filter = ''; tier = null">清除筛选</button></div>
      </div>
    </section>
  </div>
</template>
<style scoped>
.comp-pick{position:relative;padding:0 20px 10px;text-align:right}.comp-pick button{font-size:11px;padding:5px 9px;color:#f9a5bf}.comp-pick button.chosen{background:#ff0050;color:#fff;border-color:#ff0050}
.comp-browser{display:grid;grid-template-columns:284px minmax(0,1fr);gap:26px;height:100%;min-height:0}.catalog-panel{border:1px solid #25262d;background:#121318;border-radius:7px;display:flex;flex-direction:column;min-height:0;padding:8px}.catalog-tabs{display:flex}.catalog-tabs button{flex:1;background:none;border:0;padding:13px 4px;font-size:12px}.catalog-tabs .chosen{color:#ff0050}.catalog-search{display:flex;align-items:center;background:#1b1c23;border-radius:6px;padding:0 12px;margin:3px 0 15px;gap:8px}.catalog-search span{font-size:22px;color:#a9abb7}.catalog-search input{border:0;background:none;min-width:0;width:100%;padding:10px 0;font-size:12px}.catalog-grid{display:grid;grid-template-columns:repeat(6,1fr);align-content:start;gap:15px 10px;overflow:auto;padding:6px 6px 16px;flex:1;min-height:0}.portrait{display:block;position:relative;border:1px solid #697181;background:#22252c;padding:0;border-radius:0;aspect-ratio:1;min-width:0}.portrait img{width:100%;height:100%;object-fit:cover;display:block}.portrait:hover,.portrait.picked{outline:2px solid #ff0050;outline-offset:2px}.cost-1{border-color:#72777f}.cost-2{border-color:#3e9e6a}.cost-3{border-color:#398dd6}.cost-4{border-color:#bc4fda}.cost-5,.cost-6,.cost-7{border-color:#e7aa47}.catalog-caption{font-size:10px;color:#70737f;border-top:1px solid #24252b;line-height:1.8;padding:13px 8px 4px}.clear-filter{font-size:11px;color:#ff7e9e;margin-bottom:12px;background:#301621;border:0}.compositions{overflow:auto;padding-right:8px;min-width:0}.comp-heading{display:flex;align-items:center;justify-content:space-between;margin:10px 0 18px}.comp-heading h1{font-size:44px;line-height:1.2;letter-spacing:-1px;margin:8px 0 7px}.comp-heading p{color:#b7bac8;margin:0;font-size:14px}.snapshot-note{color:#676b78;font-size:10px;text-align:right}.snapshot-note span{display:block;color:#a2a6b4;margin-top:5px}.source-tabs{display:flex;gap:12px;padding-bottom:17px;border-bottom:1px solid #22232b}.source-tabs button{font-size:12px;background:transparent;border:0;padding:8px 19px;border-radius:4px;color:#9ca0b1}.source-tabs button.chosen{color:white;background:#ff0050;box-shadow:0 4px 15px #ff005029}.source-tabs small{font-size:9px;margin-left:6px;opacity:.6}.tier-filters{display:flex;gap:8px;align-items:center;padding:12px 0 16px}.tier-filters>span{font-size:11px;color:#757a88;margin-right:auto}.tier-filters button{background:none;border:0;font-size:11px;padding:3px 8px;color:#7e8493}.tier-filters .chosen{color:#ff5a89;background:#2b1621}.comp-cards{display:flex;flex-direction:column;gap:14px;padding-bottom:20px}.comp-card{position:relative;isolation:isolate;overflow:hidden;border:1px solid #26272e;background:#16171d;border-radius:6px;flex-shrink:0}.comp-art{position:absolute;width:65%;height:100%;right:0;top:0;object-fit:cover;object-position:80% 25%;opacity:.14;z-index:-1;mask-image:linear-gradient(90deg,transparent,#000 85%)}.comp-summary{width:100%;display:flex;align-items:center;text-align:left;gap:15px;border:0;background:transparent;padding:19px 20px;min-height:83px;border-radius:0}.comp-summary:hover{background:#ffffff04}.comp-title{width:175px;min-width:120px;flex-shrink:0}.comp-title strong{display:block;font-size:12px;color:#f1f1f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.comp-title small{display:flex;gap:4px;font-size:9px;color:#878c9c;margin-top:6px}.comp-title i{font-style:normal;background:#24262e;padding:0 3px}.comp-tier{display:grid;place-items:center;background:#74808f;color:#09131e;width:19px;height:24px;font-size:11px;font-weight:900;clip-path:polygon(0 0,100% 0,100% 75%,50% 100%,0 75%);flex-shrink:0}.tier-0{background:#7bc7ff}.tier-1{background:#ffc12e}.tier-2{background:#d8cbea}.summary-units{display:flex;gap:9px;flex-wrap:wrap;min-width:0;flex:1}.summary-units .portrait{width:33px;height:33px;flex-shrink:0}.stars{position:absolute;bottom:-8px;left:0;color:#f7d674;font-size:8px;letter-spacing:-2px;text-shadow:0 1px 2px black;white-space:nowrap}.chevron{margin-left:auto;color:#a2a5b4;font-size:20px}.comp-expanded{position:relative;border-top:1px solid #ffffff09;display:grid;grid-template-columns:minmax(140px,.8fr) minmax(170px,1fr) 253px;gap:22px;padding:0 24px 24px}.comp-expanded h3{font-size:11px;font-weight:500;margin:17px 0 13px;color:#e5e6eb}.comp-expanded h3 small{font-size:9px;color:#6e7482;margin-left:6px}.unit-strip{display:flex;gap:5px;flex-wrap:wrap}.unit-strip .portrait{height:28px;width:28px}.muted{font-size:10px;color:#6e7482}.build-row{display:flex;gap:4px;align-items:center;margin:8px 0}.build-row span{font-size:10px;color:#9b9fad;min-width:42px}.build-row img{width:22px;height:22px;border:1px solid #474d57}.trait-chips{display:flex;flex-wrap:wrap;gap:7px 5px}.trait-chips>span{font-size:9px;display:flex;align-items:center;gap:4px;padding:3px 5px;background:#47283f;border-radius:3px;color:#e8d7e4}.trait-chips img{width:17px;height:17px;object-fit:contain}.trait-chips b{color:#ffb5d1;font-size:10px}.level-steps{display:flex;flex-wrap:wrap;gap:7px}.level-steps span{font-size:10px;color:#9095a4;background:#20222a;padding:4px 8px}.level-steps b{display:block;color:#c6cad4;font-size:10px;font-weight:500}.comp-stats{display:flex;gap:12px;margin-top:16px;font-size:10px;color:#8c92a2}.comp-stats b{color:#e2bf7b;margin-left:5px}.mini-board{padding:4px 0}.hex-row{display:flex;gap:3px;height:31px}.hex-row:nth-child(even){padding-left:17px}.hex{width:31px;height:35px;padding:2px;border:0;border-radius:0;background:#292c36;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}.hex:disabled{opacity:.65;cursor:default}.hex img{width:100%;height:100%;object-fit:cover;clip-path:inherit}.empty-comps{padding:50px;text-align:center;color:#989eaf}.empty-comps h3{color:#dadce4}.empty-comps p{font-size:12px}@media(max-width:1250px){.comp-browser{grid-template-columns:244px minmax(0,1fr);gap:20px}.catalog-grid{gap:12px 7px}.comp-title{width:145px}.comp-expanded{grid-template-columns:1fr 1fr;gap:16px}.position-section{grid-column:2;grid-row:1 / span 2}.traits-section{grid-column:1}.summary-units{gap:6px}.summary-units .portrait{width:29px;height:29px}.comp-heading h1{font-size:38px}}
</style>
