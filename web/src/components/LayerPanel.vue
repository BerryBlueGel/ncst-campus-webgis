<script setup lang="ts">
import { useMapStore } from "../stores/mapStore";
import {DETAIL_PRESENTATION_ENABLED as DETAIL_REVIEW_ENABLED,DETAIL_RELEASE_ENABLED,SHAPE_REVIEW_ENABLED,DORM_SHAPE_REVIEW_ENABLED,DORM_COMPOUND_PRESENTATION_ENABLED as DORM_COMPOUND_REVIEW_ENABLED,SHAPE_RELEASE_ENABLED,ACADEMIC_REFINEMENT_ENABLED,NEXT_ACADEMIC_REFINEMENT_ENABLED} from '../gis/three/CampusDetailReview';
import {MODEL_DISPLAY_LABEL} from '../gis/three/CampusThreeConfig';
import {PLAN_ROOF_GROUPS} from '../gis/layers/CampusPlanRoofGroups';
import {UNRESOLVED_DISPLAY_FRAGMENT_IDS} from '../gis/layers/SourceFragmentDisplay';
const store = useMapStore();
const groups = ["基础数据", "自然环境", "建筑设施", "地标"];
</script>
<template>
  <aside class="panel layers">
    <div class="panel-heading">
      <div>
        <h2>校园图层</h2>
      </div>
      <button aria-label="折叠图层面板" @click="store.leftOpen = false">
        ‹
      </button>
    </div>
    <p class="gis-summary">
      {{ store.layers.filter((l) => l.loaded).length }} / 8 图层已加载 · WGS84
    </p>
    <section class="layer-group">
      <label class="layer-row"><span>显示三维校园</span><input aria-label="3D Campus图层" type="checkbox" v-model="store.threeRequested" /></label>
      <p v-if="store.threeRequested" class="model-status" role="status">{{store.campus3D.status==='ready'?'三维模型已就绪':({idle:'尚未加载',loading:'校园模型加载中…',error:'模型暂不可用'})[store.campus3D.status]}}{{store.campus3D.zoomSuppressed?' · 请放大地图':''}}</p>
      <p v-if="store.campus3D.error" role="alert">{{store.campus3D.error}}，二维地图仍可使用。</p>
      <details v-if="store.campus3D.status==='ready'" class="model-diagnostics"><summary>三维验证信息</summary><small>{{MODEL_DISPLAY_LABEL}} · 加载 {{Math.round(store.campus3D.loadMs)}} ms · 首帧 {{Math.round(store.campus3D.firstRenderMs??0)}} ms</small><label><input type="checkbox" aria-label="Ground polygon offset" v-model="store.groundOffset" />Ground polygon offset</label><pre class="three-diagnostics">{{JSON.stringify(store.campus3D,null,2)}}</pre></details>
    </section>
    <section v-for="group in groups" :key="group" class="layer-group">
      <h3>{{ group }}</h3>
      <div
        v-for="layer in store.layers.filter((l) => l.group === group)"
        :key="layer.id"
        class="gis-layer"
        :data-layer="layer.id"
      >
        <label class="layer-row"
          ><span>{{ layer.name }}</span
          ><small>{{ layer.loaded ? layer.count : "…" }}</small
          ><input
            type="checkbox"
            :aria-label="layer.name + '图层'"
            :checked="layer.visible"
            @change="
              store.toggleLayer(
                layer.id,
                ($event.target as HTMLInputElement).checked,
              )
            " /></label
        ><details class="layer-opacity"><summary :aria-label="layer.name+'样式'" :title="'透明度 '+Math.round(layer.opacity * 100)+'%'">样式</summary><label class="opacity-row"
          ><span>透明度 {{ Math.round(layer.opacity * 100) }}%</span
          ><input
            type="range"
            min="0"
            max="100"
            step="10"
            :aria-label="layer.name + '透明度'"
            :value="layer.opacity * 100"
            @input="
              store.setOpacity(
                layer.id,
                Number(($event.target as HTMLInputElement).value) / 100,
              )
            " /></label
        ></details><small v-if="layer.error" role="alert">{{ layer.error }}</small>
      </div>
    </section>
    <details class="layer-advanced"><summary>模型与校核设置</summary>
    <section v-if="DETAIL_REVIEW_ENABLED" class="layer-group" data-testid="detail-review-note">
      <small>展示级模型 · 形状参考总图与实景，高度估算，原始 GIS 分析不变。</small>
      <details><summary>模型与数据质量说明</summary>
      <p v-if="NEXT_ACADEMIC_REFINEMENT_ENABLED" data-testid="academic-refinement-note">学院区 v006：A4补回总图中的三处连接，架空形式和高度为推定；D1/D9调整竖向窗组、基座和屋顶收边，庭院与原轮廓保持。保留D3/B4修复。二维为屋顶投影，不等于封闭地面范围。尚非全校实建校核完成。</p>
      <p v-else-if="ACADEMIC_REFINEMENT_ENABLED" data-testid="academic-refinement-note">学院区 v005：D3补回架空入口与西侧连接部，D2/D3及B4楼体调整窗组、基座和屋顶边缘。B4/B6连接位置参考总图，架空形式尚属推定；高度未实测。二维显示屋顶投影，入口地面保持开放；原始 GIS 分析不变。并非全校实建校核完成。</p>
      <p v-if="DORM_COMPOUND_REVIEW_ENABLED&&!ACADEMIC_REFINEMENT_ENABLED" data-testid="compound-review-note">{{SHAPE_RELEASE_ENABLED?'全校楼体校核 v004：58处非宿舍总图楼体与三维屋面一致，9处组合楼体二维/三维统一选取。':'宿舍整体校核 v003：'}}25 组宿舍南北楼（含两组中楼），52 个高层主体与 33 处低层连接体量；兰园7号保留独立长条楼。参考用户总图与720实景类型，庭院留空。低连接部暂按两层、6.2m估算，逐栋高度和背面未全部核实；原始 GIS 与旧模型保留。{{SHAPE_RELEASE_ENABLED?'这是近似展示校核，不是全校实测完成。':'本机候选，云端未覆盖。'}}</p>
      <p v-if="DORM_SHAPE_REVIEW_ENABLED">宿舍区形状校核：兰园14、竹园10、菊园12、梅园17个楼体逐栋对照，共53个。本版新增修正梅园1号北楼东侧短翼和梅园4号南楼西侧回折，保留上一版修正及独立屋面间隙。依据配准校园图，720东、西生活区实景辅助核对；高度沿用旧估算，窄连接部与逐栋背面仍需进一步确认。旧模型、GIS与云端未覆盖。</p>
      <p v-else-if="SHAPE_REVIEW_ENABLED&&!DORM_COMPOUND_REVIEW_ENABLED">形状优先校核：12 处轮廓差异已同步到三维，保留庭院和真正断开的屋面。位置依据用户配准平面图，720 实景辅助核对；高度沿用旧估算，尚非全校实测模型。旧模型与云端未覆盖。</p>
      <h3>{{DETAIL_RELEASE_ENABLED||SHAPE_RELEASE_ENABLED?'楼层与模型说明':'仅本机 · 发布候选审阅'}}</h3><p>39 个教学楼体四层、53 个宿舍楼体五层。层数为用户提供的典型值，米制高度与立面仍为估算；二维展示采用近似总图轮廓，分析与面积仍用原始 GIS。{{DETAIL_RELEASE_ENABLED||SHAPE_RELEASE_ENABLED?'当前使用独立展示模型，旧 v005 保留用于回滚。':'该候选不含原粗模对照，正式 v005 与云端保持不变。'}}</p>
      </details>
    </section>
    <section class="layer-group" data-testid="source-fragment-review">
      <h3>二维分块校核</h3>
      <label class="layer-row"><span>显示待核实源分块</span><input aria-label="显示待核实源分块" type="checkbox" v-model="store.sourceFragmentReview" /></label>
      <details><summary>分块显示与分析说明</summary>
      <small v-if="DORM_COMPOUND_REVIEW_ENABLED&&store.planDisplayPreview">将25组宿舍按整组展示与选取；其他楼体沿用总图校核。仍有 {{UNRESOLVED_DISPLAY_FRAGMENT_IDS.length}} 处待核实屋面，不因靠近宿舍就自动并入。原始166条源记录、面积与分析不变。</small>
      <small v-else-if="store.planDisplayPreview">全校 {{PLAN_ROOF_GROUPS.length}} 处图示楼体按总图统一展示与选取；仍有 {{UNRESOLVED_DISPLAY_FRAGMENT_IDS.length}} 处屋面范围不明确，仅在校核或搜索选中时显示琥珀色虚线。独立小屋面的间隙保留。实际产权分界仍未核实，源记录、面积与分析不变。</small>
      <small v-else>当前为原始 GIS 对照，全部源分块按原始面显示；切回“总图工作版”后可用此开关查看待核实虚线。数据不会删除或自动并入邻楼。</small>
      </details>
    </section>
    <section v-if="!DETAIL_REVIEW_ENABLED||!store.threeRequested" class="layer-group">
      <h3>建筑总图展示校核</h3>
      <label class="layer-row"><span>二维总图轮廓（近似）</span><input aria-label="二维总图轮廓" type="checkbox" v-model="store.planDisplayPreview" :disabled="store.threeRequested && store.teachingPartInspection" /></label>
      <small v-if="store.threeRequested && store.teachingPartInspection">正在校核源分块，三维临时显示粗模；二维总图工作版选择不变，返回主楼或清除选择后恢复三维展示。</small>
      <small v-else-if="DORM_COMPOUND_REVIEW_ENABLED">25组宿舍采用主体与低连接部整体轮廓，保留院落和独立楼外屋面；关闭可恢复原始GIS对照。层高为估算，166个源记录、面积与分析数据不变。</small>
      <small v-else>按用户总图展示建筑轮廓与名称，{{PLAN_ROOF_GROUPS.length}} 处同名屋面作为图示楼体统一选取；关闭可恢复独立 GIS 分块。保留院落、真正断开的屋面与斜向翼楼，不猜楼高。166 个原始记录、面积与分析数据不变，尚非全校实测模型。</small>
    </section>
    </details>
    <details class="load-metrics">
      <summary>加载统计</summary>
      <div v-for="l in store.layers" :key="l.id">
        {{ l.name }} · {{ (l.bytes / 1024).toFixed(1) }} KB · 加载
        {{ l.loadMs.toFixed(1) }} ms · 绘制约
        {{ l.renderMs === null ? "待空闲" : l.renderMs.toFixed(1) + " ms" }}
      </div>
    </details>
    <div class="mock-note">
      三维开启后默认隐藏重复二维面，可手动开启叠加。<br />体育场范围来自配准示意图，并非实测边界
    </div>
  </aside>
</template>
