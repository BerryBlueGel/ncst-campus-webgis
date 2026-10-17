import { defineStore } from "pinia";
import { computed, markRaw, ref } from "vue";
import { DEFAULT_CAMERA } from "../gis/map/MapConfig";
import { createLayerManager } from "../gis/layers/LayerManager";
import { initialThreeState } from '../gis/three/CampusThreeConfig';
import { StaticFeatureRepository } from '../gis/repositories/StaticFeatureRepository';
import { ApiFeatureRepository } from '../gis/repositories/ApiFeatureRepository';
import type { FeatureRepository } from '../gis/repositories/FeatureRepository';
import { SelectionManager } from '../gis/interaction/SelectionManager';
import { AnalysisManager } from '../gis/analysis/AnalysisManager';
import { createTeachingPreviewState } from '../gis/features/TeachingPreviewState';
export const useMapStore = defineStore("map", () => {
  const campus3D=ref(initialThreeState());
  const threeRequested=ref(false);
  const groundOffset=ref(true);
  const wideScreen =
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 801px)").matches;
  const mapReady = ref(false),
    camera = ref({ ...DEFAULT_CAMERA }),
    selectedFeatureId = ref<string | null>(null),
    hoveredFeatureId = ref<string | null>(null),
    activeBaseMap = ref("open-map"),
    leftOpen = ref(wideScreen),
    rightOpen = ref(wideScreen),
    cursor = ref<[number, number] | null>(null);
  const {preferred:planDisplayPreview,effective:teachingPreview,inspectingPart:teachingPartInspection}=createTeachingPreviewState(selectedFeatureId);
  const sourceFragmentReview=ref(false);
  const featureSource=import.meta.env.VITE_FEATURE_SOURCE==='api'?'api':'static';
  const featureRepository:FeatureRepository=markRaw(featureSource==='api'?new ApiFeatureRepository():new StaticFeatureRepository());
  const selection=markRaw(new SelectionManager(featureRepository));
  const analysis=markRaw(new AnalysisManager(featureRepository,()=>selectedFeatureId.value));
  const analysisState=ref(analysis.getState());
  analysis.onChange(state=>analysisState.value=state);
  const featuresReady=ref(false),featuresError=ref('');
  const selectedFeature=computed(()=>selectedFeatureId.value?featureRepository.getById(selectedFeatureId.value):undefined);
  const hoveredFeature=computed(()=>hoveredFeatureId.value?featureRepository.getById(hoveredFeatureId.value):undefined);
  selection.onChange((selected,hovered)=>{selectedFeatureId.value=selected;hoveredFeatureId.value=hovered;});
  async function loadFeatures(){
    try{await featureRepository.load();await analysis.load();featuresReady.value=true;featuresError.value='';}
    catch(error){featuresReady.value=false;featuresError.value=featureSource==='api'
      ?`Backend unavailable：${error instanceof Error?error.message:String(error)}`
      :error instanceof Error?error.message:String(error);}
  }
  const manager = createLayerManager(),
    layers = ref(manager.getLayers());
  manager.onChange(() => {
    layers.value = manager.getLayers();
  });
  function setOpacity(id: string, value: number) {
    manager.setOpacity(id, value);
  }
  function toggleLayer(id: string, visible: boolean) {
    manager.setVisibility(id, visible);
    layers.value = manager.getLayers();
  }
  return {
    campus3D,threeRequested,groundOffset,teachingPreview,teachingPartInspection,planDisplayPreview,sourceFragmentReview,
    mapReady,
    camera,
    selectedFeatureId,
    hoveredFeatureId,
    selectedFeature,hoveredFeature,featuresReady,featuresError,featureSource,featureRepository,selection,analysis,analysisState,loadFeatures,
    activeBaseMap,
    leftOpen,
    rightOpen,
    cursor,
    layers,
    toggleLayer,
    setOpacity,
    layerManager: () => manager,
  };
});
