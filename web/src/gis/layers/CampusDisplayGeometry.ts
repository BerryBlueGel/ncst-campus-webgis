import { featureCollection, polygon, union, bbox, feature as turfFeature } from '@turf/turf';
import type { CampusFeature } from '../../types/CampusFeature';
import type { FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import { coordinates } from '../coordinate/CampusCoordinateService';
import { TEACHING_PLAN_GEOMETRIES, TEACHING_PLAN_CONNECTIONS, TEACHING_PART_IDS, planToWgs84, planConnectionsCollection } from '../features/TeachingPlanGeometry';
import { residentialPlanFor, residentialToWgs84 } from '../features/CampusResidentialPlan';
import { academicPlanFor, academicToWgs84 } from '../features/CampusAcademicPlan';
import { suppressedInPlanPreview } from '../features/CampusPlanDispositions';
import {reviewedDisplayGroup as roofGroupFor,reviewedDisplayGeometry as roofGroupGeometry,reviewedDisplayId as planDisplayId} from './CampusCompoundDisplay';
import {dormitoryShapeCorrection} from '../features/CampusDormitoryShapeReview';
import {DORM_SHAPE_REVIEW_ENABLED,DORM_COMPOUND_PRESENTATION_ENABLED as DORM_COMPOUND_REVIEW_ENABLED} from '../three/CampusDetailReview';

export const AUDITORIUM_SOURCE_ID = 'buildings:29c44087930555db18c9';
export const CAMPUS_BASEMAP_MASK = 'campus-basemap-mask';
export const CAMPUS_SURFACE_COLOR = '#edf7fd';

/** Presentation only: dimensions verified against the named v005 GLB meshes.
 * Includes the platform, canopy, entrance wings, stairs and ramps, not a survey footprint.
 * Keep repository geometry, stable IDs, statistics and PostGIS analysis untouched.
 */
export function auditoriumDisplayGeometry(): Polygon | MultiPolygon {
  const [east, north] = [981.0432739257812, 1212];
  const ellipse: Position[] = Array.from({length:64}, (_, i) => {
    const angle = i * Math.PI * 2 / 64;
    return [east + 44.5 * Math.cos(angle), north + 49 * Math.sin(angle)];
  });
  ellipse.push([...ellipse[0]!]);
  const rectangle = (west:number, eastOffset:number, south:number, northOffset:number) => polygon([[
    [east+west,north+south], [east+eastOffset,north+south],
    [east+eastOffset,north+northOffset], [east+west,north+northOffset], [east+west,north+south],
  ]]);
  const result = union(featureCollection([
    polygon([ellipse]),
    rectangle(-29.5,29.5,-49,-38), // AUD_Entrance_Canopy
    rectangle(-43,-25,-55,-34), rectangle(25,43,-55,-34), // AUD_Wing_L/R
    rectangle(-27,27,-79,-48.88), // Twelve overlapping stair treads
    rectangle(-37,-29,-79,-44), rectangle(29,37,-79,-44), // AUD_Ramp_L/R
  ]));
  if (!result) throw Error('Empty auditorium presentation outline');
  const rings = result.geometry.type === 'Polygon' ? [result.geometry.coordinates] : result.geometry.coordinates;
  const projected = rings.map(poly => poly.map(ring => ring.map(point => coordinates.localToWgs84([point[0]!,point[1]!]))));
  return result.geometry.type === 'Polygon'
    ? {type:'Polygon',coordinates:projected[0]!}
    : {type:'MultiPolygon',coordinates:projected};
}

export function displayCollection(layerId:string, data:FeatureCollection, teachingPreview=false, includeSourceFragments=false):FeatureCollection {
  if (layerId !== 'buildings') return data;
  const original=data.features.map(feature => String(feature.id) === AUDITORIUM_SOURCE_ID
    ? {...feature, geometry:auditoriumDisplayGeometry()}
    : feature);
  if(!teachingPreview)return {...data,features:original};
  const existing=new Set(data.features.map(f=>String(f.id)));
  const features=original.filter(f=>(includeSourceFragments||!TEACHING_PART_IDS.includes(String(f.id))||
    (roofGroupFor(String(f.id))&&!existing.has(planDisplayId(String(f.id)))))&&!suppressedInPlanPreview(String(f.id))&&
    (planDisplayId(String(f.id))===String(f.id)||!existing.has(planDisplayId(String(f.id))))).map(f=>{
    const plan=TEACHING_PLAN_GEOMETRIES.find(p=>p.id===String(f.id));
    const residential=residentialPlanFor(String(f.id));
    const academic=academicPlanFor(String(f.id));
    const correction=DORM_SHAPE_REVIEW_ENABLED&&!DORM_COMPOUND_REVIEW_ENABLED?dormitoryShapeCorrection(String(f.id)):undefined;
    const geometry=correction?residentialToWgs84(correction.geometry):roofGroupGeometry(String(f.id))??(plan?planToWgs84(plan.geometry):residential?residentialToWgs84(residential.geometry):academic?academicToWgs84(academic.geometry):undefined);
    const group=roofGroupFor(String(f.id));
    return geometry?{...f,geometry,properties:{...f.properties,displayStatus:'APPROXIMATE_DISPLAY_ONLY',
      ...(group?{displayGroupRoot:group.root,displayGroupMembers:[group.root,...group.members],displayGroupStatus:'SCHEMATIC_PRESENTATION_NOT_SOURCE_OWNERSHIP'}:{})}}:f;
  });
  // Connections have no repository binding: decorative only, not independently selectable.
  return {...data,features:[...features,...planConnectionsCollection().features.filter((_,i)=>
    TEACHING_PLAN_CONNECTIONS[i]!.owners.every(id=>existing.has(id)))]};
}

/** Camera-only copy. A corrected display roof can extend beyond its old GIS
 * envelope; fitting the authority bounds would clip it. Never write these
 * display bounds/centroid back into a repository or analytical feature. */
export function featureForDisplayCamera(source:CampusFeature, preview:boolean):CampusFeature {
  if(source.category!=='building'||(!preview&&source.id!==AUDITORIUM_SOURCE_ID))return source;
  const rendered=displayCollection('buildings',{type:'FeatureCollection',features:[
    {type:'Feature',id:source.id,properties:source.properties,geometry:source.geometry},
  ]},preview).features.find(f=>f.id===source.id);
  if(!rendered||rendered.geometry===source.geometry)return source;
  const [west,south,east,north]=bbox(turfFeature(rendered.geometry));
  if(![west,south,east,north].every(Number.isFinite))return source;
  return {...source,centroid:[(west!+east!)/2,(south!+north!)/2],bounds:[[west!,south!],[east!,north!]]};
}
