# 数据源

## 本地数据（`data/`）

| 文件 | 大小 | 内容 | 谁读它 |
| --- | --- | --- | --- |
| `tft-sets.json` | 543 KB | 英雄、装备、羁绊（按赛季索引） | `game/tft-data.ts` |
| `comps.json` | 381 KB | 内嵌阵容（`official` / `blitz` 两组） | `game/comps-data.ts` |
| `metatft-comps.json` | 287 KB | 外部统计源阵容快照 | `game/metatft-comps.ts` |
| `metatft-early.json` | 4 KB | 前期棋盘聚类（按阶段） | `game/metatft-early.ts` |

这些 JSON 数据在构建期通过 `static import` 编译进 bundle，运行时不需要在线统计接口。部分图片 URL 仍为远程地址；修改 JSON 后需要重新构建。

## 阵容源

`game/comps-sources.ts` 是唯一入口：

```ts
allComps({ set: 18, source: 'metatft', title: 'Meta' })
groupsOf(18)          // 按来源分组统计
sourcesFor(18)        // [{ id:'official', count:81 }, …]
byChampionAll(18)     // 英雄 → 阵容反查
```

支持 `official` / `blitz` / `metatft` / `all`，设置项 `compsSource` 决定默认值。

## 外部快照怎么更新

```bash
npm run metatft:sync                        # 默认 set 18、queue 1100、拉 60 套详情
npm run metatft:sync -- --set 18 --dry      # 只看不写
npm run metatft:sync -- --details 20        # 少拉些详情（更快）
```

脚本（`scripts/metatft-sync.mjs`）做四件事：

1. `tft-comps-api/latest_cluster_id` 取当前聚类
2. `comp_options` 取阵容骨架（`units_list` / `traits_list` 是 `&` 分隔的 id 串）
3. `comp_details` 逐套取决策项，裁剪后写入快照
4. `tft-early-comps/comps_overview` 取前期阶段，写入 `metatft-early.json`

### 接口约定

请求头必须带 `User-Agent` + `Referer: https://www.metatft.com/`，否则被拒：

```ts
export const METATFT_HEADERS = {
  'User-Agent': '…',
  Referer: 'https://www.metatft.com/',
  Origin: 'https://www.metatft.com',
  Accept: 'application/json, text/plain, */*',
};
```

### 从 `comp_details` 里取什么

原始响应 26 个字段，快照只留 6 类（体积从 2.1 MB 压到 287 KB）：

| 字段 | 用途 | 裁剪规则 |
| --- | --- | --- |
| `levels` | 升级节奏 `2-5 L5 · 3-2 L6` | 同等级只留最早一步，最多 9 条 |
| `final_levels` | 等级 → 平均名次 | 按等级升序，最多 6 条 |
| `builds` | 装备组合（`buildName` + `unit`） | 按场次降序取 3 |
| `unit_stats` | 单卡星级 / 装备件数 → 名次 | 按场次降序取 5 |
| `positioning` | 站位热区（`cell_25` → 次数） | 每单位 3 格、最多 6 单位 |
| `proComps` | 作者阵容（标题 + 作者 + distance） | 按 distance 升序取 3 |

`early_options` 单独走 `metatft-early.json`：每阶段取胜率前 2。

### 这些字段不可信

- `matchup_winrate` 被归一化成 0.5，`matchup_avg_hp_delta`、`avg_hp` 是存活者口径 → **不参与胜率计算**
- 只用 `final_place_avg` / `final_place_winrate` / `final_place_count`

## Tier 怎么算

外部源的 `avgPlace` 随版本漂移，固定阈值会把九成阵容判成 T0，所以用**同批分位**：

```
排序后按 15% / 35% / 60% / 80% 切成 T0…T4
样本 < 4 套时不切档（避免小样本乱分）
```

实现见 `game/metatft-comps.ts` 的 `assignTiers()`。

## 加一个新数据源

1. 写 `core/<source>.ts`（客户端：超时、重试、缓存、错误类型）
2. 写 `game/<source>-comps.ts`（转换成 `OfficialComp` 形状，`source: '<name>'`）
3. 在 `game/comps-sources.ts` 注册：
   ```ts
   export const SOURCES = [official, blitz, metatft, yours];
   ```
4. 加一个 `scripts/<source>-sync.mjs` 生成快照
5. 补测试：解析、裁剪、`allComps` 合并计数
