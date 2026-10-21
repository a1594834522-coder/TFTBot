/** 替换单个窗口的入口，避免新旧 Vue 应用同时挂载 #app。 */
export function injectBootHtml(html, windowName) {
  if (!/^[a-z][a-z0-9_-]*$/i.test(windowName)) throw new Error('Invalid window name');
  const oldEntry = new RegExp(`/assets/${windowName}(?:-[\\w-]+)?\\.js(?:[?"'])`, 'i');
  if (html.includes('data-tftbot="boot"') && html.includes('data-tftbot="style"') && !oldEntry.test(html)) return html;
  let next = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
    if (/tftbot-boot\.js|window\.__tftbot__/.test(tag)) return '';
    return /\btype\s*=\s*["']module["']/i.test(tag) && oldEntry.test(tag) ? '' : tag;
  });
  next = next.replace(/<link\b[^>]*href\s*=\s*["'][^"']*\/tftbot\.css["'][^>]*>/gi, '');
  const block = '<link data-tftbot="style" rel="stylesheet" href="/assets/tftbot.css" />\n' +
    '<script data-tftbot="boot" type="module">import { boot } from "/assets/tftbot-boot.js"; await boot();</script>';
  return /<\/head>/i.test(next) ? next.replace(/<\/head>/i, `${block}\n</head>`) :
    /<\/body>/i.test(next) ? next.replace(/<\/body>/i, `${block}\n</body>`) : `${next}\n${block}`;
}
