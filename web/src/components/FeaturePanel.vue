<script setup lang="ts">
import { computed,ref,watch } from 'vue';
import { useMapStore } from '../stores/mapStore';
import { displayProperties } from '../gis/interaction/FeatureDisplayConfig';
import { teachingRelatedIds, TEACHING_BUILDINGS } from '../gis/features/TeachingBuildingPresentation';
import { teachingBuildingAudit } from '../gis/features/TeachingBuildingAudit';
import { residentialPlanFor } from '../gis/features/CampusResidentialPlan';
import { academicPlanFor } from '../gis/features/CampusAcademicPlan';
import { planDispositionFor,suppressedInPlanPreview } from '../gis/features/CampusPlanDispositions';
import { nearbyIdentityIds } from '../gis/features/CampusBuildingIdentity';
import {roofGroupFor} from '../gis/layers/CampusPlanRoofGroups';
import {academicRefinementFor,academicRefinementNote,academicFacadeRefinementFor} from '../gis/layers/CampusAcademicRefinement';
import {ACADEMIC_REFINEMENT_ENABLED} from '../gis/three/CampusDetailReview';
import {DETAIL_PRESENTATION_ENABLED as DETAIL_REVIEW_ENABLED,reviewStoreys,DORM_COMPOUND_PRESENTATION_ENABLED as DORM_COMPOUND_REVIEW_ENABLED,SHAPE_RELEASE_ENABLED} from '../gis/three/CampusDetailReview';
import {dormitoryCompoundFor} from '../gis/features/CampusDormitoryCompounds';
const store=useMapStore();
const emit=defineEmits<{flyTo:[id:string];zoomTo:[id:string];view3D:[id:string];immerse:[id:string];analyze:[id:string];clear:[]}>();
const feature=computed(()=>store.selectedFeature);
const panel=ref<HTMLElement>();
watch(()=>feature.value?.id,()=>{if(panel.value)panel.value.scrollTop=0;},{flush:'post'});
const rows=computed(()=>feature.value?displayProperties(feature.value,DETAIL_REVIEW_ENABLED):[]);
const related=computed(()=>feature.value?store.featureRepository.getByIds([...teachingRelatedIds(feature.value.id)]):[]);
const teaching=computed(()=>TEACHING_BUILDINGS.some(r=>r.id===feature.value?.id));
const audit=computed(()=>feature.value?teachingBuildingAudit(feature.value.id):null);
const residential=computed(()=>feature.value?residentialPlanFor(feature.value.id):undefined);
const academic=computed(()=>feature.value?academicPlanFor(feature.value.id):undefined);
const disposition=computed(()=>feature.value?planDispositionFor(feature.value.id):undefined);
const roofGroup=computed(()=>feature.value?roofGroupFor(feature.value.id):undefined);
const compound=computed(()=>DORM_COMPOUND_REVIEW_ENABLED&&feature.value?dormitoryCompoundFor(feature.value.id):undefined);
const refinement=computed(()=>ACADEMIC_REFINEMENT_ENABLED&&feature.value?academicRefinementFor(feature.value.id):undefined);
const facadeRefinement=computed(()=>ACADEMIC_REFINEMENT_ENABLED&&feature.value?academicFacadeRefinementFor(feature.value.id):undefined);
const groupedPlan=computed(()=>!!(compound.value||roofGroup.value)&&!store.threeRequested&&store.planDisplayPreview);
const storeys=computed(()=>reviewStoreys(feature.value?.id));
const identityNeighbors=computed(()=>feature.value?store.featureRepository.getByIds(nearbyIdentityIds(feature.value,store.featureRepository.getAll())):[]);
</script>
<template>
  <aside ref="panel" class="panel features" aria-label="要素信息面板">
    <div class="panel-heading">
      <div>
        <h2>空间信息</h2>
      </div>
      <button aria-label="折叠信息面板" @click="store.rightOpen = false">
        ›
      </button>
    </div>
    <div v-if="feature" class="feature-detail" data-testid="feature-detail">
      <small class="eyebrow">{{feature.category==='landmark'?'地标':feature.category==='stadium'?'体育场':'建筑'}}</small>
      <h3>{{feature.name}}</h3>
      <p class="feature-summary">{{feature.category==='building'?'展示模型非实测，面积与分析使用原始 GIS。':feature.description}}</p>
      <p v-if="storeys" class="feature-storeys">{{storeys.storeys}} 层 · 用户提供的典型值，非逐栋实测</p>
      <div class="feature-actions">
        <button @click="emit('flyTo',feature.id)">飞到此处</button>
        <button @click="emit('zoomTo',feature.id)">缩放至范围</button>
        <button @click="emit('analyze',feature.id)">空间分析</button>
        <button v-if="feature.modelBinding||feature.category==='building'" @click="emit('view3D',feature.id)">在 3D 中查看</button>
        <button v-if="feature.modelBinding||feature.category==='building'" @click="emit('immerse',feature.id)">沉浸查看</button>
        <button @click="emit('clear')">清除选择</button>
      </div>
      <dl><div><dt>经纬度</dt><dd>{{feature.centroid[0].toFixed(6)}}° E<br>{{feature.centroid[1].toFixed(6)}}° N</dd></div>
        <div v-for="row in rows" :key="row.label"><dt>{{row.label}}</dt><dd>{{row.value}}</dd></div></dl>
      <details :key="feature.id" class="feature-provenance"><summary>模型说明与数据来源</summary>
      <p>{{feature.type}} · {{roofGroup&&!store.threeRequested&&store.planDisplayPreview?'按总图作为同一图示楼体展示；原始 GIS 分块记录仍独立保留。':feature.properties.fragmentNote?'独立源记录或总图分块参考；形态与归属待核实，未自动合并或删除。':DETAIL_REVIEW_ENABLED&&feature.category==='building'?'楼体外观近似展示；总图轮廓与立面尚需实建校核，原始 GIS 数据继续用于分析。':feature.description}}</p>
      <p v-if="feature.id==='auditorium'">二维外形按精修模型展示；面积与空间分析仍使用原始 GIS 数据。</p>
      <p v-if="refinement" data-testid="academic-portal-note">连接部修复：{{refinement.name}}。二维为屋顶投影，三维保留架空通行。{{academicRefinementNote(feature.id)}}高度与构件尺寸为估算，面积与分析仍对应原始 GIS。</p>
      <p v-if="facadeRefinement&&facadeRefinement.sourceStoreys==null" data-testid="training-facade-note">训练用房立面参考实景类型。层数未确认，暂沿用旧模型占位高度；高窗分格不代表楼层，仍需逐栋核实。</p>
      <p v-if="SHAPE_RELEASE_ENABLED&&roofGroup&&!compound&&!refinement&&(store.threeRequested||store.planDisplayPreview)" data-testid="whole-building-note">整体展示：{{roofGroup.name}}，二维与三维统一选取已校核的楼体部件，院落和断开的屋面仍保留。当前源记录的名称、面积与分析独立保留，不是整组统计或产权合并。</p>
      <p v-if="compound" data-testid="dorm-compound-note">整体显示：{{compound.name}}，南北楼{{compound.bodyIds.length===3?'及中楼':''}}与低层连接部作为一组统一选取，庭院留空。主体采用五层典型值；连接部暂按两层、6.2m估算，非逐栋实测。当前名称、下方面积与分析仍对应原始源记录，不是整组统计或产权合并。</p>
      <section v-if="feature.properties.displayNameSource" data-testid="building-identity-note">
        <p>名称来源：用户校园总图或总图位置参考，非独立核实的现行官方名称。原始编号 {{feature.properties.sourceLabel}} 保留。</p>
        <p v-if="groupedPlan&&roofGroup&&!compound&&!refinement" data-testid="roof-group-note">二维总图显示为 {{roofGroup.name}}，点击同一图示的各部分统一选取。旧编号深链接仍可查看；下方面积与分析针对当前源记录，并非整栋楼面积。关闭“二维总图轮廓”可恢复独立原始分块；实际产权分界未核实，三维模型未合并。</p>
        <p v-else-if="feature.properties.fragmentNote">分块说明：{{feature.properties.fragmentNote}}。原始几何和 ID 保留；小块不等于废弃建筑，也不代表已确认属于旁边楼体。</p>
        <p v-if="!roofGroup&&!suppressedInPlanPreview(feature.id)&&!store.threeRequested&&feature.properties.identityKind==='UNCERTAIN_FRAGMENT' && store.planDisplayPreview">二维总图工作版仅用琥珀色虚线定位，不再填色为独立建筑；取消选取后默认隐藏，可在“二维分块校核”中恢复查看全部待核实源块。</p>
        <div v-if="identityNeighbors.length&&!groupedPlan" class="feature-actions" aria-label="附近楼体位置参考">
          <p>附近楼体（仅供位置核对，不代表归属）：</p>
          <button v-for="neighbor in identityNeighbors" :key="neighbor.id" @click="store.selection.select(neighbor.id)">查看附近 {{neighbor.name}}</button>
        </div>
      </section>
      <section v-if="storeys" data-testid="storey-review-info">
        <p v-if="residential">总图参考：{{residential.planLabel}}（不是独立核实的官方名称，保留原建筑 ID）。</p>
        <p>候选模型：{{storeys.storeys}} 层（用户提供的典型层数，个别楼体尚需确认）；估算层高 {{storeys.storeyHeightMeters.toFixed(1)}}m，楼层主体 {{storeys.bodyHeightMeters.toFixed(1)}}m，含基座顶部与屋顶收边约 {{storeys.heightAboveRootMeters.toFixed(2)}}m。不是实测高度，原始 GIS 属性与分析不改。</p>
      </section>
      <section v-if="teaching&&!DETAIL_REVIEW_ENABLED" data-testid="teaching-preview-controls">
        <label><input aria-label="本楼总图工作版" type="checkbox" v-model="store.teachingPreview" />总图工作版 / 原始粗模对照</label>
        <p>{{store.teachingPreview?'当前显示 v004 总图近似轮廓，统一配准并校正墙边平行、垂直关系，非实测。':'当前显示原始 GIS 粗模。'}}面积和空间分析仍使用原始 GIS；蓝灰贴地带仅为总图平面参考，不代表实际连廊，不合并建筑 ID。</p>
      </section>
      <section v-if="residential&&!DETAIL_REVIEW_ENABLED&&!groupedPlan" data-testid="residential-preview-controls">
        <label><input aria-label="本楼生活区工作版" type="checkbox" v-model="store.teachingPreview" />生活区工作版 / 原始粗模对照</label>
        <p>总图标注：{{residential.planLabel}}（尚非独立官方名称核实）。{{store.teachingPreview?'当前显示 v004 总图近似轮廓。':'当前显示原始 GIS 粗模。'}}只替换本 ID 对应楼体，附近分块仍独立，不代表整栋归属已经核实。不封填院落、不猜层数；高度沿用源粗模，面积和分析仍使用原始 GIS。</p>
        <p v-if="residential.wallPolicy==='TRACED_NON_RECTILINEAR'">本楼斜边来自总图描线，未强制改成直角或正南正北；疑似连接带不建成未经核实的实体连廊。</p>
      </section>
      <section v-if="academic&&!DETAIL_REVIEW_ENABLED&&!groupedPlan" data-testid="academic-preview-controls">
        <label><input aria-label="本楼学院区工作版" type="checkbox" v-model="store.teachingPreview" />学院区工作版 / 原始粗模对照</label>
        <p>总图标注：{{academic.planLabel}}（尚非独立官方名称核实）。{{store.teachingPreview?`当前显示${'batchRegion' in academic?academic.batchRegion:'东北区 v001'}总图近似轮廓。`:'当前显示原始 GIS 粗模。'}}按本 ID 独立描线，分块不自动合并；院落镂空和有依据的斜边保留。高度沿用源粗模，面积与分析仍用原始 GIS，不代表已按实建图校核。</p>
        <p v-if="academic.geometry.type==='MultiPolygon'">原始源 ID 跨越多个楼体：工作版保留断开的白色屋面，不把院落、铺装或疑似连接带封成实体；多部件仍使用原稳定 ID，不表示已核实建筑归属。</p>
        <p>连接关系、楼层与净空未核实；同一总图名称可能涉及多个源 ID，未审阅部分继续独立显示。</p>
      </section>
      <section v-if="disposition&&!DETAIL_REVIEW_ENABLED&&!groupedPlan" data-testid="plan-disposition">
        <p>全校轮廓审阅：{{disposition.note}}。</p>
        <p v-if="disposition.suppressed">按用户总图，该源粗模不再单独显示为楼体；关闭工作版可恢复对照。未删除原始 ID、几何或分析数据，尚需实建资料核实。</p>
        <p v-else>仍保留独立源记录，不猜测邻楼归属。总图审阅不等于实测完成。</p>
      </section>
      </details>
      <section v-if="related.length&&!DETAIL_REVIEW_ENABLED" data-testid="teaching-parts" aria-label="附近分块校核">
        <p>附近分块校核：保留独立 ID，不代表已确认同一栋楼。</p>
        <p v-if="store.threeRequested && store.teachingPartInspection" data-testid="teaching-inspection-note">正在查看独立源分块，三维临时显示原始粗模。二维展示选择不变；返回主楼后恢复三维展示选择。</p>
        <div class="feature-actions">
          <button v-for="part in related" :key="part.id" @click="store.selection.select(part.id)">查看 {{part.name}}</button>
        </div>
      </section>
      <details v-if="audit&&!DETAIL_REVIEW_ENABLED" class="building-evidence" data-testid="building-evidence">
        <summary>楼体资料与待核实项</summary>
        <p>公开设计资料支持八座单体与院落式布局，不代表本楼已按实建图校核。楼名仍依据用户总图。</p>
        <p v-if="audit.selectedIsNearbyPart">本对象为 {{audit.name}} 附近的独立分块，归属未确认。</p>
        <p>v004 保留组团整体朝向，校正手工描线斜边；没有逐栋缩放或强制正南正北，仍需实建校核。</p>
        <p>直墙规整最大移动 {{audit.regularization.maxDisplacementMeters.toFixed(2)}} m，组团墙边相对局部东向约 {{audit.regularization.wallAngleDegrees.toFixed(2)}}°；这是展示修正，不是实测数据。</p>
        <p>旧 v001 的逐栋拟合最大调整 {{audit.historicalV001.maxFitAdjustmentMeters.toFixed(1)}} m；这是旧版变形量，不是实测定位精度。</p>
        <p v-if="audit.connectionTo">与 {{audit.connectionTo}} 的蓝灰贴地带只示意总图平面关系，不是连廊实体，不代表真实高度或净空。</p>
        <ul><li v-for="item in audit.unresolved" :key="item">待核实：{{item}}</li></ul>
        <div v-for="source in audit.sources" :key="source.url">
          <a :href="source.url" target="_blank" rel="noopener noreferrer">{{source.title}} ↗</a>
          <p>{{source.supports}}</p>
        </div>
      </details>

    </div>
    <div v-else class="empty-feature">
      <div class="empty-symbol">⌖</div>
      <h3>探索，从一个地点开始</h3>
      <p>点击地图中的建筑或设施查看信息</p>
    </div>
    <div v-if="!feature" class="location-card">
      <span class="eyebrow">当前区域</span>
      <h3>华北理工大学</h3>
      <p>河北 · 唐山 · 曹妃甸校区</p>
      <div class="location-line"></div>
      <small>地理基准</small><strong>WGS84 / UTM Zone 50N</strong
      ><code>EPSG:32650</code>
    </div>
  </aside>
</template>
