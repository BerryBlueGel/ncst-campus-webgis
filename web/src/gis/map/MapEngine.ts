import {
  Map,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
// Bundle the module worker explicitly; Vite's dependency URL is not its package directory.
setWorkerUrl(workerUrl);
import type { CameraState } from "../../types/gis";
import type { BaseMapProvider } from "./BaseMapProvider";
import type { LayerManager, CampusBounds } from "../layers/LayerManager";
import type { CampusThreeLayer } from '../three/CampusThreeLayer';
import { CAMPUS_3D_VIEW,initialThreeState,type CampusThreeState } from '../three/CampusThreeConfig';
import { DeferredActivation } from './DeferredActivation';
import { MapFeatureHighlighter } from '../interaction/MapFeatureHighlighter';
import type { FeatureRepository } from '../repositories/FeatureRepository';
import { NavigationGesture } from '../interaction/NavigationGesture';
import { SOURCE_FRAGMENT_LAYER,sourceFragmentPickEnabled } from '../layers/SourceFragmentDisplay';
import type { FocusPadding } from './FeatureFocusViewport';
export interface MapEvents {
  ready(): void;
  camera(state: CameraState): void;
  settled(state: CameraState): void;
  moving?(): void;
  cursor(position: [number, number]): void;
  error(message: string): void;
  coordinateClick?(position: [number, number]): void;
  three?(state:CampusThreeState):void;
  picked?(id:string|null,node?:string):void;
  hover?(id:string|null,node?:string):void;
}
export class MapEngine {
  private map?: Map;
  private observer?: ResizeObserver;
  private three?:CampusThreeLayer;
  private deferredThree?:DeferredActivation<typeof import('../three/CampusThreeLayer')>;
  private threeRequested=false;
  private threeChanged?:MapEvents['three'];
  private groundEnabled=true;
  private highlighter?:MapFeatureHighlighter;
  private selected:string|null=null;private hovered:string|null=null;
  private lastHover=0;
  private teachingPreview=true;
  setTeachingPlanPreview(enabled:boolean){this.teachingPreview=enabled;this.three?.setTeachingPlanPreview(enabled);}
  private interactionGuard:()=>boolean=()=>false;
  setInteractionGuard(guard:()=>boolean){this.interactionGuard=guard;}
  getMap(){return this.map;}
  refreshSelection(){this.highlighter?.update(this.selected,this.hovered,true);}
  create(
    container: HTMLElement,
    provider: BaseMapProvider,
    camera: CameraState,
    events: MapEvents,
    layers?: LayerManager,
    features?:FeatureRepository,
  ) {
    this.destroy();
    this.threeRequested=new URLSearchParams(location.search).get('mode')==='3d';
    this.threeChanged=events.three;
    const map = (this.map = new Map({
      container,
      // The shared context must request MSAA at creation; Three cannot retrofit it.
      canvasContextAttributes: { antialias: true },
      style: provider.style(),
      center: [camera.lng, camera.lat],
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
      maxPitch: 70,
      minZoom: 2,
      maxZoom: 20,
      attributionControl: { compact: true },
    }));
    map.addControl(
      new NavigationControl({ visualizePitch: true }),
      "top-right",
    );
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("load", async () => {
      events.camera(this.getCameraState());
      events.settled(this.getCameraState());
      if (layers) await layers.load(map);
      if(this.map!==map)return;
      if(features){this.highlighter=new MapFeatureHighlighter(map,features,()=>layers?.getTeachingPlanPreview()??false);this.highlighter.install();this.highlighter.update(this.selected,this.hovered);}
      this.deferredThree=new DeferredActivation(()=>import('../three/CampusThreeLayer'),
        ()=>this.map===map&&this.threeRequested,({CampusThreeLayer})=>{
          this.three=new CampusThreeLayer(s=>{
            layers?.setCampus3DActive(s.visible && !s.zoomSuppressed && s.status==='ready');
            events.three?.(s);
          },features);
          const before=map.getStyle().layers.find(l=>l.id==='poi-circle')?.id;
          this.three.setTeachingPlanPreview(this.teachingPreview);
          this.three.setGroundOffset(this.groundEnabled);
          map.addLayer(this.three,before);
          Object.assign(this.three.state.environment,{registered:!!map.getLayer(this.three.id),insertedBefore:before,baseStyleLayerOrder:map.getStyle().layers.map(l=>l.id)});
          this.three.setHighlight(this.selected,this.hovered);
          this.three.setVisible(this.threeRequested);
        },error=>events.three?.({...initialThreeState(),visible:true,status:'error',error:error instanceof Error?error.message:String(error)}));
      // 2D and analysis are usable before any optional 3D code is downloaded.
      events.ready();
      this.setThree(this.threeRequested);
    });
    map.on("movestart", () => events.moving?.());
    map.on("move", () => events.camera(this.getCameraState()));
    map.on("moveend", () => events.settled(this.getCameraState()));
    const pickGis=(point:{x:number;y:number})=>{
      if(!features)return null;
      const interactive=['poi-circle','landmarks-circle','sports-fill','buildings-fill']
        .filter(id=>!!map.getLayer(id)&&map.getLayoutProperty(id,'visibility')!=='none');
      if(!interactive.length)return null;
      const hits=map.queryRenderedFeatures([point.x,point.y],{layers:interactive});
      for(const hit of hits){
        if(hit.id===undefined||hit.id===null)continue;
        const id=features.resolveGis(hit.source,String(hit.id),hit.properties??{});
        if(id)return id;
      }
      const reviewing=layers?.getSourceFragmentReview()??false;
      if(sourceFragmentPickEnabled(reviewing,this.selected)&&map.getLayer(SOURCE_FRAGMENT_LAYER)&&map.getLayoutProperty(SOURCE_FRAGMENT_LAYER,'visibility')!=='none'){
        // Small dashed outlines need a modest screen-space hit tolerance, but
        // never steal an exact main-building hit or pick invisible source blocks.
        const outlines=map.queryRenderedFeatures([[point.x-4,point.y-4],[point.x+4,point.y+4]],{layers:[SOURCE_FRAGMENT_LAYER]});
        for(const hit of outlines){
          if(hit.id===undefined||hit.id===null||(!reviewing&&String(hit.id)!==this.selected))continue;
          const id=features.resolveGis(hit.source,String(hit.id),hit.properties??{});
          if(id)return id;
        }
      }
      return null;
    };
    const pick=(point:{x:number;y:number})=>{
      const model=this.three?.pick(point);return model??{id:pickGis(point),node:undefined};
    };
    map.on("mousemove", (event) => {
      events.cursor([event.lngLat.lng, event.lngLat.lat]);
      if(this.interactionGuard()){map.getCanvas().style.cursor='crosshair';return;}
      // Recursive model raycasts and hover highlighting must not compete with navigation.
      if(map.isMoving() || map.isZooming() || (event.originalEvent.buttons ?? 0) !== 0)return;
      if(performance.now()-this.lastHover<55)return;
      this.lastHover=performance.now();
      const result=pick(event.point),id=result.id;
      if(id!==this.hovered){this.hovered=id;this.setSelection(this.selected,id);events.hover?.(id,result.node);}
      map.getCanvas().style.cursor=id?'pointer':'';
    });
    map.on('mouseout',()=>{this.hovered=null;this.setSelection(this.selected,null);events.hover?.(null);map.getCanvas().style.cursor='';});
    map.on("error", (event) => events.error(event.error.message));
    const gesture=new NavigationGesture();let clickAccepted=false;
    const canvas=map.getCanvas();
    canvas.addEventListener('pointerdown',e=>{clickAccepted=false;gesture.begin(e);});
    canvas.addEventListener('pointermove',e=>gesture.move(e));
    canvas.addEventListener('pointerup',e=>{clickAccepted=gesture.end(e);});
    canvas.addEventListener('pointercancel',()=>{clickAccepted=false;gesture.cancel();});
    map.on("click", (event) =>{
      if(this.interactionGuard())return;
      const accepted=clickAccepted;clickAccepted=false;
      if(!accepted)return;
      events.coordinateClick?.([event.lngLat.lng, event.lngLat.lat]);
      const result=pick(event.point);events.picked?.(result.id,result.node);
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
  }
  destroy() {
    this.deferredThree?.dispose();this.deferredThree=undefined;this.threeChanged=undefined;
    this.highlighter?.clear();this.highlighter=undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    this.map?.remove();
    this.map = undefined;
    this.three=undefined;
  }
  setThree(visible:boolean){
    this.threeRequested=visible;
    if(this.three)this.three.setVisible(visible);
    else {
      this.threeChanged?.({...initialThreeState(),visible,status:visible?'loading':'idle'});
      if(visible)this.deferredThree?.request();
    }
  }
  setSelection(selected:string|null,hovered:string|null){
    this.selected=selected;this.hovered=hovered;
    this.highlighter?.update(selected,hovered);this.three?.setHighlight(selected,hovered);
  }
  groundOffset(enabled:boolean){this.groundEnabled=enabled;this.three?.setGroundOffset(enabled);}
  campus3DView(){this.setThree(true);this.flyTo(CAMPUS_3D_VIEW);}
  resize() {
    this.map?.resize();
  }
  fitBounds(bounds: CampusBounds,padding?:FocusPadding) {
    this.map?.fitBounds(bounds, {
      // Leave room for the persistent map caption above the fitted feature.
      // Scale on short viewports rather than letting padding exceed the map.
      padding: padding??{top:Math.min(160,(this.map?.getContainer().clientHeight??540)*0.3),bottom:45,left:45,right:45},
      duration: 650,
      pitch: 0,
      bearing: 0,
    });
  }
  flyTo(camera: CameraState,offset:[number,number]=[0,0]) {
    this.map?.flyTo({
      center: [camera.lng, camera.lat],
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
      // A transient screen offset, not persistent transform padding.
      offset,
      duration: 650,
    });
  }
  jumpTo(camera: CameraState) {
    this.map?.jumpTo({
      center: [camera.lng, camera.lat],
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
    });
  }
  getCameraState(): CameraState {
    if (!this.map) throw new Error("Map not created");
    const c = this.map.getCenter();
    return {
      lng: c.lng,
      lat: c.lat,
      zoom: this.map.getZoom(),
      pitch: this.map.getPitch(),
      bearing: this.map.getBearing(),
    };
  }
}
