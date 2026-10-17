import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson';
import type { CampusFeature } from '../../types/CampusFeature';
import type { AnalysisTarget } from './AnalysisTypes';

export function featureGeometry(feature:CampusFeature):Feature<Geometry>{
  if(!feature.geometry||!['Point','LineString','Polygon','MultiPolygon'].includes(feature.geometry.type))
    throw Error(`要素 ${feature.name} 没有可用的分析几何`);
  const coordinates=(feature.geometry as {coordinates:unknown}).coordinates;
  const allFinite=(value:unknown):boolean=>Array.isArray(value)&&value.length>0&&
    (typeof value[0]==='number'?value.length>=2&&value.every(n=>typeof n==='number'&&Number.isFinite(n)):
      value.every(allFinite));
  if(!allFinite(coordinates))throw Error(`要素 ${feature.name} 的坐标无效`);
  return {type:'Feature',properties:{id:feature.id,name:feature.name},geometry:feature.geometry};
}
export function polygonTarget(feature:CampusFeature):AnalysisTarget|undefined{
  if(feature.geometry.type!=='Polygon'&&feature.geometry.type!=='MultiPolygon')return;
  const category=feature.category==='stadium'?'stadium':'building';
  return {id:`${category}:${feature.id}`,name:feature.name,category,
    businessId:feature.id,feature:featureGeometry(feature) as Feature<Polygon|MultiPolygon>};
}
