# TFTBot

TypeScript / Vue 重构的独立 Windows 云顶助手，直接打开桌面窗口。

默认使用 **MetaTFT** 阵容与海克斯评级，官网和 Blitz 用于辅助对照。只保留最新赛季（当前 S18），英雄、阵容、装备、羁绊和海克斯名称统一中文。海克斯评级属于作者建议，不等同于统计胜率。

双击 [启动TFTBot.cmd](启动TFTBot.cmd)，或运行已打包的 `desktop-release/TFTBot-win32-x64/TFTBot.exe`。请保留整个发布文件夹。

```bash
npm start              # 构建并打开独立桌面窗口
npm run pack:desktop   # 生成独立 staging 便携包，不覆盖正在运行的版本
npm run test:desktop   # 真实 Electron 窗口冒烟检查
```

围绕玩家手选的阵容主线提供前期过渡留牌、赌狗 / 84 / 95 分类浏览、三类搜牌参考、4-2 替代核心比较及真实高人口变体，以及阵容筛选、中文英雄资料、独立局内评级与记牌浮窗。桌面规划与手选阵容同步。建议模型使用真实聚合关联、装备实体分配和有限牌池计算，真实排位收益尚待校准。对局采集依赖本机 `E:/amumu` 的原生组件，仓库不分发原版二进制；无需打开原版前端。当前不执行自动买牌、刷新或摆位。详见 [原生采集验证记录](docs/ORIGINAL-RECOGNITION.md) 与 [功能路线](docs/FEATURE-ROADMAP.md)。

以下同时保留宿主扩展的开发说明；独立桌面版不需要原阿木木客户端。

- **纯 TypeScript**：核心逻辑与 UI 分离，无框架绑定
- **事件驱动**：一份对局事件流（`update-info`）驱动全部窗口
- **本地快照**：英雄/装备/羁绊/阵容使用本地 JSON；部分图片仍通过远程地址加载
- **可二次开发**：命令注册表 + 依赖注入 + 纯函数控制器，扩展不用改核心

---

## 能力

| 模块 | 内容 |
| --- | --- |
| 悬浮层（trick） | 存活人数、己方棋盘、记牌器、三星预警（含"谁在追"）、阵容牌高亮 |
| 记牌器 | 全场副本数、剩余张数、追三费用过滤 |
| 三星预警 | 谁能三星、还差几张、每个玩家各持几张 |
| 阵容面板（tracker） | 多数据源阵容、Tier 分档、羁绊、站位热区、升级节奏、装备、开局分支 |
| 英雄详情（characterwin） | 属性、推荐装备、单卡表现、相关阵容 |
| 设置（settings） | 12 个开关 + 阵容源选择，改动实时生效 |
| 对局记录 | 事件 JSONL 采集与重放比对 |

---

## 快速开始

```bash
npm install
npm test          # 单元、SSR 和窗口交互回归
npm run typecheck
npm run build     # 产出 core / ui / boot 三个 chunk
npm run pack
npm run verify:release
```

开发预览（四窗口 + 假平台，先完成构建）：

```bash
npm run demo
npm run demo:ui
npm run demo:boot
```

装进宿主客户端：

```bash
node scripts/pack.mjs          # 打发布包
node scripts/ship.mjs --target "<宿主扩展目录>" --boot --apply  # 写入产物并备份窗口 HTML
```

---

## 目录

```
src/
  core/         事件模型、设置、命令注册表、数据源客户端、录像、shadow 录制
  game/         英雄表、记牌器算法、阵容数据与转换
  app/          命令装配（完整版 background / 精简版 lean）
  boot/         窗口分发与挂载（一个 chunk 服务所有窗口）
  windows/      trick / tracker / characterwin / settings 四个窗口页
  ui/           无状态组件（棋盘、棋子、悬停卡、阵容面板…）
data/           英雄/装备/羁绊/阵容/数据源快照（JSON）
tests/          单元 + SSR + 浏览器自检辅助
scripts/        构建、打包、校验、数据同步、demo
docs/           命令参考、构建变体、数据源、快速上手
```

---

## 架构

三层，依赖单向向下：

```
windows/  ── 只做渲染，接收 props，抛出事件
   ↓
app/      ── 命令装配：把 core 能力暴露成 IPC 命令
   ↓
core/     ── 纯逻辑：事件流、状态、算法、数据源、存储
```

- **控制器与渲染分离**：`windows/trick/controller.ts` 不依赖 Vue，可直接单测与回放
- **窗口分发是纯函数**：`pageForWindow(name)` 决定挂哪个页面，一份 boot chunk 通吃
- **受控组件**：面板的选中项、过滤条件由外部传入，便于 SSR 断言与任意状态管理
- **依赖注入**：`cube / getOwner / now / genId / local / fetch` 全部可注入，测试零网络

---

## 命令接口

宿主通过 `message.invoke(winId, command, payload)` 调用，注册表见 [`docs/IPC-COMMANDS.md`](docs/IPC-COMMANDS.md)。

```ts
broker.handle('getComps', async (payload) => allComps(payload));
broker.handle('getSettings', async () => settings.get());
```

新增命令：在 `src/app/lean.ts`（或 `background.ts`）里 `broker.handle(...)`，再补一条测试。

---

## 数据源

`data/` 下的 JSON 是唯一真相来源：

| 文件 | 内容 |
| --- | --- |
| `tft-sets.json` | 英雄 / 装备 / 羁绊 |
| `comps.json` | 内嵌阵容（按赛季分组） |
| `metatft-comps.json` | 外部数据源阵容快照（升级节奏、装备、站位、作者阵容、开局分支） |
| `metatft-early.json` | 前期棋盘聚类（按阶段） |

更新快照：`npm run metatft:sync`（见 [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md)）。

---

## 构建产物

| 产物 | 用途 |
| --- | --- |
| `dist/tftbot-core.js` | 逻辑库（可在 Node 里直接 import） |
| `dist/ui/tftbot-ui.js` | 组件库 |
| `dist/boot/tftbot-boot.js` | 自包含启动 chunk（Vue 已内联） |
| `dist/release/tftbot-*.zip` | 发布包（含安装/校验脚本） |

---

## 测试

```bash
npm test
npm run test:watch
npx vitest run tests/cardTracker.test.ts
```

覆盖：算法（记牌器/池子/追三）、状态（设置/命令/事件）、渲染（SSR 断言）、集成（窗口挂载、跨窗口联动、数据源解析）、回归（录像 → 摘要 golden）。

浏览器自检：`npm run demo:boot` 后打开生成的页面，标题会显示 `PASS/FAIL` 与逐项结果。

---

## 二次开发

1. **加命令**：`app/lean.ts` 里 `broker.handle`，在 `tests/broker.test.ts` 补用例
2. **加窗口**：`boot/lean.ts` 的 `pageForWindow` 加映射 + `mount*Window`，`windows/<name>/` 放控制器与页面
3. **换数据**：修改 `data/*.json` 后重新构建；JSON 会编译进 bundle
4. **换皮肤**：`ui/` 组件基于 scoped 样式，改 CSS 即可
5. **接外部数据**：`core/metatft.ts` 是范例（超时、重试、TTL 缓存、错误类型齐全）

---

## 说明

个人项目，用于 TFT 对局数据的可视化与自动化研究。数据来自公开统计接口，运行时不上报个人信息；`shadow` 录制只写本地。

图片/图标版权归各自所有者。


记牌器、刷牌金币估算及局内叠加层：见 [说明](docs/CARD-TRACKER.md)。对局面板打开记牌浮窗，F8 显示/隐藏，Ctrl+Shift+F8 切换鼠标穿透；海克斯评级独立显示在游戏三选一卡片下方。等级与持牌支持原生采集；新版完整实战仍待验收，S18 PBE 参考数值待核对。


## 候选对手采集（1.1.1）

当前还没有验证头像候选角标对应的原生字段，胜率使用全场等权参考。已增加被动字段探针，下次从工作区启动脚本运行时自动保留未知名单字段和事件。探针不改变决策权重。详见 [候选对手证据与验证](docs/OPPONENT-CANDIDATES.md)。

## 数据与仓库

正常构建直接使用 `data/` 中的当前赛季快照，不需要开发者机器上的外部目录。若重新生成装备/阵容机制资料，请设置 `METATFT_REFERENCE_DIR` 指向包含 `TFTSet18_latest_en_us.json` 等文件的本地参考目录；聚合资料重建还需要同步脚本生成的 `dist/` 缓存。

开发依赖使用 `npm ci` 安装。打包需要 Windows x64；原生采集测试另需本机原版组件。日志、用户配置、构建目录、便携程序、原版提取文件与内部工作记录不会提交到 Git。


## 主线阵容助手（1.2.0）

用户决定阵容主线，系统展示候选与辅助数据，不自动定阵。即使装备、海克斯与来牌一致，也不会自动关闭其它类型的候选；只有点击“设为主线”才切换参考与高亮。主线候选展示持牌、同行、过渡和机制关联，同玩法备选优先，跨类型仍可浏览。

已有真实棋盘支持的主线九人口及以上变体可在桌面查看，不保证其汇总均名就是本局升级收益。完整体验目标与实现边界见 [主线阵容助手设计](docs/COMPANION-EXPERIENCE.md)。
