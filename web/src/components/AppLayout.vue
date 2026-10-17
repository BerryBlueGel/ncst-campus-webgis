<template>
  <div class="app-layout">
    <header class="site-header">
      <RouterLink to="/map" class="brand"
        ><img class="brand-mark brand-image" src="/branding/berrybluegel-v1-128.png" alt="" width="42" height="42"
        ><span
          ><strong
            >华北理工大学<span class="brand-sub">三维地图 · 数字校园</span></strong
          ><small>NORTH CHINA UNIVERSITY OF SCIENCE AND TECHNOLOGY</small></span
        ></RouterLink
      >
      <nav aria-label="主导航">
        <RouterLink to="/map">校园地图</RouterLink
        ><RouterLink to="/dashboard">数据概览</RouterLink
        ><RouterLink to="/analysis">空间分析</RouterLink
        ><RouterLink to="/about">关于项目</RouterLink>
      </nav>
      <span class="phase-tag">CAMPUS GIS <i></i></span>
    </header>
    <main><slot /></main>
  </div>
</template>
