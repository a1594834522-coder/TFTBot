import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

/**
 * 产物是 ESM chunk：直接被 tftbot 的窗口 HTML 以
 *   <script type="module" src="/assets/tftbot-core.js"></script>
 * 引入（平台不校验包完整性，eV() 是 return !0）。
 *
 * 同一份配置也给 vitest 用（.vue 需要 plugin-vue 才能编译）。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: {
    target: 'chrome120',
    outDir: 'dist',
    // dist 同时存放桌面产物与运行中监控，构建 core 只覆盖自身产物。
    emptyOutDir: false,
    minify: false, // 分析项目保留可读性；要发布再开 esbuild
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'src/core/index.ts'),
      formats: ['es'],
      fileName: () => 'tftbot-core.js',
    },
    rollupOptions: {
      // 完全自包含：把 zod 之类打成一颗 chunk，应用里不需要 importmap / node_modules
      external: [],
      output: { inlineDynamicImports: true },
    },
  },
  test: {
    environment: 'node',
    // 交互测试编译客户端 render，其余测试保留 SSR 编译路径。
    testTransformMode: { web: ['**/boot-integration.test.ts', '**/current-season.test.ts'] },
    include: ['tests/**/*.test.ts'],
    // 单文件超时（数据层会解析 543KB JSON）
    testTimeout: 10000,
  },
});
