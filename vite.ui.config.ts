import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

/** UI chunk：把 Vue 一起打进来，页面里 <script type="module"> 直接用 */
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  // lib 模式不会自动注入这些编译期常量，而 Vue 的 bundler 构建需要它们
  define: {
    'process.env.NODE_ENV': '"production"',
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: {
    target: 'chrome120',
    outDir: 'dist/ui',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'src/ui/index.ts'),
      formats: ['es'],
      fileName: () => 'tftbot-ui.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
