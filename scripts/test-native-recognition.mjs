import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
const require = createRequire(import.meta.url);
const electron = require('electron');
const env = { ...process.env, TFTBOT_TEST_CHANNEL: `TFTBot-native-test-${process.pid}-${Date.now()}`, TFTBOT_SMOKE_DIR: path.resolve(process.env.TFTBOT_TEST_PURCHASE==='1'?'dist/native-purchase-smoke':process.env.TFTBOT_TEST_COMBAT_AUX==='1'?'dist/native-combat-smoke':'dist/native-recognition-smoke') };
await fs.access('E:/amumu/resources/win64/node-native.node');
const fixture = spawn(electron, [path.resolve('scripts/native-recognition-fixture.cjs')], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('原生测试服务启动超时')), 8000);
    fixture.once('error', reject);
    fixture.once('exit', code => { clearTimeout(timer); reject(new Error(`测试服务提前退出 ${code}`)); });
    fixture.stdout.on('data', chunk => { if (String(chunk).includes('NATIVE_FIXTURE_READY')) { clearTimeout(timer); resolve(); } });
    fixture.stderr.on('data', chunk => process.stderr.write(chunk));
  });
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged=process.env.TFTBOT_SMOKE_EXE;
  const app = spawn(packaged??electron, [...(packaged?[]:[path.resolve('dist/desktop/main.cjs')]), '--smoke', '--native-smoke',...process.argv.slice(2)], { env, windowsHide: true, stdio: 'inherit' });
  process.exitCode = await new Promise((resolve, reject) => { app.once('error', reject); app.once('exit', code => resolve(code ?? 1)); });
} finally { fixture.kill(); }
