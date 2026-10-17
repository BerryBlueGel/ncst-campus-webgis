<script setup lang="ts">
import {ACTIVE_MODEL_URL,ACTIVE_MODEL_HASH,MODEL_DISPLAY_LABEL,MODEL_URL,MODEL_HASH} from '../gis/three/CampusThreeConfig';
</script>
<template>
  <section class="content-page about">
    <span class="eyebrow">ABOUT THE ATLAS</span>
    <h1>华北理工大学三维地图</h1>
    <p class="page-intro">
      华北理工数字校园 WebGIS，以真实 GIS
      数据与地理配准模型为基础，逐步连接校园浏览、查询与空间分析。
    </p>
    <div class="about-demo"><span class="eyebrow">START EXPLORING</span><h2>三分钟，走进数字校园。</h2><div class="demo-links"><RouterLink to="/map?selected=library&mode=3d"><span>01</span><strong>定位图书馆</strong><small>查看属性与地理配准三维模型 ↗</small></RouterLink><RouterLink to="/map?view=immersive&selected=library"><span>02</span><strong>进入沉浸校园</strong><small>漫游校园，跳转标志建筑 ↗</small></RouterLink><RouterLink to="/analysis?selected=library"><span>03</span><strong>尝试空间分析</strong><small>选择缓冲区，对比 Turf / PostGIS ↗</small></RouterLink></div></div>
    <div class="about-grid">
      <article>
        <h2>01 / 系统能力</h2>
        <p>地理配准三维校园 · 查询 · 空间分析</p>
        <p>
          已接入建筑、道路、水体、绿地、体育设施、校园边界、地标与兴趣点，支持图层管理、要素查询、沉浸式浏览及 Turf / PostGIS 空间分析。
        </p>
        <h2>02 / 地理基准</h2>
        <strong>EPSG:32650</strong>
        <p>WGS84 / UTM Zone 50N</p>
        <p>原点 E 635986.7561034276<br />N 4339716.120350528</p>
      </article>
      <article>
        <h2>03 / 当前展示模型</h2>
        <p>{{MODEL_DISPLAY_LABEL}}</p><code>{{ACTIVE_MODEL_URL.split('/').pop()}}</code>
        <p>已使用共享地图画布加载三维校园，支持 2D / 3D 切换与 GIS 图层叠加。</p>
        <small>SHA-256</small
        ><code class="hash"
          >{{ACTIVE_MODEL_HASH}}</code
        >
        <details v-if="ACTIVE_MODEL_URL!==MODEL_URL"><summary>保留的正式基线与回滚说明</summary><code>{{MODEL_URL.split('/').pop()}}</code><code class="hash">{{MODEL_HASH}}</code><p>正式基线未覆盖。当前楼体连接、立面和高度为展示级校核或估算，不是全校实测模型；原始 GIS 面积与分析仍独立保留。</p></details>
        <h2>04 / 技术路线</h2>
        <div class="architecture-flow"><span>Vue · MapLibre · Three.js</span><span aria-hidden="true">↓ HTTPS / REST</span><span>Spring Boot · Java 21</span><span aria-hidden="true">↓ 内部网络</span><span>PostgreSQL · PostGIS</span></div>
        <div class="tech-tags">
          <span>Vue 3 · 已接入</span><span>TypeScript · 已接入</span
          ><span>MapLibre · 已接入</span><span>proj4 · 已接入</span
          ><span>Turf · 已接入</span><span>Three.js · 已接入</span
          ><span>Spring Boot · 已接入</span><span>PostGIS · 已接入</span>
        </div>
      </article>
    </div>
    <div class="source-note">
      底图来源：<a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener"
        >OpenStreetMap contributors · ODbL</a
      >。校园数据与模型包含第三方来源，具体来源与许可见
      <a href="/data-attribution.txt" target="_blank" rel="noopener">数据署名与来源说明</a>。
      校园轮廓和部分建筑尺寸由配准总图或公开资料推导，属于展示级数据；不用于工程放样、产权认定或安全决策。这里是独立数字校园演示项目，不是学校官方网站。
    </div>
  </section>
</template>
