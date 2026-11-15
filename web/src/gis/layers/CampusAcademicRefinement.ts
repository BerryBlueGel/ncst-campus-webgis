import type {Polygon,MultiPolygon} from 'geojson';
import {ACADEMIC_DISPLAY_MANIFEST as manifest} from '../three/CampusDetailReview';
import {coordinates} from '../coordinate/CampusCoordinateService';

/** Roof projection only: portals do not close the passage at ground level. */
export const academicRefinementFor=(id:string)=>manifest.groups.find(g=>g.root===id||g.members.some(m=>m===id));
export const academicFacadeRefinementFor=(id:string)=>'facadeOnly' in manifest?manifest.facadeOnly.find(g=>g.id===id):undefined;
export function academicRefinementNote(id:string){
  const group=academicRefinementFor(id);if(!group)return '';
  if('publicNote' in group)return group.publicNote as string;
  return group.root==='buildings:41e976045d6ae2f14056'?'D3入口形式参考用户航拍与720实景，构件高度与尺寸为估算。'
    :'B4/B6连接位置参考总图，架空形式推定；B8南楼仍独立。';
}
export function academicRefinementGeometry(id:string):Polygon|MultiPolygon|undefined {
  const group=academicRefinementFor(id);if(!group)return;
  const geometry=group.geometryLocal as Polygon|MultiPolygon;
  const project=(rings:Polygon['coordinates'])=>rings.map(r=>r.map(p=>coordinates.localToWgs84([p[0]!,p[1]!])));
  return geometry.type==='Polygon'?{type:'Polygon',coordinates:project(geometry.coordinates)}
    :{type:'MultiPolygon',coordinates:geometry.coordinates.map(project)};
}
