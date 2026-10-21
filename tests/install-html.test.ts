import { describe, expect, it } from 'vitest';
import { injectBootHtml } from '../scripts/install-html.mjs';

describe('宿主窗口安装入口', () => {
  const original = '<html><head><script type="module" crossorigin src="/assets/trick-8da003d2.js"></script><script type="module" src="/keep.js"></script></head><body><div id="app"></div></body></html>';
  it('替换原窗口入口，保留其它脚本并加载样式和显式 boot 调用', () => {
    const html = injectBootHtml(original, 'trick');
    expect(html).not.toContain('/assets/trick-8da003d2.js');
    expect(html).toContain('/keep.js');
    expect(html).toContain('await boot()');
    expect(html).toContain('href="/assets/tftbot.css"');
    expect(injectBootHtml(html, 'trick')).toBe(html);
  });
  it('升级旧版全局调用不会重复启动或重复插入 CSS', () => {
    const legacy = original.replace('</head>', '<script type="module" src="/assets/tftbot-boot.js"></script><script type="module">window.__tftbot__?.boot?.()</script><link rel="stylesheet" href="/assets/tftbot.css"></head>');
    const html = injectBootHtml(legacy, 'trick');
    expect(html.match(/tftbot-boot\.js/g)).toHaveLength(1);
    expect(html.match(/tftbot\.css/g)).toHaveLength(1);
    expect(html).not.toContain('window.__tftbot__');
  });
  it('支持单引号与没有原模块入口的页面', () => {
    expect(injectBootHtml("<body><script src='/assets/tracker-abc.js' type='module'></script></body>", 'tracker')).not.toContain('tracker-abc.js');
    expect(injectBootHtml('<div id="app"></div>', 'settings')).toContain('await boot()');
  });
});
