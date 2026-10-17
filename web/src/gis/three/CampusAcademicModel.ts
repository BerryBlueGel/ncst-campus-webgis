import {Box3,Group,Mesh,MeshStandardMaterial,Shape,Path,ExtrudeGeometry,Vector2,type Object3D} from 'three';
import type {CampusFeature} from '../../types/CampusFeature';
import {sourceBuildingBindings} from './SourceBuildingBindings';
import {ACADEMIC_PLAN_GEOMETRIES,ACADEMIC_PLAN_PROVENANCE} from '../features/CampusAcademicPlan';

export const ACADEMIC_PREVIEW_ROOT='ACADEMIC_PLAN_PREVIEW_ROOT';
export const academicNodeName=(id:string)=>`ACAD_PLAN_${id.replace(':','_')}`;
/** Exact unique source binding; holes are actual extruded voids, not paint.
 * Run before Mercator reprojection. Source buffers and original visibility survive. */
export function createAcademicPlanPreview(scene:Object3D,features:readonly CampusFeature[]){
  if(scene.getObjectByName(ACADEMIC_PREVIEW_ROOT))throw Error('Duplicate academic preview');
  const bindings=sourceBuildingBindings(scene,features),originals=new Map<Object3D,boolean>();
  const root=new Group();root.name=ACADEMIC_PREVIEW_ROOT;root.userData={...ACADEMIC_PLAN_PROVENANCE};
  const material=new MeshStandardMaterial({color:0xc5ced2,roughness:0.9});
  for(const ref of ACADEMIC_PLAN_GEOMETRIES){
    const source=bindings.find(b=>b.id===ref.id)?.root;if(!source)continue;
    const bounds=new Box3().setFromObject(source),height=bounds.max.z-bounds.min.z;
    if(!Number.isFinite(height)||height<=0)continue;
    const rings=ref.geometry.coordinates.map(r=>r.slice(0,-1).map(p=>new Vector2(p[0]!,p[1]!)));
    const shape=new Shape(rings[0]!);shape.holes=rings.slice(1).map(r=>new Path(r));
    const mesh=new Mesh(new ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,steps:1}),material);
    mesh.name=academicNodeName(ref.id);mesh.position.z=bounds.min.z;
    mesh.userData={...ACADEMIC_PLAN_PROVENANCE,featureId:ref.id,sourceLabel:ref.sourceLabel,planLabel:ref.planLabel,
      wallPolicy:ref.wallPolicy,sourceBodyHeightMeters:height,sourceBaseElevationMeters:bounds.min.z};
    root.add(mesh);originals.set(source,source.visible);
  }
  if(!root.children.length)material.dispose();scene.add(root);
  return {root,setEnabled(enabled:boolean){root.visible=enabled;originals.forEach((visible,o)=>o.visible=enabled?false:visible);}};
}
