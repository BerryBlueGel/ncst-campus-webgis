<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { layerFocus, STAT_LAYERS } from '../gis/stats/CampusStats';
import { useRoute, useRouter } from 'vue-router';
import TopBar from "../components/TopBar.vue";
import LayerPanel from "../components/LayerPanel.vue";
import FeaturePanel from "../components/FeaturePanel.vue";
import StatusBar from "../components/StatusBar.vue";
import MapCanvas from "../components/MapCanvas.vue";
import DeferredToolStatus from '../components/DeferredToolStatus.vue';
import { useMapStore } from "../stores/mapStore";
import { cameraQuery } from '../gis/map/MapConfig';
import { isImmersiveView, enterImmersiveQuery, exitImmersiveQuery, type ImmersiveQuery } from '../gis/three/immersive/ImmersiveUrlState';
// Keep optional tools out of the map's initial download. Both fallback states
// retain the parent's exit/close listeners, including immersive deep links.
const deferredOptions={loadingComponent:DeferredToolStatus,errorComponent:DeferredToolStatus,delay:150,timeout:30000};
const ImmersiveViewer=defineAsyncComponent({...deferredOptions,loader:()=>import('../components/immersive/ImmersiveViewer.vue')});
const AnalysisWorkbench=defineAsyncComponent({...deferredOptions,loader:()=>import('../components/AnalysisWorkbench.vue')});
const store = useMapStore(),
  route=useRoute(),router=useRouter(),
  canvas = ref<InstanceType<typeof MapCanvas>>(),
  page = ref<HTMLElement>(),
  full = ref(false),
  notice = ref("");
defineProps<{analysisMode?:boolean}>();
const focusedLayer = computed(() => STAT_LAYERS.find(layer => layer.mapId === route.query.focusLayer));
watch(() => route.query.focusLayer, query => {
  const visibility = layerFocus(query);
  if (visibility) Object.entries(visibility).forEach(([id, visible]) => store.toggleLayer(id, visible));
}, { immediate: true });
function showAllLayers() { void router.replace({ query: { ...route.query, focusLayer: 'all' } }); }
const analysisOpen=ref(false);
function closeAnalysis(){store.analysis.cancel();if(route.path==='/analysis')void router.push({path:'/map',query:route.query});else analysisOpen.value=false;}
const immersiveOpen=computed(()=>isImmersiveView(route.query as ImmersiveQuery));
function enterImmersive(id?:string){
  store.analysis.cancel();
  if(id)store.selection.select(id);
  const query=enterImmersiveQuery({...route.query,...cameraQuery(store.camera)} as ImmersiveQuery,store.selectedFeatureId);
  void router.push({path:'/map',query});
}
function exitImmersive(){
  if(store.selectedFeatureId&&window.matchMedia('(min-width: 801px)').matches)store.rightOpen=true;
  void router.replace({path:'/map',query:exitImmersiveQuery(route.query as ImmersiveQuery)});
}
onMounted(async()=>{if(immersiveOpen.value&&typeof route.query.selected==='string'){
  await store.loadFeatures();store.selection.select(route.query.selected);
}});
function fullChanged() {
  full.value = !!document.fullscreenElement;
}
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await page.value?.requestFullscreen();
  } catch {
    notice.value = "当前浏览器暂不支持全屏";
  }
}
const narrow=window.matchMedia('(max-width: 800px)');
function responsive(){if(narrow.matches){store.leftOpen=false;store.rightOpen=false;}}
onMounted(() => {document.addEventListener("fullscreenchange", fullChanged);narrow.addEventListener('change',responsive);responsive();});
onBeforeUnmount(() => {document.removeEventListener("fullscreenchange", fullChanged);narrow.removeEventListener('change',responsive);});
</script>
<template>
  <section ref="page" class="map-page" :inert="immersiveOpen">
    <TopBar :full="full" @home="canvas?.home()" @fullscreen="fullscreen" @toggle3D="canvas?.toggle3D()" @view3D="canvas?.campus3DView()" @immerse="enterImmersive()" @chooseFeature="id=>canvas?.selectFeature(id)" />
    <p v-if="notice" role="status">{{ notice }}</p>
    <div v-if="focusedLayer" class="layer-focus-note" role="status">当前聚焦：{{ focusedLayer.name }}<button type="button" @click="showAllLayers">显示全部图层</button></div>
    <div class="map-workspace" :class="{'analysis-active':analysisMode||analysisOpen}">
      <LayerPanel v-if="store.leftOpen" /><button
        v-else
        class="reopen left"
        aria-label="展开图层面板"
        @click="store.leftOpen = true"
      >
        › 图层</button
      ><MapCanvas ref="canvas" /><FeaturePanel v-if="store.rightOpen" @flyTo="id=>canvas?.flyToFeature(id)" @zoomTo="id=>canvas?.zoomToFeature(id)" @view3D="id=>canvas?.viewFeature3D(id)" @immerse="id=>enterImmersive(id)" @analyze="id=>{canvas?.selectFeature(id);analysisOpen=true;store.analysis.activateTool('buffer')}" @clear="canvas?.clearSelection()" /><button
        v-else
        class="reopen right"
        aria-label="展开信息面板"
        @click="store.rightOpen = true"
      >
        信息 ‹
      </button>
      <AnalysisWorkbench v-if="analysisMode||analysisOpen" :expanded="analysisMode" @close="closeAnalysis" @choose="id=>canvas?.selectFeature(id)" />
      <button v-else class="analysis-open" type="button" aria-label="打开空间分析" @click="analysisOpen=true">⌖ 空间分析</button>
    </div>
    <StatusBar />
  </section>
  <ImmersiveViewer v-if="immersiveOpen" @exit="exitImmersive" />
</template>
