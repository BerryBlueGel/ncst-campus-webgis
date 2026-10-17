# 华北理工大学数字校园 WebGIS

当前版本包含八类 GIS 图层、地图三维、独立沉浸校园、搜索与选取、Turf / PostGIS 空间分析，以及真实统计概览。采用浅蓝 / 天蓝视觉主题。历史验收材料保留在 `docs/phase1/` 至 `docs/phase8/`。

## 启动

已验证环境：Node.js 24.18.1、npm 11.16.0。请使用 Node 22.12+ 或 24 LTS。

```powershell
cd web
npm ci
npm run dev
```

打开 http://127.0.0.1:5173/ ，自动跳转 `/map`。开发服务仅监听本机。线上访问 https://ncstgeo.cn/map 。

默认 `static` 模式可独立浏览校园。需要后端时，在 `.env.local` 设置 `VITE_FEATURE_SOURCE=api`，按 `../server/README.md` 启动后端（8080），再启动 Vite。Vite 将 `/api` 代理到本机后端；生产 Nginx 使用同源 `/api/v1`。

```powershell
npm test
npm run prepare:gis
npm run validate:gis
npm run build
npm run preview
```

构建输出为 `dist/`。预览默认端口 4173。保留 `package-lock.json`，用 `npm ci` 重现依赖；TypeScript 固定为 5.9.3，避免当前 vue-tsc 与 TypeScript 7 的兼容问题。

## 配置与操作

复制 `.env.example` 为 `.env.local`，可设置 `VITE_MAP_STYLE_URL` 为 MapLibre style JSON 地址，修改后重启服务。留空使用 OpenStreetMap 栅格底图。所有 `VITE_` 变量会暴露在前端，禁止放入私密凭据。

地图支持拖动、缩放、倾斜、旋转、回到校园、全屏和侧栏折叠。相机参数 `lng/lat/zoom/pitch/bearing` 在操作结束后延迟 300ms 写入 URL，刷新可恢复。无效参数退回默认值。

## 分层

- `src/gis/map/`：MapEngine 生命周期、相机默认值、可替换底图 Provider。
- `src/gis/coordinate/`：proj4 坐标转换；EPSG:32650 原点为 `[635986.7561034276, 4339716.120350528]`。
- `src/gis/layers/`：八类正式图层的注册、加载、开关、透明度、移除和资源清理，样式集中维护。
- `src/gis/repositories/`：静态与 API 要素仓库，通过稳定 ID 连接搜索、选取、GIS 图层和模型节点。
- `src/gis/stats/`：统计仓库、UTM 平面度量与地图图层聚焦。在线数据源使用 PostGIS 统计；校园边界面积从版本化静态边界计算。
- `src/gis/three/`、`src/gis/interaction/`、`src/gis/analysis/`：共享地图三维、沉浸浏览、选取和空间分析生命周期。
- `src/stores/`：Pinia 相机、就绪状态、选择/悬停 ID、底图和侧栏状态。
- `src/components/`：布局、地图容器和交互面板，不直接读取正式 GIS 数据。
- `src/views/`：地图、概览、分析、关于四个页面。
- `tests/`：坐标原点、标准 UTM 参考点、往返误差、相机参数、图层状态自测。

## 当前限制

模型、搜索、选取、空间分析和后端均已接入。`/dashboard` 显示真实统计，卡片与条形图可进入 `/map?focusLayer=...`；地图上的“显示全部图层”恢复全量。`/about` 提供三步演示、架构、坐标系、模型哈希与可访问的来源署名。

统计面积累计未做重叠消除；体育场按四处统计，跑道与内场共八个面。部分尺寸来自配准总图及公开资料，不应当作官方测量坐标或用于工程决策。

`npm run prepare:gis` 从上级 campus 正式源文件生成 `public/data/`，保留源属性/稳定 ID，并核验源哈希和坐标往返误差。局部坐标校园边界先加 UTM 原点，再转 WGS84；不要手工改坐标。缺少原始 campus 数据时不运行预处理，已有 public/data 可直接使用。

开发时可在 `.env.local` 设置 `VITE_GIS_DEBUG=true`，点击地图查看 WGS84、UTM 和校园局部坐标。默认关闭；生产构建即使配置 true 也关闭。Home 从校园边界自动计算范围。

公开底图依赖网络，开发测试可用性不代表生产 SLA。正式发布前应确认数据/模型许可并选择符合服务条款的底图供应商。npm 构建有地图/三维分包超过 500 kB 的体积提示，非失败；路由已懒加载。统计图采用原生 CSS 条形图与可访问的文本链接，不额外加载图表引擎。

完整项目简介见 `../README.md`；生产部署与回滚使用 `../infra/`，不要在共享服务器重启全局 Docker 或其他项目服务。
