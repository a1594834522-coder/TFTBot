<script setup lang="ts">
import type { ReaderStatus } from '../recognition/status';
import { dataset } from '../game/tft-data';
import { computed } from 'vue';
import { analyzePool } from '../game/cardTracker';
import { currentPool, normalizeShopHero, shopCatalog } from '../game/shop-mechanics';
const props = defineProps<{ status: ReaderStatus | null; selectedIds?: string[] }>();
const pool = computed(() => props.status?.tracker?.snapshot ? analyzePool(props.status.tracker.snapshot.ownedByName, shopCatalog, { pool: currentPool, normalizeName: normalizeShopHero }) : []);
function remaining(id: string) { return pool.value.find(r => r.champion === normalizeShopHero(id))?.remaining; }
defineEmits<{ (event: 'start'): void; (event: 'stop'): void }>();
</script>
<template>
  <section class="reader-panel" data-reader-panel :data-phase="status?.phase ?? 'stopped'" :data-test-mode="!!status?.testMode">
    <header><div><h2>商店与海克斯识别</h2><p>{{ status?.message ?? '未连接原版采集' }}</p></div><div><button v-if="!status || ['stopped', 'error'].includes(status.phase)" class="primary" data-reader-start @click="$emit('start')">连接原版采集</button><button v-else @click="$emit('stop')">停止连接</button></div></header>
    <div v-if="status?.testMode" class="notice">协议测试数据，用于验证传输和展示，不代表已读取真实对局。</div>
    <p v-else-if="status?.phase === 'waiting'" class="notice">原生服务会等待当前赛季的云顶窗口，再加载原版 GEP；当前尚未收到真实游戏读数。</p>
    <div class="reader-grid"><div><h3>当前商店 <small>{{ status?.cards.shopReady ? '五槽已匹配' : '等待有效数据' }}</small></h3><div class="shop-slots"><div v-for="n in 5" :key="n" :class="['reader-card', {target:selectedIds?.includes(normalizeShopHero(status?.cards.shop[n-1]?.id ?? ''))}]" :data-shop-card="status?.cards.shop[n - 1]?.known ? status.cards.shop[n - 1]!.id : undefined"><img v-if="status?.cards.shop[n - 1]?.known" :src="dataset.characterById(status.cards.shop[n - 1]!.id)?.image_path" alt="" /><strong>{{ status?.cards.shop[n - 1]?.name ?? '空槽 / 未采集' }}</strong><small v-if="status?.cards.shop[n - 1] && remaining(status.cards.shop[n - 1]!.id) !== undefined">估计剩余 {{ remaining(status.cards.shop[n - 1]!.id) }} 张</small></div></div></div>
    <div><h3>海克斯三选一 <small>{{ status?.cards.augmentsReady ? '已关联 MetaTFT 评级' : '等待有效数据' }}</small></h3><div class="augment-slots"><div v-for="n in 3" :key="n" class="reader-card" :data-live-augment="status?.cards.augments[n - 1]?.known ? status.cards.augments[n - 1]!.id : undefined"><strong>{{ status?.cards.augments[n - 1]?.name ?? '空槽 / 未采集' }}</strong><b v-if="status?.cards.augments[n - 1]?.rating">{{ status.cards.augments[n - 1]!.rating }}</b></div></div><p v-if="status?.cards.pickedAugment">已选：{{ status.cards.pickedAugment.name }}</p></div></div>
    <p v-if="status?.scoreboard" class="notice" data-scoreboard-status :data-phase="status.scoreboard.phase">全场持牌：{{ status.scoreboard.message }} · 有效快照 {{ status.scoreboard.frames }}</p>
    <footer>有效事件 {{ status?.frames ?? 0 }} 条<span v-if="status?.lastFrameAt"> · 最近接收 {{ new Date(status.lastFrameAt).toLocaleTimeString('zh-CN') }}</span> · 未识别 ID 不用于自动决策</footer>
  </section>
</template>
<style scoped>
.reader-card.target{outline:1px solid var(--clay);outline-offset:2px}
.reader-panel{border:1px solid var(--line-strong);border-radius:7px;background:var(--surface);padding:20px;margin-bottom:22px}.reader-panel header{display:flex;align-items:center;justify-content:space-between;gap:20px}.reader-panel h2{font-size:18px;margin:0}.reader-panel header p,.reader-panel footer{font-size:11px;color:var(--muted)}.reader-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:30px}.reader-panel h3{font-size:12px;font-weight:500}.reader-panel h3 small{color:var(--faint);margin-left:8px;font-size:10px}.shop-slots,.augment-slots{display:flex;gap:8px}.reader-card{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;gap:8px;flex-direction:column;border:1px solid var(--line-strong);background:var(--surface-inset);padding:14px 6px;min-height:80px;border-radius:5px;text-align:center}.reader-card img{height:42px;width:42px}.reader-card strong{font-size:11px;font-weight:500}.reader-card b{font-size:20px;color:var(--accent)}.reader-panel footer{margin-top:18px}.reader-panel>.notice{margin-top:15px}
</style>
