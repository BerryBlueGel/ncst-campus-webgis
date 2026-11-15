import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {Box3,Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {Polygon,MultiPolygon} from 'geojson';
import {TEACHING_BUILDINGS,TEACHING_MODEL_BINDINGS} from '../src/gis/features/TeachingBuildingPresentation';
import {teachingBuildingAudit,TEACHING_BUILDING_SOURCES} from '../src/gis/features/TeachingBuildingAudit';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import {modelAtPath} from '../src/gis/three/CampusModelPresentation';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';

const protectedPaths=['../output/campus_refined_v005.glb','public/models/campus_refined_v005.glb',
  '../output/geojson/buildings.geojson','public/data/buildings.geojson',
  '../output/teaching_area_preview_v001.glb','../blender/teaching_area_working_v001.blend',
  '../output/teaching_area_preview_v002.glb','../blender/teaching_area_working_v002.blend',
  '../output/teaching_area_preview_v003.glb','../blender/teaching_area_working_v003.blend'];
async function hashes(){return Object.fromEntries(await Promise.all(protectedPaths.map(async p=>
  [p,createHash('sha256').update(await readFile(p)).digest('hex').toUpperCase()])));}
const before=await hashes();
if(before[protectedPaths[0]!]!=='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65')throw Error('Unexpected protected GLB baseline');
const sources=Object.fromEntries(await Promise.all(['buildings','sports','landmarks','pois'].map(async k=>
  [k,JSON.parse(await readFile(`public/data/${k}.geojson`,'utf8'))]))) as unknown as FeatureSources;
const repository=new StaticFeatureRepository(sources);
const bytes=await readFile(protectedPaths[1]!);
const loader=new GLTFLoader();loader.register(()=>({name:'AUDIT_GEOMETRY_ONLY',loadTexture:()=>Promise.resolve(new Texture())}));
const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
try{
  scene.updateMatrixWorld(true);
  const records=TEACHING_BUILDINGS.map(ref=>{
    const feature=repository.getById(ref.id)!;
    const geometry=feature.geometry as Polygon|MultiPolygon;
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    const points=polygons.flat(2).map(p=>coordinates.wgs84ToLocal([p[0]!,p[1]!]));
    const gisBounds=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
    const object=modelAtPath(scene,ref.modelPath);if(!object)throw Error(`Missing ${ref.modelPath}`);
    const box=new Box3().setFromObject(object),modelBounds=[box.min.x,box.min.y,box.max.x,box.max.y];
    const mismatch=Math.max(...modelBounds.map((v,i)=>Math.abs(v-gisBounds[i]!)));
    if(mismatch>0.001)throw Error(`${ref.name}: GIS/model envelope mismatch ${mismatch}`);
    const audit=teachingBuildingAudit(ref.id)!;
    return {...audit,sourceModelPath:ref.modelPath,gisBounds,modelBounds,
      modelToGisEnvelopeDeltaMeters:mismatch,sourcePolygonCount:polygons.length,
      sourceCourtyardCount:polygons.reduce((n,p)=>n+p.length-1,0),
      sourceModelHeightMeters:box.max.z-box.min.z,
      nearbyParts:audit.nearbyPartIds.map(id=>{
        const binding=TEACHING_MODEL_BINDINGS.find(b=>b.id===id)!;
        if(!modelAtPath(scene,binding.path))throw Error(`Missing nearby source ${id}`);
        return {id,path:binding.path,relationship:'UNVERIFIED_NOT_UNIONED'};
      })};
  });
  const after=await hashes();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Protected assets changed');
  const report={schemaVersion:4,status:'EVIDENCE_AUDIT_NOT_AS_BUILT',checkedDate:'2026-10-04',
    frame:'Local East/North in meters, source GLB ENU',protectedAssets:after,
    limitations:['Schematic-derived coordinates are approximate, not a measured survey.',
      'Fit adjustment is a display deformation, not registration accuracy.',
      'Project articles do not establish individual building heights, fragment ownership or connector clearance.',
      'Current geometry retains shared approximate registration without per-building fitting.',
      'v004 wall regularization is bounded display editing in one shared frame, not an as-built survey.',
      'Connections are ground markers, not bridge structures or measured elevations.',
      'Preserved v001, v002 and v003 GLB and Blend remain unchanged.'],sources:TEACHING_BUILDING_SOURCES,buildings:records};
  const target=resolve('../reference/buildings/teaching_building_audit_v004.json');
  const payload=JSON.stringify(report,null,2)+'\n';await mkdir(dirname(target),{recursive:true});
  try{await writeFile(target,payload,{flag:'wx'});}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(target,'utf8')!==payload)throw error;
  }
  console.log(JSON.stringify({target,buildings:records.map(r=>({name:r.name,fitAdjustmentMeters:r.maxFitAdjustmentMeters,
    scaleEast:r.scaleEast,scaleNorth:r.scaleNorth,sourceHoles:r.sourceCourtyardCount,previewHoles:r.tracedCourtyardCount,
    heightMeters:r.sourceModelHeightMeters,modelToGisDeltaMeters:r.modelToGisEnvelopeDeltaMeters,nearbyParts:r.nearbyPartIds.length})),protectedUnchanged:true},null,2));
}finally{disposeModel(scene);}
