# 命令参考

宿主与页面的通信都走命令注册表（`src/core/broker.ts`）：

```ts
// 页面 → 宿主
const comps = await cube.windows.message.invoke('background', 'getComps', { set: 18 });

// 宿主注册
broker.handle('getComps', async (payload) => allComps(payload));

// 广播（宿主 → 所有窗口）
broker.broadcast('settingsChanged', next);
```

命令按构建变体分两套：

- **完整版**（`src/app/background.ts`）—— 72 条，含直播/录制/调试等周边能力
- **精简版**（`src/app/lean.ts`）—— 26 条，只保留游戏面板相关（默认发布用这套）

下面按分组列出精简版，并标注它在完整版里是否有同名实现。

## 设置

| 命令 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `getSettings` | — | `Settings` | 当前设置（已归一化） |
| `setSettings` | `Partial<Settings>` | `Settings` | 合并式更新，返回新值并广播 `settingsChanged` |
| `settingsChanged` | — | — | 广播：设置已变更 |

## 赛季

| 命令 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `getCurrentSet` | — | `number` | 当前赛季 |
| `setCurrentSet` | `number` | `number` | 切换赛季，广播 `currentSetChanged` |
| `currentSetChanged` | — | — | 广播：赛季已切换 |
| `getSupportSets` | — | `number[]` | 数据集支持的赛季列表 |

## 游戏数据

| 命令 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `getCharacters` | `{ set? }` | 英雄列表 | 含费用、技能、图片 |
| `getItems` | `{ set? }` | 装备列表 | id、名称、合成件 |
| `getTraits` | `{ set? }` | 羁绊列表 | id、名称、层级 |
| `getComps` | `{ set?, source?, title? }` | 阵容数组 | `source` 支持 `official` / `blitz` / `metatft` / `all` |
| `getTFTHighlight` | — | `string[]` | 当前高亮棋子 |
| `setTFTHighlight` | `string[]` | `string[]` | 设置高亮（跨窗口同步） |
| `getRankData` | — | 段位或 `null` | 段位数据 |
| `getCurLocale` / `setCurLocale` | — / `string` | `string` | 界面语言 |

## 自建阵容

| 命令 | 入参 | 返回 |
| --- | --- | --- |
| `getMyTeamComps` | — | 自建阵容列表 |
| `setMyTeamComps` | 列表 | 新列表（并广播 `myTeamCompsChanged`） |
| `deleteMyTeamComps` | `{ id }` | 新列表 |
| `getPinCompsInfo` / `setPinCompsInfo` | — / 数据 | 钉住的阵容（并广播 `pinCompsChanged`） |

## 窗口

| 命令 | 说明 |
| --- | --- |
| `showMainPage` | 显示主界面 |
| `showOrHideCharacterwin` | 显示/隐藏英雄详情窗口 |
| `rebuildGameinWindows` | 重建所有游戏窗口 |

## 完整版额外命令（部分）

| 分类 | 命令 |
| --- | --- |
| 直播 | `getLiveList`、`getObsState` |
| 录制 | `deleteRecordMedia`、`getRecordBaseSetting`、`recordMediaChanged`、`recordStateChanged`、`getVideoEncoders` |
| 调试 | `checkGpuEnable`、`getHexArguments`、`getHexStatus`、`pauseHexmsgFollow` |
| 账号 | `probeEmailBindStatus`、`requestEmailBindProbe`、`forceLogoutCleanup` |
| 广告 | `closeAdWindow` |

## 加一条命令

```ts
// src/app/lean.ts
broker.handle('getMyThing', async (payload) => {
  const p = typeof payload === 'string' ? safeJson(payload) : payload;
  return { echo: p };
});
```

```ts
// tests/broker.test.ts
const app = createLeanBackground(f.cube, { getOwner: () => 'local' });
expect(await f.invoke('getMyThing', { a: 1 })).toEqual({ echo: { a: 1 } });
```

约定：

- 入参可能是 JSON 字符串（平台在部分通道上会序列化），用 `safeJson` 兜一层
- 会改状态的命令要 `broker.broadcast('<name>Changed', next)`，让其它窗口跟上
- 返回值保持可序列化（不要传类实例 / 函数）
