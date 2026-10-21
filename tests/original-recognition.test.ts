import { describe, expect, it } from 'vitest';
import { createOriginalRecognition, decodeOriginalInfo } from '../src/recognition/original-events';
import { dataset } from '../src/game/tft-data';
import { bundledAugmentTiers } from '../src/game/metatft-augments';

// Synthetic packets matching recovered contracts; these are not claimed as live game captures.
const packet = (key: string, value: unknown) => JSON.stringify({ type: 'info', category: 'game_info', key, value: typeof value === 'string' ? value : JSON.stringify(value) });
const heroes = dataset.characters.slice(0, 5).map(c => ({ name: c.character_id }));
const choices = Object.fromEntries(bundledAugmentTiers.augments.slice(0, 3).map((a, i) => [`augment_${i + 1}`, { name: a.id }]));
describe('原版原生识别协议的 TS 接入', () => {
  it('接受真实协议形式的 UTF-8 字节流，商店保留槽位并映射当前英雄中文名', () => {
    const reader = createOriginalRecognition();
    expect(reader.accept(new TextEncoder().encode(packet('tft_shop', heroes)))).toBe(true);
    expect(reader.view().shopReady).toBe(true);
    expect(reader.view().shop.map(c => c?.name)).toEqual(dataset.characters.slice(0, 5).map(c => c.display_name));
  });
  it('海克斯三选一通过 ID 关联中文名和 MetaTFT 评级', () => {
    const reader = createOriginalRecognition(); reader.accept(packet('tft_augments', choices));
    expect(reader.view().augmentsReady).toBe(true);
    expect(reader.view().augments.map(c => c?.rating)).toEqual(bundledAugmentTiers.augments.slice(0, 3).map(a => a.rating));
    expect(reader.view().augments.every(c => /[\u3400-\u9fff]/.test(c!.name))).toBe(true);
  });
  it('未识别 ID、历史英雄和不完整槽位不能被当作可决策状态', () => {
    const reader = createOriginalRecognition(); reader.accept(packet('tft_shop', [{ name: 'TFT16_Tristana' }, ...heroes.slice(1)]));
    expect(reader.view().shopReady).toBe(false);
    expect(reader.view().shop[0]).toMatchObject({ known: false, name: '未识别英雄' });
    reader.accept(packet('tft_augments', { ...choices, augment_2: { name: 'unknown' } }));
    expect(reader.view().augmentsReady).toBe(false);
  });
  it('选择后和空帧清理旧海克斯，断开后清理全部状态', () => {
    const reader = createOriginalRecognition(); reader.accept(packet('tft_augments', choices));
    reader.accept(packet('tft_picked_augment', bundledAugmentTiers.augments[0].id));
    expect(reader.view().pickedAugment?.known).toBe(true);
    expect(reader.view().augments).toEqual([]);
    reader.accept(packet('tft_augments', {}));
    expect(reader.view().augments).toEqual([null, null, null]);
    reader.reset(); expect(reader.view().pickedAugment).toBeNull();
  });
  it('坏 JSON、错误类别和超出五槽的商店不覆盖上一有效帧', () => {
    const reader = createOriginalRecognition(); reader.accept(packet('tft_shop', heroes)); const before = reader.view();
    for (const bad of ['{bad', JSON.stringify({ type: 'info', category: 'other', key: 'tft_shop', value: '[]' }), packet('tft_shop', [...heroes, heroes[0]])]) expect(reader.accept(bad)).toBe(false);
    expect(reader.view()).toEqual(before);
    expect(decodeOriginalInfo(new Uint8Array([0xff]))).toBeNull();
  });
});
