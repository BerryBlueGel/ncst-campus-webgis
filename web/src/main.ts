import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import "./map-clean.css";
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/map" },
    { path: "/map", component: () => import("./views/MapView.vue") },
    {
      path: "/dashboard",
      component: () => import("./views/DashboardView.vue"),
    },
    { path: "/analysis", component: () => import("./views/AnalysisView.vue") },
    { path: "/about", component: () => import("./views/AboutView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/map" },
  ],
});
createApp(App).use(createPinia()).use(router).mount("#app");
