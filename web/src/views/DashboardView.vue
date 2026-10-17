<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { loadDashboardStats } from '../gis/stats/StatsRepository';
import { STAT_LAYERS, type DashboardStats } from '../gis/stats/CampusStats';
const stats = ref<DashboardStats>(), loading = ref(true), error = ref('');
const source = import.meta.env.VITE_FEATURE_SOURCE === 'api' ? 'api' : 'static';
let controller: AbortController | undefined;
async function load() {
  controller?.abort();
  const request = new AbortController(); controller = request;
  loading.value = true; error.value = '';
  try { stats.value = await loadDashboardStats(source, request.signal); }
  catch (reason) { if (!request.signal.aborted) error.value = `统计暂时不可用：${reason instanceof Error ? reason.message : String(reason)}`; }
  finally { if (!request.signal.aborted) loading.value = false; }
}
onMounted(load); onBeforeUnmount(() => controller?.abort());
const format = (value: number, digits = 0) => value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const cards = computed(() => stats.value ? [
  { name: '校园边界面积', value: format(stats.value.campusAreaSquareMeters / 1e6, 2), unit: 'km²', note: '边界多边形 · UTM 平面面积', layer: 'campus-boundary' },
  { name: '建筑要素', value: format(stats.value.buildingCount), unit: '个', note: 'GIS 建筑面，不等于楼宇登记数', layer: 'buildings' },
  { name: '道路总长度', value: format(stats.value.roadLengthMeters / 1000, 2), unit: 'km', note: '道路中心线长度累计', layer: 'roads' },
  { name: '绿地面积', value: format(stats.value.greenAreaSquareMeters / 10000, 2), unit: 'ha', note: '已收录绿地面面积累计', layer: 'green-areas' },
  { name: '水域面积', value: format(stats.value.waterAreaSquareMeters / 10000, 2), unit: 'ha', note: '已收录水体面面积累计', layer: 'waterways' },
  { name: '体育场', value: format(stats.value.sportsCount), unit: '处', note: '跑道与内场计为同一体育场', layer: 'sports' },
] : []);
const layerCounts = computed(() => STAT_LAYERS.map(layer => ({ ...layer, count: stats.value?.layers.find(row => row.layer === layer.key)?.featureCount ?? 0 })));
const maxCount = computed(() => Math.max(1, ...layerCounts.value.map(layer => layer.count)));
const surfaces = computed(() => {
  if (!stats.value) return [];
  const total = stats.value.greenAreaSquareMeters + stats.value.waterAreaSquareMeters;
  return [
    { name: '绿地', value: stats.value.greenAreaSquareMeters, layer: 'green-areas', color: '#65a98b' },
    { name: '水域', value: stats.value.waterAreaSquareMeters, layer: 'waterways', color: '#329bda' },
  ].map(surface => ({ ...surface, percent: total ? surface.value / total * 100 : 0 }));
});
</script>
<template>
  <section class="content-page dashboard">
    <div class="page-heading"><div><span class="eyebrow">CAMPUS INSIGHTS</span><h1>用数据，理解校园。</h1></div><button type="button" :disabled="loading" @click="load">{{ loading ? '正在读取…' : '刷新统计' }}</button></div>
    <p class="page-intro">从校园轮廓到道路、水域与绿地，将空间数据转化为可探索的校园概览。</p>
    <div v-if="error" class="dashboard-error" role="alert">{{ error }}<button type="button" @click="load">重试</button><p>当前数据源为 {{ source }}，不会静默切换到其他数据。</p></div>
    <p v-else-if="loading && !stats" class="dashboard-loading" role="status">正在加载校园统计，请稍候…</p>
    <template v-if="stats && !error">
      <div class="data-provenance"><span class="source-badge">{{ stats.source === 'api' ? 'PostGIS · 在线数据' : 'Static · 本地 GIS 数据' }}</span><span>{{ format(stats.totalFeatures) }} 个空间要素 · 8 类图层</span><span>读取于 {{ new Date(stats.loadedAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</span></div>
      <div class="stats-grid">
        <RouterLink v-for="(card, i) in cards" :key="card.layer" :to="{ path: '/map', query: { focusLayer: card.layer } }" class="stat-card" :aria-label="`在地图查看${card.name}`">
          <span class="stat-no">0{{ i + 1 }}</span><h2>{{ card.name }}</h2><div class="metric-value"><strong>{{ card.value }}</strong><span>{{ card.unit }}</span></div><small>{{ card.note }}</small><span class="stat-link">在地图查看 ↗</span>
        </RouterLink>
      </div>
      <div class="dashboard-charts">
        <article class="chart-card"><span class="eyebrow">LAYER INVENTORY</span><h2>空间要素分布</h2><p>点击图层，进入该类数据的地图视图。</p>
          <div class="layer-bars"><RouterLink v-for="layer in layerCounts" :key="layer.key" :to="{ path: '/map', query: { focusLayer: layer.mapId } }" class="layer-bar" :aria-label="`${layer.name} ${layer.count} 个，在地图查看`"><span>{{ layer.name }}</span><span class="bar-track"><span :style="{ width: `${layer.count / maxCount * 100}%` }"></span></span><strong>{{ layer.count }}</strong></RouterLink></div>
        </article>
        <article class="chart-card"><span class="eyebrow">GREEN & BLUE</span><h2>已收录绿地与水域</h2><p>仅比较两类面数据，不代表全校园土地利用占比。</p>
          <div class="surface-stack" aria-hidden="true"><span v-for="surface in surfaces" :key="surface.layer" :style="{ width: `${surface.percent}%`, background: surface.color }"></span></div>
          <RouterLink v-for="surface in surfaces" :key="surface.layer" :to="{ path: '/map', query: { focusLayer: surface.layer } }" class="surface-row"><span><i :style="{ background: surface.color }"></i>{{ surface.name }}</span><strong>{{ format(surface.value / 10000, 2) }} ha</strong><span>{{ format(surface.percent, 1) }}%</span></RouterLink>
          <div class="chart-note">体育设施图层含跑道与足球场共 8 个面；体育场按 4 处统计。面积为已收录要素累计，未做重叠消除。</div>
        </article>
      </div>
      <p class="statistics-method">统计基准：EPSG:32650（米）。{{ stats.source === 'api' ? '建筑、道路、绿地、水体与体育场来自 PostGIS；校园边界面积由版本化静态边界计算。' : '全部由版本化静态 GeoJSON 转换至 UTM 后计算。' }} 这些数据用于校园展示与分析演示，不替代测绘成果。</p>
    </template>
  </section>
</template>
