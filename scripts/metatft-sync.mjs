#!/usr/bin/env node
/**
 * metatft-sync.mjs —— 从 MetaTFT 拉一套阵容快照，落成 data/metatft-comps.json
 *
 *   npm run metatft:sync                      # 拉 Set 18 / queue 1100
 *   node scripts/metatft-sync.mjs --set 18 --queue 1100 --details 12
 *   node scripts/metatft-sync.mjs --dry       # 只探测，不写文件
 *
 * 为什么是「快照」而不是运行时联网：
 *   我们的运行时是离线优先（游戏内窗口不该因为外网抖动而空表）。
 *   所以脚本在开发期拉一次，产物是普通 JSON，进包、可 diff、可回归。
 *
 * 依据：metatft/INTERFACES.md 的实测结论
 *   - comp_options 的键就是 comp id（"426000"…"426059"）
 *   - comp_details 必须同时给 comp 与 cluster_id
 *   - 缺 Referer 会被拒
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'tft-sets.json'), 'utf8'));
const latestSet = Math.max(...Object.keys(catalog.characters).map(Number));
const set = Number(get('set', String(latestSet)));
if (set !== latestSet) throw new Error(`仅同步最新赛季 S${latestSet}`);
const queue = Number(get('queue', '1100'));
const detailLimit = Number(get('details', '60'));
const dry = args.includes('--dry');
const summaryOnly = args.includes('--summary-only');
const decision = args.includes('--decision');
if (summaryOnly && decision) throw new Error('--summary-only 与 --decision 不能同时使用');
const outFile = path.join(root, 'data', 'metatft-comps.json');

const mod = await import(pathToFileURL(path.join(root, 'dist', 'tftbot-core.js')).href).catch(() => {
  console.error('先构建：npm run build:core');
  process.exit(2);
});
const { createMetatftClient, compsFromOptions, groupBySet } = mod;

const client = createMetatftClient({ timeoutMs: 20000, retries: 2 });

function log(...a) {
  console.log('[metatft]', ...a);
}

try {
  const patch = await client.patch();
  log(`patch ${patch.patch}${patch.b_patch_version} · ${patch.count.toLocaleString()} 局`);
  const cluster = await client.latestCluster();
  if (cluster.tft_set !== `TFTSet${set}`) throw new Error(`线上赛季 ${cluster.tft_set} 与当前目录 S${set} 不符，请先更新整套目录，禁止混用`);
  log(`cluster ${cluster.cluster_id} (${cluster.tft_set})`);

  const options = await client.compOptions(queue);
  const info = await client.clusterInfo();
  if (info.cluster_info?.cluster_id !== cluster.cluster_id || info.cluster_info?.tft_set !== cluster.tft_set || options.cluster_id !== cluster.cluster_id) throw new Error('阵容命名、汇总与聚类版本不一致，保留原快照');
  const ids = Object.keys(options?.results?.options ?? {});
  log(`comp_options: ${ids.length} 套`);

  // 只给最有代表性的若干套拉 details（26 字段，单次约 100KB）
  const details = {};
  const picked = summaryOnly ? [] : decision ? ids : ids.slice(0, Math.max(0, detailLimit));
  for (const comp of picked) {
    try {
      const d = await client.compDetails(comp, cluster.cluster_id);
      if (d.cluster_id !== cluster.cluster_id || d.tft_set !== cluster.tft_set || String(d.results?.cluster) !== comp) throw new Error('阵容明细版本或 ID 不匹配');
      if (d?.results) details[comp] = d.results;
      log(`  details ${comp} ok`);
    } catch (e) {
      log(`  details ${comp} 失败: ${e.message}`);
    }
  }
  if (decision && ids.some(id => !details[id])) throw new Error('智能定阵明细未齐，保留已有快照');

  // 适配层（已在 core chunk 里导出）
  const comps = compsFromOptions(options, { clusterId: cluster.cluster_id, set, details, clusterNames: info.cluster_info.cluster_details?.clusters });
  if (decision) for (const c of comps) {
    const raw = details[String(c.id).split(':').at(-1)];
    if (raw) c.details = mod.parseDecisionDetails(raw);
  }
  if (summaryOnly && fs.existsSync(outFile)) {
    const previous = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    if (previous.meta?.cluster_id === cluster.cluster_id) for (const c of comps) {
      const old = previous.sets?.[set]?.find(p => p.id === c.id);
      if (old?.details) c.details = old.details;
    }
  }
  log(`解析出 ${comps.length} 套阵容`);

  const grouped = groupBySet(comps, set);
  if (Object.keys(grouped).some(s => Number(s) !== set)) throw new Error('阵容数据包含非当前赛季');
  const payload = {
    meta: {
      fetchedAt: new Date().toISOString(),
      tft_set: cluster.tft_set,
      cluster_id: cluster.cluster_id,
      queue,
      patch: `${patch.patch}${patch.b_patch_version ?? ''}`,
      totalGames: patch.count,
      source: 'https://api-hc.metatft.com/tft-comps-api',
      metricsScope: 'comp_options.results.overall[compId]',
      namesSource: 'latest_cluster_info.cluster_info.cluster_details.clusters[].name',
      ...(decision ? {decisionProfiles: true} : {}),
    },
    sets: grouped,
  };

  if (dry) {
    log('--dry：不写文件');
    log(JSON.stringify(payload.meta, null, 2));
    log(`样例：${comps[0]?.name} · ${comps[0]?.units?.length} 人 · avgPlace ${comps[0]?.avgPlace?.toFixed?.(2) ?? '-'}`);
    process.exit(0);
  }

  const pretty = args.includes('--pretty');
  fs.writeFileSync(outFile, JSON.stringify(payload, null, pretty ? 2 : 0) + '\n');
  log(`写入 ${outFile}（${(fs.statSync(outFile).size / 1024).toFixed(1)} KB）`);
  for (const [s, list] of Object.entries(grouped)) log(`  set ${s}: ${list.length} 套`);
  if (summaryOnly) process.exit(0);

  // —— 前期棋盘聚类（early-comps）：单独一个文件，按赛季归档 ——
  try {
    const overview = await client.earlyComps('comps_overview');
    if (overview?.tft_set && overview.tft_set !== `TFTSet${set}`) throw new Error('前期阵容赛季不符');
    const stages = mod.parseEarlyOverview ? mod.parseEarlyOverview(overview) : [];
    if (stages.length) {
      const earlyPayload = {
        meta: {
          fetchedAt: new Date().toISOString(),
          tft_set: overview?.tft_set ?? cluster.tft_set,
          sampleSize: overview?.sampleSize ?? null,
          source: 'https://api.metatft.com/tft-early-comps',
          clusteringId: overview.clustering_id,
          statisticsUpdated: overview.lastUpdated,
          scope: 'latest_stats per board; full stage candidate list',
        },
        sets: { [String(set)]: stages },
      };
      const earlyFile = path.join(root, 'data', 'metatft-early.json');
      fs.writeFileSync(earlyFile, JSON.stringify(earlyPayload, null, pretty ? 2 : 0) + '\n');
      log(`early: ${stages.length} 个阶段 → ${earlyFile}（${(fs.statSync(earlyFile).size / 1024).toFixed(1)} KB）`);
      for (const s of stages) log(`  stage ${s.stage}: ${s.boards.length} 个棋盘`);
    } else {
      log('early: 没解析到阶段数据（跳过）');
    }
  } catch (e) {
    log(`early: 拉取失败（${e.message}），保留旧文件`);
  }
} catch (e) {
  console.error('[metatft] 失败：', e.message);
  console.error('提示：缺 Referer 会被拒；国内网络可能需要代理。');
  process.exit(1);
}
