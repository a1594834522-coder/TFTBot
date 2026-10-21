# 快速上手

## 1. 跑起来

```bash
npm install
npm test                 # 单元、SSR 和窗口交互回归
npm run typecheck
npm run build
```

## 2. 本地预览（不装客户端）

```bash
npm run demo:boot        # 生成 dist/boot/boot-demo.html
npx vite preview --outDir dist/boot --port 5180
# 打开 http://localhost:5180/boot-demo.html
```

打开页面后：

- `#app` 悬浮层（棋盘 / 记牌器 / 三星预警 / 玩家）
- `#app2` 阵容面板（前期走向 + 阵容列表 + 详情）
- `#app3` 英雄详情
- `#app4` 设置页

页面标题会显示 `PASS` / `FAIL` 与逐项检查结果（43 项）。

## 3. 装进客户端

```bash
node scripts/pack.mjs            # 打 zip
node scripts/verify-release.mjs  # 结构 / CRC / SHA-256 / 必需文件
node scripts/ship.mjs --target "<宿主扩展目录>" --boot --apply
```

窗口 HTML 首次改写前会在同目录保留 `.bak`，重复安装不会覆盖原始备份。脚本替换对应窗口的旧模块入口，避免两个 Vue 应用争用 `#app`；assets 更新前请自行保留原版本以便完整回滚。

## 4. 进游戏看这几处

| 位置 | 期望 |
| --- | --- |
| 悬浮层 | 存活人数、己方名字、棋盘、记牌器、赛季芯片 |
| 阵容面板 | 前期走向芯片（2-x…5-x）、阵容列表、源/Tier 芯片可点、详情含羁绊与小棋盘 |
| 英雄详情 | 属性、推荐装备、单卡表现、相关阵容 |
| 设置 | 12 个开关 + 4 个源芯片，改动后悬浮层立刻跟着变 |
| 阵容高亮 | 在阵容面板点一套，悬浮层棋盘上该套的棋子会亮 |

## 5. 采集一局事件（可选）

控制台里：

```js
localStorage.setItem('tftbot:shadow', '1');   // 下次启动生效
location.reload();
```

打完一局：

```js
__TFTBOT_SHADOW__.size();     // 录了多少条（环形上限 2000）
__TFTBOT_SHADOW__.dropped();  // 被裁掉多少
copy(__TFTBOT_SHADOW__.dump()); // JSONL 到剪贴板
```

存成 `fixtures/round-real.jsonl` 后重放比对：

```bash
node scripts/shadow.mjs fixtures/round-real.jsonl --set 18
node scripts/shadow.mjs fixtures/round-real.jsonl --golden fixtures/round.golden.json
```

## 6. 出问题怎么报

一句话 + 三样东西：

1. 哪个窗口（trick / tracker / characterwin / settings）
2. Console 红字
3. `__TFTBOT_SHADOW__.dump()` 的最后 20 行

## 已知边界

- 数据是离线快照：赛季更新后要重新 `npm run metatft:sync`
- 部分外部 id 没有中文名，会走 `prettifyId()` 兜底（如 `ElderDragon → Elder Dragon`）
- 宿主目录名沿用扩展标识，与项目名无关；改项目名不影响安装路径
