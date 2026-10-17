import {Box3,Group,Mesh,MeshStandardMaterial,Shape,Path,ExtrudeGeometry,Vector2,type Object3D} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {CampusFeature} from '../../types/CampusFeature';
import {sourceBuildingBindings} from './SourceBuildingBindings';
import {SOUTHWEST_PLAN_GEOMETRIES,SOUTHWEST_PLAN_PROVENANCE} from '../features/CampusSouthwestPlan';
export const SOUTHWEST_PREVIEW_ROOT='SOUTHWEST_PLAN_PREVIEW_ROOT';
export const southwestNodeName=(id:string)=>`SW_PLAN_${id.replace(':','_')}`;
/** One mesh/binding per historical ID, even for disconnected roof components.
 * Keep source buffers/visibility untouched; run in ENU before reprojection. */
export function createSouthwestPlanPreview(scene:Object3D,features:readonly CampusFeature[]){
  return createRegisteredRoofPreview(scene,features,SOUTHWEST_PLAN_GEOMETRIES,SOUTHWEST_PLAN_PROVENANCE,SOUTHWEST_PREVIEW_ROOT,southwestNodeName);
}
export function createRegisteredRoofPreview(scene:Object3D,features:readonly CampusFeature[],refs:typeof SOUTHWEST_PLAN_GEOMETRIES,
  provenance:Record<string,unknown>,rootName:string,nodeName:(id:string)=>string){
  if(scene.getObjectByName(rootName))throw Error(`Duplicate preview ${rootName}`);
  const bindings=sourceBuildingBindings(scene,features),originals=new Map<Object3D,boolean>();
  const root=new Group();root.name=rootName;root.userData={...provenance};
  const material=new MeshStandardMaterial({color:0xc5ced2,roughness:0.9});
  for(const ref of refs){
    const source=bindings.find(b=>b.id===ref.id)?.root;if(!source)continue;
    const bounds=new Box3().setFromObject(source),height=bounds.max.z-bounds.min.z;
    if(!Number.isFinite(height)||height<=0)continue;
    const polys=ref.geometry.type==='Polygon'?[ref.geometry.coordinates]:ref.geometry.coordinates;
    const pieces=polys.map(poly=>{
      const rings=poly.map(r=>r.slice(0,-1).map(p=>new Vector2(p[0]!,p[1]!)));
      const shape=new Shape(rings[0]!);shape.holes=rings.slice(1).map(r=>new Path(r));
      return new ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,steps:1});
    });
    const geometry=mergeGeometries(pieces);pieces.forEach(p=>p.dispose());
    if(!geometry)throw Error(`Cannot merge source components ${ref.id}`);
    const mesh=new Mesh(geometry,material);mesh.name=nodeName(ref.id);mesh.position.z=bounds.min.z;
    mesh.userData={...provenance,featureId:ref.id,sourceLabel:ref.sourceLabel,planLabel:ref.planLabel,
      wallPolicy:ref.wallPolicy,componentCount:polys.length,sourceBodyHeightMeters:height,sourceBaseElevationMeters:bounds.min.z};
    root.add(mesh);originals.set(source,source.visible);
  }
  if(!root.children.length)material.dispose();scene.add(root);
  return {root,setEnabled(enabled:boolean){root.visible=enabled;originals.forEach((visible,o)=>o.visible=enabled?false:visible);}};
}
