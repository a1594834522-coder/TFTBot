import { it,expect } from 'vitest';
import { resolveSelectedComp } from '../src/game/selected-comp';
import { highlightedCompUnits } from '../src/game/selected-comp';
import { normalizeShopHero } from '../src/game/shop-mechanics';
import type { MetatftComp } from '../src/game/metatft-comps';
import { allComps, sourceOfComp } from '../src/game/comps-sources';
import { CURRENT_SET } from '../src/game/current-season';
import { shopOverlayLayout } from '../src/game/shop-overlay-layout';
import {applyDirectionSelection} from '../src/game/direction-selection';
import catalog from '../data/metatft-direction-catalog.json';
it('选定当前 MetaTFT 阵容，去重共享形态并拒绝过期键',()=>{
  const c=allComps({set:CURRENT_SET,source:'metatft'})[0];
  const selected=resolveSelectedComp(`${sourceOfComp(c)}:${c.id}`)!;
  expect(selected.name).toBe(c.name);expect(selected.units.length).toBeGreaterThan(0);expect(new Set(selected.units).size).toBe(selected.units.length);
  expect(resolveSelectedComp(null)).toBeNull();expect(()=>resolveSelectedComp('metatft:old-season')).toThrow();
});
it('选用真实核心变体，不会退回遗漏该主C的默认英雄名单',()=>{
  const profile=catalog.profiles.find(p=>p.pairs.some(pair=>{
    const base=resolveSelectedComp('metatft:'+p.key)!;return !base.units.includes(pair.carry)||!base.units.includes(pair.tank);
  }))!;
  const base=resolveSelectedComp('metatft:'+profile.key)!,pair=profile.pairs.find(pair=>!base.units.includes(pair.carry)||!base.units.includes(pair.tank))!;
  const selected=applyDirectionSelection(base,pair.id)!;
  expect(selected.directionId).toBe(pair.id);expect(selected.units).toEqual([...new Set(pair.templates[0].poolUnits)]);
  expect(selected.units).toContain(pair.carry);expect(selected.units).toContain(pair.tank);
  const changed=applyDirectionSelection(resolveSelectedComp(selected.key,null),selected.directionId)!;
  expect(changed.units).toEqual(selected.units);expect(highlightedCompUnits(changed)).toEqual(selected.units);
  expect(()=>applyDirectionSelection(base,'not-a-variant')).toThrow();
});
it('商店高亮沿用原版 16:9 与 4:3 比例',()=>{
  expect(shopOverlayLayout(1920,1080)).toMatchObject({left:'28.9%',width:'52%'});
  expect(shopOverlayLayout(1600,1200)).toMatchObject({left:'16.8%',width:'69%'});
});
it('过渡直接来自 MetaTFT earlyOptions，切换后高亮成型和过渡的并集',()=>{
  const c=allComps({set:CURRENT_SET,source:'metatft'}).find(c=>String(c.id).endsWith('426021')) as MetatftComp;
  const selected=resolveSelectedComp(`${sourceOfComp(c)}:${c.id}`)!;
  expect(selected.transitions).toHaveLength(3);
  for(const t of selected.transitions!)expect(c.details!.earlyOptions!.some(o=>o.units.map(normalizeShopHero).sort().join('|')===[...t.units].sort().join('|'))).toBe(true);
  const changed=resolveSelectedComp(selected.key,selected.transitions![1].id)!;
  expect(new Set(highlightedCompUnits(changed))).toEqual(new Set([...changed.units,...changed.transitions![1].units]));
  expect(highlightedCompUnits(resolveSelectedComp(selected.key,null))).toEqual(selected.units);
  expect(()=>resolveSelectedComp(selected.key,'missing')).toThrow();
});
