import type {Object3D} from 'three';
import type {CampusFeature} from '../../types/CampusFeature';
import {createTeachingPlanPreview} from './TeachingPlanModel';
import {createResidentialPlanPreview} from './CampusResidentialModel';
import {createAcademicPlanPreview} from './CampusAcademicModel';
import {createSouthwestPlanPreview} from './CampusSouthwestModel';
import {createRemainingPlanPreview} from './CampusRemainingModel';
import {isEmbeddedDetailReview} from './CampusDetailReview';

/** One presentation switch, independently versioned reviewed work batches. */
export function createCampusBuildingWorkPreview(scene:Object3D,features:readonly CampusFeature[]=[]){
  // Candidate already contains the reviewed facades. Do not recreate old 6m prisms over them.
  if(isEmbeddedDetailReview(scene)){
    const embedded={setEnabled(_enabled:boolean){/* No raw counterpart in this separate candidate. */}};
    return {teaching:embedded,residential:embedded,academic:embedded,southwest:embedded,remaining:embedded,setEnabled:embedded.setEnabled};
  }
  const teaching=createTeachingPlanPreview(scene),residential=createResidentialPlanPreview(scene,features);
  const academic=createAcademicPlanPreview(scene,features);
  const southwest=createSouthwestPlanPreview(scene,features);
  const remaining=createRemainingPlanPreview(scene,features);
  return {teaching,residential,academic,southwest,remaining,setEnabled(enabled:boolean){teaching.setEnabled(enabled);residential.setEnabled(enabled);academic.setEnabled(enabled);southwest.setEnabled(enabled);remaining.setEnabled(enabled);}};
}
