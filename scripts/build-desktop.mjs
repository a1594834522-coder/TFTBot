import { build as buildRenderer } from 'vite';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import './verify-current-data.mjs';
import './build-transition-library.mjs';
// The transition projection writes asynchronously; verify after it has completed.
await import('./verify-decision-data.mjs');
await fs.mkdir('dist/desktop/renderer', { recursive: true });
await buildRenderer({ configFile: 'vite.desktop.config.ts' });
await build({ entryPoints: { main: 'src/desktop/main.ts', preload: 'src/desktop/preload.ts', 'native-reader-worker': 'src/desktop/native-reader-worker.ts', 'scoreboard-worker': 'src/desktop/scoreboard-worker.ts','battle-worker':'src/desktop/battle-worker.ts' }, outdir: 'dist/desktop', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], sourcemap: true });
await fs.cp('data/metatft-model','dist/desktop/metatft-model',{recursive:true});
await fs.copyFile('data/decision-model-manifest.json','dist/desktop/decision-model-manifest.json');
console.log('[desktop] TypeScript 主进程、预加载与 Vue 界面构建完成');
