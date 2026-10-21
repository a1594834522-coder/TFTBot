import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { CharacterHover, ItemHover, TraitHover, components, UI_VERSION } from '../src/ui/index';

async function render(comp: any, props: Record<string, any>): Promise<string> {
  const app = createSSRApp({ render: () => h(comp, props) });
  return renderToString(app);
}

describe('UI：棋子悬浮卡', () => {
  it('渲染真实数据（名字/费用/羁绊/技能/装备）', async () => {
    const html = await render(CharacterHover, { characterId: 'DA_18_Caitlyn', set: 18, level: 2, items: ['DA_Component_BFSword'] });
    expect(html).toContain('凯特琳');
    expect(html).toContain('2费');
    expect(html).toContain('★★');
    expect(html).toContain('data-character-id="DA_18_Caitlyn"');
    expect(html).toContain('data-trait-id=');
    expect(html).toContain('暴风大剑');
    // 2 星血量 = 基础 ×1.8
    expect(html).toMatch(/9\d\d HP/);
  });

  it('compact 模式只留头部+羁绊，不渲染技能描述', async () => {
    const html = await render(CharacterHover, { characterId: 'DA_18_Caitlyn', set: 18, compact: true });
    expect(html).toContain('凯特琳');
    expect(html).not.toContain('ch-desc');
    expect(html).not.toContain('推荐');
  });

  it('未知棋子有明确兜底，不抛错', async () => {
    const html = await render(CharacterHover, { characterId: 'NOT_A_CHAMP' });
    expect(html).toContain('未知棋子');
    expect(html).toContain('NOT_A_CHAMP');
  });
});

describe('UI：装备悬浮卡', () => {
  it('基础件显示可合成去向', async () => {
    const html = await render(ItemHover, { itemId: 'DA_Component_BFSword' });
    expect(html).toContain('暴风大剑');
    expect(html).toContain('基础件');
    expect(html).toContain('可合成');
    expect(html).toContain('无尽之刃');
  });

  it('minimal 只显示头部', async () => {
    const html = await render(ItemHover, { itemId: 'DA_Component_BFSword', minimal: true });
    expect(html).toContain('暴风大剑');
    expect(html).not.toContain('it-desc');
  });

  it('未知装备兜底', async () => {
    const html = await render(ItemHover, { itemId: 'nope' });
    expect(html).toContain('未知装备');
  });
});

describe('UI：羁绊悬浮卡', () => {
  it('按人数点亮层级并给出下一档距离', async () => {
    const html = await render(TraitHover, { traitId: 'DA_18_Inferno', count: 3 });
    expect(html).toContain('data-count="3"');
    expect(html).toContain('active'); // 2 人档已亮
    expect(html).toContain('再 1 人'); // 到 4 人
  });

  it('0 人不显示计数，未知羁绊兜底', async () => {
    const html = await render(TraitHover, { traitId: 'DA_18_Inferno', count: 0 });
    expect(html).not.toContain('tr-count');
    const bad = await render(TraitHover, { traitId: 'nope' });
    expect(bad).toContain('未知羁绊');
  });
});

describe('UI 导出面', () => {
  it('组件与版本', () => {
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
});
