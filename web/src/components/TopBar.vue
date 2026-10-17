<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useMapStore } from '../stores/mapStore';
import type { CampusFeature } from '../types/CampusFeature';
import {displaySearchResults} from '../gis/interaction/DisplaySearchResults';
defineProps<{full:boolean}>();
const emit=defineEmits<{home:[];fullscreen:[];toggle3D:[];view3D:[];immerse:[];chooseFeature:[id:string]}>();
const store=useMapStore(),query=ref(''),open=ref(false);
const remoteResults=ref<CampusFeature[]>([]),searchError=ref('');
const activeIndex=ref(-1),searchInput=ref<HTMLInputElement>(),searchLoading=ref(false);
let requestVersion=0;
watch(query,(value,_previous,onCleanup)=>{
  const version=++requestVersion;
  activeIndex.value=-1;remoteResults.value=[];searchError.value='';searchLoading.value=false;
  if(store.featureSource!=='api'||!value.trim())return;
  searchLoading.value=true;
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
    try{
      const result=await store.featureRepository.searchRemote?.(value,controller.signal);
      if(version===requestVersion)remoteResults.value=result??[];
    }catch{
      if(!controller.signal.aborted&&version===requestVersion)searchError.value='Backend unavailable';
    }finally{if(version===requestVersion)searchLoading.value=false;}
  },200);
  onCleanup(()=>{clearTimeout(timer);controller.abort();});
});
onBeforeUnmount(()=>requestVersion++);
const results=computed(()=>displaySearchResults(store.featureSource==='api'?remoteResults.value:
  store.featuresReady?store.featureRepository.search(query.value):[],query.value,
  store.threeRequested||store.planDisplayPreview,id=>store.featureRepository.getById(id)));
watch(results,()=>{activeIndex.value=-1;});
function choose(feature:CampusFeature){emit('chooseFeature',feature.id);query.value='';open.value=false;}
function keydown(event:KeyboardEvent){
  if(event.isComposing)return;
  if(event.key==='Escape'){event.preventDefault();open.value=false;return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();open.value=true;
    if(results.value.length)activeIndex.value=activeIndex.value<0?
      (event.key==='ArrowDown'?0:results.value.length-1):
      (activeIndex.value+(event.key==='ArrowDown'?1:-1)+results.value.length)%results.value.length;
  }else if(event.key==='Enter'){
    event.preventDefault();const selected=results.value[Math.max(0,activeIndex.value)];if(selected)choose(selected);
  }
}
function focusout(event:FocusEvent){
  if(!(event.relatedTarget instanceof Node)||!(event.currentTarget as HTMLElement).contains(event.relatedTarget))open.value=false;
}
</script>
<template>
  <div class="map-toolbar">
    <div class="breadcrumb">曹妃甸校区 <span>/</span> 校园地图</div>
    <div class="toolbar-actions">
      <div class="campus-search" @focusout="focusout">
        <input ref="searchInput" v-model="query" aria-label="搜索校园建筑与设施" role="combobox" aria-autocomplete="list" :aria-expanded="open&&query.trim().length>0" aria-controls="campus-search-results" :aria-activedescendant="open&&activeIndex>=0?`campus-search-option-${activeIndex}`:undefined"
          placeholder="⌕ 搜索图书馆、南门、体育场…" @focus="open=true" @input="open=true" @keydown="keydown" />
        <div v-if="open&&query.trim()" id="campus-search-results" class="search-results" role="listbox">
          <button v-for="(feature,index) in results" :id="`campus-search-option-${index}`" :key="feature.id" type="button" role="option" class="search-result" :aria-selected="activeIndex===index"
            :aria-label="`选择${feature.name}`" @pointerdown.prevent @click="choose(feature)" @focus="activeIndex=index" @keydown.esc.prevent="open=false;searchInput?.focus()">
            <span>{{feature.category==='stadium'?'◉':feature.category==='building'?'▣':'⌖'}}</span>
            <strong>{{feature.name}}</strong><small>{{feature.type}}</small>
          </button>
          <p v-if="searchError" role="alert">{{searchError}}</p>
          <p v-else-if="searchLoading" role="status">正在搜索…</p>
          <p v-else-if="!results.length">没有找到相关建筑或设施</p>
        </div>
      </div>
      <button @click="emit('home')">⌂ 回到校园</button>
      <button @click="emit('toggle3D')">{{store.threeRequested?'切换 2D':'切换 3D'}}</button>
      <button class="overview-entry" @click="emit('view3D')">三维总览</button>
      <button class="immerse-entry" @click="emit('immerse')">沉浸校园</button>
      <button @click="emit('fullscreen')">{{full?'退出全屏':'全屏'}}</button>
    </div>
  </div>
</template>
