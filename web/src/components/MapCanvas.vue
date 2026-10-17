<script setup lang="ts">
import { onMounted, onBeforeUnmount, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MapEngine } from "../gis/map/MapEngine";
import { DefaultOpenMapProvider } from "../gis/map/BaseMapProvider";
import { readCamera, cameraQuery, DEFAULT_CAMERA } from "../gis/map/MapConfig";
import { useMapStore } from "../stores/mapStore";
import { CameraUrlSync } from '../gis/map/CameraUrlSync';
import { coordinates } from "../gis/coordinate/CampusCoordinateService";
import { CampusModelAnchor as anchor } from '../gis/three/CampusModelAnchor';
import { readSelected,selectedQueryWithMode,selectedQueryWhileLoading,threeModeAfterRouteUpdate } from '../gis/interaction/SelectedUrlState';
import { featureCamera } from '../gis/interaction/FeatureDisplayConfig';
import { featureForDisplayCamera } from '../gis/layers/CampusDisplayGeometry';
import {SHAPE_REVIEW_ENABLED} from '../gis/three/CampusDetailReview';
import { featureFocusViewport } from '../gis/map/FeatureFocusViewport';
let focusRequest=0,unmounted=false;
const debugEnabled =
  import.meta.env.DEV && import.meta.env.VITE_GIS_DEBUG === "true";
const debugPoint = ref<{
  wgs84: number[];
  utm: number[];
  local: number[];
} | null>(null);
const pickedNode=ref('');
  const container = ref<HTMLElement>(),
  error = ref(""),
  store = useMapStore(),
  route = useRoute(),
  router = useRouter(),
  engine = new MapEngine();
engine.setInteractionGuard(()=>store.analysis.isInteracting());
engine.setTeachingPlanPreview(store.teachingPreview);
store.layerManager().setTeachingPlanPreview(store.planDisplayPreview);
store.layerManager().setSourceFragmentReview(store.sourceFragmentReview);
const cameraUrl = new CameraUrlSync(
  () => engine.getCameraState(),
  () => !store.mapReady || !!engine.getMap()?.isMoving(),
  query => router.replace({query:{...route.query,...query,
    ...selectedQueryWhileLoading(store.selectedFeatureId,store.featuresReady,route.query.selected),
    mode:store.threeRequested?'3d':'2d'}}),
);
onMounted(() => {
  const initialSelected=typeof route.query.selected==='string'?route.query.selected:null;
  store.threeRequested=route.query.mode==='3d';
  // A fresh overview/statistics route must not republish the previous page's selection.
  if(!initialSelected)store.selection.clear();
  void store.loadFeatures().then(()=>{
    if(unmounted||!store.featuresReady)return;
    const id=readSelected(new URLSearchParams(initialSelected?`selected=${encodeURIComponent(initialSelected)}`:''),key=>!!store.featureRepository.getById(key));
    if(id){store.selection.select(id);store.rightOpen=true;}
    else store.selection.clear();
    engine.setSelection(store.selectedFeatureId,store.hoveredFeatureId);
  });
  if (container.value)
    engine.create(
      container.value,
      new DefaultOpenMapProvider(),
      readCamera(new URLSearchParams(location.search)),
      {
        ready: () => {
          store.mapReady = true;
          error.value = "";
          const map=engine.getMap();if(map)store.analysis.attach(map);
        },
        camera: (state) => {
          store.camera = state;
        },
        moving: () => cameraUrl.cancel(),
        settled: () => cameraUrl.schedule(),
        three:(s)=>{store.campus3D=s;},
        picked:(id,node)=>{pickedNode.value=node??'';store.selection.select(id);if(id)store.rightOpen=true;},
        hover:(id,node)=>{if(node)pickedNode.value=node;store.selection.hover(id);},
        cursor: (point) => {
          store.cursor = point;
        },
        error: (message) => {
          error.value = "底图连接暂时不可用，请检查网络后重试。";
          console.warn("Map provider:", message);
        },
        coordinateClick: (point) => {
          if (debugEnabled)
            debugPoint.value = {
              wgs84: point,
              utm: coordinates.wgs84ToUtm(point),
              local: coordinates.wgs84ToLocal(point),
            };
        },
      },
      store.layerManager(),
      store.featureRepository,
    );
});
watch(
  () => route.query,
  (_query,previous) => {
    if (!store.mapReady) return;
    store.threeRequested=threeModeAfterRouteUpdate(route.query.mode,previous.mode,store.threeRequested);
    if(store.featuresReady){
      const id=readSelected(new URLSearchParams(location.search),key=>!!store.featureRepository.getById(key));
      if(id!==store.selectedFeatureId){store.selection.select(id);if(id)store.rightOpen=true;}
    }
    const target = readCamera(new URLSearchParams(location.search));
    const current = cameraQuery(store.camera);
    if (
      ['lng','lat','zoom','pitch','bearing'].some(key=>route.query[key]!==previous[key]) &&
      Object.entries(cameraQuery(target)).some(
        ([key, value]) => current[key] !== value,
      )
      && !cameraUrl.owns(route.query)
    ) {
      cameraUrl.cancel();
      engine.jumpTo(target);
    }
  },
);
watch(()=>store.threeRequested,(v)=>{engine.setThree(v);if(store.mapReady)cameraUrl.schedule();});
watch(()=>store.groundOffset,(v)=>engine.groundOffset(v));
watch(()=>store.teachingPreview,v=>engine.setTeachingPlanPreview(v));
watch(()=>store.planDisplayPreview,v=>{store.layerManager().setTeachingPlanPreview(v);engine.refreshSelection();});
watch(()=>store.sourceFragmentReview,v=>store.layerManager().setSourceFragmentReview(v));
watch(()=>store.selectedFeatureId,selected=>{
  engine.setSelection(selected,store.hoveredFeatureId);
  void router.replace({query:{...route.query,...selectedQueryWithMode(selected,store.threeRequested)}});
});
watch(()=>store.hoveredFeatureId,hovered=>engine.setSelection(store.selectedFeatureId,hovered));
onBeforeUnmount(() => {
  unmounted=true;
  focusRequest++;
  cameraUrl.dispose();
  store.analysis.cancel();
  store.layerManager().detach();
  store.analysis.detach();
  engine.destroy();
  store.mapReady = false;
  store.cursor = null;
});
function home() {
  focusRequest++;
  const bounds = store.layerManager().bounds;
  if (bounds) engine.fitBounds(bounds);
  else engine.flyTo(DEFAULT_CAMERA);
}
function pitch() {
  focusRequest++;
  engine.flyTo({ ...store.camera, pitch: store.camera.pitch > 0 ? 0 : 55 });
}
function rotate() {
  focusRequest++;
  engine.flyTo({
    ...store.camera,
    bearing: store.camera.bearing >= 150 ? -180 : store.camera.bearing + 30,
  });
}
function toggle3D(){focusRequest++;store.threeRequested=!store.threeRequested;engine.flyTo({...store.camera,pitch:store.threeRequested?50:0});}
function campus3DView(){focusRequest++;store.threeRequested=true;engine.campus3DView();}
async function focusFeature(id:string,fit:boolean){
  const request=++focusRequest,selected=store.selectedFeatureId,three=store.threeRequested;
  // Search opens the sheet in the same event. Measure only after Vue lays it out.
  await nextTick();
  if(request!==focusRequest||selected!==store.selectedFeatureId||three!==store.threeRequested||!container.value||!store.mapReady)return;
  const source=store.featureRepository.getById(id);if(!source)return;
  // Reviewed 3D groups can be much larger than an old source fragment. Legacy
  // inspection preferences must not fit the camera to that tiny GIS rectangle.
  const feature=featureForDisplayCamera(source,three?(store.teachingPreview||SHAPE_REVIEW_ENABLED):store.planDisplayPreview);
  const panel=container.value.closest('.map-workspace')?.querySelector<HTMLElement>('[aria-label="要素信息面板"]');
  const viewport=featureFocusViewport(container.value.getBoundingClientRect(),panel?.getBoundingClientRect()??null,window.matchMedia('(max-width: 800px)').matches);
  if(feature.bounds&&(fit||(!three&&viewport.occluded)))engine.fitBounds(feature.bounds,viewport.padding);
  else engine.flyTo(featureCamera(feature,three),viewport.occluded?viewport.offset:[0,0]);
}
function flyToFeature(id:string){void focusFeature(id,false);}
function zoomToFeature(id:string){void focusFeature(id,true);}
function selectFeature(id:string){store.selection.select(id);if(store.selectedFeatureId){store.rightOpen=true;flyToFeature(id);}}
function viewFeature3D(id:string){const feature=store.featureRepository.getById(id);if(!feature||(!feature.modelBinding&&feature.category!=='building'))return;store.selection.select(id);store.rightOpen=true;store.threeRequested=true;engine.setThree(true);flyToFeature(id);}
function clearSelection(){focusRequest++;store.selection.clear();}
defineExpose({ home,toggle3D,campus3DView,selectFeature,flyToFeature,zoomToFeature,viewFeature3D,clearSelection });
</script>
<template>
  <div class="map-stage">
    <div ref="container" class="map-canvas" aria-label="校园交互地图"></div>
    <div v-if="error" role="alert" class="map-error">
      {{ error
      }}<button
        @click="
          error = '';
          home();
        "
      >
        返回校园
      </button>
    </div>
    <div v-if="store.featuresError" role="alert" class="map-error">
      {{ store.featuresError }}
      <button type="button" @click="store.loadFeatures()">重试连接</button>
    </div>
    <div class="camera-tools">
      <button @click="pitch">
        {{ store.camera.pitch > 0 ? "俯视视角" : "倾斜视角" }}</button
      ><button @click="rotate">旋转 30°</button>
    </div>
    <p v-if="store.campus3D.status==='loading' || store.campus3D.status==='error'" class="map-error" role="status">{{store.campus3D.error || '正在加载三维校园…'}} · 二维地图仍可使用</p>
    <div
      v-if="debugEnabled"
      class="coordinate-debug"
      data-testid="coordinate-debug"
    >
      <strong>坐标调试 · 点击地图</strong
      ><template v-if="debugPoint"
        ><div>
          WGS84 {{ debugPoint.wgs84.map((v) => v.toFixed(7)).join(" / ") }}
        </div>
        <div>UTM {{ debugPoint.utm.map((v) => v.toFixed(3)).join(" / ") }}</div>
        <div>
          Local {{ debugPoint.local.map((v) => v.toFixed(3)).join(" / ") }}
        </div></template
      >
      <pre>{{ JSON.stringify({anchor,selected:store.selectedFeatureId,hovered:store.hoveredFeatureId,pickedNode:pickedNode,...store.campus3D},null,2) }}</pre>
      <label><input type="checkbox" checked @change="engine.groundOffset(($event.target as HTMLInputElement).checked)" />Ground offset</label>
    </div>
    <span class="map-help">拖动平移 · 滚轮缩放 · 右键拖动旋转 / 倾斜</span>
  </div>
</template>
