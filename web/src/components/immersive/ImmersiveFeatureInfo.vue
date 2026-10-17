<script setup lang="ts">
import type { CampusFeature } from '../../types/CampusFeature';
import {reviewStoreys,DETAIL_PRESENTATION_ENABLED as DETAIL_REVIEW_ENABLED,DORM_COMPOUND_PRESENTATION_ENABLED as DORM_COMPOUND_REVIEW_ENABLED,SHAPE_RELEASE_ENABLED} from '../../gis/three/CampusDetailReview';
import {roofGroupFor} from '../../gis/layers/CampusPlanRoofGroups';
import {ACADEMIC_REFINEMENT_ENABLED} from '../../gis/three/CampusDetailReview';
import {academicRefinementFor,academicRefinementNote} from '../../gis/layers/CampusAcademicRefinement';
import {dormitoryCompoundFor} from '../../gis/features/CampusDormitoryCompounds';
import {residentialPlanFor} from '../../gis/features/CampusResidentialPlan';
defineProps<{feature:CampusFeature}>();
const emit=defineEmits<{close:[];focus:[];exit:[]}>();
</script>
<template>
  <aside class="immersive-info" data-testid="immersive-feature-info" :aria-label="`${feature.name}信息`">
    <div class="immersive-info-top"><span>{{feature.category==='stadium'?'体育场':feature.category==='landmark'?'校园地标':'校园建筑'}}</span><button aria-label="关闭沉浸信息卡" @click="emit('close')">×</button></div>
    <h2>{{feature.name}}</h2><p class="immersive-info-type">{{feature.type}}</p><p>{{feature.properties.fragmentNote?'独立源记录或总图分块参考；形态与归属待核实，未自动合并或删除。':DETAIL_REVIEW_ENABLED&&feature.category==='building'?'楼体外观近似展示；总图轮廓与立面尚需实建校核，原始 GIS 数据继续用于分析。':feature.description}}</p>
    <p v-if="feature.properties.displayNameSource" data-testid="immersive-name-source">总图名称或位置参考，非独立官方名称核实；原始编号 {{feature.properties.sourceLabel}} 保留。</p>
    <p v-if="ACADEMIC_REFINEMENT_ENABLED&&academicRefinementFor(feature.id)" data-testid="immersive-academic-note">连接部修复：保留立柱与顶梁、庭院和架空通行。{{academicRefinementNote(feature.id)}}原始 GIS 分析不变。</p>
    <p v-else-if="SHAPE_RELEASE_ENABLED&&roofGroupFor(feature.id)&&!dormitoryCompoundFor(feature.id)" data-testid="immersive-whole-building-note">整体展示：{{roofGroupFor(feature.id)!.name}}。已校核部件统一选取，庭院和独立屋面间隙保留；原始源记录与面积未合并。</p>
    <p v-if="DORM_COMPOUND_REVIEW_ENABLED&&dormitoryCompoundFor(feature.id)" data-testid="immersive-compound-note">整体显示：{{dormitoryCompoundFor(feature.id)!.name}}。南北楼与低连接部统一选取，庭院留空；连接部暂按两层、6.2m估算，非实测。当前属性与分析仍对应原始源记录，未合并产权或 GIS。</p>
    <p v-if="feature.properties.fragmentNote" data-testid="immersive-fragment-note">{{feature.properties.fragmentNote}}。保留独立 ID，未合并为同一栋楼。</p>
    <p v-if="DETAIL_REVIEW_ENABLED&&residentialPlanFor(feature.id)">总图参考：{{residentialPlanFor(feature.id)!.planLabel}}（官方名称未独立核实，保留原建筑 ID）。</p>
    <p v-if="reviewStoreys(feature.id)" data-testid="immersive-storey-info">用户典型层数：{{reviewStoreys(feature.id)!.storeys}} 层；估算层高 {{reviewStoreys(feature.id)!.storeyHeightMeters.toFixed(1)}}m，楼层主体 {{reviewStoreys(feature.id)!.bodyHeightMeters.toFixed(1)}}m，非实测。</p>
    <div class="immersive-info-actions"><button @click="emit('focus')">⌖ 重新定位</button><button @click="emit('exit')">在地图中查看</button></div>
  </aside>
</template>
