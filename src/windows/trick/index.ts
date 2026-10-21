/**
 * trick 窗口入口：把 cube 事件接到控制器，再挂 Vue 页面。
 * 在真机上由 window HTML 里 `<script type="module" src="...">` 调用 mountTrick()。
 */
import { createApp, h } from 'vue';
import TrickPage from './TrickPage.vue';
import { createTrickController } from './controller';
import type { TrickCorePort } from './controller';
import type { ChampionCatalogEntry } from '../../game/cardTracker';

export interface MountTrickOptions {
  /** 核心（真机传 createCore() 的结果；测试可传桩） */
  core: TrickCorePort;
  /** 挂载点，默认 #app */
  el?: string | HTMLElement;
  catalog?: ChampionCatalogEntry[];
  set?: number;
  meName?: string;
}

export function mountTrick(opts: MountTrickOptions) {
  const controller = createTrickController({ core: opts.core, catalog: opts.catalog, meName: opts.meName });
  const el = typeof opts.el === 'string' ? opts.el : opts.el ?? '#app';
  const app = createApp({
    render: () => h(TrickPage, { controller, set: opts.set ?? 16 }),
  });
  app.mount(el as any);
  return { app, controller };
}

export { TrickPage, createTrickController };
export type { TrickController, TrickState, TrickCorePort } from './controller';
