import type {Polygon} from 'geojson';
import {CAMPUS_ORIGIN,coordinates} from '../coordinate/CampusCoordinateService';
import {orthogonalizeRing,sharedRectilinearAngle,type LocalPoint} from './RectilinearGeometry';
import type {CampusFeature} from '../../types/CampusFeature';
import {RESIDENTIAL_TRACES_V004,type ResidentialTrace} from './CampusResidentialBatchV004';

/** Reviewed white building bodies, not shadows, roads, stairs or enclosing parcels.
 * North/south IDs remain independent. No implied whole-building ownership/height.
 */
export const RESIDENTIAL_PLAN_PROVENANCE={
  version:'v004',sourceFile:'campus_georef.tif',cropOrigin:[700,3600],
  pixelScale:0.35858544812789306,tiePoint:[635954.8830563505,4341918.878195945],
  status:'APPROXIMATE_DISPLAY_ONLY',fit:'SHARED_RASTER_GEOREFERENCE_NO_BUILDING_FIT',
  heightStatus:'SOURCE_ROUGH_MODEL_NOT_SURVEYED',maxDisplacementMeters:3,
  nameStatus:'USER_PLAN_LABEL_NOT_OFFICIAL_NAME_VERIFICATION',
} as const;
export function residentialRasterToLocal([x,y]:LocalPoint):LocalPoint{
  const p=RESIDENTIAL_PLAN_PROVENANCE;
  return [p.tiePoint[0]+(p.cropOrigin[0]+x)*p.pixelScale-CAMPUS_ORIGIN[0],
    p.tiePoint[1]-(p.cropOrigin[1]+y)*p.pixelScale-CAMPUS_ORIGIN[1]];
}
const traces:ResidentialTrace[]=[
  {id:'buildings:e0efafd2ba8a8ff80c98',sourceLabel:'建筑 060',planLabel:'兰园4号楼北楼',pair:'orchid-04',trace:
    [[626,430],[805,423],[806,466],[794,466],[795,508],[777,509],[776,467],[674,471],[674,515],[629,516]]},
  {id:'buildings:5c8c799c7e2e669a5957',sourceLabel:'建筑 061',planLabel:'兰园4号楼南楼',pair:'orchid-04',trace:
    [[636,568],[769,563],[767,521],[815,519],[817,601],[637,607]]},
  {id:'buildings:1bfc41f2bdc3b32069b5',sourceLabel:'建筑 045',planLabel:'兰园3号楼北楼',pair:'orchid-03',trace:
    [[951,420],[1124,414],[1125,497],[1083,499],[1083,465],[987,468],[991,519],[957,521]]},
  {id:'buildings:c5098332f3dd16729126',sourceLabel:'建筑 020',planLabel:'兰园3号楼南楼',pair:'orchid-03',trace:
    [[956,522],[1006,521],[1007,561],[1134,559],[1135,605],[960,613]]},
  // Adjacent independent source 047 is NOT assigned to this north building.
  {id:'buildings:4b4e002af6e98d730dd3',sourceLabel:'建筑 049',planLabel:'兰园1号楼北楼',pair:'orchid-01',trace:
    [[1201,171],[1370,171],[1370,211],[1201,215]]},
  {id:'buildings:59cf707ba187558ee74e',sourceLabel:'建筑 048',planLabel:'兰园1号楼南楼',pair:'orchid-01',trace:
    [[1208,310],[1336,310],[1334,258],[1380,256],[1382,347],[1210,353]]},
];
export const RESIDENTIAL_WALL_ANGLE=sharedRectilinearAngle(traces.map(t=>t.trace.map(residentialRasterToLocal)));
// Freeze the first-batch frame: adding bodies must not move previously reviewed geometry.
const nextTraces:typeof traces=[
  {id:'buildings:ddb0086eed4e96258c6b',sourceLabel:'建筑 043',planLabel:'兰园2号楼北楼',pair:'orchid-02',trace:
    [[1225,455],[1393,451],[1396,538],[1356,540],[1354,497],[1226,501]]},
  // Adjacent source 022 is not joined to the south bar; its ownership remains unverified.
  {id:'buildings:4134dddc73d0db640367',sourceLabel:'建筑 023',planLabel:'兰园2号楼南楼',pair:'orchid-02',trace:
    [[1230,600],[1403,595],[1404,637],[1232,642]]},
  // Only the source bar, not the adjacent detached block or connecting leg.
  {id:'buildings:d1d687fd615e19da64ed',sourceLabel:'建筑 016',planLabel:'兰园5号楼北楼',pair:'orchid-05-north-source',trace:
    [[648,727],[824,721],[825,763],[649,769]]},
  {id:'buildings:ba3556de74bdf2cf888e',sourceLabel:'建筑 018',planLabel:'兰园7号楼',pair:'orchid-07-source',trace:
    [[375,729],[576,723],[577,765],[377,771]]},
];
const thirdTraces:ResidentialTrace[]=[
  {id:'buildings:05b4609106667404300c',sourceLabel:'建筑 015',planLabel:'兰园5号楼中楼',pair:'orchid-05-middle-source',trace:
    [[647,864],[789,861],[787,815],[831,814],[832,900],[810,901],[810,905],[649,909]]},
  // The schematic's slanted south boundary is intentional, not a digitizing error.
  // Leave the apparent north connector outside this source body: no inferred clearance/height.
  {id:'buildings:d207671023630541fee7',sourceLabel:'建筑 014',planLabel:'兰园5号楼南楼',pair:'orchid-05-south-source',
    wallPolicy:'TRACED_NON_RECTILINEAR',trace:
    [[647,958],[693,958],[693,1005],[678,1005],[678,1015],[785,1030],[785,955],[833,955],[833,1066],[838,1066],[838,1088],[654,1064],[654,1036],[647,1036]]},
  // Trace only the external white building body; internal roof seams are not footprint gaps.
  {id:'buildings:b1a16e4a0a003281a758',sourceLabel:'建筑 021',planLabel:'兰园食堂',pair:'orchid-canteen-source',trace:
    [[1171,768],[1242,768],[1242,777],[1354,775],[1355,795],[1388,795],[1394,976],[1380,976],[1380,990],[1319,991],[1319,985],[1179,989]]},
];
export const RESIDENTIAL_PLAN_GEOMETRIES=[...traces,...nextTraces,...thirdTraces,...RESIDENTIAL_TRACES_V004].map((t,i)=>{
  const registered=t.trace.map(residentialRasterToLocal);
  const wallPolicy=t.wallPolicy??'SHARED_RECTILINEAR_FRAME';
  const ring=wallPolicy==='TRACED_NON_RECTILINEAR'?registered:
    orthogonalizeRing(registered,RESIDENTIAL_WALL_ANGLE,RESIDENTIAL_PLAN_PROVENANCE.maxDisplacementMeters);
  return {...t,wallPolicy,batchVersion:i<traces.length?'v001':i<traces.length+nextTraces.length?'v002':i<traces.length+nextTraces.length+thirdTraces.length?'v003':'v004',registered,geometry:{type:'Polygon',coordinates:[[...ring,[...ring[0]!]]]} as Polygon,
    maxRegularizationMeters:Math.max(...ring.map((p,i)=>Math.hypot(p[0]-registered[i]![0],p[1]-registered[i]![1])))};
});
export const residentialPlanFor=(id:string)=>RESIDENTIAL_PLAN_GEOMETRIES.find(r=>r.id===id);
export function residentialToWgs84(geometry:Polygon):Polygon{
  return {type:'Polygon',coordinates:geometry.coordinates.map(r=>r.map(p=>coordinates.localToWgs84([p[0]!,p[1]!])))};
}
/** Search aliases only: API name, source geometry/area/height and business ID remain authoritative. */
export function residentialPresentation(feature:CampusFeature):CampusFeature{
  const ref=feature.category==='building'?residentialPlanFor(feature.id):undefined;
  if(!ref)return feature;
  return {...feature,aliases:[...new Set([...feature.aliases,ref.planLabel])],
    properties:{...feature.properties,planLabel:ref.planLabel,planLabelStatus:RESIDENTIAL_PLAN_PROVENANCE.nameStatus}};
}
