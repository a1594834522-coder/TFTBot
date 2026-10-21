#!/usr/bin/env node
/**
 * ship.mjs —— 把构建产物装进 tftbot 包（真机可跑）
 *
 *   # 游戏专用 boot（推荐）：装 tftbot-boot.js，并在指定窗口写入一行启动脚本
 *   node scripts/ship.mjs --target "<appDir>" --boot --windows trick,tracker,characterwin
 *
 *   # 只要核心/UI chunk
 *   node scripts/ship.mjs --target "<appDir>" --windows main
 *
 * 默认是预演（只打印计划），加 --apply 才写文件；写入前对 HTML 做 .bak 备份；幂等。
 * 启动脚本注入形式：
 *   <script type="module" src="/assets/tftbot-boot.js"></script>
 *   <script type="module">window.__tftbot__?.boot?.()</script>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectBootHtml } from './install-html.mjs';

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const target = get('target');
const windows = String(get('windows', args.includes('--boot') ? 'trick,tracker,characterwin,settings' : 'main')).split(',').map((s) => s.trim()).filter(Boolean);
const apply = args.includes('--apply');
const boot = args.includes('--boot');
const withUi = args.includes('--ui') || boot;

if (!target) {
  console.error('用法: node scripts/ship.mjs --target <appDir> [--boot] [--ui] [--windows trick,tracker] [--apply]');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(target, 'assets');
if (!fs.existsSync(assetsDir)) {
  console.error('目标不像 tftbot 包（缺 assets/）:', target);
  process.exit(2);
}

/** 要复制的产物：core 始终要；boot/ui 按参数 */
const required = [path.join(root, 'dist', 'tftbot-core.js')];
if (boot || withUi) {
  const kind = boot ? 'boot' : 'ui';
  required.push(path.join(root, 'dist', kind, `tftbot-${kind}.js`), path.join(root, 'dist', kind, 'tftbot.css'));
}
for (const file of required) {
  if (!fs.existsSync(file)) { console.error('缺少产物，先 npm run build:', file); process.exit(2); }
}
const copies = [];
const coreChunk = path.join(root, 'dist', 'tftbot-core.js');
if (fs.existsSync(coreChunk)) copies.push({ from: coreChunk, name: 'tftbot-core.js' });

if (boot) {
  for (const f of ['tftbot-boot.js', 'tftbot-boot.js.map', 'tftbot.css']) {
    const p = path.join(root, 'dist', 'boot', f);
    if (fs.existsSync(p)) copies.push({ from: p, name: f });
  }
} else if (withUi) {
  for (const f of ['tftbot-ui.js', 'tftbot-ui.js.map', 'tftbot.css']) {
    const p = path.join(root, 'dist', 'ui', f);
    if (fs.existsSync(p)) copies.push({ from: p, name: f });
  }
}

if (!copies.length) {
  console.error('没有可装的产物，先 npm run build');
  process.exit(2);
}

/** 注入内容 */
const injectTags = [];
if (boot) {
  injectTags.push('<script type="module">import { boot } from "/assets/tftbot-boot.js"; await boot();</script>');
} else {
  injectTags.push('<script type="module" src="/assets/tftbot-core.js"></script>');
}
if (withUi) {
  const css = fs.existsSync(path.join(root, 'dist', boot ? 'boot' : 'ui', 'tftbot.css'));
  if (css) injectTags.unshift('<link rel="stylesheet" href="/assets/tftbot.css" />');
}

const marker = boot ? 'tftbot-boot.js' : 'tftbot-core.js';
let changed = 0;

for (const c of copies) {
  const dest = path.join(assetsDir, c.name);
  console.log(`[${apply ? 'write' : 'dry'}] copy ${c.name} -> ${dest}`);
  if (apply) fs.copyFileSync(c.from, dest);
  changed++;
}

for (const w of windows) {
  if (!/^[a-z][a-z0-9_-]*$/i.test(w)) throw new Error('Invalid window name: ' + w);
  const file = [path.join(target, 'src', 'pages', w, 'index.html'), path.join(target, 'pages', 'pages', w, 'index.html'), path.join(target, 'pages', w, 'index.html')].find((p) => fs.existsSync(p));
  if (!file) {
    console.log(`[skip] 找不到窗口 HTML: ${w}`);
    continue;
  }
  let html = fs.readFileSync(file, 'utf8');
  if (!boot && html.includes(marker)) {
    console.log(`[skip] 已注入 (${marker}): ${file}`);
    continue;
  }
  const block = injectTags.join('\n  ');
  const idx = html.search(/<script[^>]+type=["']module["']/i);
  const original = html;
  html = boot ? injectBootHtml(html, w) : idx >= 0 ? html.slice(0, idx) + block + '\n  ' + html.slice(idx) : /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `  ${block}\n</body>`) : html + '\n' + block;
  if (html === original) { console.log(`[skip] 已注入: ${file}`); continue; }
  console.log(`[${apply ? 'write' : 'dry'}] inject (${marker}) -> ${file}`);
  if (apply) {
    if (!fs.existsSync(file + '.bak')) fs.writeFileSync(file + '.bak', fs.readFileSync(file));
    fs.writeFileSync(file, html);
  }
  changed++;
}

console.log(
  `\n${apply ? '完成，共写入 ' + changed + ' 项，重启 tftbot 生效。' : '预演结束（' + changed + ' 项）；加 --apply 才会写入。'}`,
);
if (boot) console.log('提示：boot 会自动识别窗口（trick/tracker/characterwin），无需为每个窗口写不同代码。');
