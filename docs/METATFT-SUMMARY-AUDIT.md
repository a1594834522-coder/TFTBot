# MetaTFT 阵容汇总修正（2026-10-20）

运行期没有下载逐局历史，也没有从逐局对局重算均名。`60` 是聚类阵容数量，不是对局样本数。

原适配错误：把 `comp_options.results.options[compId][人口][具体棋盘].count/avg` 当成整个聚类的样本与均名；当前 `comp_details.placements` 是 `[{count,avg}]`，并非八个名次数字，因此旧解析又落回了具体棋盘。小样本高人口棋盘造成均名虚高和错误排序。

现口径：

- 名称：`latest_cluster_info.cluster_info.cluster_details.clusters[].name`，按 `type: trait/unit` 使用当季中文表翻译，保留 MetaTFT 命名顺序。
- 样本 / 均名：一次 `comp_options.results.overall[compId]` 汇总返回的 `count/avg`。
- 缺少聚类汇总时不使用具体棋盘数字冒充总样本。
- 新版汇总不提供胜率和前四率时不推导这两个指标；兼容旧版八名次桶。
- 成型棋盘仍选该聚类最常见的具体组合，独立于整个聚类统计。
- `early_options`、装备等是接口已经聚合的明细，不是原始对局记录。

实测 `cluster 426 / comp 426021`：旧棋盘 `1,062 / 3.0085`；聚类汇总 `24,624 / 4.436`。名称 `DA_18_Rapidfire + DA_18_Kayle` → `迅捷射手 凯尔`。

快照全部 60 套已按同一汇总响应修正并重新分档、排序。数字后续随接口更新；截图左侧榜单可能使用不同时间窗、段位或人工命名，不能保证与我们的默认接口筛选一致。

只刷新名称和结论：先 `npm run build:core`，再 `npm run metatft:sync -- --summary-only`。同一聚类下保留已有过渡 / 装备缓存；聚类变化时不沿用旧明细。常规同步可额外拉取每套阵容的聚合明细。两种路径均不调用 `recent_matches`。
