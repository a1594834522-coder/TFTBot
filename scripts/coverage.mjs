// 生成 docs/COVERAGE.md：81 个 IPC 命令的 TS 覆盖矩阵
import fs from 'node:fs';
import path from 'node:path';

const ALL = [
  // 状态写入 / 广播
  'setCurrentSet', 'setPinCompsInfo', 'pinCompsChanged', 'setSettings', 'settingsChanged',
  'setMyTeamComps', 'myTeamCompsChanged', 'deleteMyTeamComps', 'currentSetChanged',
  'showMainPage', 'setCurLocale', 'setShowTrackerHotkey', 'showTrackerHotkeyChanged',
  'setShowMainHotkey', 'showMainHotkeyChanged', 'setOverallRecordHotkey',
  'showOverallRecordHotkeyChanged', 'setRecordBaseSetting', 'setTFTHighlight',
  'setStartRecordHotkey', 'setStopRecordHotkey', 'recordStateChanged', 'recordMediaChanged',
  'closeAdWindow', 'setLiveList', 'setInviteCount', 'setIc', 'icChanged',
  'setHexOrderStatus', 'setHexOrderRes', 'setHexGamePlayBegan', 'showHexPredict',
  'showHexPredictRecharge', 'showHexPredictAdvancedApply', 'showHexOrderResult',
  'showHexPredictCompactReturn', 'pauseHexmsgFollow', 'summonerIdChanged',
  'featureUnlockChanged', 'showOrHideCharacterwin', 'requireEmailBind',
  'requireEmailRegistration', 'requestEmailBindProbe', 'tftbotMigrationDebug',
  // 查询
  'getSupportSets', 'getCurrentSet', 'getCharacters', 'getItems', 'getTraits', 'getComps',
  'getPinCompsInfo', 'getSettings', 'getMyTeamComps', 'getUnitsItems', 'getCurLocale',
  'getHexArguments', 'getRankData', 'checkGpuEnable', 'getShowTrackerHotkey',
  'getShowMainHotkey', 'getshowOverallRecordHotkey', 'getRecordBaseSetting',
  'getTFTHighlight', 'getObsState', 'stopObs', 'getVideoEncoders', 'getStartRecordHotkey',
  'getStopRecordHotkey', 'deleteRecordMedia', 'getLiveList', 'getInviteCount',
  'getHexStatus', 'getHexOrderRes', 'getHexGamePlayBegan', 'syncHexOrderLifecycle',
  'probeEmailBindStatus', 'resetHexOrderForAccountChange', 'getFeaturesList',
  'syncMembershipUpdated', 'forceLogoutCleanup', 'rebuildGameinWindows',
];

// 已实现集合：直接从 src/app/background.ts 的 SUPPORTED_COMMAND_NAMES 解析，避免两处不同步
const bgSrc = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'app', 'background.ts'), 'utf8');
const block = /export const SUPPORTED_COMMAND_NAMES[\s\S]*?\];/.exec(bgSrc)?.[0] ?? '';
const IMPLEMENTED = new Set([...block.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]));

// 精简版移除清单：同样从 src/app/lean.ts 解析，保持同步
const leanSrc = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'app', 'lean.ts'), 'utf8');
const leanBlock = /export const LEAN_REMOVED[\s\S]*?\];/.exec(leanSrc)?.[0] ?? '';
const REMOVED_LEAN = new Set([...leanBlock.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]));

const GROUPS = [
  ['设置 / 赛季 / 语言', ['getSettings', 'setSettings', 'getCurrentSet', 'setCurrentSet', 'getCurLocale', 'setCurLocale', 'getSupportSets']],
  ['阵容（我的 / 置顶）', ['getMyTeamComps', 'setMyTeamComps', 'deleteMyTeamComps', 'myTeamCompsChanged', 'getPinCompsInfo', 'setPinCompsInfo', 'pinCompsChanged']],
  ['账号 / 会员', ['getFeaturesList', 'featureUnlockChanged', 'syncMembershipUpdated', 'getInviteCount', 'setInviteCount', 'forceLogoutCleanup']],
  ['热键', ['getShowMainHotkey', 'setShowMainHotkey', 'showMainHotkeyChanged', 'getShowTrackerHotkey', 'setShowTrackerHotkey', 'showTrackerHotkeyChanged', 'getshowOverallRecordHotkey', 'setOverallRecordHotkey', 'showOverallRecordHotkeyChanged', 'getStartRecordHotkey', 'setStartRecordHotkey', 'getStopRecordHotkey', 'setStopRecordHotkey']],
  ['录制 / OBS', ['getObsState', 'stopObs', 'getVideoEncoders', 'deleteRecordMedia', 'recordStateChanged', 'recordMediaChanged', 'getLiveList', 'setLiveList', 'setRecordBaseSetting', 'getRecordBaseSetting']],
  ['游戏数据（角色/装备/羁绊/阵容）', ['getCharacters', 'getItems', 'getTraits', 'getComps', 'getUnitsItems', 'getRankData', 'getHexArguments', 'getTFTHighlight', 'setTFTHighlight', 'checkGpuEnable']],
  ['Hex 下注 / 订单', ['getHexOrderStatus', 'setHexOrderStatus', 'getHexOrderRes', 'setHexOrderRes', 'setHexGamePlayBegan', 'getHexGamePlayBegan', 'syncHexOrderLifecycle', 'resetHexOrderForAccountChange', 'showHexPredict', 'showHexPredictRecharge', 'showHexPredictAdvancedApply', 'showHexOrderResult', 'showHexPredictCompactReturn', 'pauseHexmsgFollow']],
  ['账号 / 邮箱 / 迁移', ['summonerIdChanged', 'requireEmailBind', 'requireEmailRegistration', 'requestEmailBindProbe', 'probeEmailBindStatus', 'tftbotMigrationDebug']],
  ['窗口 / 其它', ['showMainPage', 'showOrHideCharacterwin', 'closeAdWindow', 'setIc', 'icChanged', 'rebuildGameinWindows', 'settingsChanged', 'currentSetChanged']],
];

const rows = [];
for (const [name, cmds] of GROUPS) {
  rows.push(`\n### ${name}\n`);
  rows.push('| 命令 | 状态 |');
  rows.push('| --- | --- |');
  for (const c of cmds) {
    const state = REMOVED_LEAN.has(c) ? '🗑 精简版移除' : IMPLEMENTED.has(c) ? '✅ 已实现' : '⬜ 待实现';
    rows.push(`| \`${c}\` | ${state} |`);
  }
}

const done = ALL.filter((c) => IMPLEMENTED.has(c)).length;
const leanKept = [...IMPLEMENTED].filter((c) => !REMOVED_LEAN.has(c)).length;
const md = `# IPC 命令覆盖矩阵（自动生成）

> 由 \`scripts/coverage.mjs\` 生成。基准：平台命令表的 81 条。
> 当前进度（完整版）：**${done}/${ALL.length}**（${((done / ALL.length) * 100).toFixed(0)}%）
> 游戏专用精简版：**${leanKept}/${ALL.length}**（其余 ${REMOVED_LEAN.size} 个命令按业务要求移除，见 [LEAN.md](LEAN.md)）

已实现的部分见 \`src/app/background.ts\`（完整版）与 \`src/app/lean.ts\`（游戏专用）；新增实现后重跑本脚本即可更新。

${rows.join('\n')}

---

## 说明

- 「已实现」= TS 侧有真实实现 + 单测覆盖（见 \`tests/background.test.ts\`、\`tests/lean.test.ts\`）。
- 「精简版移除」= 非游戏面板相关的业务命令，对应 \`LEAN_REMOVED\`。
- 分组按职责，不按字母序 —— 目的是让"还差哪块"一眼可见。
`;

fs.mkdirSync(path.join(import.meta.dirname, '..', 'docs'), { recursive: true });
fs.writeFileSync(path.join(import.meta.dirname, '..', 'docs', 'COVERAGE.md'), md);
console.log(`coverage: 完整 ${done}/${ALL.length} · 精简 ${leanKept}/${ALL.length}（移除 ${REMOVED_LEAN.size}）→ docs/COVERAGE.md`);
