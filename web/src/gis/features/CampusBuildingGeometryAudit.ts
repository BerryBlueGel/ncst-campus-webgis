import type {FeatureCollection,Polygon,MultiPolygon} from 'geojson';
import {booleanValid,intersect,featureCollection,feature} from '@turf/turf';
import {coordinates} from '../coordinate/CampusCoordinateService';
import {TEACHING_BUILDINGS} from './TeachingBuildingPresentation';
import {TEACHING_PART_IDS} from './TeachingPlanGeometry';
import {sharedRectilinearAngle,ringCornerErrors,type LocalPoint} from './RectilinearGeometry';

type LocalPolygon=LocalPoint[][];
const ringArea=(ring:number[][])=>Math.abs(ring.slice(0,-1).reduce((sum,p,i)=>{
  const q=ring[(i+1)%(ring.length-1)]!;return sum+p[0]!*q[1]!-p[1]!*q[0]!;
},0))/2;
const polygonArea=(poly:number[][][])=>ringArea(poly[0]!)-poly.slice(1).reduce((sum,ring)=>sum+ringArea(ring),0);
/** Triage only: non-right angles can be legitimate. No automatic source edits,
 * inferred names, union of nearby IDs or survey accuracy claims.
 */
export function auditCampusBuildingGeometry(collection:FeatureCollection,refinedSourceIds:ReadonlyMap<string,string>=new Map()){
  const ids=new Set<string>(),duplicates:string[]=[],local:Map<string,Polygon|MultiPolygon>=new Map();
  const records=collection.features.map((f,index)=>{
    const id=String(f.id);if(ids.has(id))duplicates.push(id);ids.add(id);
    const geometry=f.geometry;if(geometry.type!=='Polygon'&&geometry.type!=='MultiPolygon')throw Error(`Unexpected building geometry ${id}`);
    const raw=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    const polygons:LocalPolygon[]=raw.map(p=>p.map(r=>r.map(v=>coordinates.wgs84ToLocal([v[0]!,v[1]!]))));
    const localGeometry:Polygon|MultiPolygon=geometry.type==='Polygon'?{type:'Polygon',coordinates:polygons[0]!}:{type:'MultiPolygon',coordinates:polygons};
    local.set(id,localGeometry);
    const points=polygons.flat(2),bounds=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
    const open=polygons.flatMap(p=>p.map(r=>r.slice(0,-1))),corners=open.flatMap(r=>ringCornerErrors(r));
    let angle:number|null=null;try{angle=sharedRectilinearAngle(open,8)*180/Math.PI;}catch{/* curved or tiny outline */}
    const reviewed=TEACHING_BUILDINGS.find(b=>b.id===id),nearby=TEACHING_PART_IDS.includes(id),replacement=refinedSourceIds.get(id);
    const valid=booleanValid(f),height=f.properties?.height;
    const maxCornerError=Math.max(...corners);
    return {id,sourceLabel:`建筑 ${String(index+1).padStart(3,'0')}`,knownName:reviewed?.name??null,
      stage:replacement?'REFINED_LANDMARK_SOURCE_REFERENCE':reviewed?'TEACHING_DISPLAY_V004_NOT_AS_BUILT':nearby?'INDEPENDENT_PART_OWNERSHIP_UNVERIFIED':'SOURCE_ROUGH_UNREVIEWED',
      refinedReplacementId:replacement??null,
      geometryValid:valid,polygonCount:polygons.length,courtyardHoleCount:polygons.reduce((sum,p)=>sum+p.length-1,0),
      sourceHeight:typeof height==='number'?height:null,heightStatus:'SOURCE_METADATA_NOT_SURVEY_VERIFIED',
      boundsLocalEastNorth:bounds,estimatedWallAngleDegrees:angle,maxCornerErrorDegrees:maxCornerError,
      flags:[...(!valid?['INVALID_GEOMETRY']:[]),...(polygons.length>1?['MULTIPART_REVIEW']:[]),
        ...(maxCornerError>5?['NON_RECTILINEAR_REVIEW_NOT_AUTOFIX']:[]),
        ...(nearby?['NEARBY_PART_NOT_UNIONED']:[])],
      courtyardStatus:'HOLE_COUNT_IS_SOURCE_TOPOLOGY_NOT_PROOF_OF_REAL_COURTYARD',
    };
  });
  const pairs:{ids:string[];kind:string;overlapSquareMeters?:number;boxGapMeters?:number}[]=[];
  for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){
    const a=records[i]!,b=records[j]!,ab=a.boundsLocalEastNorth,bb=b.boundsLocalEastNorth;
    const dx=Math.max(ab[0]!-bb[2]!,bb[0]!-ab[2]!,0),dy=Math.max(ab[1]!-bb[3]!,bb[1]!-ab[3]!,0),gap=Math.hypot(dx,dy);
    if(gap>3)continue;
    if(gap===0&&a.geometryValid&&b.geometryValid){
      const overlap=intersect(featureCollection([feature(local.get(a.id)!),feature(local.get(b.id)!)]));
      if(overlap){const g=overlap.geometry,polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
        const area=polygons.reduce((sum,p)=>sum+polygonArea(p),0);
        if(area>0.01){pairs.push({ids:[a.id,b.id],kind:'SOURCE_OVERLAP_REVIEW_NOT_DUPLICATE_ASSERTION',overlapSquareMeters:area});continue;}
      }
    }
    pairs.push({ids:[a.id,b.id],kind:'BBOX_NEAR_ONLY_OWNERSHIP_UNVERIFIED',boxGapMeters:gap});
  }
  return {schemaVersion:1,frame:'LOCAL_EAST_NORTH_METERS',status:'GEOMETRY_TRIAGE_NOT_AS_BUILT',
    summary:{count:records.length,duplicateIds:duplicates,invalidGeometryCount:records.filter(r=>!r.geometryValid).length,
      teachingDisplayCount:records.filter(r=>r.stage==='TEACHING_DISPLAY_V004_NOT_AS_BUILT').length,
      independentTeachingParts:records.filter(r=>r.stage==='INDEPENDENT_PART_OWNERSHIP_UNVERIFIED').length,
      refinedSourceReferences:records.filter(r=>r.stage==='REFINED_LANDMARK_SOURCE_REFERENCE').length,
      otherSourceFootprints:records.filter(r=>r.stage==='SOURCE_ROUGH_UNREVIEWED').length,
      nonRectilinearReviewCount:records.filter(r=>r.flags.includes('NON_RECTILINEAR_REVIEW_NOT_AUTOFIX')).length,
      sourceOverlapPairs:pairs.filter(p=>p.overlapSquareMeters!==undefined).length},records,pairs,
    limitations:['Source footprints are not a current as-built survey.','A diagonal wall is not automatically an error.',
      'Separate GIS features can be parts of a building; bounding boxes cannot establish ownership.',
      'Refined landmarks have separate business IDs and are not counted as corrected source footprints.',
      'Zero hole count does not imply no courtyard. No names or heights are inferred for unreviewed buildings.']};
}
