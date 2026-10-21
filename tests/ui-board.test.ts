import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { BoardSlot, TftBoard, CardTrackerStrip, components, UI_VERSION } from '../src/ui/index';
import { dataset } from '../src/game/tft-data';

async function render(comp: any, props: Record<string, any>): Promise<string> {
  const app = createSSRApp({ render: () => h(comp, props) });
  return renderToString(app);
}

const CH = 'DA_18_Caitlyn';

describe('UI：棋盘格 BoardSlot', () => {
  it('有棋子时渲染图标/名字/星级/装备点', async () => {
    const html = await render(BoardSlot, { characterId: CH, level: 3, items: ['DA_Component_BFSword', 'TFT_Item_InfinityEdge'], slot: 5 });
    expect(html).toContain('slot');
    expect(html).toContain('data-slot="5"');
    expect(html).toContain(`data-character-id="${CH}"`);
    expect(html).toContain('凯特琳');
    expect(html).toContain('★★★');
    expect((html.match(/class="dot"/g) ?? []).length).toBe(2);
  });

  it('空格渲染 dashed 占位且无角色属性', async () => {
    const html = await render(BoardSlot, { slot: 0 });
    expect(html).toContain('empty');
    // Vue SSR 对空字符串属性输出裸属性名（data-character-id），不带值
    expect(html).toMatch(/data-character-id(\s|>|=)/);
    expect(html).toContain('title="空格"');
  });

  it('highlight 命中时带高亮 class', async () => {
    const html = await render(BoardSlot, { characterId: CH, highlight: true });
    expect(html).toContain('highlight');
  });
});

describe('UI：TftBoard 棋盘', () => {
  const champions = [
    { character_id: CH, position: 0, level: 2 },
    { character_id: 'DA_18_Ahri', position: 7, level: 1 },
    { character_id: 'DA_18_Caitlyn', position: 3, level: 1 },
    { character_id: 'DA_18_Ahri', position: 28, level: 2 },
  ];

  it('渲染 28 个棋盘格 + 9 个备战席格', async () => {
    const html = await render(TftBoard, { champions });
    const slots = [...html.matchAll(/data-slot="(\d+)"/g)].map((m) => Number(m[1]));
    expect(slots.length).toBe(28 + 9);
    expect(Math.max(...slots)).toBe(36);
  });

  it('按 position 摆放；备战席棋子不会被填到棋盘空格里', async () => {
    const html = await render(TftBoard, { champions });
    expect(html).toContain('data-slot="0" data-character-id="' + CH + '"');
    expect(html).toContain('data-slot="3" data-character-id="' + CH + '"');
    expect(html).toContain('data-slot="7" data-character-id="DA_18_Ahri"');
    // 备战席（28）是 Garen 2 星
    expect(html).toContain('data-slot="28" data-character-id="DA_18_Ahri"');
    // 关键回归：37 格里只有 4 个真的落子（3 个棋盘 + 1 个备战席）
    const filled = [...html.matchAll(/data-slot="(\d+)"[^>]*data-character-id="([^"]+)"/g)];
    expect(filled.length).toBe(4);
    // 棋盘空格（2/4/5/6 等）必须保持空
    expect(html).not.toContain('data-slot="2" data-character-id="TFT16');
  });

  it('position 冲突时第二只按顺序落到空格，不丢棋子', async () => {
    const clash = [
      { character_id: CH, position: 0 },
      { character_id: 'DA_18_Ahri', position: 0 },
    ];
    const html = await render(TftBoard, { champions: clash });
    const filled = [...html.matchAll(/data-slot="(\d+)"[^>]*data-character-id="([^"]+)"/g)];
    expect(filled.length).toBe(2);
    expect(filled.map((m) => m[2]).sort()).toEqual(['DA_18_Ahri', CH]);
  });

  it('超出棋盘/无 position 的棋子会被顺序填补', async () => {
    const html = await render(TftBoard, { champions: [{ character_id: CH }, { character_id: CH, position: 99 }] });
    const filled = [...html.matchAll(/data-character-id="(DA_18_Caitlyn)"/g)].length;
    expect(filled).toBe(2);
  });

  it('可配置行列与备战席数量', async () => {
    const html = await render(TftBoard, { champions: [], rows: 2, cols: 3, benchSlots: 2 });
    const slots = [...html.matchAll(/data-slot="(\d+)"/g)];
    expect(slots.length).toBe(6 + 2);
    expect(html).toContain('data-rows="2"');
    expect(html).toContain('data-cols="3"');
  });

  it('highlightIds 会传到对应格', async () => {
    const html = await render(TftBoard, { champions, highlightIds: ['DA_18_Ahri'] });
    expect(html).toContain('highlight');
  });
});

describe('UI：CardTrackerStrip 记牌器', () => {
  const rows = [
    { champion: 'DA_18_Caitlyn', cost: 2, owned: 9, remaining: 3 },
    { champion: 'DA_18_Ahri', cost: 1, owned: 6, remaining: 1 },
    { champion: 'TFT17_Teemo', cost: 4, owned: 2, remaining: 8 },
  ];

  it('按剩余升序渲染，并显示中文名', async () => {
    const html = await render(CardTrackerStrip, { rows });
    const order = [...html.matchAll(/data-champion="([^"]+)"/g)].map((m) => m[1]);
    expect(order[0]).toBe('DA_18_Ahri'); // 剩 1
    expect(order[1]).toBe('DA_18_Caitlyn'); // 剩 3
    expect(html).toContain('data-remaining="1"');
    expect(html).toContain('凯特琳');
  });

  it('limit 生效；空数据显示占位文案', async () => {
    const html = await render(CardTrackerStrip, { rows, limit: 1 });
    expect((html.match(/data-champion=/g) ?? []).length).toBe(1);
    const empty = await render(CardTrackerStrip, { rows: [] });
    expect(empty).toContain('暂无数据');
  });

  it('costs 过滤', async () => {
    const html = await render(CardTrackerStrip, { rows, costs: [4] });
    expect(html).toContain('data-champion="TFT17_Teemo"');
    expect(html).not.toContain('data-champion="DA_18_Ahri"');
  });
});

describe('UI 导出面', () => {
  it('8 个组件（含 CompsPanel / TrickPage）+ 版本号', () => {
    expect(Object.keys(components).sort()).toEqual([
      'BoardSlot',
      'CardTrackerStrip',
      'CharacterHover',
      'CompsPanel',
      'ItemHover',
      'TftBoard',
      'TraitHover',
      'TrickPage',
    ]);
    expect(UI_VERSION).toBe('0.4.0');
  });

  it('棋盘组件能直接吃 core 输出的职业数据', async () => {
    // 用真实数据集构造一个棋子，验证 UI 与数据层打通
    const champ = dataset.characterById(CH)!;
    const html = await render(TftBoard, { champions: [{ character_id: champ.character_id, position: 0, level: 2 }] });
    expect(html).toContain(champ.display_name);
  });
});
