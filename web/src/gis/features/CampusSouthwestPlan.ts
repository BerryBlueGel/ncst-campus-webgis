import type {Polygon,MultiPolygon} from 'geojson';
import {residentialRasterToLocal} from './CampusResidentialPlan';
import type {LocalPoint} from './RectilinearGeometry';

/** White roof bodies in the registered B-area crop, not GIS connecting envelopes.
 * Multiple disconnected roofs can belong to ONE existing source ID. This is
 * display topology only, not a newly verified business union or ownership claim. */
export const SOUTHWEST_PLAN_PROVENANCE={version:'v001',batchRegion:'西南区 v001',
  sourceFile:'campus_georef.tif',cropOrigin:[700,4800],cropSize:[1700,1080],
  status:'APPROXIMATE_DISPLAY_ONLY',heightStatus:'SOURCE_ROUGH_MODEL_NOT_SURVEYED',
  nameStatus:'USER_PLAN_LABEL_NOT_OFFICIAL_NAME_VERIFICATION',fit:'SHARED_RASTER_GEOREFERENCE_NO_BUILDING_FIT'} as const;
export const southwestRasterToLocal=([x,y]:LocalPoint):LocalPoint=>residentialRasterToLocal([x,y+1200]);
function body(label:string,id:string,planLabel:string,components:LocalPoint[][][]){
  const coordinates=components.map(poly=>poly.map(ring=>{
    const points=ring.map(southwestRasterToLocal);return [...points,[...points[0]!]];
  }));
  const geometry:Polygon|MultiPolygon=coordinates.length===1?{type:'Polygon',coordinates:coordinates[0]!}
    :{type:'MultiPolygon',coordinates};
  return {id:`buildings:${id}`,sourceLabel:`建筑 ${label}`,planLabel,batchRegion:'西南区 v001',
    tracePixels:components,geometry,wallPolicy:'INDIVIDUAL_REGISTERED_TRACE_NOT_AUTORECTIFIED'};
}
export const SOUTHWEST_PLAN_GEOMETRIES=[
  body('003','e072c019ac6d1d730572','B区9号楼源主体',[[[
    [1294,825],[1466,825],[1466,779],[1521,779],[1521,876],[1294,876],
  ]]]),
  // A single historical GIS envelope crosses B4/B6/B8. Do NOT extrude its
  // connecting envelope: retain three observed white roofs as disjoint parts.
  body('004','a50682221e1fa05f267b','B区4号楼及B区6号楼、B区8号楼南侧源组合体',[
    [[[774,662],[1009,660],[1009,714],[822,714],[822,825],[1058,825],
      [1080,850],[1086,864],[1074,880],[773,883],[773,832],[781,832],[781,736],[774,736]]],
    [[[1085,799],[1218,658],[1263,658],[1263,709],[1118,829]]],
    [[[1349,658],[1521,658],[1521,709],[1349,709]]],
  ]),
  body('006','fb5aee449a57ed5df550','B区2号楼南楼源主体',[[[
    [294,805],[365,805],[365,835],[633,835],[633,882],[294,886],
  ]]]),
  body('008','610064d59b3aaf6dddc5','B区4号楼北侧弧形源分体',[[[
    [770,649],[771,634],[777,615],[782,606],[791,606],[815,613],[820,620],[820,658],[801,653],[774,653],
  ]]]),
  body('009','71491b7a02820e1b3838','B区2号楼北楼源主体',[[[
    [497,670],[679,670],[679,719],[497,721],
  ]]]),
  body('011','cf68dba2ec49260e0733','B区3号楼南楼源主体',[[[
    [545,421],[715,417],[716,480],[545,483],
  ]]]),
  // B3 north and B5 north are separated by a pedestrian/landscape strip.
  // MultiPolygon keeps this gap open without inventing new business IDs.
  body('027','0de1148c8c38994c1f49','B区3号楼北楼及B区5号楼北楼源组合体',[
    [[[548,275],[900,268],[900,317],[595,322],[595,363],[548,364]]],
    [[[1013,260],[1267,260],[1267,288],[1256,288],[1256,309],[1013,312]]],
  ]),
  body('029','08877aec7b9527f279ec','B区5号楼南楼源主体',[[[
    [1010,407],[1030,407],[1030,410],[1061,410],[1061,419],[1236,422],
    [1236,401],[1209,401],[1209,369],[1264,369],[1264,471],[1030,475],[1030,456],[1010,456],
  ]]]),
  body('033','0753c07f7d914356571c','B区8号楼北楼源主体',[[[
    [1348,410],[1378,410],[1378,406],[1455,406],[1455,415],[1486,415],
    [1486,388],[1519,388],[1519,470],[1348,470],
  ]]]),
];
export const SOUTHWEST_DEFERRED_LABELS=['007','010','026','028','030','031','032'];
export const southwestPlanFor=(id:string)=>SOUTHWEST_PLAN_GEOMETRIES.find(r=>r.id===id);
