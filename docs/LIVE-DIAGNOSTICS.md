# 本地诊断与回放

正常启动桌面程序默认开启本地诊断。直接双击EXE时保存在 Electron `userData/live-monitor`（通常 `%APPDATA%/TFTBot/live-monitor`）；工作区 `启动TFTBot.cmd` 指向 `dist/live-monitor`，并通过 `--reader` 自动连接只读采集。它不会启动游戏。环境变量 `TFTBOT_MONITOR_DIR` 可指定目录。

1.6.0 用轮转日志替换累计50MB后停止写入的旧逻辑。默认每段16,000,000字节、当前段加7段归档，总上限128,000,000字节。`events.jsonl` 最新，`events.1.jsonl` 次新，编号越大越旧；最旧段到期后删除，继续记录下一局。旧的大段会在后续写入时迁为归档并纳入总限额。只管理这些保留文件名，不删除目录里其他文件；单条记录超过段大小时写明确的省略记录。

`decision-state` 保存可重建的实际输入及原始采集时间，最多每秒4次，纯帧序号/接收时间/修订号变化不会重复保存。对手与本方数据的时效等级变化仍会产生记录。测试通道不写成实战状态；不上传日志。归档是保留的关键状态，并不表示每个游戏事件都能完整重建。

```powershell
node scripts/audit-live-log.mjs dist/live-monitor
node scripts/audit-opponent-signals.mjs dist/live-monitor
node scripts/replay-live-trace.mjs dist/live-monitor dist/live-replay-audit/decision-states.jsonl
```

输入目录会按旧至新读取整个保留环；明确传入文件则只读取该文件。读取固定清单和字节前缀，并核对文件身份；归档恰好发生替换或截断时报告读错误，不能当作完整成功。遇此错误重新执行审计。导出拒绝覆盖输入文件、Windows大小写别名、硬链接和报告文件碰撞。导出报告与JSONL同目录，命名为 `decision-states.report.json`。

回放必须使用每条状态的 `clock` 作为评估时刻，不能用今天的时间把历史帧全部判为过期。此脚本仅提取输入，没有推理或排位收益校准。

2026-10-21只读审计现有旧日志：31,549,221字节、32,501条有效记录，无解析或读取错误；内容为等待/窗口健康记录，没有native-packet、实际对局轮次或decision-state。这批日志不足以校准实战建议；不能把正常等待日志当成实时对局链路已经验证的证据。真实下一对手候选标记仍待实局对照。
