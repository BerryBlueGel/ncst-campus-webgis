import type { Map as GLMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";
import type { LayerMetadata } from "../../types/gis";
import {
  CAMPUS_LAYERS,
  type CampusLayerDefinition,
} from "./CampusLayerRegistry";
import { StaticCampusDataRepository } from "../repositories/CampusDataRepository";
import { displayCollection, CAMPUS_BASEMAP_MASK, CAMPUS_SURFACE_COLOR } from './CampusDisplayGeometry';
import { SOURCE_FRAGMENT_LAYER,SOURCE_FRAGMENT_ROLE,isUnverifiedSourceFragment,sourceFragmentOpacity } from './SourceFragmentDisplay';
export type LayerState = LayerMetadata & {
  loaded: boolean;
  count: number;
  bytes: number;
  loadMs: number;
  renderMs: number | null;
  error?: string;
};
export type CampusBounds = [[number, number], [number, number]];
export function collectionBounds(data: FeatureCollection): CampusBounds {
  const b: CampusBounds = [
    [Infinity, Infinity],
    [-Infinity, -Infinity],
  ];
  const walk = (a: any) => {
    if (typeof a[0] === "number") {
      b[0][0] = Math.min(b[0][0], a[0]);
      b[0][1] = Math.min(b[0][1], a[1]);
      b[1][0] = Math.max(b[1][0], a[0]);
      b[1][1] = Math.max(b[1][1], a[1]);
    } else a.forEach(walk);
  };
  const geom = (g: Geometry) =>
    g.type === "GeometryCollection"
      ? g.geometries.forEach(geom)
      : walk(g.coordinates);
  data.features.forEach((f) => geom(f.geometry));
  if (!b.flat().every(Number.isFinite)) throw Error("Empty boundary");
  return b;
}
export class LayerManager {
  private layers = new Map<string, LayerState>();
  private defs = new Map<string, CampusLayerDefinition>();
  private map?: GLMap;
  private abort?: AbortController;
  private revision = 0;
  private listener: () => void = () => {};
  private cleanups: (() => void)[] = [];
  public bounds?: CampusBounds;
  private campus3DActive=false;
  private teachingPreview=true;
  private buildingData?:FeatureCollection;
  private sourceFragmentReview=false;
  setSourceFragmentReview(enabled:boolean){this.sourceFragmentReview=enabled;this.apply('buildings');}
  getSourceFragmentReview(){return this.sourceFragmentReview;}
  getTeachingPlanPreview(){return this.teachingPreview;}
  setTeachingPlanPreview(enabled:boolean){
    this.teachingPreview=enabled;
    const def=this.defs.get('buildings'),data=this.buildingData;
    if(def&&data)(this.map?.getSource(def.sourceId) as GeoJSONSource|undefined)?.setData(this.renderData('buildings',data));
  }
  private renderData(id:string,data:FeatureCollection):FeatureCollection {
    const displayed=displayCollection(id,data,this.teachingPreview,true);
    return {...displayed,features:displayed.features.map(feature=>({...feature,properties:{...feature.properties,__sourceId:String(feature.id),
      ...(id==='buildings'&&this.teachingPreview&&!feature.properties?.displayGroupRoot&&isUnverifiedSourceFragment(String(feature.id))?{displayRole:SOURCE_FRAGMENT_ROLE}:{})}}))};
  }
  private overlayOverrides=new Set<string>();
  private overlapping=new Set(['buildings','roads','waterways','green-areas','sports']);
  setCampus3DActive(active:boolean){
    if(active===this.campus3DActive)return;
    this.campus3DActive=active;this.overlayOverrides.clear();
    this.defs.forEach((_d,id)=>this.apply(id));this.listener();
  }
  private effectiveVisible(id:string,visible:boolean){return visible && !(this.campus3DActive && this.overlapping.has(id) && !this.overlayOverrides.has(id));}
  onChange(listener: () => void) {
    this.listener = listener;
  }
  register(def: CampusLayerDefinition) {
    if (this.defs.has(def.id)) throw Error("Duplicate layer ID");
    this.defs.set(def.id, def);
    this.registerLayer({
      id: def.id,
      name: def.name,
      type:
        def.style[0]!.type === "circle"
          ? "symbol"
          : (def.style[0]!.type as LayerMetadata["type"]),
      visible: def.defaultVisible,
      opacity: def.defaultOpacity,
      group: def.group,
    });
  }
  registerLayer(layer: LayerMetadata) {
    if (this.layers.has(layer.id)) throw Error("Duplicate layer ID");
    this.layers.set(layer.id, {
      ...layer,
      loaded: false,
      count: 0,
      bytes: 0,
      loadMs: 0,
      renderMs: null,
    });
  }
  async load(map: GLMap) {
    this.detach();
    this.map = map;
    const token = this.revision,
      abort = (this.abort = new AbortController()),
      repo = new StaticCampusDataRepository();
    for (const def of this.defs.values()) {
      const state = this.layers.get(def.id)!;
      try {
        const result = await repo.getLayer(def.url, abort.signal);
        if (token !== this.revision) return;
        if (!this.defs.has(def.id)) continue;
        const start = performance.now();
        // MapLibre's tiler assigns numeric feature IDs to string GeoJSON IDs.
        // Promote the stable Phase 2 ID through a property for picking/feature-state.
        if(def.id==='buildings')this.buildingData=result.data;
        const rendered=this.renderData(def.id,result.data);
        map.addSource(def.sourceId, { type: "geojson", data: rendered, promoteId:'__sourceId' });
        for (const style of def.style)
          map.addLayer({
            ...style,
            minzoom: def.minZoom,
            maxzoom: def.maxZoom,
          });
        state.loaded = true;
        state.count = result.data.features.length;
        state.bytes = result.bytes;
        state.loadMs = result.loadMs;
        delete state.error;
        this.apply(def.id);
        if (def.id === "campus-boundary") {
          this.bounds = collectionBounds(result.data);
          // Raster OSM buildings cannot be switched off independently. Cover only
          // the campus, below every campus layer, while retaining the outside map.
          const before = [...this.defs.values()].flatMap(d=>d.style).find(l=>!!map.getLayer(l.id))?.id;
          map.addLayer({id:CAMPUS_BASEMAP_MASK,type:'fill',source:def.sourceId,
            paint:{'fill-color':CAMPUS_SURFACE_COLOR,'fill-opacity':1}},before);
        }
        const idle = () => {
          if (token !== this.revision) return;
          state.renderMs = performance.now() - start;
          this.listener();
        };
        map.once("idle", idle);
        this.cleanups.push(() => map.off("idle", idle));
      } catch (e) {
        if (abort.signal.aborted) return;
        state.error = e instanceof Error ? e.message : String(e);
      }
      this.listener();
    }
  }
  detach() {
    this.revision++;
    this.abort?.abort();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    if (this.map) {
      if (this.map.getLayer(CAMPUS_BASEMAP_MASK)) this.map.removeLayer(CAMPUS_BASEMAP_MASK);
      for (const def of this.defs.values()) {
        for (const l of def.style)
          if (this.map.getLayer(l.id)) this.map.removeLayer(l.id);
        if (this.map.getSource(def.sourceId))
          this.map.removeSource(def.sourceId);
      }
    }
    this.map = undefined;
    // 3D suppression belongs to the removed map, not to persistent user choices.
    // A new analysis/2D map may never construct a Three layer to clear it.
    this.campus3DActive=false;
    this.overlayOverrides.clear();
    this.buildingData=undefined;
    this.bounds = undefined;
    for (const l of this.layers.values()) {
      l.loaded = false;
      l.renderMs = null;
    }
    this.listener();
  }
  private apply(id: string) {
    const def = this.defs.get(id),
      state = this.layers.get(id);
    if (!def || !state || !this.map) return;
    for (const layer of def.style) {
      if (!this.map.getLayer(layer.id)) continue;
      this.map.setLayoutProperty(
        layer.id,
        "visibility",
        this.effectiveVisible(id,state.visible) ? "visible" : "none",
      );
      if(layer.id===SOURCE_FRAGMENT_LAYER){
        this.map.setPaintProperty(layer.id,'line-opacity',sourceFragmentOpacity(this.sourceFragmentReview,state.opacity));
        continue;
      }
      const key =
        layer.type === "fill"
          ? "fill-opacity"
          : layer.type === "line"
            ? "line-opacity"
            : "circle-opacity";
      this.map.setPaintProperty(layer.id, key, state.opacity);
      if (layer.type === "circle")
        this.map.setPaintProperty(
          layer.id,
          "circle-stroke-opacity",
          state.opacity,
        );
    }
  }
  show(id: string) {
    this.setVisibility(id, true);
  }
  hide(id: string) {
    this.setVisibility(id, false);
  }
  setVisibility(id: string, visible: boolean) {
    const s = this.layers.get(id);
    if (s) {
      if(this.campus3DActive)this.overlayOverrides.add(id);
      s.visible = visible;
      this.apply(id);
      this.listener();
    }
  }
  setOpacity(id: string, opacity: number) {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw Error("Opacity must be 0–1");
    const s = this.layers.get(id);
    if (s) {
      s.opacity = opacity;
      this.apply(id);
      this.listener();
    }
  }
  remove(id: string) {
    const def = this.defs.get(id);
    if (def && this.map) {
      if(id==='campus-boundary' && this.map.getLayer(CAMPUS_BASEMAP_MASK))this.map.removeLayer(CAMPUS_BASEMAP_MASK);
      def.style.forEach((l) => {
        if (this.map!.getLayer(l.id)) this.map!.removeLayer(l.id);
      });
      if (this.map.getSource(def.sourceId)) this.map.removeSource(def.sourceId);
    }
    this.defs.delete(id);
    this.layers.delete(id);
    this.listener();
  }
  removeLayer(id: string) {
    this.remove(id);
  }
  getState(id: string) {
    return this.getLayer(id);
  }
  getLayer(id: string) {
    const l = this.layers.get(id);
    return l ? { ...l,visible:this.effectiveVisible(id,l.visible) } : undefined;
  }
  getLayers() {
    return [...this.layers.values()].map((l) => ({ ...l,visible:this.effectiveVisible(l.id,l.visible) }));
  }
}
export function createLayerManager() {
  const manager = new LayerManager();
  CAMPUS_LAYERS.forEach((d) => manager.register(d));
  return manager;
}
