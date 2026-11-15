import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Texture,Mesh,Box3,Raycaster,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {booleanValid,feature,intersect,featureCollection} from '@turf/turf';
import {REMAINING_PLAN_GEOMETRIES,REMAINING_PLAN_PROVENANCE} from '../src/gis/features/CampusRemainingPlan';
import {CAMPUS_PLAN_DISPOSITIONS,EARLIER_OWNERSHIP_GAPS} from '../src/gis/features/CampusPlanDispositions';
import {RESIDENTIAL_PLAN_GEOMETRIES} from '../src/gis/features/CampusResidentialPlan';
import {ACADEMIC_PLAN_GEOMETRIES} from '../src/gis/features/CampusAcademicPlan';
import {SOUTHWEST_PLAN_GEOMETRIES} from '../src/gis/features/CampusSouthwestPlan';
import {TEACHING_PLAN_GEOMETRIES} from '../src/gis/features/TeachingPlanGeometry';
import {createRemainingPlanPreview} from '../src/gis/three/CampusRemainingModel';
import {sourceBuildingBindings} from '../src/gis/three/SourceBuildingBindings';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex').toUpperCase();
const source=await readFile('public/data/buildings.geojson'),model=await readFile('../output/campus_refined_v005.glb');
if(sha(model)!=='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65'||sha(source)!=='118D98BA970E9FCE28074AFA5F29B5089B5BF02A487D2645A55D1A1529AED8F6')throw Error('Protected baseline differs');
const targets=['../output/campus_remaining_preview_v001.glb','../reference/buildings/remaining_batch_v001.json',
  '../reference/buildings/campus_building_review_v009.json','../reference/buildings/campus_whole_school_queue_v004.json'];
// Repair only the artifacts CREATED IN THIS RUN after visual QA identified a
// viewer-resizing trace mistake. All historical user files remain immutable.
const repairOwnBatch=process.argv.includes('--repair-owned-current-batch');
if(repairOwnBatch){
  if(sha(await readFile(targets[0]!))!=='798A68EB235EEC5847333BD766FC5B02921845C7595F0CA5B798BD7CAC9DF874')throw Error('Owned draft differs; refuse repair');
}else for(const path of targets){try{await access(path);throw Error(`Refusing overwrite ${path}`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
for(let i=0;i<REMAINING_PLAN_GEOMETRIES.length;i++){
  const r=REMAINING_PLAN_GEOMETRIES[i]!;if(!booleanValid(feature(r.geometry)))throw Error(`Invalid ${r.sourceLabel}`);
  for(const other of [...REMAINING_PLAN_GEOMETRIES.slice(i+1),...RESIDENTIAL_PLAN_GEOMETRIES,...ACADEMIC_PLAN_GEOMETRIES,...SOUTHWEST_PLAN_GEOMETRIES,...TEACHING_PLAN_GEOMETRIES])
    if(intersect(featureCollection([feature(r.geometry),feature(other.geometry)])))throw Error(`Roof overlap ${r.sourceLabel}/${other.id}`);
}
const queue=JSON.parse(await readFile('../reference/buildings/campus_whole_school_queue_v003.json','utf8'));
const pending=queue.records.filter((r:any)=>r.stage==='SOURCE_ROUGH_UNREVIEWED');
const reviewed=[...REMAINING_PLAN_GEOMETRIES,...CAMPUS_PLAN_DISPOSITIONS];
if(pending.length!==75||reviewed.length!==75||new Set(reviewed.map(r=>r.id)).size!==75||pending.some((r:any)=>!reviewed.some(a=>a.id===r.id)))throw Error('Incomplete remaining source accounting');
const sources=Object.fromEntries(await Promise.all(['buildings','sports','landmarks','pois'].map(async k=>[k,JSON.parse(await readFile(`public/data/${k}.geojson`,'utf8'))]))) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources),loader=new GLTFLoader();loader.register(()=>({name:'GEOMETRY_EXPORT',loadTexture:()=>Promise.resolve(new Texture())}));
const {scene,parser}=await loader.parseAsync(model.buffer.slice(model.byteOffset,model.byteOffset+model.byteLength),'');
class BlobReader{result:ArrayBuffer|null=null;onloadend?:()=>void;readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(r=>{this.result=r;this.onloadend?.();});}}
Object.assign(globalThis,{FileReader:BlobReader});
try{
  const bindings=sourceBuildingBindings(scene,repo.getAll()),control=createRemainingPlanPreview(scene,repo.getAll());
  if(bindings.length!==162||control.root.children.length!==39)throw Error('Exact source bindings required');
  scene.updateMatrixWorld(true);
  const libraryMeshes:Mesh[]=[];scene.traverse(o=>{if(o.name.startsWith('LIB_')&&(o as Mesh).isMesh)libraryMeshes.push(o as Mesh);});
  const libraryCoverage=CAMPUS_PLAN_DISPOSITIONS.filter(r=>r.status==='REFINED_LIBRARY_COMPONENT').map(r=>{
    const b=new Box3().setFromObject(bindings.find(a=>a.id===r.id)!.root),c=b.getCenter(new Vector3());
    const points=[[c.x,c.y],[b.min.x+1,c.y],[b.max.x-1,c.y],[c.x,b.min.y+1],[c.x,b.max.y-1]];
    const hits=points.map(([x,y])=>new Raycaster(new Vector3(x!,y!,100),new Vector3(0,0,-1)).intersectObjects(libraryMeshes,true).length>0);
    if(hits.some(hit=>!hit))throw Error(`Library does not cover ${r.sourceLabel}`);
    return {id:r.id,samples:points.length,coveredSamples:hits.filter(Boolean).length,status:'EXISTING_REFINED_MESH_COVERS_SOURCE_ENVELOPE_NOT_NEW_OWNERSHIP'};
  });
  let triangles=0;control.root.traverse(o=>{if((o as Mesh).isMesh){const g=(o as Mesh).geometry;triangles+=(g.index?.count??g.attributes.position!.count)/3;}});
  const records=REMAINING_PLAN_GEOMETRIES.map(r=>{
    const source=bindings.find(b=>b.id===r.id)!.root,parts:string[]=[];
    for(let node:typeof source|null=source;node;node=node.parent){const i=parser.associations.get(node)?.nodes;if(i!==undefined)parts.unshift(parser.json.nodes[i].name);}
    const mesh=control.root.children.find(o=>o.userData.featureId===r.id)!;
    return {...r,geometryLocal:r.geometry,sourceModelPath:parts.join('/'),componentCount:mesh.userData.componentCount,
      sourceBodyHeightMeters:mesh.userData.sourceBodyHeightMeters,sourceBaseElevationMeters:mesh.userData.sourceBaseElevationMeters,
      ownershipStatus:'SOURCE_IDS_REMAIN_INDEPENDENT',representation:'REGISTERED_WHITE_ROOF_DISPLAY_NOT_BUSINESS_UNION'};
  });
  const review=JSON.parse(await readFile('../reference/buildings/campus_building_review_v008.json','utf8'));
  review.schemaVersion=9;queue.schemaVersion=4;queue.status='WHOLE_CAMPUS_PLAN_QC_COMPLETE_WITH_AS_BUILT_EVIDENCE_GAPS';
  for(const collection of [review.records,queue.records])for(const row of collection){
    const roof=records.find(r=>r.id===row.id),decision=CAMPUS_PLAN_DISPOSITIONS.find(r=>r.id===row.id);
    if(roof){row.stage='WHOLE_CAMPUS_ROOF_DISPLAY_V001_NOT_AS_BUILT';row.planLabel=roof.planLabel;
      if(row.sourceModelPath&&row.sourceModelPath!==roof.sourceModelPath)throw Error('Source path drift');
      row.nextAction='PRESERVE_REVIEWED_ROOF_WORK';row.priority=null;row.geometryStatus='APPROXIMATE_DISPLAY_ONLY';
    }else if(decision){row.stage=`PLAN_QC_${decision.status}`;row.planDisposition=decision;
      row.nextAction=decision.status==='OWNER_OR_ROOF_SCOPE_UNCERTAIN'?'REQUIRES_AS_BUILT_OR_OWNER_REFERENCE':'PRESERVE_AUTHORITY_REFERENCE';row.priority=null;
    }
  }
  const uncertain=[...CAMPUS_PLAN_DISPOSITIONS.filter(r=>r.status==='OWNER_OR_ROOF_SCOPE_UNCERTAIN'),...EARLIER_OWNERSHIP_GAPS];
  queue.pendingIds=uncertain.map(r=>r.id);queue.unreviewedIds=[];queue.sectors=review.sectors;
  for(const sector of Object.values(review.sectors) as any[]){sector.unreviewed=0;sector.remaining=sector.ids.filter((id:string)=>uncertain.some(r=>r.id===id)).length;}
  Object.assign(queue.summary,{workingAcademicBodies:59,workingRemainingSourceIds:39,workingRemainingRoofComponents:40,
    workingRoofSourceIds:124,planQcReviewedSourceRecords:166,unreviewedSourceBodies:0,pendingSourceBodies:12,
    pendingMainTrace:0,pendingDiagonalOrCurved:0,pendingSmallOrOwnership:12,pendingHistoricalSourceStand:0,
    newBatchEvidenceGaps:9,previousEvidenceGaps:3,
    suppressedPlanNonRoofBodies:19,coveredLibraryReferences:2,retainedSmallRoofFragments:5,historicalReplacedStand:1,
    pendingReason:'NEW_EXTERNAL_EVIDENCE_REQUIRED_NOT_UNSTARTED_MODELING'});
  Object.assign(review.summary,{academicWork:59,remainingWork:39,otherSourceFootprints:36,planQcReviewedSourceRecords:166,unreviewedSourceBodies:0,awaitingOwnerEvidence:12,newBatchEvidenceGaps:9,previousEvidenceGaps:3});
  review.nextPriority=['Twelve source fragments (nine new and three earlier) require external as-built or ownership evidence; do not force union.',
    'Survey/floor/roof-height verification remains separate from display-only plan QC.'];
  queue.limitations=['All 166 SOURCE records were inspected, not all current real campus buildings surveyed.',
    '124 source IDs have working roof geometry; five small roofs retain original display geometry.',
    '19 non-roof interpretations and two covered Library references hide only in the reversible work preview.',
    'Twelve fragments (nine new and three earlier) retain independent originals pending new external evidence. No floor count or ownership inferred.',
    'Three earlier refined references, three earlier unresolved parts and one historical replaced stand remain separately accounted for.',
    'Roof traces from a registered schematic are not orthophoto, survey or authority geometry.'];
  control.root.removeFromParent();control.root.updateMatrixWorld(true);
  const binary=await new GLTFExporter().parseAsync(control.root,{binary:true,onlyVisible:true});if(!(binary instanceof ArrayBuffer))throw Error('GLB required');
  const batch={...REMAINING_PLAN_PROVENANCE,sourceSha256:sha(source),formalGlbSha256:sha(model),previewSha256:sha(new Uint8Array(binary)),meshes:39,roofComponents:40,triangles,records,
    dispositions:CAMPUS_PLAN_DISPOSITIONS,libraryCoverage,limitations:queue.limitations};
  if(sha(await readFile('public/data/buildings.geojson'))!==sha(source)||sha(await readFile('../output/campus_refined_v005.glb'))!==sha(model))throw Error('Protected source changed');
  await writeFile(targets[0]!,Buffer.from(binary),{flag:repairOwnBatch?'w':'wx'});
  for(const [i,data] of [[1,batch],[2,review],[3,queue]] as const)await writeFile(targets[i]!,JSON.stringify(data,null,2)+'\n',{flag:repairOwnBatch?'w':'wx'});
  console.log(JSON.stringify({targets,meshes:39,roofComponents:40,triangles,bytes:binary.byteLength,summary:queue.summary,libraryCoverage},null,2));
  disposeModel(control.root);
}finally{disposeModel(scene);}
