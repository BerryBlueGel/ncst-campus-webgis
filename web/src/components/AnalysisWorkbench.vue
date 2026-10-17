<script setup lang="ts">
import { computed,onMounted,onBeforeUnmount,ref,watch } from 'vue';
import { lineString } from '@turf/turf';
import type { Feature,Geometry } from 'geojson';
import { useMapStore } from '../stores/mapStore';
import type { AnalysisTool,NearestCategory } from '../gis/analysis/AnalysisTypes';
import { backendArea,backendBBox,backendBuffer,backendDistance,backendIntersection,backendNearest,backendWithin } from '../api/analysisApi';
import { formatArea,formatDistance } from '../gis/analysis/AnalysisFormatter';
import {copyAnalysisText} from '../gis/analysis/AnalysisClipboard';
const props=defineProps<{expanded?:boolean}>();
const emit=defineEmits<{choose:[id:string];close:[]}>();
const store=useMapStore(),manager=store.analysis,state=computed(()=>store.analysisState);
const tools:{id:AnalysisTool;name:string}[]=[
  {id:'coordinate',name:'测坐标'},{id:'distance',name:'测距'},{id:'area',name:'测面积'},
  {id:'buffer',name:'缓冲区'},{id:'nearest',name:'最近设施'},{id:'bbox',name:'范围查询'},
  {id:'pip',name:'点在面内'},{id:'intersection',name:'相交分析'}];
const copyNotice=ref('');
const engine=ref<'turf'|'postgis'>('turf');
const backendState=ref<'idle'|'loading'|'ready'|'error'>('idle');
const backendText=ref('');
const backendDifference=ref('');
const backendError=ref('');
let backendGeometry:Feature<Geometry>|null=null;
let turfGeometry:Feature<Geometry>|null=null;
let comparisonRevision=0;
const targets=computed(()=>manager.catalog.getAll());
const polygonTargets=computed(()=>targets.value.filter(t=>t.category==='green'||t.category==='boundary'||t.category==='building'||t.category==='stadium'));
function activate(tool:AnalysisTool){manager.activateTool(tool);}
function setEngine(value:'turf'|'postgis'){
  engine.value=value;
  manager.showComparisonGeometry(value==='postgis'&&backendState.value==='ready'&&backendGeometry?
    backendGeometry:turfGeometry);
}
function targetFeatureId(id:string){
  const target=manager.catalog.get(id);
  if(target?.businessId)return target.businessId;
  if(id==='boundary:campus')return 'campus-boundary-local';
  if(id.startsWith('green:'))return id.slice(6);
  return id;
}
watch(()=>state.value.measurement,async measurement=>{
  const revision=++comparisonRevision;
  const snapshot=state.value;
  copyNotice.value='';
  backendState.value='idle';backendText.value='';backendDifference.value='';backendError.value='';
  backendGeometry=null;turfGeometry=state.value.resultGeometry;
  if(!measurement||snapshot.status!=='ready'||store.featureSource!=='api')return;
  const input=snapshot.inputGeometry?.geometry;
  backendState.value='loading';
  let text='',difference='',geometry:Feature<Geometry>|null=null;
  try{
    if(measurement.kind==='distance'&&input){
      const result=await backendDistance(input);
      text=formatDistance(result.distanceMeters);
      const turf=Number(measurement.raw?.turfMeters);
      if(Number.isFinite(turf))difference=`${Math.abs(result.distanceMeters-turf).toFixed(3)} m`;
    }else if(measurement.kind==='area'&&input){
      const result=await backendArea(input);
      text=formatArea(result.areaSquareMeters);
      const turf=Number(measurement.raw?.turfSquareMeters);
      if(Number.isFinite(turf))difference=`${Math.abs(result.areaSquareMeters-turf).toFixed(3)} m²`;
    }else if(measurement.kind==='buffer'&&input){
      const result=await backendBuffer(input,snapshot.bufferRadius);
      text=`${result.radiusMeters} m 缓冲区`;
      geometry={type:'Feature',properties:{},geometry:result.geometry};
    }else if(measurement.kind==='nearest'&&snapshot.points[0]){
      const [longitude,latitude]=snapshot.points[0];
      const category=snapshot.nearestCategory;
      const result=await backendNearest(longitude,latitude,category==='all'?undefined:[category]);
      text=`${result.feature.name} · ${formatDistance(result.distanceMeters)}`;
      const turf=Number(measurement.raw?.distanceMeters);
      if(Number.isFinite(turf))difference=`${Math.abs(result.distanceMeters-turf).toFixed(3)} m`;
      const feature=result.feature as {centroid?:[number,number]};
      if(feature.centroid)geometry=lineString([[longitude,latitude],feature.centroid]);
    }else if(measurement.kind==='intersection'&&input){
      const targetId=String(measurement.details['目标 ID']??'');
      if(targetId==='green:auto'){backendState.value='idle';return;}
      const result=await backendIntersection(input,targetFeatureId(targetId));
      text=result.intersects?`相交 · ${formatArea(result.areaSquareMeters)}`:'不相交';
      const turf=Number(measurement.raw?.turfSquareMeters);
      if(Number.isFinite(turf))difference=`${Math.abs(result.areaSquareMeters-turf).toFixed(3)} m²`;
      geometry=result.geometry?{type:'Feature',properties:{},geometry:result.geometry}:null;
    }else if(measurement.kind==='pip'&&snapshot.points[0]){
      const [longitude,latitude]=snapshot.points[0];
      const result=await backendWithin(longitude,latitude,targetFeatureId(snapshot.targetId));
      text=result.within?'位于目标面内':'位于目标面外';
    }else if(measurement.kind==='bbox'&&snapshot.points.length===2){
      const [a,b]=snapshot.points;
      const result=await backendBBox(Math.min(a[0],b[0]),Math.min(a[1],b[1]),
        Math.max(a[0],b[0]),Math.max(a[1],b[1]));
      text=`找到 ${result.features.length} 个要素`;
      difference=`计数差 ${Math.abs(result.features.length-snapshot.resultFeatures.length)}`;
    }else{backendState.value='idle';return;}
    if(revision!==comparisonRevision)return;
    backendText.value=text;backendDifference.value=difference;backendGeometry=geometry;
    backendState.value='ready';
    if(engine.value==='postgis'&&backendGeometry)manager.showComparisonGeometry(backendGeometry);
  }catch(error){
    if(revision!==comparisonRevision)return;
    backendState.value='error';
    backendError.value=error instanceof Error?error.message:String(error);
  }
});
function keydown(event:KeyboardEvent){const target=event.target as HTMLElement;
  if(['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||!manager.isInteracting())return;
  if(event.key==='Escape'){event.preventDefault();manager.cancel();}
  if(event.key==='Backspace'){event.preventDefault();manager.undo();}
}
onMounted(()=>window.addEventListener('keydown',keydown));onBeforeUnmount(()=>{comparisonRevision++;window.removeEventListener('keydown',keydown);});
async function copy(){if(!manager.getResult())return;copyNotice.value=await copyAnalysisText(manager.copyText(),text=>navigator.clipboard.writeText(text));}
</script>
<template>
  <aside class="analysis-workbench" :class="{expanded}" aria-label="空间分析工具箱" data-testid="analysis-workbench">
    <header><div><h2>空间分析</h2></div><button type="button" aria-label="收起分析面板" @click="emit('close')">×</button></header>
    <p class="analysis-intro">选择工具，在地图上绘制或点击。</p>
    <details class="analysis-method"><summary>计算方式与数据说明</summary><p>Turf 用经纬度计算，并用 UTM 米制结果校验；PostGIS 使用后端空间数据。</p>
    <p v-if="store.teachingPreview" class="analysis-provenance" data-testid="analysis-source-note">教学区和生活区总图工作版仅用于显示；分析使用原始 GIS 轮廓，院落与连廊可能不同。<button type="button" @click="store.teachingPreview=false">查看原始轮廓</button></p>
    </details>
    <div class="analysis-options"><label>计算引擎
      <select aria-label="Analysis Engine" :value="engine" :disabled="store.featureSource!=='api'"
        @change="setEngine(($event.target as HTMLSelectElement).value as 'turf'|'postgis')">
        <option value="turf">Frontend - Turf</option><option value="postgis">Backend - PostGIS</option>
      </select></label><small v-if="store.featureSource!=='api'">静态模式仅提供 Turf；切换 VITE_FEATURE_SOURCE=api 启用对照。</small></div>
    <div class="analysis-tool-grid">
      <button v-for="tool in tools" :key="tool.id" type="button" :aria-label="tool.name" :aria-pressed="state.activeTool===tool.id" :class="{active:state.activeTool===tool.id}" @click="activate(tool.id)">{{tool.name}}</button>
    </div>
    <p class="analysis-hint" role="status">{{state.hint}}</p>
    <div v-if="state.activeTool==='buffer'" class="analysis-options">
      <label>半径 (m) <input type="number" min="1" max="5000" :value="state.bufferRadius" @change="manager.setRadius(Number(($event.target as HTMLInputElement).value))" /></label>
      <div class="analysis-presets"><button v-for="radius in [50,100,200,300,500]" :key="radius" type="button" :aria-pressed="state.bufferRadius===radius" @click="manager.setRadius(radius)">{{radius}}</button></div>
      <button type="button" :disabled="!store.selectedFeatureId" @click="manager.bufferSelected()">缓冲已选要素{{store.selectedFeature?' · '+store.selectedFeature.name:''}}</button>
      <small>附近面要素按代表点判定，非严格几何相交。</small>
    </div>
    <div v-if="state.activeTool==='nearest'" class="analysis-options"><label>搜索类别
      <select :value="state.nearestCategory" @change="manager.setCategory(($event.target as HTMLSelectElement).value as NearestCategory)">
        <option value="all">全部</option><option value="building">建筑</option><option value="stadium">体育场</option><option value="landmark">地标</option><option value="poi">POI</option>
      </select></label><small>距离按要素代表点计算。</small></div>
    <div v-if="state.activeTool==='pip'||state.activeTool==='intersection'" class="analysis-options"><label>目标面
      <select :value="state.targetId" aria-label="目标面" @change="manager.setTarget(($event.target as HTMLSelectElement).value)">
        <option v-if="state.activeTool==='intersection'" value="green:auto">自动匹配相交绿地</option>
        <option v-for="target in polygonTargets" :key="target.id" :value="target.id">{{target.name}} · {{target.id}}</option>
      </select></label>
      <template v-if="state.activeTool==='intersection'"><label>源面（可不选，改为地图绘制）
        <select :value="state.sourceId" aria-label="源面" @change="manager.setSource(($event.target as HTMLSelectElement).value)">
          <option value="">地图绘制</option><option v-for="target in polygonTargets" :key="target.id" :value="target.id">{{target.name}} · {{target.id}}</option>
        </select></label><button v-if="state.sourceId" type="button" @click="manager.intersectTargets(state.sourceId,state.targetId)">计算两个面相交</button></template>
    </div>
    <div class="analysis-actions">
      <button type="button" :disabled="!state.activeTool" @click="manager.complete()">完成</button>
      <button type="button" :disabled="!state.points.length" @click="manager.undo()">撤销一点</button>
      <button type="button" @click="manager.clear()">清除</button>
      <button type="button" :disabled="!state.activeTool" @click="manager.cancel()">取消 Esc</button>
    </div>
    <section class="analysis-result" aria-label="分析结果" data-testid="analysis-result">
      <small>RESULT · {{state.status.toUpperCase()}}</small>
      <p v-if="state.error" class="analysis-error" role="alert">{{state.error}}</p>
      <template v-if="state.measurement"><strong>{{engine==='postgis'&&backendState==='ready'?backendText:state.measurement.primary}}</strong><dl><div v-for="(value,key) in state.measurement.details" :key="key"><dt>{{key}}</dt><dd>{{value}}</dd></div></dl>
        <small>耗时 {{state.measurement.elapsedMs.toFixed(2)}} ms</small><button type="button" @click="copy">复制结果</button><small v-if="copyNotice" role="status">{{copyNotice}}</small></template>
      <div v-if="store.featureSource==='api'&&state.measurement" data-testid="postgis-comparison">
        <small>Frontend Turf：{{state.measurement.primary}}</small>
        <p v-if="backendState==='loading'">Backend PostGIS：计算中…</p>
        <p v-else-if="backendState==='ready'">Backend PostGIS：{{backendText}}<span v-if="backendDifference"> · Difference：{{backendDifference}}</span></p>
        <p v-else-if="backendState==='error'" class="analysis-error" role="alert">Backend unavailable：{{backendError}}</p>
      </div>
      <p v-if="!state.measurement&&!state.error">尚无结果</p>
      <div v-if="state.resultFeatures.length" class="analysis-feature-list"><h3>相关要素 · {{state.resultFeatures.length}}</h3>
        <button v-for="feature in state.resultFeatures.slice(0,40)" :key="feature.id" type="button" @click="emit('choose',feature.id)">{{feature.name}} <small>{{feature.id}}</small></button>
        <small v-if="state.resultFeatures.length>40">仅显示前 40 项</small>
      </div>
    </section>
  </aside>
</template>
