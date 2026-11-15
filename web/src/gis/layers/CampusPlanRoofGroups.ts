import type {Polygon,MultiPolygon} from 'geojson';
import {feature,featureCollection,union,difference} from '@turf/turf';
import {globalRasterToLocal} from '../features/CampusRemainingPlan';
import {residentialPlanFor,RESIDENTIAL_WALL_ANGLE} from '../features/CampusResidentialPlan';
import {academicPlanFor} from '../features/CampusAcademicPlan';
import {TEACHING_PLAN_GEOMETRIES} from '../features/TeachingPlanGeometry';
import {orthogonalizeRing,type LocalPoint} from '../features/RectilinearGeometry';
import {coordinates} from '../coordinate/CampusCoordinateService';

/** Full-campus 2D schematic review, not ownership or a database/3D merge.
 * Names/layout: user's bb9e69ad7ce16bfda1a854e938151961.jpg.
 * Geometry: shared campus_georef.tif registration, never per-building bbox fits.
 * Separated white roofs remain separated; no buffering or invented bridges. */
export const PLAN_ROOF_GROUPS=[
  {root:'buildings:4b4e002af6e98d730dd3',members:['buildings:cb64ee8051756c097c6b'],name:'兰园1号楼北楼'},
  {root:'buildings:4134dddc73d0db640367',members:['buildings:6d188b2b59ca4eb32182'],name:'兰园2号楼南楼'},
  {root:'buildings:d1d687fd615e19da64ed',members:['buildings:5406aa5430d00212d9e7'],name:'兰园5号楼北楼'},
  {root:'buildings:69dee2704484a5676bd6',members:['buildings:b795fc43df83ff863ac7'],name:'竹园2号楼南楼'},
  {root:'buildings:3b216e82b3a5fbd7a8b8',members:['buildings:73bcd79a72a4bcf7af29'],name:'竹园3号楼南楼'},
  {root:'buildings:f873a346f9ac588fcb88',members:['buildings:838f69cbcb84b6bed2b2'],name:'梅园6号楼北楼'},
  {root:'buildings:c1a62d3431a6223b40f3',members:['buildings:8c3f21b9a8bd43f5dbc2'],name:'兰园6号楼北楼'},
  {root:'buildings:7612d4df140331fe641e',members:['buildings:b910aecdb252a70a2f2b'],name:'竹园1号楼北楼'},
  {root:'buildings:2f2c84cadd1be3b196b5',members:['buildings:eea2b80f62a4d82b2c84'],name:'笃学楼（C 座）'},
  {root:'buildings:2ac3ae0f3c8f8ebc9052',members:['buildings:c00db434039442f40ee9','buildings:6a708aca8b5af56df102'],name:'知行楼（L 座）'},
  {root:'buildings:f7a2270ee46df0ba726d',members:['buildings:98dbf7bc6177f74fdc1a'],name:'教师公寓'},
  {root:'buildings:74615b51f5c15bf29cfb',members:['buildings:6bb493b4ad7b9e6c17dd'],name:'校医院'},
  {root:'buildings:52e6ff3e2b5b8b9f18f3',members:['buildings:055f5d204709af39f70a','buildings:4ca22c55f914092b4e65'],name:'A区1号楼'},
  {root:'buildings:2d7a6c32c34801f6495e',members:['buildings:73c56e34242855f03fa1','buildings:850755baf9695c35d6f0','buildings:6641d080d2168893daa4'],name:'A区4号楼'},
  {root:'buildings:bd660fec95c437579797',members:['buildings:5d86f812d7a6e3691a5c'],name:'D区7号楼南楼'},
  {root:'buildings:01f4781169cdebc320a0',members:['buildings:9368c406b93d9280ed6b'],name:'D区4号楼北楼'},
  {root:'buildings:0644ef53eafa507aa16b',members:['buildings:7371e64fc4bf9ae493c7'],name:'菊园3号楼南楼'},
  {root:'buildings:77515d231f35cf949244',members:['buildings:62cb4835dfd1bc3dc02c'],name:'菊园2号楼北楼'},
  {root:'buildings:41e976045d6ae2f14056',members:['buildings:61a517f42a95ddd995f8','buildings:6ec99a0af367bfd980f4'],name:'D区3号楼'},
  {root:'buildings:c4413d5a7dda1c0312d4',members:['buildings:140282bbc730b1777d14','buildings:ada881d96d2ef1f43ca8'],name:'D区2号楼'},
] as const;
export const roofGroupFor=(id:string)=>PLAN_ROOF_GROUPS.find(g=>g.root===id||g.members.some(m=>m===id));
export const planDisplayId=(id:string)=>roofGroupFor(id)?.root??id;

const key=(suffix:string)=>`buildings:${suffix}`;
const trace=(pixels:LocalPoint[],rectilinear=false):Polygon=>{
  const registered=pixels.map(globalRasterToLocal);
  const ring=rectilinear?orthogonalizeRing(registered,RESIDENTIAL_WALL_ANGLE,3):registered;
  return {type:'Polygon',coordinates:[[...ring,ring[0]!]]};
};
// White-roof traces, NOT displaced old GIS rectangles. Observable gaps stay.
const capTraces:Record<string,Polygon>={
  [key('5406aa5430d00212d9e7')]:trace([[1342,4378],[1380,4378],[1380,4410],[1342,4410]],true),
  [key('b795fc43df83ff863ac7')]:trace([[1877,3528],[1914,3528],[1914,3558],[1886,3558],[1886,3590],[1877,3590]]),
  [key('73bcd79a72a4bcf7af29')]:trace([[1280,3294],[1319,3294],[1319,3322],[1280,3322]],true),
};
const wholeTraces:Record<string,Polygon>={
  [key('4b4e002af6e98d730dd3')]:trace([[1901,3771],[2070,3771],[2070,3811],[1934,3813],[1934,3851],[1898,3851],[1898,3813]],true),
  [key('f873a346f9ac588fcb88')]:trace([[4135,4220],[4310,4220],[4310,4228],[4318,4228],[4318,4304],[4278,4304],[4278,4273],[4307,4273],[4307,4263],[4135,4263]]),
  // D4 north's missing long white bar must not be absorbed into neighboring D6.
  [key('01f4781169cdebc320a0')]:trace([[4087,2173],[4388,2168],[4388,2159],[4461,2159],[4461,2212],[4087,2222]]),
  // D2 east return, excluding the courtyard and the adjacent D3 west body.
  [key('c4413d5a7dda1c0312d4')]:trace([[3582,1943],[3803,1943],[3803,1938],[3840,1938],[3842,2115],[3834,2126],[3650,2126],[3650,2077],[3803,2077],[3803,1995],[3582,1995]]),
};
const masterOnly=new Set([
  key('c1a62d3431a6223b40f3'),key('7612d4df140331fe641e'),
  key('2f2c84cadd1be3b196b5'),key('2ac3ae0f3c8f8ebc9052'),
]);
function registeredRoof(id:string):Polygon|MultiPolygon {
  const geometry=capTraces[id]??TEACHING_PLAN_GEOMETRIES.find(p=>p.id===id)?.geometry??residentialPlanFor(id)?.geometry??academicPlanFor(id)?.geometry;
  if(!geometry)throw Error(`Missing registered schematic roof: ${id}`);
  return geometry;
}
const cache=new Map<string,Polygon|MultiPolygon>();
export function roofGroupGeometry(id:string):Polygon|MultiPolygon|undefined {
  const group=roofGroupFor(id);if(!group)return undefined;
  const cached=cache.get(group.root);if(cached)return cached;
  let local:Polygon|MultiPolygon|undefined=wholeTraces[group.root];
  // Shared white junction with D6: one painted roof surface, no doubled area.
  // This partitions the drawing only; it does not establish a legal boundary.
  if(group.root===key('01f4781169cdebc320a0'))
    local=difference(featureCollection([feature(local!),feature(registeredRoof(key('dcea1c9614744dcfce1d')))]))?.geometry;
  if(!local){
    const parts:(Polygon|MultiPolygon)[]=[registeredRoof(group.root)];
    if(group.root===key('f7a2270ee46df0ba726d'))parts.push(trace([[752,2684],[773,2684],[774,2700],[763,2700],[763,2735],[752,2735]]));
    else if(!masterOnly.has(group.root))parts.push(...group.members.map(registeredRoof));
    local=parts.length===1?parts[0]:union(featureCollection(parts.map(p=>feature(p))))?.geometry;
    if(!local)throw Error(`Empty schematic roof group: ${group.root}`);
  }
  const project=(poly:Polygon['coordinates'])=>poly.map(ring=>ring.map(p=>coordinates.localToWgs84([p[0]!,p[1]!])));
  const projected:Polygon|MultiPolygon=local.type==='Polygon'?{type:'Polygon',coordinates:project(local.coordinates)}
    :{type:'MultiPolygon',coordinates:local.coordinates.map(project)};
  cache.set(group.root,projected);return projected;
}
