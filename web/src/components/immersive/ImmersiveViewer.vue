<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMapStore } from '../../stores/mapStore';
import { ImmersiveCampusViewer, type ImmersiveState } from '../../gis/three/immersive/ImmersiveCampusViewer';
import ImmersiveToolbar from './ImmersiveToolbar.vue';
import ImmersiveFeatureInfo from './ImmersiveFeatureInfo.vue';
const emit=defineEmits<{exit:[]}>();
const store=useMapStore(),host=ref<HTMLElement>(),infoOpen=ref(true);
const status=ref<ImmersiveState>({status:'idle',loadMs:0,readyMs:0,fps:0,drawCalls:0,triangles:0,reversedDepthBuffer:false,clipControl:false,pixelRatio:1,nodeCount:0});
const feature=computed(()=>store.selectedFeature);
let viewer:ImmersiveCampusViewer|undefined,dead=false;
function choose(id:string){store.selection.select(id);infoOpen.value=true;viewer?.focusFeature(id);}
function overview(){infoOpen.value=false;viewer?.focusOverview();}
function escape(event:KeyboardEvent){
  if(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key==='Escape'){event.preventDefault();emit('exit');}
  else if(event.key.toLowerCase()==='f'&&store.selectedFeatureId)viewer?.focusFeature(store.selectedFeatureId);
  else if(event.key.toLowerCase()==='h')overview();
}
onMounted(async()=>{
  window.addEventListener('keydown',escape);
  if(!store.featuresReady)await store.loadFeatures();
  if(dead||!host.value)return;
  if(store.featuresError){status.value={...status.value,status:'error',error:store.featuresError};return;}
  viewer=new ImmersiveCampusViewer(host.value,store.featureRepository,{
    state:state=>{status.value=state;},
    pick:id=>{if(id){store.selection.select(id);infoOpen.value=true;}else infoOpen.value=false;},
    hover:id=>store.selection.hover(id),
  });
  viewer.setTeachingPlanPreview(store.teachingPreview);
  await viewer.mount(store.selectedFeatureId);
});
watch(()=>store.teachingPreview,v=>viewer?.setTeachingPlanPreview(v));
watch(()=>store.selectedFeatureId,id=>{viewer?.setSelection(id);if(id)infoOpen.value=true;});
onBeforeUnmount(()=>{dead=true;window.removeEventListener('keydown',escape);store.selection.hover(null);viewer?.dispose();});
</script>
<template>
  <div class="immersive-shell" data-testid="immersive-viewer" aria-label="沉浸式校园三维查看器">
    <div ref="host" class="immersive-stage" data-testid="immersive-stage"></div>
    <ImmersiveToolbar :selected-id="store.selectedFeatureId" @exit="emit('exit')" @overview="overview" @choose="choose" @focus="store.selectedFeatureId&&viewer?.focusFeature(store.selectedFeatureId)" />
    <div v-if="status.status!=='ready'" class="immersive-loading" role="status">
      <div class="immersive-loading-card"><span class="immersive-loading-icon">◉</span>
        <h2>{{status.status==='error'?'三维校园暂不可用':'正在进入校园'}}</h2>
        <p>{{status.status==='error'?status.error:'正在校验并加载校园模型…'}}</p>
        <button v-if="status.status==='error'" @click="emit('exit')">返回 WebGIS</button>
      </div>
    </div>
    <ImmersiveFeatureInfo v-if="status.status==='ready'&&feature&&infoOpen" :feature="feature" @close="infoOpen=false" @focus="viewer?.focusFeature(feature.id)" @exit="emit('exit')" />
    <div v-if="status.status==='ready'" class="immersive-metrics" data-testid="immersive-metrics">
      <span>{{status.fps?'FPS '+status.fps:'静止 · 按需渲染'}}</span><span>{{status.drawCalls}} calls</span><span>{{status.triangles.toLocaleString()}} tris</span>
      <span>{{status.reversedDepthBuffer?'反向深度':'标准深度'}}</span>
    </div>
  </div>
</template>
