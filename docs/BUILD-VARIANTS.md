# 构建变体

项目有两套命令装配，共用同一份 `core/` 与 `ui/`：

| 变体 | 入口 | 命令数 | 场景 |
| --- | --- | --- | --- |
| 完整版 | `src/app/background.ts` → `createBackgroundApp` | 见 `SUPPORTED_COMMAND_NAMES` | 需要直播/录制/调试/账号等周边能力 |
| 精简版 | `src/app/lean.ts` → `createLeanBackground` | 见 `LEAN_COMMANDS` | 只做游戏内面板（默认发布用） |

两者共用 store/service，但返回接口不完全相同。默认窗口启动器依赖 `LeanApp` 的段位服务、当前赛季与变更订阅。

## 怎么切换

`src/boot/lean.ts` 只 import 精简版：

```ts
const lean = createLeanBackground(cube, opts);
await lean.ready();
```

要使用完整版，需要为 `createBackgroundApp` 补充窗口启动器需要的 `rank`、`currentSet()`、`setCurrentSet()`、`subscribeSet()` 等适配，不能只替换函数名。

## 精简版去掉了什么

| 分组 | 去掉的命令 |
| --- | --- |
| 账号 / 登录 | `probeEmailBindStatus`、`requestEmailBindProbe`、`forceLogoutCleanup` |
| 广告 | `closeAdWindow` |
| 直播 | `getLiveList`、`getObsState` |
| 录制 / 回放 | `deleteRecordMedia`、`getRecordBaseSetting`、`recordMediaChanged`、`recordStateChanged`、`getVideoEncoders` |
| 调试 / 实验 | `checkGpuEnable`、`getHexArguments`、`getHexStatus`、`pauseHexMsgFollow`、`icChanged`、`featureUnlockChanged` |
| 杂项 | `getUnitsItems`、`getInviteCount` |

这些能力的模块（`core/recorder.ts`、`core/replay.ts`、`core/hex-order.ts`、`core/features.ts`）仍然保留且带测试，需要时在完整版里直接接线即可。

## 产物

```bash
npm run build           # core + ui + boot
npm run build:core      # dist/tftbot-core.js（库，可在 Node 里 import）
npm run build:ui        # dist/ui/tftbot-ui.js
npm run build:boot      # dist/boot/tftbot-boot.js（自包含，Vue 内联）
```

三个 chunk 的职责：

| chunk | 谁用 | 内容 |
| --- | --- | --- |
| core | 脚本、测试、Node | 事件模型、算法、设置、数据源 |
| ui | 其它前端复用 | 组件库（不含业务逻辑） |
| boot | 宿主窗口 | 装配 background + 按窗口挂页面 |

## 打包与校验

```bash
node scripts/pack.mjs        # 打 zip（含 install.ps1 / VERIFY.ps1 / BUILD-INFO.json）
node scripts/verify-release.mjs
```

`verify-release.mjs` 会检查：zip 结构、每个文件的 CRC32、必需文件是否齐全、`BUILD-INFO.json` 里的版本与构建时间。
