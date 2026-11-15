import type { Polygon, FeatureCollection } from 'geojson';
import { coordinates, CAMPUS_ORIGIN } from '../coordinate/CampusCoordinateService';
import { TEACHING_BUILDINGS } from './TeachingBuildingPresentation';
import { sharedRectilinearAngle, orthogonalizeRing } from './RectilinearGeometry';

type Point = [number,number];
type Bounds = [number,number,number,number];
/** Hand-traced schematic pixels, NOT survey/as-built geometry. All buildings and
 * connections use ONE raster georeference: no per-building scale or translation.
 * Authoritative GIS geometry/areas remain unchanged.
 */
export const TEACHING_PLAN_PROVENANCE = {
  sourceFile:'campus_georef.tif',
  source:'USER_SUPPLIED_GEOREFERENCED_SCHEMATIC',status:'APPROXIMATE_DISPLAY_ONLY',
  cropOrigin:[2300,3020],pixelScale:0.35858544812789306,
  tiePoint:[635954.8830563505,4341918.878195945],heightStatus:'SOURCE_ROUGH_MODEL_NOT_SURVEYED',
  version:'v004',fit:'SHARED_RASTER_GEOREFERENCE_NO_BUILDING_FIT',
  regularization:'REVIEWED_SHARED_ORTHOGONAL_FRAME',maxDisplacementMeters:3,
} as const;
const TRACES:{bounds:Bounds;rings:Point[][]}[]=[
  {bounds:[848.465302926721,1015.7102862177417,951.5350063783117,1086.0434544924647],rings:[
    [[133,111],[389,103],[389,156],[367,157],[366,201],[429,202],[429,302],[182,307],[180,247],[182,219],[135,221]],
    [[194,153],[316,150],[318,243],[194,244]]]},
  {bounds:[1020.9179502595216,1017.3147123055533,1121.9929563895566,1090.4124503079802],rings:[
    [[667,94],[913,86],[913,140],[866,141],[870,288],[625,294],[625,196],[688,194],[687,149],[667,149]],
    [[735,143],[858,143],[858,251],[735,251]]]},
  {bounds:[873.9749433838297,915.2503655897453,953.6358659067191,983.7372444039211],rings:[
    [[184,395],[434,386],[432,571],[211,577],[208,520],[233,519],[233,451],[186,455]],
    [[248,450],[390,446],[389,473],[373,475],[374,494],[389,494],[389,516],[248,519]]]},
  {bounds:[1021.9540143489139,919.7882570000365,1102.4264025181765,985.2130232350901],rings:[
    [[624,384],[873,374],[873,429],[824,432],[823,505],[849,506],[847,560],[626,564]],
    [[665,438],[812,435],[812,507],[666,510],[666,480],[681,480],[681,463],[665,463]]]},
  {bounds:[867.2068193963496,803.6317211957648,955.0258378301514,871.2706816215068],rings:[
    [[214,699],[437,696],[436,875],[201,881],[199,826],[240,825],[240,757],[214,758]],
    [[255,757],[393,754],[393,779],[378,779],[378,798],[393,798],[394,823],[255,825]]]},
  {bounds:[1024.0103802932426,806.7303998144343,1107.7771522518015,873.92388952896],rings:[
    [[627,691],[848,682],[848,742],[823,742],[823,807],[874,806],[873,862],[627,870]],
    [[667,744],[812,741],[812,808],[667,816],[667,793],[682,792],[683,775],[667,776]]]},
  {bounds:[853.2536823559785,696.9821528922766,954.724722315208,773.0197397721931],rings:[
    [[170,969],[442,956],[443,1163],[254,1168],[254,1155],[223,1156],[223,1140],[254,1138],[254,1123],[407,1118],[408,1019],[171,1025]]]},
  {bounds:[1024.0534172364278,699.0619210815057,1125.7342378505273,775.6406705491245],rings:[
    [[630,955],[914,944],[915,1015],[670,1016],[670,1090],[827,1088],[829,1114],[861,1113],[861,1130],[831,1132],[831,1153],[630,1160]]]},
];
function fitted(index:number,p:Point):Point {
  const trace=TRACES[index]!,outer=trace.rings[0]!;
  const xs=outer.map(v=>v[0]),ys=outer.map(v=>v[1]);
  const [w,s,e,n]=trace.bounds,xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
  return [w+(p[0]-xmin)/(xmax-xmin)*(e-w),n-(p[1]-ymin)/(ymax-ymin)*(n-s)];
}
export function teachingRasterToLocal([x,y]:readonly [number,number]):Point {
  const p=TEACHING_PLAN_PROVENANCE;
  return [p.tiePoint[0]+(p.cropOrigin[0]+x)*p.pixelScale-CAMPUS_ORIGIN[0],
    p.tiePoint[1]-(p.cropOrigin[1]+y)*p.pixelScale-CAMPUS_ORIGIN[1]];
}
const closed=(ring:Point[])=>[...ring.map(p=>[...p] as Point),[...ring[0]!] as Point];
/** Only for auditing the preserved v001 file. Never used to render the current preview. */
export function legacyFittedTeachingGeometry(index:number):Polygon {
  return {type:'Polygon',coordinates:TRACES[index]!.rings.map(r=>closed(r.map(p=>fitted(index,p))))};
}
export function teachingGeometryBounds(geometry:Polygon):Bounds {
  const outer=geometry.coordinates[0]!;
  return [Math.min(...outer.map(p=>p[0]!)),Math.min(...outer.map(p=>p[1]!)),
    Math.max(...outer.map(p=>p[0]!)),Math.max(...outer.map(p=>p[1]!))];
}
/** Preserved v002/v003 shared registration, before straight-wall regularization. */
export function registeredTeachingGeometry(index:number):Polygon {
  return {type:'Polygon',coordinates:TRACES[index]!.rings.map(r=>closed(r.map(teachingRasterToLocal)))};
}
const registeredRings=TRACES.flatMap(t=>t.rings.map(r=>r.map(teachingRasterToLocal)));
export const TEACHING_WALL_FRAME={angleRadians:sharedRectilinearAngle(registeredRings),source:'REVIEWED_EIGHT_BUILDING_TRACES'} as const;
export const TEACHING_PLAN_GEOMETRIES=TEACHING_BUILDINGS.map((ref,i)=>({
  id:ref.id,name:ref.name,sourceBounds:[...TRACES[i]!.bounds] as Bounds,
  geometry:{type:'Polygon',coordinates:TRACES[i]!.rings.map(r=>closed(orthogonalizeRing(r.map(teachingRasterToLocal),TEACHING_WALL_FRAME.angleRadians,TEACHING_PLAN_PROVENANCE.maxDisplacementMeters)))} as Polygon,
  trace:TRACES[i]!.rings,
}));
function connector(a:number,b:number,x0:number,x1:number) {
  const boundaryY=(ring:number[][],x:number,south:boolean)=>{
    const hits:number[]=[];
    for(let i=0;i<ring.length-1;i++){
      const p=ring[i]!,q=ring[i+1]!;
      if(p[0]!==q[0]&&x>=Math.min(p[0],q[0])&&x<=Math.max(p[0],q[0]))hits.push(p[1]+(x-p[0])/(q[0]-p[0])*(q[1]-p[1]));
    }
    if(!hits.length)throw Error('Connection outside traced building');
    return south?Math.max(...hits):Math.min(...hits);
  };
  const upper=TEACHING_PLAN_GEOMETRIES[a]!.geometry.coordinates[0]!,lower=TEACHING_PLAN_GEOMETRIES[b]!.geometry.coordinates[0]!;
  const west=teachingRasterToLocal([x0,0])[0],east=teachingRasterToLocal([x1,0])[0];
  const p:Point=[west,boundaryY(upper,west,false)],q:Point=[east,boundaryY(upper,east,false)],
    r:Point=[east,boundaryY(lower,east,true)],s:Point=[west,boundaryY(lower,west,true)];
  p[1]+=0.2;q[1]+=0.2;r[1]-=0.2;s[1]-=0.2;
  return {id:`plan-connection-${a}-${b}`,owners:[TEACHING_BUILDINGS[a]!.id,TEACHING_BUILDINGS[b]!.id],geometry:{type:'Polygon',coordinates:[closed([p,q,r,s])]} as Polygon};
}
/** Separate schematic connections, no business-ID union and no analytical feature. */
export const TEACHING_PLAN_CONNECTIONS=[connector(2,4,392,409),connector(3,5,649,666)];
export const TEACHING_PART_IDS=TEACHING_BUILDINGS.flatMap(ref=>[...(ref.nearbyParts??[])]);
export function planToWgs84(geometry:Polygon):Polygon {
  return {type:'Polygon',coordinates:geometry.coordinates.map(r=>r.map(p=>coordinates.localToWgs84([p[0]!,p[1]!])))};
}
export function planConnectionsCollection():FeatureCollection {
  return {type:'FeatureCollection',features:TEACHING_PLAN_CONNECTIONS.map(c=>({type:'Feature',id:c.id,properties:{status:'APPROXIMATE_DISPLAY_ONLY',kind:'schematic-connection',representation:'SCHEMATIC_GROUND_MARKER_NOT_BUILDING'},geometry:planToWgs84(c.geometry)}))};
}
