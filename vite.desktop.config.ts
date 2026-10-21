import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve(__dirname, 'src/desktop'), base: './', plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: { target: 'chrome120', outDir: resolve(__dirname, 'dist/desktop/renderer'), emptyOutDir: true, sourcemap: true },
});
