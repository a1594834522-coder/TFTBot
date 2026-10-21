import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import TrickPage from '../src/windows/trick/TrickPage.vue';
import CharacterPage from '../src/windows/characterwin/CharacterPage.vue';
import { createTrickController } from '../src/windows/trick/controller';
import type { TrickCorePort } from '../src/windows/trick/controller';
import { buildSnapshot } from '../src/game/roster';
import { dataset } from '../src/game/tft-data';
import { comps as compsData } from '../src/game/comps-data';
import type { RankEntryView } from '../src/core/rank';

const catalog = dataset.charactersOf(18).map((c) => ({ character_id: c.character_id, display_name: c.display_name, cost: c.cost }));
const snap = buildSnapshot(
  [{ summoner: 'Me', tag_line: '1', health: 60, index: 0 }],
  [{ summoner: 'Me', tag_line: '1', champions: [{ name: 'DA_18_Caitlyn', level: 2 }] }],
);
const coreOf = (s: any): TrickCorePort => ({ snapshot: () => s, onGame: () => () => {} });
const render = (comp: any, props: Record<string, any>) => renderToString(createSSRApp({ render: () => h(comp, props) }));

const rank: RankEntryView = {
  queue: 'RANKED_TFT',
  tier: 'DIAMOND',
  division: 'I',
  lp: 88,
  wins: 9,
  losses: 1,
  winRate: 0.9,
  label: '钻石 I 88LP',
};

describe('trick 页接通赛季/段位', () => {
  it('顶栏显示赛季芯片与段位（compact）', async () => {
    const ctrl = createTrickController({ core: coreOf(snap), catalog });
    ctrl.apply(snap, 'players_info');
    const html = await render(TrickPage, { controller: ctrl, set: 18, supportSets: [16, 17, 18], rank });
    expect(html).toContain('data-current="18"');
    expect(html).toContain('data-set="17"');
    expect(html).toContain('data-tier="DIAMOND"');
    expect(html).toContain('钻石 I 88LP');
    ctrl.dispose();
  });

  it('没传 supportSets/rank 时不渲染（保持简洁）', async () => {
    const ctrl = createTrickController({ core: coreOf(snap), catalog });
    ctrl.apply(snap);
    const html = await render(TrickPage, { controller: ctrl });
    expect(html).not.toContain('data-set=');
    expect(html).not.toContain('data-tier=');
    ctrl.dispose();
  });
});

describe('characterwin 页切换赛季', () => {
  it('最新赛季芯片与英雄数据可渲染', async () => {
    const html = await render(CharacterPage, {
      characterId: 'DA_18_Caitlyn',
      set: 18,
      supportSets: [16, 17, 18],
    });
    expect(html).toContain('data-current="18"');
    expect(html).toContain('data-set="18"');
    expect(html).toContain('凯特琳');
  });

  it('指定当前赛季时查询英雄数据', async () => {
    const c17 = dataset.charactersOf(18)[0];
    const html = await render(CharacterPage, { characterId: c17.character_id, set: 18, supportSets: [18] });
    expect(html).toContain(c17.character_id);
    expect(html).toContain(c17.display_name);
    expect(html).toContain('data-current="18"');
  });

  it('当前赛季英雄无需历史数据即可显示', async () => {
    const html = await render(CharacterPage, { characterId: 'DA_18_Caitlyn', set: 18 });
    expect(html).toContain('data-character-id="DA_18_Caitlyn"');
    expect(html).not.toContain('未知');
  });

  it('相关阵容按当前赛季过滤', async () => {
    const s17 = dataset.charactersOf(18).find((c) => compsData.byChampion(18, c.character_id).length > 0)!;
    const html = await render(CharacterPage, { characterId: s17.character_id, set: 18, comps: compsData.comps(18) });
    const ids = [...html.matchAll(/data-comp-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const c = compsData.comp(18, id)!;
      expect(c.units.some((u) => u.character_id === s17.character_id)).toBe(true);
    }
  });
});
