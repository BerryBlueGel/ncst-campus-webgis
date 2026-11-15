# 华北理工大学数字校园 WebGIS
# WebGIS Architecture v1.0

## 1. 项目目标

建设一个以华北理工大学曹妃甸校区为对象的三维数字校园 WebGIS。

项目不是单纯的：

- Three.js 模型查看器
- GIS 作业 Demo
- 数据大屏
- 静态校园地图

而是逐步发展为：

> Vue + MapLibre + Three.js + Turf + Spring Boot + PostGIS
> 的完整 WebGIS 全栈项目。

核心目标：

1. 展示真实 GIS 空间数据。
2. 展示已经精修并地理配准的三维校园。
3. 支持建筑、道路、水体、绿地、体育设施、POI 等图层。
4. 支持查询、搜索、选中、高亮、飞行定位。
5. 支持基础空间分析。
6. 后期接入 PostGIS、Spring Boot。
7. 后期增加 Cesium 三维 GIS 分析模块。
8. 最终部署至香港云服务器。
9. 项目应具备 WebGIS 求职作品价值。

---

# 2. 当前三维校园稳定基线

当前正式模型：

output/campus_refined_v005.glb

SHA-256:

7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65

当前模型大致：

- 1317 meshes
- 65377 triangles
- 42 materials
- 约 5.42 MB

已有精修内容：

- Auditorium / 会堂
- SouthGate / 南门
- Library / 图书馆
- FusionSculpture / 融合雕塑
- Stadium_East_01
- Stadium_East_02
- Stadium_West_01
- Stadium_West_02

后续仍会继续精修建筑，因此 WebGIS 不得把业务数据与具体 GLB 版本强耦合。

---

# 3. GIS 坐标基准

校园原始 GIS：

EPSG:32650
WGS84 / UTM Zone 50N

单位：

meter

Area 1 原点：

Easting:
635986.7561034276

Northing:
4339716.120350528

校园局部坐标：

localX = utmX - 635986.7561034276
localNorth = utmNorth - 4339716.120350528

Blender / 原 GLB 坐标：

GIS East  -> Blender +X
GIS North -> Blender +Z
GIS Up    -> Blender -Y

注意：

当前模型不是普通 Blender Z-Up GIS 约定。

禁止在 WebGIS 各组件中散落手写坐标偏移。

必须集中实现：

CampusCoordinateService

统一负责：

- EPSG:32650 <-> EPSG:4326
- UTM <-> Campus Local
- Campus Local <-> WGS84
- Blender <-> GIS
- MapLibre Mercator <-> Campus

以后修改坐标逻辑只能修改该模块。

---

# 4. 产品结构

项目路由：

/map
/dashboard
/analysis
/about

其中：

/map
为绝对核心页面，占主要开发精力。

/dashboard
只作为轻量统计概览。

/analysis
用于空间分析及后期 Cesium 实验功能。

/about
展示：

- 项目介绍
- 数据来源
- 坐标系统
- 技术架构
- 模型版本
- 开源许可
- 项目演进过程

---

# 5. 前端技术栈

核心：

- Vue 3
- TypeScript
- Vite
- Vue Router
- Pinia
- MapLibre GL JS
- Three.js
- Turf.js
- ECharts
- Axios
- Element Plus

开发规范：

- Composition API
- <script setup lang="ts">
- TypeScript strict
- GIS 核心代码不得全部写进 Vue Component
- UI 与 GIS Engine 分离

---

# 6. 主地图架构

主模式：

MapLibre GL JS
+
Three.js Custom Layer

MapLibre 负责：

- Base Map
- Camera
- GIS layers
- GeoJSON
- 后期 MVT
- POI
- Label
- 查询结果
- 空间分析结果

Three.js Custom Layer 负责：

- campus_refined_v005.glb
- 精修三维校园
- GLB Object Picking
- Three.js Highlight
- 三维地标

架构目标：

MapLibre 是主 GIS Engine。

Three.js 是 MapLibre 中的三维渲染能力，
不是整个 WebGIS 的唯一地图引擎。

---

# 7. 独立沉浸式校园模式

同时保留：

ImmersiveCampusViewer

使用独立 Three.js Renderer。

用途：

- 精细三维漫游
- 更自由相机
- 近距离观察建筑
- 高质量模型展示

继续保留已验证的渲染逻辑：

- reversedDepthBuffer
- Ground polygonOffset
- near = 0.5
- close navigation near = 0.1
- far = 5000

MapLibre 模式和独立 Three.js 模式必须共用：

- feature ID
- POI
- 建筑属性
- selectedFeature
- model binding
- camera target

不能形成两个完全独立的数据系统。

---

# 8. Base Map 策略

采用：

MapLibre + 可替换 BaseMap Provider

不要将项目锁死到高德、腾讯或单个国外地图源。

设计：

BaseMapProvider

例如：

- OSM
- OpenMapTiles
- Satellite
- Custom Campus
- PMTiles
- future provider

核心 GIS 数据保持标准 WGS84 / UTM。

不要把 GCJ-02 作为内部权威坐标。

如果以后接入中国商业地图：

通过 Adapter 转换。

---

# 9. Campus GIS Layers

第一阶段需要支持的数据：

Buildings
Roads
Waterways
GreenAreas
Sports
Landmarks
POI

后期可能增加：

Trees
Railways
Contours
Campus Boundary
Facilities
Devices
Population
Traffic
Events

Layer 不允许直接由 MapView.vue 手写管理。

必须建立：

LayerManager

例如：

GISLayerManager

负责：

- addLayer
- removeLayer
- showLayer
- hideLayer
- setOpacity
- queryLayer
- getLayerState

---

# 10. Feature ID

所有 GIS 对象使用统一 ID。

例如：

library
south-gate
auditorium
fusion-sculpture

stadium-east-01
stadium-east-02
stadium-west-01
stadium-west-02

普通建筑也需要稳定 ID。

业务数据与三维节点之间建立 binding。

例如：

Feature:

{
  "id": "library",
  "name": "图书馆",
  "type": "building"
}

ModelBinding:

{
  "featureId": "library",
  "asset": "campus_refined_v005.glb",
  "node": "REFINED_BUILDINGS/Library"
}

禁止：

通过 mesh index 作为永久业务 ID。

---

# 11. 数据访问层

第一阶段：

静态数据。

public/data/
public/models/

但 Vue Component 不得直接到处 fetch。

统一定义：

FeatureRepository

接口例如：

getAllFeatures()
getFeatureById()
searchFeatures()
getLayerFeatures()

第一阶段：

StaticFeatureRepository

第二阶段：

ApiFeatureRepository

未来切到 Spring Boot 时：

UI 与 GIS 业务代码不需要重写。

---

# 12. 第一阶段静态数据

建议：

public/
├─ data/
│  ├─ buildings.geojson
│  ├─ roads.geojson
│  ├─ waterways.geojson
│  ├─ green_areas.geojson
│  ├─ sports.geojson
│  ├─ pois.json
│  └─ campus_features.json
│
└─ models/
   └─ campus_refined_v005.glb

保留原始 EPSG:32650 数据。

浏览器使用版本可以构建时转换为 EPSG:4326。

不要手工修改原始 GIS 数据。

---

# 13. /map UI

总体：

------------------------------------------------
TopBar
------------------------------------------------
LayerPanel | MapCanvas | FeaturePanel
------------------------------------------------
StatusBar
------------------------------------------------

TopBar：

- Logo
- 项目名
- Search
- Home
- 2D / 3D
- Immersive Campus
- Fullscreen

LayerPanel：

- Buildings
- Roads
- Water
- Green
- Sports
- Landmarks
- POI
- Base Map

FeaturePanel：

选中对象后显示：

- Name
- Type
- Description
- Area
- Height
- Coordinates
- Images
- Attributes

操作：

- Fly To
- Zoom To
- Immersive View
- Nearby
- Route（后期）

StatusBar：

- Longitude
- Latitude
- EPSG:32650
- Zoom
- Pitch
- Bearing
- Scale
- FPS

---

# 14. 交互系统

必须统一：

SelectionManager

处理：

hoverFeature
selectedFeature

选中一个建筑：

1. MapLibre layer highlight
2. Three.js corresponding mesh highlight
3. FeaturePanel open
4. Pinia 更新 selectedFeature

不要分别维护：

Map selected
Three selected
Panel selected

它们必须指向同一个 feature ID。

---

# 15. 搜索

第一版：

本地搜索。

支持：

图书馆
南门
会堂
融合雕塑
体育场
普通建筑
POI

搜索结果点击：

flyToFeature(id)

以后：

/api/search

替代本地实现。

---

# 16. URL 状态

地图视角支持 URL 持久化。

例如：

/map?lng=118.xxx&lat=39.xxx&zoom=17&pitch=55&bearing=20

分享 URL 可以恢复：

- center
- zoom
- pitch
- bearing

后期可加入：

selected=library

---

# 17. /dashboard

保持轻量。

统计：

- Campus Area
- Building Count
- Road Length
- Green Area
- Water Area
- Sports Facilities
- Refined Landmarks

ECharts：

- Building Type
- Building Height
- Land Use
- Feature Distribution

图表可以反向筛选地图。

不要制作纯装饰性“大屏”。

---

# 18. /analysis

第一阶段：

Turf.js

功能：

- Distance
- Area
- Coordinate Pick
- Buffer
- Point in Polygon
- Intersection
- Nearby
- Nearest Feature
- Bounding Box Query

第二阶段：

PostGIS 提供相同能力。

可以展示：

Frontend Turf
vs
Backend PostGIS

---

# 19. Backend Phase

第二阶段加入：

Spring Boot
Java 21

PostgreSQL
PostGIS

结构：

Controller
Service
Repository
Database

API：

GET /api/features
GET /api/features/{id}

GET /api/search

GET /api/pois

GET /api/layers

GET /api/stats/overview

POST /api/analysis/buffer
POST /api/analysis/nearest
POST /api/analysis/within
POST /api/analysis/intersection

---

# 20. PostGIS

校园业务数据权威坐标优先保留：

EPSG:32650

原因：

- meter
- 面积自然
- 距离自然
- 已有所有校园定位基于该 CRS

API 输出 GeoJSON 时：

ST_Transform(..., 4326)

后期 Vector Tile：

根据 MVT pipeline 转换。

必须创建 GiST spatial index。

---

# 21. Vector Tile

项目初期不使用。

数据量增大以后：

PostGIS
↓
Martin
↓
MVT
↓
MapLibre

Martin 不属于 Phase 1。

---

# 22. GeoServer

不是主数据链路。

后期作为 GIS 标准服务学习模块：

PostGIS
↓
GeoServer
↓
WMS
WFS
WMTS

目的：

展示 OGC GIS 服务能力。

---

# 23. Cesium

不替代 MapLibre 主地图。

以后放在：

/analysis/cesium

用于：

- Terrain
- 3D Tiles
- Measurement
- Viewshed
- Line of Sight
- Flood
- Height Analysis

作为三维 GIS 能力展示。

---

# 24. SuperMap

不在第一阶段集成。

后期可制作：

SuperMap / iClient3D / S3M compatibility demo

或者：

docs/supermap-migration.md

说明现有数字校园迁移到 SuperMap 技术体系的方法。

---

# 25. 部署架构

最终目标：

Hong Kong Cloud Server

Internet
↓
Nginx
├─ Vue dist
├─ GLB / static
├─ /api -> Spring Boot
└─ /tiles -> Martin

Docker Compose:

nginx
backend
postgres-postgis
martin (later)

数据库不暴露公网。

公网仅：

80
443

HTTPS。

---

# 26. 项目目录

campus-webgis/
│
├─ web/
│  ├─ src/
│  │
│  ├─ components/
│  ├─ views/
│  │  ├─ MapView.vue
│  │  ├─ DashboardView.vue
│  │  ├─ AnalysisView.vue
│  │  └─ AboutView.vue
│  │
│  ├─ gis/
│  │  ├─ map/
│  │  ├─ layers/
│  │  ├─ three/
│  │  ├─ coordinate/
│  │  ├─ interaction/
│  │  ├─ analysis/
│  │  └─ repositories/
│  │
│  ├─ stores/
│  ├─ api/
│  ├─ types/
│  └─ utils/
│
├─ public/
│  ├─ models/
│  └─ data/
│
├─ server/
│
├─ database/
│  ├─ migrations/
│  └─ seed/
│
├─ infra/
│  ├─ docker/
│  └─ nginx/
│
├─ docs/
│
└─ README.md

---

# 27. Coding Principles

1. GIS Engine 与 Vue UI 解耦。
2. 坐标转换只允许一个 Service。
3. Feature 使用稳定 ID。
4. GLB node 不能作为数据库主键。
5. MapLibre 是主 GIS Engine。
6. Three.js 是三维渲染能力。
7. Cesium 是后期分析模块。
8. 第一阶段静态数据，但必须保留 Repository abstraction。
9. 不提前设计微服务。
10. 不提前加入 Redis、MQ、Kubernetes 等无必要技术。
11. 不为了技术栈数量破坏项目整体性。
12. 优先把 /map 做好。

---

# 28. Development Roadmap

Phase 1
Project Bootstrap + MapLibre

Phase 2
Campus GIS Layers

Phase 3
Three.js GLB Custom Layer

Phase 4
Picking / Search / Feature Panel

Phase 5
Immersive Three.js Campus Viewer

Phase 6
Turf Spatial Analysis

Phase 7
Spring Boot + PostGIS

Phase 8
Production Deployment

Phase 9
Cesium Analysis

Phase 10
MVT / GeoServer / SuperMap extension

---

# 29. Current Rule

当前只执行当前 Phase。

不要提前实现后续 Phase，
除非它是当前架构必须的最小基础。

每一 Phase 必须：

- 可运行
- 可验证
- 可回滚
- 输出 report
- 不破坏上一阶段