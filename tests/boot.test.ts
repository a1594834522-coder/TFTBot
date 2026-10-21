import { describe, expect, it } from 'vitest';
import { detectWindow, BOOT_VERSION } from '../src/boot/lean';
import type { Cube } from '../src/core/cube';

const cubeWith = (windowId: string) =>
  ({ windows: { current: { id: () => windowId, isOffscreen: () => false, dragMove: () => {} } } }) as unknown as Cube;

describe('boot：窗口识别', () => {
  it('优先用 cube.windows.current.id()', () => {
    expect(detectWindow(cubeWith('trick'))).toBe('trick');
    expect(detectWindow(cubeWith('tracker'))).toBe('tracker');
  });

  it('拿不到 cube 时退回 location 解析（node 环境下为空串）', () => {
    expect(detectWindow(undefined)).toBe('');
  });

  it('cube 抛错也不炸', () => {
    const bad = {
      windows: {
        current: {
          id: () => {
            throw new Error('boom');
          },
        },
      },
    } as unknown as Cube;
    expect(detectWindow(bad)).toBe('');
  });

  it('版本号', () => {
    expect(BOOT_VERSION).toBe('0.2.0');
  });
});
