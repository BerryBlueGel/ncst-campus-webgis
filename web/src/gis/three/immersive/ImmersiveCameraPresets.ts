import { Box3, Vector3 } from 'three';
import type { CampusFeature } from '../../../types/CampusFeature';

export interface FeaturePreset { minDistance:number; widthFactor:number; elevationFactor:number; azimuthDegrees:number }
const byCategory:Record<CampusFeature['category'],FeaturePreset>={
  building:{minDistance:65,widthFactor:1.6,elevationFactor:0.5,azimuthDegrees:15},
  landmark:{minDistance:85,widthFactor:1.22,elevationFactor:0.48,azimuthDegrees:10},
  stadium:{minDistance:240,widthFactor:1.65,elevationFactor:0.68,azimuthDegrees:12},
};
const overrides:Record<string,Partial<FeaturePreset>>={
  'south-gate':{minDistance:85,widthFactor:1.9,elevationFactor:0.42,azimuthDegrees:0},
  library:{minDistance:340,widthFactor:1.28,elevationFactor:0.52,azimuthDegrees:9},
  auditorium:{minDistance:160,widthFactor:1.6,elevationFactor:0.62,azimuthDegrees:22},
  'fusion-sculpture':{minDistance:48,widthFactor:2.2,elevationFactor:0.55,azimuthDegrees:15},
};
export function featurePreset(feature:CampusFeature):FeaturePreset {
  return {...byCategory[feature.category],...overrides[feature.id]};
}
export function overviewView(bounds:Box3){
  const center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3());
  const span=Math.max(size.x,size.y,800),distance=Math.min(4250,span*1.7);
  const target=new Vector3(center.x,center.y,Math.max(0,Math.min(35,center.z)));
  const position=target.clone().add(new Vector3(distance*0.14,-distance*0.72,distance*0.69));
  return {target,position};
}
