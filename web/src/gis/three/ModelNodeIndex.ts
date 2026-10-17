import type { Object3D } from 'three';
import {visibleInHierarchy} from './TeachingPlanModel';
import { MODEL_POINTS } from './CampusThreeConfig';
import { TEACHING_MODEL_BINDINGS } from '../features/TeachingBuildingPresentation';
import { modelAtPath } from './CampusModelPresentation';
import { TEACHING_BUILDINGS } from '../features/TeachingBuildingPresentation';
import { previewNodeName } from './TeachingPlanModel';
import type { CampusFeature } from '../../types/CampusFeature';
import { sourceBuildingBindings } from './SourceBuildingBindings';
import { RESIDENTIAL_PLAN_GEOMETRIES } from '../features/CampusResidentialPlan';
import { residentialNodeName } from './CampusResidentialModel';
import { ACADEMIC_PLAN_GEOMETRIES } from '../features/CampusAcademicPlan';
import { academicNodeName } from './CampusAcademicModel';
import { SOUTHWEST_PLAN_GEOMETRIES } from '../features/CampusSouthwestPlan';
import { southwestNodeName } from './CampusSouthwestModel';
import { REMAINING_PLAN_GEOMETRIES } from '../features/CampusRemainingPlan';
import { remainingNodeName } from './CampusRemainingModel';

/** Stable business IDs are attached to named GLB roots, never mesh order/UUIDs. */
export class ModelNodeIndex extends Map<string,Object3D[]> {
  readonly pickableObjects:Object3D[]=[];
  private reverse=new WeakMap<Object3D,string>();
  addBinding(id:string,root:Object3D|undefined){
    if(!root)return;
    const roots=this.get(id)??[];if(roots.includes(root))return;roots.push(root);this.set(id,roots);
    this.reverse.set(root,id);this.pickableObjects.push(root);
  }
  resolveFeatureId(node:Object3D|null):string|null{
    for(let current=node;current;current=current.parent){
      const id=this.reverse.get(current);if(id)return id;
    }
    return null;
  }
  override clear(){super.clear();this.pickableObjects.length=0;this.reverse=new WeakMap();}
  visiblePickMeshes(){
    const meshes=new Set<Object3D>();
    for(const root of this.pickableObjects)if(visibleInHierarchy(root))root.traverseVisible(node=>{
      if((node as Object3D&{isMesh?:boolean}).isMesh)meshes.add(node);
    });
    return [...meshes];
  }
}

/** Both renderers bind the same named GLB roots to Phase 4 business IDs. */
export function createCampusModelIndex(scene:Object3D,features:readonly CampusFeature[]=[]):ModelNodeIndex {
  const index=new ModelNodeIndex();
  for(const point of MODEL_POINTS)index.addBinding(point.id,scene.getObjectByName(point.node));
  for(const [id,name] of [
    ['stadium-east-02','ST_EAST_02_Root'],
    ['stadium-west-01','ST_WEST_01_Root'],
  ] as const)index.addBinding(id,scene.getObjectByName(name));
  // Embedded facade IDs are explicit and must agree with the repository, not inferred by mesh order.
  const featureIds=new Set(features.map(feature=>feature.id));
  scene.traverse(root=>{
    const id=root.userData.feature_id;
    if(typeof id==='string'&&featureIds.has(id)&&!(root as Object3D&{isMesh?:boolean}).isMesh)index.addBinding(id,root);
  });
  for(const {id,path} of TEACHING_MODEL_BINDINGS)index.addBinding(id,modelAtPath(scene,path));
  for(const {id,root} of sourceBuildingBindings(scene,features)){
    if(!index.has(id))index.addBinding(id,root);
  }
  for(const {id} of TEACHING_BUILDINGS)index.addBinding(id,scene.getObjectByName(previewNodeName(id)));
  for(const {id} of RESIDENTIAL_PLAN_GEOMETRIES)index.addBinding(id,scene.getObjectByName(residentialNodeName(id)));
  for(const {id} of ACADEMIC_PLAN_GEOMETRIES)index.addBinding(id,scene.getObjectByName(academicNodeName(id)));
  for(const {id} of SOUTHWEST_PLAN_GEOMETRIES)index.addBinding(id,scene.getObjectByName(southwestNodeName(id)));
  for(const {id} of REMAINING_PLAN_GEOMETRIES)index.addBinding(id,scene.getObjectByName(remainingNodeName(id)));
  // Shape candidates declare display groups explicitly. Source IDs remain
  // aliases for selection; picking a reviewed component returns its display ID.
  const aliases=new Map<string,string[]>();
  scene.traverse(node=>{
    const id=node.userData.shape_review_display_id;
    if(typeof id!=='string'||(node as Object3D&{isMesh?:boolean}).isMesh||node.userData.shape_review_reference_only)return;
    index.addBinding(id,node);
    if(Array.isArray(node.userData.shape_review_group_members))aliases.set(id,node.userData.shape_review_group_members);
  });
  for(const [id,members] of aliases)for(const member of members)if(member!==id)index.set(member,[...(index.get(id)??[])]);
  // Compound presentation spans multiple original records. Physical roots keep
  // their transforms/IDs; only visible picking/highlighting shares the display.
  const compoundRoots=new Map<string,Object3D[]>(),compoundMembers=new Map<string,string[]>();
  scene.traverseVisible(node=>{
    if((node as Object3D&{isMesh?:boolean}).isMesh||!visibleInHierarchy(node))return;
    const id=node.userData.dorm_compound_root;if(typeof id!=='string')return;
    const roots=compoundRoots.get(id)??[];roots.push(node);compoundRoots.set(id,roots);
    if(Array.isArray(node.userData.dorm_compound_members))compoundMembers.set(id,node.userData.dorm_compound_members);
  });
  for(const [id,roots] of compoundRoots){
    index.set(id,[]);for(const root of roots)index.addBinding(id,root);
    for(const member of compoundMembers.get(id)??[])if(member!==id)index.set(member,[...roots]);
  }
  return index;
}
