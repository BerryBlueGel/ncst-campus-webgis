import { MercatorCoordinate } from 'maplibre-gl';
import { Matrix4, Vector3, type Object3D, type Mesh } from 'three';
import { coordinates } from '../coordinate/CampusCoordinateService';
export { CampusModelAnchor } from './CampusModelAnchor';
import { MODEL_POINTS } from './CampusThreeConfig';

export const anchorLngLat = coordinates.localToWgs84([0,0]);
export const anchorMercator = MercatorCoordinate.fromLngLat(anchorLngLat,0);
export const modelScale = anchorMercator.meterInMercatorCoordinateUnits();
// Actual v005 scene extras and node translations are ENU, not the Blender editing axes.
// One anchor/matrix. Projection correction is computed from CRS, never per-landmark offsets.
export const modelMatrix = new Matrix4().makeTranslation(anchorMercator.x,anchorMercator.y,anchorMercator.z)
  .multiply(new Matrix4().makeScale(modelScale,-modelScale,modelScale));
export function projectLocal(p:Vector3) {
  const m=MercatorCoordinate.fromLngLat(coordinates.localToWgs84([p.x,p.y]),p.z);
  return new Vector3((m.x-anchorMercator.x)/modelScale,-(m.y-anchorMercator.y)/modelScale,(m.z-anchorMercator.z)/modelScale);
}
export function renderedLngLat(p:Vector3) {
  const m=p.clone().applyMatrix4(modelMatrix);
  const ll=new MercatorCoordinate(m.x,m.y,m.z).toLngLat();
  return [ll.lng,ll.lat] as [number,number];
}

// UTM and spherical Mercator are not related by one exact affine transform.
// Reproject runtime geometry and node origins once, keeping hierarchy, rotations and names.
// Subtract anchor before Float32 storage to preserve submillimetre campus precision.
function* projectionSteps(root:Object3D) {
  root.updateMatrixWorld(true);
  const original=new Map<Object3D,Matrix4>();
  const oldGeometry=new Set<Mesh['geometry']>();
  root.traverse(o=>original.set(o,o.matrixWorld.clone()));
  try {for(const o of original.keys()){
    const old=original.get(o)!;
    const world=old.clone().setPosition(projectLocal(new Vector3().setFromMatrixPosition(old)));
    const local=o.parent ? o.parent.matrixWorld.clone().invert().multiply(world) : world;
    local.decompose(o.position,o.quaternion,o.scale);
    o.updateMatrix(); o.updateMatrixWorld(false);
    const mesh=o as Mesh;
    if (!mesh.geometry) continue;
    oldGeometry.add(mesh.geometry);
    const g=mesh.geometry.clone(), a=g.getAttribute('position'), inv=o.matrixWorld.clone().invert();
    // Own the clone immediately, so cancellation can dispose a partial scene.
    mesh.geometry=g;
    const v=new Vector3();
    for(let i=0;i<a.count;i++) {
      v.fromBufferAttribute(a,i).applyMatrix4(old);
      v.copy(projectLocal(v)).applyMatrix4(inv);
      a.setXYZ(i,v.x,v.y,v.z);
      if((i+1)%512===0)yield;
    }
    a.needsUpdate=true;
    if(mesh.isMesh && g.getAttribute('normal')) g.computeVertexNormals();
    g.computeBoundingBox();g.computeBoundingSphere();
    yield;
  }}finally{oldGeometry.forEach(g=>g.dispose());}
  root.updateMatrixWorld(true);
  return MODEL_POINTS.map(p=>{
    const node=root.getObjectByName(p.node);
    if(!node) throw Error(`Missing validation node: ${p.node}`);
    const actual=renderedLngLat(node.getWorldPosition(new Vector3()));
    const expected=coordinates.localToWgs84(p.local);
    const local=coordinates.wgs84ToLocal(actual);
    const meterError=Math.hypot(local[0]-p.local[0],local[1]-p.local[1]);
    if(meterError>0.01) throw Error(`GIS alignment failed: ${p.id} ${meterError}m`);
    return {id:p.id,node:p.node,expected,actual,longitudeError:actual[0]-expected[0],latitudeError:actual[1]-expected[1],meterError};
  });
}

/** Synchronous contract retained for offline validation and small scenes. */
export function prepareProjection(root:Object3D) {
  const steps=projectionSteps(root);let next=steps.next();
  while(!next.done)next=steps.next();
  return next.value;
}

/** Loading scenes are not attached until fully transformed. Yield during large
 * vertex batches without changing the projection math or node hierarchy. */
export async function prepareProjectionAsync(root:Object3D,signal:AbortSignal,
  yieldTask:()=>Promise<void>=()=>new Promise(resolve=>setTimeout(resolve,0))) {
  const steps=projectionSteps(root);let sliceStart=performance.now();
  try {
    signal.throwIfAborted();let next=steps.next();
    while(!next.done){
      signal.throwIfAborted();
      if(performance.now()-sliceStart>=8){await yieldTask();signal.throwIfAborted();sliceStart=performance.now();}
      next=steps.next();
    }
    return next.value;
  }finally{steps.return([]);}
}
