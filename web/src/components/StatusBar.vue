<script setup lang="ts">
import { useMapStore } from "../stores/mapStore";
import { computed } from "vue";
import { coordinates } from "../gis/coordinate/CampusCoordinateService";
const store = useMapStore();
const utm = computed(() =>
  coordinates.wgs84ToUtm(store.cursor ?? [store.camera.lng, store.camera.lat]),
);
</script>
<template>
  <footer class="status-bar">
    <span
      ><i class="dot" :class="{ pending: !store.mapReady }"></i
      >{{ store.mapReady ? "地图就绪" : "地图加载中" }}</span
    ><span data-testid="cursor"
      >{{ store.cursor ? "鼠标" : "中心" }}
      {{ (store.cursor?.[0] ?? store.camera.lng).toFixed(6) }}° E &nbsp;
      {{ (store.cursor?.[1] ?? store.camera.lat).toFixed(6) }}° N</span
    ><span
      >ZOOM <b>{{ store.camera.zoom.toFixed(2) }}</b></span
    ><span
      >PITCH <b>{{ store.camera.pitch.toFixed(1) }}°</b></span
    ><span
      >BEARING <b>{{ store.camera.bearing.toFixed(1) }}°</b></span
    ><span class="status-crs"
      >EPSG:32650 <em>{{ utm.map((n) => n.toFixed(1)).join(" / ") }}</em></span
    >
  </footer>
</template>
