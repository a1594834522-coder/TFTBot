import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

/** 精简版 boot chunk：background(游戏专用) + trick 窗口页，自包含（Vue 一起打包） */
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  define: {
    'process.env.NODE_ENV': '"production"',
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: {
    target: 'chrome120',
    outDir: 'dist/boot',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'src/boot/lean.ts'),
      formats: ['es'],
      fileName: () => 'tftbot-boot.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
