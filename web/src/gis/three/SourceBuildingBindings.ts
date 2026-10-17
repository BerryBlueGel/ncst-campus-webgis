import { Box3, type Object3D } from 'three';
import type { CampusFeature } from '../../types/CampusFeature';
import { coordinates } from '../coordinate/CampusCoordinateService';

type Bounds=readonly [number,number,number,number];
/** Match source ENU envelopes, not nearest centroid/name/index. Ambiguous or
 * shifted footprints stay unbound. Run BEFORE Mercator runtime reprojection. */
export function sourceBuildingBindings(scene:Object3D,features:readonly CampusFeature[]){
  const footprints=features.flatMap(feature=>{
    const geometry=feature.geometry;
    if(feature.category!=='building'||(geometry.type!=='Polygon'&&geometry.type!=='MultiPolygon'))return [];
    const rings=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    const vertices=rings.flat(2).map(p=>coordinates.wgs84ToLocal([p[0]!,p[1]!]));
    if(!vertices.length||vertices.some(p=>!p.every(Number.isFinite)))return [];
    const bounds:Bounds=[Math.min(...vertices.map(p=>p[0])),Math.min(...vertices.map(p=>p[1])),
      Math.max(...vertices.map(p=>p[0])),Math.max(...vertices.map(p=>p[1]))];
    return [{id:feature.id,bounds}];
  });
  scene.updateMatrixWorld(true);
  const matches:{id:string;root:Object3D}[]=[];
  scene.traverse(root=>{
    if(!/^TPX_Buildings_\d+(?:_\d+)?$/.test(root.name))return;
    const box=new Box3().setFromObject(root);if(box.isEmpty())return;
    const bounds:Bounds=[box.min.x,box.min.y,box.max.x,box.max.y];
    // WGS84 conversion and Float32 storage incur <1mm in this source asset.
    const candidates=footprints.filter(f=>f.bounds.every((v,i)=>Math.abs(v-bounds[i]!)<0.01));
    if(candidates.length===1)matches.push({id:candidates[0]!.id,root});
  });
  // Also reject duplicate model envelopes: never attach two physical objects
  // to a business ID merely because they happen to share a bounding box.
  return matches.filter(match=>matches.filter(other=>other.id===match.id).length===1);
}
