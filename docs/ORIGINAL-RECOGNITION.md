# 原版商店与海克斯采集核对

结论：原版通过 GEP 原生模块采集游戏内部数据，经原生 IPC 转发为前端事件。当前证据支持内存/内部对象读取路线；不是前端通过截图 OCR 解析商店，也不是 MetaTFT 或普通 HTTP 数据接口提供本局商店。

只读目标：`E:/amumu/resources/app.asar` 和 `E:/amumu/resources/apps/amumu.bin`。没有改动原版文件，没有启动游戏采集或调用注入方法。

## 静态证据

- 原版后台先连接 `{8732C1E2-A2FD-4FF6-8330-FB43A9ABA45C}-<gameId>` 原生 IPC。收到 JSON `type: info` 后，将 `category/key/value` 传给 `cube.games.events.provider.updateInfo`。
- 后台对不同游戏分支调用 `loadGEP('/plugins/64/gep_tft.dll', 'gep_tft.dll', gameId)` 或 `gep_tftx64.dll`。宿主通过游戏 overlay 的加载流程执行，不是直接在 Vue 页面调用 DLL。
- 前端 `trick-8da003d2.js` 收到 `tft_shop` 后解析英雄列表；收到 `tft_augments` 后按 `augment_1/2/3.name` 匹配海克斯 ID。
- 两个 GEP DLL 中均包含 `ReadProcessMemory`、`GameMemoryMonitor`、`ProcessMemoryWalker`、`TaskTFTShop` 字符串/RTTI。`gep_tft.dll` 还包含 `/Script/TFTShop`、`TFTShopPlayerSubsystem`、`ShopViewModel`、`ShopItems`、`ShopIndex` 等内部对象名称。
- 这些符号支持“读取内部状态”的判断，但没有进行完整原生反编译，因此不声称已还原具体偏移、所有分支或底层算法。

## 已执行验证

使用项目当前 Electron 44.9.0 的独立子进程，仅加载并列举模块导出：

- `resources/win64/node-native.node`：成功加载，包含 `IpcConnection`、`IpcServerConnection` 等导出；客户端具备 `connect/disconnect/destroy/send/invoke` 方法。
- 从原版包取出的 `plugins/64/tft.node`：成功加载，导出 `start`。没有调用 `start`，没有猜测它的参数，也不将这个模块等同于 GEP DLL 的全部功能。

完整游戏读数、当前版本兼容性、插件启动条件和断线重连仍需真实对局端到端验证。模块能加载不等于已经接通对局。

REA 已完成 ASAR 分析：Evidence `ev_e8e3043f4f7ae75e48570ea2ed31af34f81b4786092549092fdc82c7609cb22d`，原包 SHA-256 `cdfef3a212206212d10a6e515921eb68acf9455fd3aa6ae03be95f6c5c898213`。完整结果位于工作目录 `dist/amumu-rea.json`；上述 GEP 字符串和字符串表解码结果来自普通只读文件检查，未冒称 REA 原生反编译证据。

TS 原型 `src/recognition/original-events.ts` 已按确认的消息形状实现商店/海克斯解析、中文 ID 匹配、MetaTFT 评级关联、空槽清理和未知 ID 拒绝。测试包明确为合成协议样本，不冒充真实游戏截图或采集记录。

## 待真实对局验收版

独立版已增加原生采集子进程、原版后台服务启动、当前云顶窗口检测规则登记、游戏 overlay 连接与 GEP 加载请求。检测规则来自原版后台的 `updateGameList`：ID `54262`、标题 `TFT  `（两个尾部空格）、窗口类 `UnrealWindow`。不登记普通联盟的 `RiotWindowClass` 作为云顶。

依赖用户本机现有 `E:/amumu` 安装；GEP 和依赖 DLL 从其 `resources/apps/amumu.bin` 原样提取到本程序缓存，没有修改原版文件、加载器验证或 DLL 内容。原版前端无需打开；停止采集时销毁连接并结束本程序自己启动的后台服务，不终止原有服务。

已运行两类独立验收：

- `npm run test:recognition:native`：真实 `node-native.node` 的独立测试服务发送合成协议帧，经原生 IPC、utility process、Electron 主进程和 preload 到 Vue，验证五个商店槽、三个中文海克斯及 MetaTFT 评级。界面明确标记测试数据。结果 `NATIVE_RECOGNITION_SMOKE_PASS`。
- `npm run test:desktop -- --provider-smoke`：实际启动原版原生后台并登记窗口规则，取得真实服务确认。结果 `ORIGINAL_PROVIDER_HANDSHAKE_PASS`。当时没有对局，接收帧数为零。

尚未验证的环节：真实云顶窗口触发、游戏内 overlay/GEP 实际加载返回、当前版本持续英雄/海克斯读数，以及卖牌、刷新、选完海克斯、对局结束时的实际状态更新。用户选择先交付待验证版，因此不把这些环节标记为完成。当前不执行任何买牌、刷新、摆位或其它游戏操作。

使用：启动独立版，进入“对局面板”，点击“连接原版采集”。也可用 `TFTBot.exe --reader` 直接打开对局面板并连接。没有游戏时应显示“等待当前赛季云顶窗口”，商店与海克斯保持未采集状态。


## 2026-10-20 实局排障记录

真实腾讯 TFT 窗口与 overlay 通信已验证。最初加载错误 126，原生日志明确失败于 AppData 下的 libowgameevents64.dll；同一原始文件移到便携程序 resources/tftbot-native 后加载成功。此对照确认故障与放置路径/访问环境有关，未进一步证明具体 Windows 权限或拦截机制。没有修改原版 DLL、游戏文件或绕过加载检查。

重连时发现正在游戏内加载的 DLL 无法覆盖，现按归档版本哈希分目录，读取比对原始字节一致后复用，不重复写入；不一致时报错。

真实原生协议与此前合成样本存在差异：商店是 slot_1..slot_5 对象，Sold 表示已售/空槽；roster 的 health/index 是数字字符串；已选海克斯是 slot_1..slot_4 对象；等级为 tft_xp.xp_level；自有棋盘和备战席为 cell_N 对象。上述形式已补 TS/Zod 适配，并增加按实测形状匿名化的回归测试。

真实商店事件已在 renderer-health 中核对，五槽中文名称与接收状态一致。真实三选一事件已收到且解析成功；后续每次重连后的显示仍继续随新事件核验。当前通道尚未观察到原版前端所消费的 players_info 全场明细；己方 board/bench 可合并，对手保持缺失，不输出完整牌池/金币数值。不得将此状态描述为全场记牌器已实战验证。

诊断读取原版 overlay 的 ManagerMessageToBox.logMessage 并记录到本地监控文件，限制每次 GEP 连接的加载请求为一次，避免断线时请求堆积。未配置 REA 原生反编译引擎；补充的加载器静态核对使用本地 PE/反汇编分析，记录在 dist/overlay-loader-disasm.txt，和实局原生错误日志分别保留，不把静态推断当成运行证据。


## 全场持牌独立通道（2026-10-20）

原版 `assets/tgd-888fab08.js` 使用 `plugins/64/tft.node` 的 `start(channel, callback)`，随后调用 `cube.games.invokeGEP('sgd', channel)`。原版固定通道为 `{CAB1E425-C0D0-407F-B6AF-CE68E4274079}`。结果是 `players[].index / champions[].id / level`，原版再派生 `players_info`；商店原生事件本身不包含全场持牌。

本次继续使用 reverse-engineer-anything 技能的既有包分析；局部原生引擎不可用，补充静态分析使用本地 PE/Capstone，不冒称 REA 原生运行证据。TGD 字符串表解码与格式化产物见 `dist/original-analysis/tgd-pretty.js`，sgd 的静态控制流见 `dist/sgd-handler-disasm.txt`。

关键控制流：overlay 的 sgd 启动函数如果已经存在 IPC 对象，会直接返回成功，不重新绑定参数通道。随机通道会在助手重启后失配。因此正式实现使用原版固定通道；当前已绑定旧诊断随机通道的这一局，只读枚举该 IPC 的 `_MAP / _A2B / _B2A` 名称，在本地保存按游戏 PID 限定的恢复记录。没有修改游戏、原版 DLL 或它们的内存。

采集模块现独立运行于第二个 utility process，sgd 请求经原有 GEP 连接转发，不建立第二条 overlay 客户端。模块异常、退出或过期只清理全场持牌，不清理正常的商店/海克斯。识别面板和本地监控均显示全场通道状态、有效帧数及更新时间。

TS 适配按原生 index 匹配 roster.index，不依赖血量排序；要求独立的本方 board+bench 副本指纹吻合后才接受快照。未知或重复索引、身份不匹配、缺失玩家、空快照不填造完整数据。索引的完整实战对应关系仍需真实帧核验，单元测试不替代实局验收。全场持牌超过 12 秒不更新即丢弃；新局、断线、异常清理。

另接入实测 GEP `tft_opp` + `tft_board_opponent`：对手身份在 15 秒内明确才接收该棋盘，保留 60 秒并明确为 partial，不冒充包含备战席。此部分可支撑已观察棋子的计数，不能开启精确全场刷牌预算。


### 本次实战验收结果

20:31:29 收到上一局真实 tft.node 全场帧（剩余两人，已淘汰玩家为空数组）；20:34:29 下一局收到完整八人帧。本方索引 2 的蕾欧娜、奥恩及备战席凯尔，与独立 GEP board/bench 一致。脱敏样本保留在 tests/fixtures/native-scoreboard-s18.json，玩家名称与内存地址已去除。首次索引建立实测约 55～75 秒，不能把初始化等待误报为已收到全场持牌。

实局后续暴露了 GEP 增量事件滞后：每帧重做身份校验会错误打回未齐，本方旧 GEP 明细也会覆盖新记分板。现仅在本局首次做身份校准；名单身份或索引变化、新局、断线会失效。校准之后使用完整同帧原生数据，本方不再混入旧 GEP 数量。按游戏 PID 保存带名单身份的校准记录，仅在同名单、本地 12 小时内重连复用，不缓存棋子数量来冒充实时数据。

MetaTFT 静态单位定义的 shopUnit=false、无英雄羁绊对象，被抽取为 data/current-non-pool-units.json（含原始 apiName 和 assetNames，共 35 个 ID）。纳尔大形态、伊莉丝蜘蛛形态保留为英雄并归入原共享牌池；未知新 ID 仍使估算暂停，不笼统忽略。实测永恒之森的生命花/树皮树导致的未齐状态已修复。四星按 27 副本折算，与用户提供的 S18 unitCost 表一致。

20:47 运行中的 renderer-health 与 overlay-health 均确认完整明细；8 人、missingPlayers=0，浮窗恢复均值及 90% 刷新预算。377 项测试通过后补充了 roster.xp 的重连等级恢复测试。海克斯仍沿原通道工作。此验收不代表所有强化、复制单位、特殊商店或正式服概率参数均已覆盖。
