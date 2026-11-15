# Campus WebGIS
# Phase 1 - Project Bootstrap & MapLibre

## Goal

建立华北理工大学数字校园 WebGIS 的正式前端工程基础。

本阶段只完成：

Vue3 + TypeScript + Vite + MapLibre

以及后续开发需要的基础架构。

不要加载正式校园 GLB。
不要实现 Three.js Custom Layer。
不要实现后端。
不要实现 PostGIS。
不要实现 Cesium。

==================================================
0. Read Architecture
==================================================

首先读取：

WEBGIS_ARCHITECTURE.md

本阶段实现必须遵守该架构。

==================================================
1. 创建工程
==================================================

如果 campus 项目根目录当前没有 web：

创建：

web/

使用：

Vue 3
TypeScript
Vite

启用：

TypeScript strict

安装基础依赖：

vue-router
pinia
maplibre-gl
@turf/turf
echarts
axios
element-plus

可以安装：

proj4

用于后续 CRS 转换。

本阶段暂时不要安装大型无关依赖。

==================================================
2. Route
==================================================

建立：

/
自动跳转 /map

/map
/dashboard
/analysis
/about

页面暂时允许简单。

重点是 /map。

==================================================
3. Layout
==================================================

建立：

AppLayout

/map 页面包含：

TopBar
LayerPanel
MapCanvas
FeaturePanel
StatusBar

要求：

桌面端优先。

布局大致：

Top
-----------------------------------------
Left |          Map            | Right
-----------------------------------------
Bottom

侧栏支持折叠。

地图必须自适应窗口。

==================================================
4. MapLibre Engine
==================================================

不要直接在 MapView.vue 中写全部地图逻辑。

创建：

src/gis/map/

例如：

MapEngine.ts
MapConfig.ts
BaseMapProvider.ts

MapEngine 负责：

create
destroy
resize
flyTo
jumpTo
getCameraState

Vue 只负责：

mount
unmount
UI interaction

==================================================
5. BaseMap Provider
==================================================

建立抽象：

BaseMapProvider

第一版至少提供：

DefaultOpenMapProvider

Base Map URL / style 必须可配置。

使用：

.env

例如：

VITE_MAP_STYLE_URL=

禁止把 API key 写死在代码。

如果没有商业地图 API：

使用可正常开发测试的公开/本地 MapLibre style。

但实现必须允许未来无痛替换为：

OpenMapTiles
PMTiles
Satellite
Custom Campus
other provider

==================================================
6. Initial Camera
==================================================

地图初始位置：

华北理工大学曹妃甸校区附近。

不要使用硬编码在多个文件。

统一放入：

MapConfig.ts

例如：

CAMPUS_CENTER

CAMPUS_DEFAULT_ZOOM
CAMPUS_DEFAULT_PITCH
CAMPUS_DEFAULT_BEARING

==================================================
7. URL Camera State
==================================================

支持：

/map?lng=&lat=&zoom=&pitch=&bearing=

打开页面：

如果 URL 存在 camera parameters，
恢复视角。

移动地图后：

使用 debounce 更新 URL。

不要每 frame 更新 history。

==================================================
8. Store
==================================================

Pinia 建立：

mapStore

至少包含：

mapReady

camera:
- lng
- lat
- zoom
- pitch
- bearing

selectedFeatureId

hoveredFeatureId

activeBaseMap

sidebar states

后期 Three.js 与 GIS Layers 共用。

==================================================
9. Layer Architecture
==================================================

本阶段不加载正式 GIS 数据。

但必须建立：

src/gis/layers/

LayerManager.ts

定义未来接口：

registerLayer()
removeLayer()
setVisibility()
setOpacity()
getLayer()
getLayers()

建立 layer metadata 类型：

id
name
type
visible
opacity
group

LayerPanel 用 mock layer metadata 展示：

Buildings
Roads
Water
Green
Sports
Landmarks
POI

点击 checkbox：

更新状态即可。

本阶段允许没有真实地图 layer。

==================================================
10. Repository Architecture
==================================================

创建：

src/gis/repositories/

FeatureRepository.ts

定义接口。

例如：

getAll()
getById()
search()

建立：

StaticFeatureRepository.ts

本阶段可以返回空数据或者极小 mock data。

不要在 Vue Component 中直接 fetch GIS 数据。

==================================================
11. Coordinate Architecture
==================================================

创建：

src/gis/coordinate/

CampusCoordinateService.ts

先建立接口和常量。

记录：

EPSG:32650

Origin:

635986.7561034276
4339716.120350528

定义方法：

utmToLocal()
localToUtm()
utmToWgs84()
wgs84ToUtm()
localToWgs84()
wgs84ToLocal()

使用 proj4。

写单元/自测代码验证：

local (0,0)

应对应：

UTM
635986.7561034276
4339716.120350528

不要实现 Blender transform 的复杂逻辑，
只预留接口。

==================================================
12. Status Bar
==================================================

显示：

Longitude
Latitude
Zoom
Pitch
Bearing

鼠标在地图移动：

显示 cursor lon/lat。

为未来增加：

UTM X / Y

预留位置。

==================================================
13. Top Bar
==================================================

建立：

项目名称：
华北理工大学数字校园 WebGIS

包含：

Home

Search placeholder

2D/3D placeholder

Immersive placeholder

Fullscreen

后两个本阶段：

disabled

或者标记：

Coming Soon

==================================================
14. Feature Panel
==================================================

本阶段建立 UI Shell。

没有选中 Feature：

显示：

“点击地图中的建筑或设施查看信息”

有 mock selected feature：

显示：

Name
Type
Coordinates
Description

==================================================
15. Dashboard
==================================================

只建立基础页面。

显示几个 placeholder cards：

Campus Area
Buildings
Roads
Green Area
Water
Sports

不要现在制作复杂 ECharts。

==================================================
16. Analysis
==================================================

建立页面 Shell。

列出未来分析：

Distance
Area
Buffer
Nearest
Intersection

全部标记：

Coming Soon

==================================================
17. About
==================================================

展示：

项目名称
Current Model:
campus_refined_v005.glb

Model SHA-256:

7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65

GIS CRS:

EPSG:32650
WGS84 / UTM Zone 50N

Technology:

Vue3
TypeScript
MapLibre
Three.js
Turf
Spring Boot
PostGIS

其中尚未实现的技术标记：

Planned

不要误写成已经完成。

==================================================
18. Code Quality
==================================================

要求：

npm run dev
能够启动。

npm run build
必须成功。

不得出现：

TypeScript error
ESLint critical error
browser console error

如未配置 ESLint，
本阶段可以配置基础 ESLint + Vue + TS。

==================================================
19. README
==================================================

生成：

web/README.md

记录：

- setup
- install
- dev
- build
- environment variables
- current phase
- current limitations

==================================================
20. Validation
==================================================

真实浏览器测试。

至少测试：

/map
/dashboard
/analysis
/about

/map：

- 地图加载
- 拖动
- Zoom
- Pitch
- Bearing
- resize
- URL camera sync
- LayerPanel checkbox
- sidebar collapse
- Fullscreen
- StatusBar coordinates

浏览器：

0 console errors

==================================================
21. Screenshots
==================================================

输出：

web/docs/phase1/

map_default.png
map_pitched.png
dashboard.png
analysis.png
about.png

==================================================
22. Report
==================================================

生成：

web/docs/phase1/PHASE1_REPORT.md

记录：

- Node version
- npm version
- dependency versions
- build result
- browser validation
- implemented architecture
- files created
- known limitations
- next phase recommendation

==================================================
23. Strict Scope
==================================================

本阶段禁止：

Three.js GLB integration

campus_refined_v005.glb 加载

Three.js CustomLayer

建筑拾取

GeoJSON 正式图层

Turf 正式空间分析

Spring Boot

PostGIS

GeoServer

Martin

Cesium

SuperMap

Docker

服务器部署

不要因为这些是长期架构的一部分就提前实现。

==================================================
24. Finish Condition
==================================================

只有当：

- npm install 成功
- npm run build 成功
- 四个 route 正常
- MapLibre 正常
- camera URL sync 正常
- 浏览器无错误
- Phase1 report 完成

才算 Phase 1 PASS。

完成后停止。

等待进入：

Phase 2 - Campus GIS Layers