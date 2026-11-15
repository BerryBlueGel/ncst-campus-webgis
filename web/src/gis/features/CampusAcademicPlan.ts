import type {Polygon,MultiPolygon} from 'geojson';
import {southwestPlanFor} from './CampusSouthwestPlan';
import {remainingPlanFor} from './CampusRemainingPlan';
import type {CampusFeature} from '../../types/CampusFeature';
import {coordinates} from '../coordinate/CampusCoordinateService';
import {residentialRasterToLocal} from './CampusResidentialPlan';
import type {LocalPoint} from './RectilinearGeometry';

/** D-area white roof bodies, individually traced in crop [3500,900,1150,1900].
 * GIS fragments remain independent. No whole-complex ownership, building-height
 * or present-day official-name claim. Frozen shared registration, no bbox fitting. */
export const ACADEMIC_PLAN_PROVENANCE={version:'v001',sourceFile:'campus_georef.tif',cropOrigin:[3500,900],
  status:'APPROXIMATE_DISPLAY_ONLY',heightStatus:'SOURCE_ROUGH_MODEL_NOT_SURVEYED',
  nameStatus:'USER_PLAN_LABEL_NOT_OFFICIAL_NAME_VERIFICATION',fit:'SHARED_RASTER_GEOREFERENCE_NO_BUILDING_FIT'} as const;
const body=(label:string,id:string,planLabel:string,rings:LocalPoint[][])=>{
  const local=rings.map(r=>r.map(([x,y])=>residentialRasterToLocal([x+2800,y-2700])));
  return {id:`buildings:${id}`,sourceLabel:`建筑 ${label}`,planLabel,tracePixels:rings,
    wallPolicy:'INDIVIDUAL_REGISTERED_TRACE_NOT_AUTORECTIFIED',
    geometry:{type:'Polygon',coordinates:local.map(r=>[...r,[...r[0]!]])} as Polygon};
};
export const ACADEMIC_PLAN_GEOMETRIES=[
  body('128','b998b58a3ef5faccc894','东北服务区危险品库',[
    [[55,173],[166,94],[203,143],[179,161],[174,158],[144,181],[137,178],[91,211],[74,211]],
  ]),
  body('130','5b1938051515754004ab','D区1号楼主体',[
    [[385,654],[564,652],[564,648],[625,648],[633,875],[531,875],[531,886],[394,887],[386,852],[380,779],[380,749],[384,749]],
    [[440,704],[573,704],[575,795],[594,795],[595,831],[416,831],[416,795],[435,795],[439,727]],
  ]),
  body('135','a1985398a83643027a03','D区8号楼与7号楼北侧源主体',[
    [[710,722],[942,720],[945,810],[910,810],[910,789],[749,789],[750,865],[952,861],[953,943],[792,945],[791,1053],[735,1053],[735,1070],[718,1070],[718,864],[710,864]],
  ]),
  // Separate southern bar; adjacent east cap and south detached piece are not
  // assigned to this ID, and the west return belongs to the preceding source.
  body('133','bd660fec95c437579797','D区7号楼南楼源横向体',[
    [[809,985],[950,982],[950,1023],[809,1026]],
  ]),
  body('136','40ec4bc62010f262e59c','D区5号楼阶梯教室主体',[
    [[451,920],[482,920],[482,916],[535,916],[535,924],[573,924],[573,965],[570,965],[570,1007],[562,1007],[562,1014],[469,1014],[469,982],[455,982],[455,966],[451,966]],
  ]),
  // Only D6 and its right return. D4 north's long western bar is not silently
  // consumed: the source's ownership across that connection is still uncertain.
  body('139','dcea1c9614744dcfce1d','D区6号楼主体及东侧回折',[
    [[735,1090],[954,1088],[960,1180],[952,1180],[952,1268],[904,1268],[904,1182],[739,1182]],
  ]),
  body('141','51c39a534b9f37902d58','D区4号楼南楼主体',[
    [[680,1411],[704,1389],[765,1389],[765,1384],[960,1380],[960,1452],[872,1452],[872,1460],[738,1460],[738,1454],[678,1457]],
  ]),
  body('161','6ec99a0af367bfd980f4','D区3号楼斜向翼楼源主体',[
    [[270,1382],[364,1277],[461,1277],[461,1325],[397,1325],[310,1422]],
  ]),
  body('162','140282bbc730b1777d14','D区2号楼南侧源横向体',[
    [[147,1177],[304,1177],[304,1226],[150,1226]],
  ]),
  body('163','c4413d5a7dda1c0312d4','D区2号楼北侧源横向体',[
    [[81,1045],[298,1040],[298,1090],[82,1095]],
  ]),
  body('165','5078c3f4fbe6712427a1','D区9号楼工程训练中心主体',[
    [[68,665],[293,658],[293,680],[315,680],[321,925],[77,932],[70,871],[70,844],[59,844],[53,747],[68,747]],
    [[212,746],[296,746],[299,869],[162,869],[162,845],[212,844]],
  ]),
];
export const ACADEMIC_DEFERRED_IDS=['131','132','134','137','138','140','142','143','144','145','158','159','160','164'];
export const academicPlanFor=(id:string)=>ACADEMIC_PLAN_GEOMETRIES.find(r=>r.id===id)??southwestPlanFor(id)??remainingPlanFor(id);
export function academicToWgs84(geometry:Polygon|MultiPolygon):Polygon|MultiPolygon{
  const convert=(poly:Polygon['coordinates'])=>poly.map(r=>r.map(p=>coordinates.localToWgs84([p[0]!,p[1]!])));
  return geometry.type==='Polygon'?{type:'Polygon',coordinates:convert(geometry.coordinates)}
    :{type:'MultiPolygon',coordinates:geometry.coordinates.map(convert)};
}
export function academicPresentation(feature:CampusFeature):CampusFeature{
  const ref=feature.category==='building'?academicPlanFor(feature.id):undefined;
  return !ref?feature:{...feature,aliases:[...new Set([...feature.aliases,ref.planLabel])],
    properties:{...feature.properties,planLabel:ref.planLabel,planLabelStatus:ACADEMIC_PLAN_PROVENANCE.nameStatus}};
}
