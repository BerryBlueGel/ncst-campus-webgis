import { TEACHING_BUILDINGS, teachingRelatedIds } from './TeachingBuildingPresentation';
import { TEACHING_PLAN_GEOMETRIES, TEACHING_PLAN_PROVENANCE, TEACHING_WALL_FRAME, teachingRasterToLocal, teachingGeometryBounds, legacyFittedTeachingGeometry } from './TeachingPlanGeometry';
import {ringCornerErrors} from './RectilinearGeometry';

/** Project-level evidence only. Neither page identifies measured geometry or
 * heights for our eight stable feature IDs. Keep photos as links, not bundled assets. */
export const TEACHING_BUILDING_SOURCES = [
  {
    title:'天津市建筑学会 · 新校园设计介绍',
    url:'https://www.astjc.org.cn/h-nd-139.html',
    supports:'教学组团由八座建筑单体组成、院落式布局；附功能分解图和教学区夜景。',
    scope:'GROUP_LAYOUT_NOT_INDIVIDUAL_AS_BUILT',
    figures:[
      {caption:'公共教学组团功能构成',url:'https://25179804.s21i.faiusr.com/2/1/ABUIABACGAAgxOfZ-AUoj47P5AMwuAg4ggc.jpg'},
      {caption:'公共教学组团夜景',url:'https://25179804.s21i.faiusr.com/2/1/ABUIABACGAAgxOfZ-AUo2JCiwwQwuAg4gAU.jpg'},
    ],
  },
  {
    title:'天津大学 · 设计团队项目回访',
    url:'https://news.tju.edu.cn/info/1014/378229.htm',
    supports:'确认天大设计总院参与新校区规划及建筑设计；不能据此确认某栋楼的尺寸。',
    scope:'PROJECT_DESIGN_ATTRIBUTION_ONLY',
    figures:[],
  },
] as const;

/** Compare paired vertices, not centroids. Historical v001 fitting metrics are
 * separate from current geometry; neither indicates surveyed accuracy. */
export function teachingBuildingAudit(id:string) {
  const main=TEACHING_BUILDINGS.find(r=>r.id===id)??
    TEACHING_BUILDINGS.find(r=>teachingRelatedIds(id).includes(r.id));
  if(!main)return null;
  const plan=TEACHING_PLAN_GEOMETRIES.find(p=>p.id===main.id)!;
  const raw=plan.trace[0]!.map(teachingRasterToLocal);
  const xs=raw.map(p=>p[0]),ys=raw.map(p=>p[1]);
  const historical=legacyFittedTeachingGeometry(TEACHING_BUILDINGS.indexOf(main));
  const [w,s,e,n]=teachingGeometryBounds(plan.geometry);
  const adjustments=plan.trace.flatMap((ring,ri)=>ring.map((pixel,pi)=>{
    const a=teachingRasterToLocal(pixel),b=plan.geometry.coordinates[ri]![pi]!;
    return Math.hypot(a[0]-b[0]!,a[1]-b[1]!);
  }));
  return {
    id:main.id,name:main.name,block:main.block,
    selectedIsNearbyPart:id!==main.id,
    nameStatus:'USER_SUPPLIED_SCHEMATIC_PLAN',
    geometryStatus:'APPROXIMATE_DISPLAY_ONLY',
    heightStatus:'SOURCE_ROUGH_MODEL_NOT_SURVEYED',
    sourceBounds:plan.sourceBounds,
    previewBounds:teachingGeometryBounds(plan.geometry),
    previewVersion:TEACHING_PLAN_PROVENANCE.version,
    fit:TEACHING_PLAN_PROVENANCE.fit,
    tracedCourtyardCount:plan.geometry.coordinates.length-1,
    scaleEast:1,scaleNorth:1,maxFitAdjustmentMeters:0,
    regularization:{method:TEACHING_PLAN_PROVENANCE.regularization,
      wallAngleDegrees:TEACHING_WALL_FRAME.angleRadians*180/Math.PI,
      maxDisplacementMeters:Math.max(...adjustments),
      beforeCornerErrorDegrees:Math.max(...plan.trace.flatMap(r=>ringCornerErrors(r.map(teachingRasterToLocal)))),
      afterCornerErrorDegrees:Math.max(...plan.geometry.coordinates.flatMap(r=>ringCornerErrors(r.slice(0,-1) as [number,number][]))),
      envelopeEastRatio:(e-w)/(Math.max(...xs)-Math.min(...xs)),envelopeNorthRatio:(n-s)/(Math.max(...ys)-Math.min(...ys))},
    historicalV001:{
      scaleEast:(plan.sourceBounds[2]-plan.sourceBounds[0])/(Math.max(...xs)-Math.min(...xs)),
      scaleNorth:(plan.sourceBounds[3]-plan.sourceBounds[1])/(Math.max(...ys)-Math.min(...ys)),
      maxFitAdjustmentMeters:Math.max(...plan.trace.flatMap((ring,ri)=>ring.map((pixel,pi)=>{
        const a=teachingRasterToLocal(pixel),b=historical.coordinates[ri]![pi]!;
        return Math.hypot(a[0]-b[0]!,a[1]-b[1]!);
      }))),
    },
    nearbyPartIds:[...(main.nearbyParts??[])],
    connectionTo:main.planConnection??null,
    connectionStatus:main.planConnection?'SCHEMATIC_ONLY_HEIGHT_AND_AS_BUILT_UNVERIFIED':'NOT_ASSERTED',
    connectionRepresentation:main.planConnection?'SCHEMATIC_GROUND_MARKER_NOT_BUILDING':null,
    sources:TEACHING_BUILDING_SOURCES,
    unresolved:['逐栋实际高度及屋面高差','实建轮廓与最新影像的对应',
      ...(main.planConnection?['连接体净空、层数及实建状态']:[]),
      ...(main.nearbyParts?.length?['附近独立分块的归属']:[])],
  };
}
