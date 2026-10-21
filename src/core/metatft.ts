/**
 * MetaTFT 网站接口客户端（按 metatft/INTERFACES.md 的实测结论实现）
 *
 * 覆盖 A+B 层，**不碰 C（App 本机/GEP/LCU，国服拿不到数据）**：
 *   A1 tft-stat-api     全局统计（units/traits/items/augments_tiers/percentiles/games/patch）
 *   A2 tft-comps-api    阵容聚类（latest_cluster_id / comp_options / comp_details）
 *   A3 tft-explorer-api 条件切片（官方 unit_unique/item_unique 联合筛选已实测；旧 units/items 参数会被忽略）
 *   A4 tft-early-comps  前期棋盘聚类
 *   B1/B2 静态模型与常量（只给出 URL，不在这里下载）
 *
 * 设计要点：
 *   - 依赖注入 `fetchImpl`，单测零网络；
 *   - 必须带 `Referer/Origin`（少了会被拒）；
 *   - `comp_details` **必须同时给 comp 与 cluster_id**（只给 cluster_id 返回空结构）；
 *   - 名次向量统一用 `placementStats()` 换算，避免各处自己算错。
 */

export const METATFT_HOSTS = {
  /** 统计 / 阵容 / 条件查询 */
  hc: 'https://api-hc.metatft.com',
  /** 前期聚类 */
  api: 'https://api.metatft.com',
  /** 静态模型与 lookups */
  data: 'https://data.metatft.com',
} as const;

/** 三个头就够，没有 token、没有签名；缺 Referer 会被拒 */
export const METATFT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155.0',
  Referer: 'https://www.metatft.com/',
  Origin: 'https://www.metatft.com',
  Accept: 'application/json',
};

export type MetatftQueue = 1100 | 1090 | 1160;

export interface MetatftErrorInfo {
  status: number;
  url: string;
  body?: string;
}

export class MetatftError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body?: string;
  constructor(msg: string, info: MetatftErrorInfo) {
    super(msg);
    this.name = 'MetatftError';
    this.status = info.status;
    this.url = info.url;
    this.body = info.body;
  }
}

/* ---------- 响应类型（只声明用到的字段，其余原样保留） ---------- */

export interface PatchInfo {
  patch: string;
  b_patch_version: string;
  count: number;
  start?: string;
}

export interface GamesInfo {
  current_patch?: { patch: string; b_patch_version: string; count: number };
  games?: Array<{ srq?: unknown[]; count?: number }>;
}

export interface PlacementRow {
  /** 8 个桶，[0] = 第 1 名 */
  placement_count: number[];
  [k: string]: unknown;
}

export interface LatestCluster {
  updated?: number | string;
  tft_set: string;
  cluster_id: number;
}
export interface ClusterName {
  Cluster: number;
  name?: Array<{ name: string; type: 'unit' | 'trait'; score?: number }>;
}
export interface ClusterInfoResponse {
  cluster_info?: { cluster_id: number; tft_set: string; cluster_details?: { clusters?: ClusterName[] } };
}

export interface CompOptionEntry {
  cluster?: number;
  units_list?: unknown;
  traits_list?: unknown;
  [k: string]: unknown;
}

/** comp_options 的结构：{ results: { options: { "<compId>": { "<size>": [entry…] } }, overall? } } */
export interface CompOptionsResponse {
  results?: {
    options?: Record<string, Record<string, CompOptionEntry[]>>;
    overall?: unknown;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface CompDetailsResponse {
  results?: {
    placements?: number[] | Array<{ count: number; avg: number }>;
    final_levels?: Array<{ level: string | number; count: number; avg?: number }>;
    levels?: Array<{ stage: number; round: number; level: number; count: number }>;
    builds?: unknown[];
    augments?: unknown;
    traits?: unknown;
    unit_stats?: unknown;
    overall?: { count?: number; avg?: number };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface StationMetrics {
  games: number;
  avgPlace: number;
  win: number;
  top4: number;
}

/** 名次向量 → 局数/平均名次/吃鸡率/前四率（[0] 是第 1 名） */
export function placementStats(placementCount: number[] | null | undefined): StationMetrics {
  const pc = (placementCount ?? []).map((n) => Number(n) || 0);
  const games = pc.reduce((a, b) => a + b, 0);
  if (!games) return { games: 0, avgPlace: 0, win: 0, top4: 0 };
  const weighted = pc.reduce((a, c, i) => a + (i + 1) * c, 0);
  return {
    games,
    avgPlace: weighted / games,
    win: (pc[0] ?? 0) / games,
    top4: pc.slice(0, 4).reduce((a, b) => a + b, 0) / games,
  };
}

export interface MetatftClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 简单 TTL 缓存（默认 5 分钟） */
  cacheTtlMs?: number;
  now?: () => number;
  headers?: Record<string, string>;
  retries?: number;
}

export interface MetatftClient {
  readonly headers: Record<string, string>;
  patch(): Promise<PatchInfo>;
  games(days?: number): Promise<GamesInfo>;
  units(params?: Record<string, string | number>): Promise<PlacementRow[]>;
  traits(params?: Record<string, string | number>): Promise<PlacementRow[]>;
  items(params?: Record<string, string | number>): Promise<PlacementRow[]>;
  augmentTiers(): Promise<any>;
  percentiles(): Promise<any>;
  latestCluster(): Promise<LatestCluster>;
  clusterInfo(): Promise<ClusterInfoResponse>;
  compOptions(queue?: MetatftQueue): Promise<CompOptionsResponse>;
  compDetails(comp: string | number, clusterId: string | number): Promise<CompDetailsResponse>;
  explorer(dimension: string, params?: Record<string, string | number | boolean>): Promise<any>;
  conditionalExplorer(dimension:string,query:ExplorerConditionQuery):Promise<any>;
  earlyComps(kind?: 'comps_overview' | 'comps_full'): Promise<any>;
  /** 直接取 JSON（调试用） */
  getJson(url: string): Promise<any>;
  clearCache(): void;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? '?' + parts.join('&') : '';
}

export interface ExplorerConditionQuery {
  queue:MetatftQueue;patch:string;bPatch:string;
  units?:Array<{id:string;exclude?:boolean}>;
  items?:Array<{id:string;exclude?:boolean}>;
  /** A particular unit wearing an item, rather than both existing anywhere. */
  holderItems?:Array<{unit:string;item:string;exclude?:boolean}>;
  unitStates?:Array<{unit:string;star?:1|2|3|4;numItems?:0|1|2|3;exclude?:boolean}>;
  level?:number;
  ranks?:string[];
}
/** Exact parameter family used by the official Explorer. Repeated unit/item keys
 * are retained instead of being collapsed into a plain object. */
export function explorerConditionUrl(dimension:string,query:ExplorerConditionQuery):string{
  if(!/^[a-z_]+$/.test(dimension)||!/^\d+\.\d+$/.test(query.patch)||!/^[a-z]?$/.test(query.bPatch)||![1100,1090,1160].includes(query.queue))throw new Error('Invalid conditional Explorer query');
  const params=new URLSearchParams({queue:String(query.queue),patch:query.patch,b_patch:query.bPatch,formatnoarray:'true',compact:'true'});
  for(const [key,conditions]of [['unit_unique',query.units],['item_unique',query.items]] as const){
    if((conditions?.length??0)>10)throw new Error('Too many Explorer conditions');
    for(const condition of conditions??[]){if(!/^[A-Za-z0-9_]+$/.test(condition.id))throw new Error('Invalid conditional ID');params.append(key,(condition.exclude?'!':'')+condition.id+'-1');}
  }
  const validId=(id:string)=>/^[A-Za-z0-9_]+$/.test(id);
  for(const conditions of [query.holderItems,query.unitStates])if((conditions?.length??0)>10)throw new Error('Too many Explorer conditions');
  for(const condition of query.holderItems??[]){
    if(!validId(condition.unit)||!validId(condition.item))throw new Error('Invalid carrier/item ID');
    params.append('unit_item_unique',(condition.exclude?'!':'')+condition.unit+'-1&'+condition.item+'-1');
  }
  for(const condition of query.unitStates??[]){
    if(!validId(condition.unit)||condition.star!==undefined&&(!Number.isInteger(condition.star)||condition.star<1||condition.star>4)||condition.numItems!==undefined&&(!Number.isInteger(condition.numItems)||condition.numItems<0||condition.numItems>3))throw new Error('Invalid unit state');
    params.append('unit_tier_numitems_unique',(condition.exclude?'!':'')+condition.unit+'-1_'+(condition.star??'.*')+'_'+(condition.numItems??'.*'));
  }
  if(query.level!==undefined){if(!Number.isInteger(query.level)||query.level<1||query.level>11)throw new Error('Invalid level');params.set('level',String(query.level));}
  if(query.ranks?.length){if(query.ranks.some(r=>!/^[A-Z]+$/.test(r)))throw new Error('Invalid rank');params.set('rank',[...query.ranks].sort().join(','));}
  return `${METATFT_HOSTS.hc}/tft-explorer-api/${dimension}?${params}`;
}

export function conditionalPlacementSummary(raw:unknown):{count:number;mean:number|null;first:number|null;top4:number|null;buckets:number[]}|null{
  const rows=Array.isArray(raw)?raw:(raw as any)?.data;
  if(!Array.isArray(rows)||rows.length!==1)return null;
  const pc=rows[0]?.placement_count;
  if(!Array.isArray(pc)||pc.length!==8||pc.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0))return null;
  const count=pc.reduce((sum,n)=>sum+n,0);
  return {count,mean:count?pc.reduce((sum,n,i)=>sum+n*(i+1),0)/count:null,first:count?pc[0]/count:null,top4:count?pc.slice(0,4).reduce((sum,n)=>sum+n,0)/count:null,buckets:[...pc]};
}

export function createMetatftClient(opts: MetatftClientOptions = {}): MetatftClient {
  const doFetch = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!doFetch) throw new Error('createMetatftClient: 没有可用的 fetch');
  const timeoutMs = opts.timeoutMs ?? 15000;
  const ttl = opts.cacheTtlMs ?? 5 * 60 * 1000;
  const now = opts.now ?? (() => Date.now());
  const retries = opts.retries ?? 1;
  const headers = { ...METATFT_HEADERS, ...(opts.headers ?? {}) };
  const cache = new Map<string, { at: number; data: any }>();

  async function getJson(url: string): Promise<any> {
    const hit = cache.get(url);
    if (hit && now() - hit.at < ttl) return hit.data;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const res = await doFetch!(url, { headers, signal: controller?.signal as any });
        const text = await res.text();
        if (!res.ok) {
          throw new MetatftError(`MetaTFT ${res.status} ${url}`, { status: res.status, url, body: text.slice(0, 300) });
        }
        let data: any;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new MetatftError(`MetaTFT 返回非 JSON: ${url}`, { status: res.status, url, body: text.slice(0, 300) });
        }
        cache.set(url, { at: now(), data });
        return data;
      } catch (err) {
        lastErr = err;
        // 4xx 不重试（除了 429）
        if (err instanceof MetatftError && err.status >= 400 && err.status < 500 && err.status !== 429) break;
        if (attempt === retries) break;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  const hc = (path: string, params?: Record<string, string | number | boolean | undefined>) =>
    getJson(`${METATFT_HOSTS.hc}${path}${params ? qs(params) : ''}`);

  return {
    headers,
    getJson,
    patch: () => hc('/tft-stat-api/patch'),
    games: (days = 3) => hc('/tft-stat-api/games', { days }),
    units: (params = {}) => hc('/tft-stat-api/units', params),
    traits: (params = {}) => hc('/tft-stat-api/traits', params),
    items: (params = {}) => hc('/tft-stat-api/items', params),
    augmentTiers: () => hc('/tft-stat-api/augments_tiers'),
    percentiles: () => hc('/tft-stat-api/percentiles'),
    latestCluster: () => hc('/tft-comps-api/latest_cluster_id'),
    clusterInfo: () => hc('/tft-comps-api/latest_cluster_info'),
    compOptions: (queue = 1100) => hc('/tft-comps-api/comp_options', { queue }),
    compDetails: (comp, clusterId) => hc('/tft-comps-api/comp_details', { comp, cluster_id: clusterId }),
    explorer: (dimension, params = {}) => hc(`/tft-explorer-api/${dimension}`, { compact: true, ...params }),
    conditionalExplorer:(dimension,query)=>getJson(explorerConditionUrl(dimension,query)),
    earlyComps: (kind = 'comps_overview') => getJson(`${METATFT_HOSTS.api}/tft-early-comps/${kind}`),
    clearCache: () => cache.clear(),
  };
}

/* ---------- 静态资源 URL（B 层，下载交给调用方） ---------- */

export function modelUrls(set: number | string, variant = 'WinRateModelImproved_BoardStrengthEA') {
  const tag = `TFTSet${set}`;
  return {
    lookups: `${METATFT_HOSTS.data}/model_lookupsEA_${tag}.json`,
    model: `${METATFT_HOSTS.data}/${variant}_${tag}/model.json`,
    shard: `${METATFT_HOSTS.data}/${variant}_${tag}/group1-shard1of1.bin`,
  };
}

export function iconUrl(kind: 'champions' | 'items' | 'traits' | 'augments' | 'ranks', id: string) {
  return `https://cdn.metatft.com/file/metatft/${kind}/${id.toLowerCase()}.png`;
}
