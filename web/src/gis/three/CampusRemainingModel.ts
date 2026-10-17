import type {Object3D} from 'three';
import type {CampusFeature} from '../../types/CampusFeature';
import {REMAINING_PLAN_GEOMETRIES,REMAINING_PLAN_PROVENANCE} from '../features/CampusRemainingPlan';
import {CAMPUS_PLAN_DISPOSITIONS} from '../features/CampusPlanDispositions';
import {createRegisteredRoofPreview} from './CampusSouthwestModel';
import {sourceBuildingBindings} from './SourceBuildingBindings';
export const REMAINING_PREVIEW_ROOT='REMAINING_PLAN_PREVIEW_ROOT';
export const remainingNodeName=(id:string)=>`CAMPUS_PLAN_${id.replace(':','_')}`;
export function createRemainingPlanPreview(scene:Object3D,features:readonly CampusFeature[]){
  const control=createRegisteredRoofPreview(scene,features,REMAINING_PLAN_GEOMETRIES,REMAINING_PLAN_PROVENANCE,REMAINING_PREVIEW_ROOT,remainingNodeName);
  const bindings=sourceBuildingBindings(scene,features),originals=new Map<Object3D,boolean>();
  for(const row of CAMPUS_PLAN_DISPOSITIONS.filter(r=>r.suppressed)){
    const source=bindings.find(b=>b.id===row.id)?.root;if(source)originals.set(source,source.visible);
  }
  return {...control,setEnabled(enabled:boolean){control.setEnabled(enabled);originals.forEach((visible,o)=>o.visible=enabled?false:visible);}};
}
