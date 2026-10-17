import {Box3,Group,Mesh,MeshStandardMaterial,Shape,ExtrudeGeometry,Vector2,type Object3D} from 'three';
import type {CampusFeature} from '../../types/CampusFeature';
import {sourceBuildingBindings} from './SourceBuildingBindings';
import {RESIDENTIAL_PLAN_GEOMETRIES,RESIDENTIAL_PLAN_PROVENANCE} from '../features/CampusResidentialPlan';

export const RESIDENTIAL_PREVIEW_ROOT='RESIDENTIAL_PLAN_PREVIEW_ROOT';
export const residentialNodeName=(id:string)=>`RES_PLAN_${id.replace(':','_')}`;
/** Fail closed on ambiguous bindings: do not infer a source by index or nearest centroid.
 * Must run in source ENU before projection. Keep original mesh buffers intact.
 */
export function createResidentialPlanPreview(scene:Object3D,features:readonly CampusFeature[]){
  if(scene.getObjectByName(RESIDENTIAL_PREVIEW_ROOT))throw Error('Duplicate residential preview');
  const bindings=sourceBuildingBindings(scene,features);
  const originals=new Map<Object3D,boolean>();
  const root=new Group();root.name=RESIDENTIAL_PREVIEW_ROOT;root.userData={...RESIDENTIAL_PLAN_PROVENANCE};
  const material=new MeshStandardMaterial({color:0xc5ced2,roughness:0.9});
  for(const ref of RESIDENTIAL_PLAN_GEOMETRIES){
    const source=bindings.find(b=>b.id===ref.id)?.root;if(!source)continue;
    const bounds=new Box3().setFromObject(source),height=bounds.max.z-bounds.min.z;
    if(!Number.isFinite(height)||height<=0)continue;
    const shape=new Shape(ref.geometry.coordinates[0]!.slice(0,-1).map(p=>new Vector2(p[0]!,p[1]!)));
    const mesh=new Mesh(new ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,steps:1}),material);
    mesh.name=residentialNodeName(ref.id);mesh.position.z=bounds.min.z;
    mesh.userData={...RESIDENTIAL_PLAN_PROVENANCE,batchVersion:ref.batchVersion,wallPolicy:ref.wallPolicy,featureId:ref.id,sourceLabel:ref.sourceLabel,planLabel:ref.planLabel,
      sourceBodyHeightMeters:height,sourceBaseElevationMeters:bounds.min.z};
    root.add(mesh);originals.set(source,source.visible);
  }
  if(!root.children.length)material.dispose();
  scene.add(root);
  return {root,setEnabled(enabled:boolean){root.visible=enabled;originals.forEach((visible,o)=>o.visible=enabled?false:visible);}};
}
