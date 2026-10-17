import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Map,GeoJSONSource } from 'maplibre-gl';
import { point, lineString, polygon } from '@turf/turf';
import type { AnalysisState,LngLat } from '../AnalysisTypes';
import { ANALYSIS_COLOR as C } from './AnalysisStyle';

const empty=():FeatureCollection=>({type:'FeatureCollection',features:[]});
const ids=['analysis-label','analysis-point','analysis-line','analysis-fill'] as const;
function tag(feature:Feature<Geometry>,role:string,label=''):Feature<Geometry>{return {...feature,properties:{...feature.properties,role,label}};}
export function analysisFeatures(state:AnalysisState):FeatureCollection{
  const features:Feature<Geometry>[]=[];
  if(state.inputGeometry)features.push(tag(state.inputGeometry,'input'));
  if(state.resultGeometry)features.push(tag(state.resultGeometry,'result',state.measurement?.primary));
  const points=state.points;
  if(points.length>=2&&!state.inputGeometry&&state.activeTool==='distance')features.push(tag(lineString(points),'input'));
  if(points.length>=3&&!state.inputGeometry&&(state.activeTool==='area'||state.activeTool==='intersection'))
    features.push(tag(polygon([[...points,points[0]]]),'input'));
  if(points.length===2&&!state.inputGeometry&&state.activeTool==='bbox'){
    const a=points[0],b=points[1];features.push(tag(polygon([[[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]],[a[0],a[1]]]]),'input'));
  }
  points.forEach((p:LngLat)=>features.push(tag(point(p),'vertex')));
  return {type:'FeatureCollection',features};
}
export class AnalysisLayerRenderer {
  private map?:Map;
  attach(map:Map){
    this.detach();this.map=map;
    if(!map.getSource('analysis-source'))map.addSource('analysis-source',{type:'geojson',data:empty()});
    if(!map.getLayer('analysis-fill'))map.addLayer({id:'analysis-fill',type:'fill',source:'analysis-source',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['match',['get','role'],'result',C.result,C.input],'fill-opacity':0.28}});
    if(!map.getLayer('analysis-line'))map.addLayer({id:'analysis-line',type:'line',source:'analysis-source',filter:['any',['==',['geometry-type'],'LineString'],['==',['geometry-type'],'Polygon']],paint:{'line-color':['match',['get','role'],'result',C.result,C.input],'line-width':3}});
    if(!map.getLayer('analysis-point'))map.addLayer({id:'analysis-point',type:'circle',source:'analysis-source',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':5,'circle-color':C.point,'circle-stroke-color':C.outline,'circle-stroke-width':2}});
    if(!map.getLayer('analysis-label'))map.addLayer({id:'analysis-label',type:'symbol',source:'analysis-source',filter:['has','label'],layout:{'text-field':['get','label'],'text-size':12,'text-offset':[0,1.3]},paint:{'text-color':C.point,'text-halo-color':C.outline,'text-halo-width':2}});
  }
  update(state:AnalysisState){const source=this.map?.getSource('analysis-source') as GeoJSONSource|undefined;if(source)source.setData(analysisFeatures(state));}
  detach(){if(!this.map)return;for(const id of ids)if(this.map.getLayer(id))this.map.removeLayer(id);
    if(this.map.getSource('analysis-source'))this.map.removeSource('analysis-source');this.map=undefined;}
}
