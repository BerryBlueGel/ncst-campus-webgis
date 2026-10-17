<script setup lang="ts">
import { computed } from 'vue';
import { useMapStore } from '../../stores/mapStore';
import {DETAIL_PRESENTATION_ENABLED as DETAIL_REVIEW_ENABLED,DETAIL_RELEASE_ENABLED,SHAPE_REVIEW_ENABLED,DORM_SHAPE_REVIEW_ENABLED,DORM_COMPOUND_PRESENTATION_ENABLED as DORM_COMPOUND_REVIEW_ENABLED,SHAPE_RELEASE_ENABLED} from '../../gis/three/CampusDetailReview';
import {ACADEMIC_REFINEMENT_ENABLED,NEXT_ACADEMIC_REFINEMENT_ENABLED} from '../../gis/three/CampusDetailReview';
const props=defineProps<{selectedId:string|null}>();
const emit=defineEmits<{exit:[];overview:[];choose:[id:string];focus:[]}>();
const store=useMapStore();
const landmarks=[['library','图书馆'],['south-gate','南门'],['auditorium','会堂'],['fusion-sculpture','融合雕塑'],['stadium-east-01','东区体育场'],['stadium-west-02','西区体育场']] as const;
const selectedName=computed(()=>props.selectedId?store.featureRepository.getById(props.selectedId)?.name:'未选择地点');
</script>
<template>
  <header class="immersive-toolbar" aria-label="沉浸校园导航">
    <div class="immersive-brand"><img class="immersive-brand-mark brand-image" src="/branding/berrybluegel-v1-128.png" alt="" width="36" height="36" /><div><strong>校园漫游</strong><small>华北理工大学 · 曹妃甸校区</small></div></div>
    <nav class="immersive-nav" aria-label="地标快捷定位">
      <button class="immersive-overview-button" @click="emit('overview')">校园总览</button>
      <button v-for="[id,label] in landmarks" :key="id" :class="{active:selectedId===id}" :aria-label="`定位${label}`" @click="emit('choose',id)">{{label}}</button>
    </nav>
    <div class="immersive-toolbar-end"><button v-if="selectedId" class="immersive-current" :title="`重新定位${selectedName}`" @click="emit('focus')">⌖ {{selectedName}}</button><button class="immersive-exit" @click="emit('exit')">← 返回 WebGIS</button></div>
    <p v-if="DETAIL_REVIEW_ENABLED" class="teaching-immersive-toggle">{{NEXT_ACADEMIC_REFINEMENT_ENABLED?'学院区楼体修复 v006 · 连接与立面估算':ACADEMIC_REFINEMENT_ENABLED?'学院区连接部修复 v005 · 架空入口 / 尺寸估算':SHAPE_RELEASE_ENABLED?'全校楼体校核 v004 · 高度估算':DORM_COMPOUND_REVIEW_ENABLED?'宿舍整体校核 v003 · 主体五层 / 低连接部两层估算':DORM_SHAPE_REVIEW_ENABLED?'宿舍区形状校核 v002 · 高度沿用旧估算':SHAPE_REVIEW_ENABLED?'楼体形状校核 v001 · 高度沿用旧估算':(DETAIL_RELEASE_ENABLED?'楼层细化 v004':'仅本机候选 v004')+' · 教学四层 / 宿舍五层 · 高度估算'}}，分析保留原始 GIS</p>
    <label v-else class="teaching-immersive-toggle"><input aria-label="沉浸教学区总图工作版" type="checkbox" v-model="store.teachingPreview" :disabled="store.teachingPartInspection" />{{store.teachingPartInspection?'源分块校核 · 临时粗模':'全校建筑总图工作版（近似，非实测；疑点保留）'}}</label>
  </header>
</template>
