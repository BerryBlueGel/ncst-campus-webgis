import { Box3, Group, Mesh, MeshStandardMaterial, Shape, Path, ExtrudeGeometry, Vector2, Vector3, Raycaster, BufferGeometry, Float32BufferAttribute, DoubleSide, type Object3D } from 'three';
import type { Polygon } from 'geojson';
import { TEACHING_PLAN_GEOMETRIES, TEACHING_PLAN_CONNECTIONS, TEACHING_PLAN_PROVENANCE } from '../features/TeachingPlanGeometry';
import { TEACHING_MODEL_BINDINGS } from '../features/TeachingBuildingPresentation';
import { modelAtPath } from './CampusModelPresentation';

export const TEACHING_PREVIEW_ROOT='TEACHING_PLAN_PREVIEW_ROOT';
/** Technical separation from terrain, NOT a surveyed construction elevation. */
export const TEACHING_CONNECTION_RENDER={representation:'SCHEMATIC_GROUND_MARKER_NOT_BUILDING',surfaceOffsetMeters:0.04,sampleSpacingMeters:8} as const;
export const previewNodeName=(id:string)=>`PLAN_${id.replace(':','_')}`;
export function visibleInHierarchy(node:Object3D):boolean {
  for(let p:Object3D|null=node;p;p=p.parent)if(!p.visible)return false;
  return true;
}
/** Box3.setFromObject includes hidden geometry. Focus only what is actually shown. */
export function visibleModelBounds(roots:readonly Object3D[]):Box3 {
  const bounds=new Box3();
  for(const root of roots){
    if(!visibleInHierarchy(root))continue;
    root.updateWorldMatrix(true,true);
    root.traverseVisible(object=>{
      const mesh=object as Mesh;
      if(!mesh.geometry)return;
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
      if(mesh.geometry.boundingBox)bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    });
  }
  return bounds;
}
function extruded(geometry:Polygon,base:number,material:MeshStandardMaterial) {
  const shape=new Shape(geometry.coordinates[0]!.slice(0,-1).map(p=>new Vector2(p[0]!,p[1]!)));
  shape.holes=geometry.coordinates.slice(1).map(r=>new Path(r.slice(0,-1).map(p=>new Vector2(p[0]!,p[1]!))));
  const mesh=new Mesh(new ExtrudeGeometry(shape,{depth:6,bevelEnabled:false,steps:1,curveSegments:1}),material);
  mesh.position.z=base;mesh.userData={...TEACHING_PLAN_PROVENANCE};return mesh;
}
/** Raw GLB frame is ENU (Z up). Must run BEFORE Mercator preparation. */
export function createTeachingPlanPreview(scene:Object3D) {
  if(scene.getObjectByName(TEACHING_PREVIEW_ROOT))throw Error('Duplicate teaching preview');
  scene.updateMatrixWorld(true);
  const originals=TEACHING_MODEL_BINDINGS.map(b=>modelAtPath(scene,b.path)).filter((o):o is Object3D=>!!o);
  const initial=new Map(originals.map(o=>[o,o.visible]));
  const root=new Group();root.name=TEACHING_PREVIEW_ROOT;root.userData={...TEACHING_PLAN_PROVENANCE};
  const body=new MeshStandardMaterial({color:0xc5ced2,roughness:0.9});
  const link=new MeshStandardMaterial({color:0xb0cbd8,roughness:0.9,transparent:true,opacity:0.65,depthWrite:false,side:DoubleSide});
  const ground:Mesh[]=[];
  scene.traverse(o=>{
    if(!(o as Mesh).isMesh)return;
    for(let p:Object3D|null=o;p;p=p.parent)if(/Ground/i.test(p.name)){ground.push(o as Mesh);break;}
  });
  const ray=new Raycaster(),terrainTop=ground.length?new Box3().setFromObject(scene).max.z+100:100;
  const sampleHeight=(x:number,y:number,fallback:number)=>{
    ray.set(new Vector3(x,y,terrainTop),new Vector3(0,0,-1));
    return (ray.intersectObjects(ground,false)[0]?.point.z??fallback)+TEACHING_CONNECTION_RENDER.surfaceOffsetMeters;
  };
  const bases=new Map<string,number>();
  for(const ref of TEACHING_PLAN_GEOMETRIES){
    const binding=TEACHING_MODEL_BINDINGS.find(b=>b.id===ref.id)!,source=modelAtPath(scene,binding.path);
    if(!source)continue;
    const base=new Box3().setFromObject(source).min.z;bases.set(ref.id,base);
    const mesh=extruded(ref.geometry,base,body);mesh.name=previewNodeName(ref.id);mesh.userData.featureId=ref.id;root.add(mesh);
  }
  for(const connection of TEACHING_PLAN_CONNECTIONS){
    const heights=connection.owners.map(id=>bases.get(id));if(heights.some(h=>h===undefined))continue;
    // Ground-draped plan ribbon: no wall, no invented bridge height or clearance.
    const [p,q,r,s]=connection.geometry.coordinates[0]!;
    const steps=Math.max(1,Math.ceil(Math.max(Math.hypot(p![0]!-s![0]!,p![1]!-s![1]!),Math.hypot(q![0]!-r![0]!,q![1]!-r![1]!))/TEACHING_CONNECTION_RENDER.sampleSpacingMeters));
    const positions:number[]=[],indices:number[]=[],fallback=Math.max(...heights as number[]);
    for(let i=0;i<=steps;i++)for(const [a,b] of [[p!,s!],[q!,r!]]){
      const t=i/steps,x=a![0]!+(b![0]!-a![0]!)*t,y=a![1]!+(b![1]!-a![1]!)*t;
      positions.push(x,y,sampleHeight(x,y,fallback));
    }
    for(let i=0;i<steps;i++){const a=i*2;indices.push(a,a+1,a+3,a,a+3,a+2);}
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new Mesh(geometry,link);mesh.name=connection.id;
    mesh.userData={...TEACHING_PLAN_PROVENANCE,...TEACHING_CONNECTION_RENDER,heightStatus:'NOT_A_BUILDING_HEIGHT',owners:connection.owners};root.add(mesh);
  }
  scene.add(root);
  return {root,setEnabled(enabled:boolean){root.visible=enabled;originals.forEach(o=>o.visible=enabled?false:initial.get(o)!);}};
}
