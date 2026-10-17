import { area, bboxPolygon, booleanPointInPolygon, buffer, distance, featureCollection, intersect, lineString,
  nearestPoint, point, polygon } from '@turf/turf';
import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson';
import { coordinates } from '../coordinate/CampusCoordinateService';
import type { CampusFeature } from '../../types/CampusFeature';
import type { LngLat,NearestCategory } from './AnalysisTypes';

export function validPoint(value:readonly number[]):value is LngLat {
  return value.length>=2&&Number.isFinite(value[0])&&Number.isFinite(value[1])&&
    value[0]>=-180&&value[0]<=180&&value[1]>=-85&&value[1]<=85;
}
export function requirePoints(points:LngLat[],minimum:number){
  if(points.length<minimum||points.some(p=>!validPoint(p)))throw Error(`至少需要 ${minimum} 个有效坐标点`);
}
export function closedRing(points:LngLat[]):LngLat[]{
  requirePoints(points,3);
  const ring=points.map(p=>[...p] as LngLat),first=ring[0],last=ring[ring.length-1];
  if(first[0]!==last[0]||first[1]!==last[1])ring.push([...first]);
  return ring;
}
export function planarDistanceXY(points:readonly (readonly [number,number])[]):number {
  let length=0;for(let i=1;i<points.length;i++)length+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
  return length;
}
export function planarAreaXY(ring:readonly (readonly [number,number])[]):number {
  if(ring.length<3)return 0;let sum=0;
  for(let i=0;i<ring.length;i++){const next=ring[(i+1)%ring.length];sum+=ring[i][0]*next[1]-next[0]*ring[i][1];}
  return Math.abs(sum)/2;
}
export function planarAreaWgs84(geometry:Polygon|MultiPolygon):number {
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.reduce((total,rings)=>total+rings.reduce((part,ring,index)=>{
    const value=planarAreaXY(ring.map(p=>coordinates.wgs84ToUtm(p as LngLat)));
    return part+(index===0?value:-value);
  },0),0);
}
export function coordinatePick(location:LngLat){
  if(!validPoint(location))throw Error('坐标无效');
  return {wgs84:[...location] as LngLat,utm:coordinates.wgs84ToUtm(location),local:coordinates.wgs84ToLocal(location)};
}
export function measureDistance(points:LngLat[]){
  requirePoints(points,2);
  const turfMeters=points.slice(1).reduce((sum,next,i)=>sum+distance(point(points[i]),point(next),{units:'meters'}),0);
  const utmMeters=planarDistanceXY(points.map(p=>coordinates.wgs84ToUtm(p)));
  return {turfMeters,utmMeters,differenceMeters:Math.abs(turfMeters-utmMeters),geometry:lineString(points)};
}
export function measureArea(points:LngLat[]){
  const ring=closedRing(points),geometry=polygon([ring]);
  const turfSquareMeters=area(geometry),utmSquareMeters=planarAreaWgs84(geometry.geometry);
  return {turfSquareMeters,utmSquareMeters,differenceSquareMeters:Math.abs(turfSquareMeters-utmSquareMeters),
    relativeDifferencePercent:utmSquareMeters?Math.abs(turfSquareMeters-utmSquareMeters)/utmSquareMeters*100:0,geometry};
}
export function makeBuffer(source:Feature<Geometry>,radiusMeters:number){
  if(!Number.isFinite(radiusMeters)||radiusMeters<=0||radiusMeters>5000)throw Error('缓冲半径须在 0–5000 米之间');
  if(!source.geometry||!['Point','Polygon','MultiPolygon'].includes(source.geometry.type))throw Error('仅支持点或面要素缓冲');
  const result=buffer(source,radiusMeters,{units:'meters',steps:32});
  if(!result||!['Polygon','MultiPolygon'].includes(result.geometry.type))throw Error('缓冲区计算失败');
  return result as Feature<Polygon|MultiPolygon>;
}
export function pointInside(location:LngLat,target:Feature<Polygon|MultiPolygon>){
  if(!validPoint(location))throw Error('坐标无效');
  return booleanPointInPolygon(point(location),target);
}
export function representative(feature:CampusFeature):LngLat {return feature.centroid;}
export function featuresInside(bufferPolygon:Feature<Polygon|MultiPolygon>,features:CampusFeature[]){
  return features.filter(feature=>validPoint(representative(feature))&&pointInside(representative(feature),bufferPolygon));
}
export function nearestFeature(location:LngLat,features:CampusFeature[],category:NearestCategory){
  if(!validPoint(location))throw Error('坐标无效');
  const filtered=features.filter(feature=>{
    if(category==='all')return true;if(category==='poi')return feature.gisBindings.some(b=>b.source==='campus-poi');
    return feature.category===category;
  }).filter(feature=>validPoint(representative(feature)));
  if(!filtered.length)throw Error('此分类没有可查找的要素');
  const collection=featureCollection(filtered.map(feature=>point(representative(feature),{id:feature.id})));
  const closest=nearestPoint(point(location),collection);
  const feature=filtered.find(item=>item.id===closest.properties?.id)!;
  return {feature,distanceMeters:distance(point(location),point(representative(feature)),{units:'meters'}),
    line:lineString([location,representative(feature)])};
}
export function queryBBox(cornerA:LngLat,cornerB:LngLat,features:CampusFeature[]){
  if(!validPoint(cornerA)||!validPoint(cornerB))throw Error('范围角点无效');
  const bounds:[number,number,number,number]=[Math.min(cornerA[0],cornerB[0]),Math.min(cornerA[1],cornerB[1]),
    Math.max(cornerA[0],cornerB[0]),Math.max(cornerA[1],cornerB[1])];
  if(bounds[0]===bounds[2]||bounds[1]===bounds[3])throw Error('范围宽度和高度必须大于零');
  const polygon=bboxPolygon(bounds);
  return {geometry:polygon,features:features.filter(feature=>validPoint(representative(feature))&&
    pointInside(representative(feature),polygon))};
}
export function polygonIntersection(a:Feature<Polygon|MultiPolygon>,b:Feature<Polygon|MultiPolygon>){
  const result=intersect(featureCollection([a,b]));
  if(!result)return {intersects:false,geometry:null,turfSquareMeters:0,utmSquareMeters:0};
  const geometry=result as Feature<Polygon|MultiPolygon>;
  return {intersects:true,geometry,turfSquareMeters:area(geometry),utmSquareMeters:planarAreaWgs84(geometry.geometry)};
}
