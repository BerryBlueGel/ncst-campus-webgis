import { Vector3 } from 'three';
import type { CampusFeature } from '../../../types/CampusFeature';
import { coordinates } from '../../coordinate/CampusCoordinateService';
import type { ModelNodeIndex } from '../ModelNodeIndex';
import { featurePreset } from './ImmersiveCameraPresets';
import { visibleModelBounds } from '../TeachingPlanModel';

export function resolveFeatureView(feature:CampusFeature|undefined,index:ModelNodeIndex){
  if(!feature)return null;
  const roots=index.get(feature.id)??[];
  const box=visibleModelBounds(roots),hasVisibleModel=!box.isEmpty();
  let target:Vector3,span:number;
  if(!box.isEmpty()){
    const size=box.getSize(new Vector3());target=box.getCenter(new Vector3());span=Math.max(size.x,size.y);
  }else{
    const local=coordinates.wgs84ToLocal(feature.centroid);
    target=new Vector3(local[0],local[1],0);
    span=feature.bounds?Math.max(
      Math.abs(coordinates.wgs84ToLocal(feature.bounds[1])[0]-coordinates.wgs84ToLocal(feature.bounds[0])[0]),
      Math.abs(coordinates.wgs84ToLocal(feature.bounds[1])[1]-coordinates.wgs84ToLocal(feature.bounds[0])[1]),
    ):0;
  }
  const preset=featurePreset(feature),distance=Math.max(preset.minDistance,span*preset.widthFactor);
  const azimuth=preset.azimuthDegrees*Math.PI/180;
  const position=target.clone().add(new Vector3(
    Math.sin(azimuth)*distance,-Math.cos(azimuth)*distance,distance*preset.elevationFactor,
  ));
  return {target,position,source:hasVisibleModel?'model' as const:'gis' as const};
}
