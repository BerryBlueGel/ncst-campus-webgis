import type {Polygon,MultiPolygon} from 'geojson';
import {feature,featureCollection,union} from '@turf/turf';
import {RESIDENTIAL_PLAN_GEOMETRIES,residentialRasterToLocal,residentialToWgs84} from './CampusResidentialPlan';
import {REMAINING_PLAN_GEOMETRIES} from './CampusRemainingPlan';
import {roofGroupFor,roofGroupGeometry} from '../layers/CampusPlanRoofGroups';
import {dormitoryShapeCorrection} from './CampusDormitoryShapeReview';
import {coordinates} from '../coordinate/CampusCoordinateService';

type Rect=[number,number,number,number];
/** Individually located white connecting roofs in the registered TIFF. The user
 * confirms compound connectivity; the supplied panorama shows lower connectors.
 * 6.2 m / two levels is illustrative, not an individual elevation survey.
 * Lan7 is a standalone bar, not forced into a paired template.
 */
const rows:[string,number,Rect[],boolean?][]=[
  ['兰园',1,[[2063,3806,2082,3863]]],
  ['兰园',2,[[1925,4095,1957,4166],[1922,4192,1940,4205]]],
  ['兰园',3,[[1652,4064,1694,4126]]],
  ['兰园',4,[[1475,4063,1500,4126]]],
  ['兰园',5,[[1500,4358,1529,4420],[1343,4502,1371,4564],[1344,4364,1366,4398]],true],
  ['兰园',6,[[1070,4112,1100,4175]]],
  ['竹园',1,[[2020,3170,2044,3230]]],
  ['竹园',2,[[2028,3506,2064,3568],[1880,3554,1902,3568]]],
  ['竹园',3,[[1430,3277,1465,3343],[1286,3317,1308,3343]]],
  ['竹园',4,[[1018,3194,1050,3255]]],
  ['竹园',5,[[1040,3544,1070,3604]]],
  ['菊园',1,[[3603,3376,3637,3437]]],
  ['菊园',2,[[3603,3031,3639,3091],[3776,3030,3789,3048]]],
  ['菊园',3,[[4001,3116,4035,3182],[3851,3164,3864,3202]]],
  ['菊园',4,[[4131,3237,4160,3299]]],
  ['菊园',5,[[4127,2950,4156,3011]]],
  ['菊园',6,[[4122,2604,4155,2666]]],
  ['梅园',1,[[3604,3790,3638,3853]]],
  ['梅园',2,[[3613,4129,3647,4190]]],
  ['梅园',3,[[4009,3789,4036,3850]]],
  ['梅园',4,[[4007,4129,4038,4191]]],
  ['梅园',5,[[4132,4010,4166,4075]]],
  ['梅园',6,[[4134,4260,4166,4323],[4287,4402,4317,4468]],true],
  ['梅园',7,[[4490,3966,4520,4030]]],
  ['梅园',8,[[4490,4344,4523,4408]]],
];
const plans=[...RESIDENTIAL_PLAN_GEOMETRIES,...REMAINING_PLAN_GEOMETRIES];
const body=(name:string)=>{const p=plans.find(r=>r.planLabel===name);if(!p)throw Error('Missing exact dormitory label '+name);return p;};
export const DORMITORY_COMPOUNDS=rows.map(([district,number,rects,triple])=>{
  const name=`${district}${number}号楼`;
  const bodies=[body(name+'北楼'),...(triple?[body(name+'中楼')]:[]),body(name+'南楼')];
  const ids=[...new Set(bodies.flatMap(b=>[b.id,...(roofGroupFor(b.id)?.members??[])]))];
  const connections=rects.map(([x0,y0,x1,y1],i)=>{
    const pixels=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]] as [number,number][];
    const ring=pixels.map(([x,y])=>residentialRasterToLocal([x-700,y-3600]));
    return {key:`${district}-${number}-${i+1}`,pixels,geometry:{type:'Polygon',coordinates:[[...ring,[...ring[0]!]]]} as Polygon,
      heightMeters:6.2,storeys:2,heightStatus:'PANORAMA_TYPE_ESTIMATE_NOT_SURVEYED'};
  });
  return {name,district,number,root:bodies[0]!.id,members:ids.filter(id=>id!==bodies[0]!.id),bodyIds:bodies.map(b=>b.id),connections};
});
export const dormitoryCompoundFor=(id:string)=>DORMITORY_COMPOUNDS.find(g=>g.root===id||g.members.includes(id));
const cache=new Map<string,Polygon|MultiPolygon>();
export function dormitoryCompoundGeometry(id:string):Polygon|MultiPolygon|undefined{
  const group=dormitoryCompoundFor(id);if(!group)return;
  if(cache.has(group.root))return cache.get(group.root);
  const bodies=group.bodyIds.map(id=>{
    const correction=dormitoryShapeCorrection(id);
    const p=plans.find(r=>r.id===id)!;
    const local=correction?.geometry??p.geometry;
    const project=(poly:Polygon['coordinates'])=>poly.map(r=>r.map(([x,y])=>coordinates.localToWgs84([x!,y!])));
    return roofGroupGeometry(id)??(local.type==='Polygon'?residentialToWgs84(local):{type:'MultiPolygon',coordinates:local.coordinates.map(project)} as MultiPolygon);
  });
  const result=union(featureCollection([...bodies,...group.connections.map(c=>residentialToWgs84(c.geometry))].map(g=>feature(g))));
  if(!result)throw Error('Empty compound '+group.name);
  cache.set(group.root,result.geometry);return result.geometry;
}
