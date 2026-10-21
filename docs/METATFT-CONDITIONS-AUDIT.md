# Explorer 联合筛选更正

2026-10-20，依据官方 `explorer.js` 实际组装请求的代码重新实测。此前“单位/装备联合筛选不可用”的结论不成立；之前测试的参数名不正确。

已验证请求：

```
GET https://api-hc.metatft.com/tft-explorer-api/total
  ?queue=1100&patch=18.4&b_patch=b&formatnoarray=true&compact=true
  &unit_unique=DA_18_Kayle-1
  &item_unique=DA_GuinsoosRageblade-1
```

同一批请求的聚合名次记录总量（动态时间窗会有少量变化）：

| 条件 | 记录数 |
| --- | ---: |
| 无条件 | 10,934,074 |
| 包含凯尔 | 1,249,491 |
| 包含凯尔并且包含羊刀 | 865,225 |
| 不包含凯尔 | 9,684,510 |
| 不存在的英雄 ID | 0 |
| 旧参数 `units=DA_18_Kayle` | 10,933,954，接近无条件，未实现预期筛选 |

“单位存在且装备存在”不等于“该单位携带该装备”。官方还提供 `unit_item_unique` 和带星级/装备数的条件编码，需要分别正反对照验证后再用于具体携带者分析。也不能将这些终局条件统计当成当时局面的行动因果收益。

核心客户端已新增结构化 `conditionalExplorer` 和严格八桶适配器；空样本的均名/吃鸡/前四均为 `null`，不会把空结果解释成均名 0。重复条件参数得以保留，无法表示合法 ID 的输入直接拒绝。

复现：`node scripts/probe-metatft-conditions.mjs`。原始响应和完整请求保存在 `dist/condition-audit/`。继续审计同单位出装、星级、羁绊和组合条件，不能再依据错误参数断言数据源能力不足。
# 追加验证：指定持有者与星级

`scripts/probe-metatft-conditions.mjs --extended` 的原始聚合响应已保存在 `dist/condition-audit/`。同一时间段的窗口总量约 1,093 万条最终名次记录；凯尔携带鬼索约 65.6 万，凯尔二星约 53.6 万、三星约 61.3 万。窗口持续更新，不能要求顺序请求精确相加。

- `unit_item_unique=DA_18_Kayle-1&DA_GuinsoosRageblade-1`：整个值使用一次 URL 编码，指定装备必须在指定英雄身上，不能替代为任意持有者的装备条件。不存在的持有装备控制组返回零。
- `unit_tier_numitems_unique=DA_18_Kayle-1_3_.*`：指定三星；星级与装备件数按官方客户端结构编码。
- 重复 `unit_unique` 的两英雄 AND 查询已通过真实/不存在英雄控制组。

类型化客户端已支持 `holderItems` 和 `unitStates`，并测试了持有者身份、零件数、重复条件及编码注入保护。这些仍是最终名次的条件汇总，不能冒充前期状态或购买行为的因果收益。
