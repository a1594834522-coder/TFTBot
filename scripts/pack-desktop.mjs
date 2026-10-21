import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),runtime=path.dirname(require('electron'));
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const stamp=new Date().toISOString().replace(/[-:.]/g,'');
// Fresh staging: never overwrite a running or previous release.
const output=path.resolve('desktop-release',`staging-${pkg.version}-${stamp}`,'TFTBot-win32-x64');
if(process.platform!=='win32'||process.arch!=='x64')throw Error('此打包入口针对 Windows x64');
for(const file of ['main.cjs','preload.cjs','battle-worker.cjs','native-reader-worker.cjs','scoreboard-worker.cjs','renderer/index.html','metatft-model/model.json','decision-model-manifest.json'])await fs.access(path.join('dist/desktop',file));
await fs.mkdir(output,{recursive:true});
await fs.cp(runtime,output,{recursive:true});
await fs.rename(path.join(output,'electron.exe'),path.join(output,'TFTBot.exe'));
const appRoot=path.join(output,'resources','app');await fs.mkdir(appRoot,{recursive:true});
await fs.cp('dist/desktop',appRoot,{recursive:true});
await fs.writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'tftbot-desktop',productName:'TFTBot',version:pkg.version,main:'main.cjs'},null,2));
const files={};
async function inventory(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await inventory(file);else files[path.relative(appRoot,file).replaceAll('\\','/')]=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');}}
await inventory(appRoot);
await fs.writeFile(path.join(output,'BUILD-INFO.json'),JSON.stringify({version:pkg.version,builtAt:new Date().toISOString(),files},null,2));
await fs.writeFile(path.join(output,'使用说明.txt'),[
  `TFTBot ${pkg.version} · 独立桌面助手`,
  '双击 TFTBot.exe；保留整个文件夹。仅最新 S18，中文名称，MetaTFT 为主。',
  '阵容助手：玩家手选主线、三类候选浏览、前期过渡、搜牌参考与实际高人口变体。',
  '设为主线后同步参考与局内头像；取消主线可清除选择。复杂比较在桌面，浮窗保持简洁。',
  '原生采集仍需本机 E:\\amumu 组件，无需打开原版前端。对局面板点击连接；全场持牌需建立索引。',
  '下一战模型缺少实际匹配候选时显示全场等权参考。刷牌参数仍为标明的 S18 PBE 参考。',
  '补齐概率包含买牌费用，按当前人口和钱包；不是战斗胜率，不含未来收入。',
  '工程测试通过，真实排位收益待校准。当前不执行自动买牌、刷新、摆位或其它游戏输入。',
].join('\r\n')+'\r\n','utf8');
await fs.writeFile('dist/desktop-package.json',JSON.stringify({output,executable:path.join(output,'TFTBot.exe'),version:pkg.version},null,2));
console.log('[desktop staged] '+path.join(output,'TFTBot.exe'));
