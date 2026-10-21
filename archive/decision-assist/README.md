# 智能过渡与智能定阵：暂停归档

2026-10-21 按用户要求暂停。恢复参考检查点：`105ec63`，源代码快照见同目录 `source-105ec63.zip`。源码也保留在原路径以维持数据格式、单元测试与引用关系；运行入口和自动计算已关闭，不作为当前产品能力。

归档范围：`src/game/comp-advisor.ts` 的阵容推荐和早期留牌、`src/game/mainline-transitions.ts`、`src/decision/direction-*`、`src/decision/strategic-*`、`src/decision/search-holds.ts`、`src/desktop/SmartCompPanel.vue` 及其路线推荐面板。研究数据继续保留，不重新抓取对局或推送本地对局记录。

当前生效策略在 `src/game/active-product-scope.ts`：关闭阵容助手导航、未选阵容的自动留牌、自动过渡路线和计算进程中的智能建议。旧过渡选择不恢复到运行状态；玩家仍可在热门阵容中手选目标，查看目标英雄、记牌、抽卡金币估计、海克斯/仙灵评级和单场胜率。

下一步先讨论固定目标阵容的辅助：关键提升、追牌成本、装备分配与上限。未经重新讨论，不自动恢复跨阵容决策。
