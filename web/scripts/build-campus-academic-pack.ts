import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Texture,Mesh} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {booleanValid,polygon,intersect,featureCollection} from '@turf/turf';
import {ACADEMIC_PLAN_GEOMETRIES,ACADEMIC_PLAN_PROVENANCE,ACADEMIC_DEFERRED_IDS} from '../src/gis/features/CampusAcademicPlan';
import {RESIDENTIAL_PLAN_GEOMETRIES} from '../src/gis/features/CampusResidentialPlan';
import {createAcademicPlanPreview} from '../src/gis/three/CampusAcademicModel';
import {sourceBuildingBindings} from '../src/gis/three/SourceBuildingBindings';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex').toUpperCase();
const source=await readFile('public/data/buildings.geojson'),model=await readFile('../output/campus_refined_v005.glb');
if(sha(model)!=='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65'||sha(source)!=='118D98BA970E9FCE28074AFA5F29B5089B5BF02A487D2645A55D1A1529AED8F6')throw Error('Protected baseline differs');
const targets=['../output/academic_area_preview_v001.glb','../reference/buildings/academic_batch_v001.json',
  '../reference/buildings/campus_building_review_v007.json','../reference/buildings/campus_whole_school_queue_v002.json'];
for(const target of targets){try{await access(target);throw Error(`Refusing overwrite ${target}`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
for(let i=0;i<ACADEMIC_PLAN_GEOMETRIES.length;i++){
  const r=ACADEMIC_PLAN_GEOMETRIES[i]!;if(!booleanValid(polygon(r.geometry.coordinates)))throw Error(`Invalid ${r.id}`);
  for(const other of [...ACADEMIC_PLAN_GEOMETRIES.slice(i+1),...RESIDENTIAL_PLAN_GEOMETRIES])
    if(intersect(featureCollection([polygon(r.geometry.coordinates),polygon(other.geometry.coordinates)])))throw Error(`Roof overlap ${r.id}/${other.id}`);
}
const sources=Object.fromEntries(await Promise.all(['buildings','sports','landmarks','pois'].map(async k=>[k,JSON.parse(await readFile(`public/data/${k}.geojson`,'utf8'))]))) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources),loader=new GLTFLoader();loader.register(()=>({name:'GEOMETRY_EXPORT',loadTexture:()=>Promise.resolve(new Texture())}));
const {scene,parser}=await loader.parseAsync(model.buffer.slice(model.byteOffset,model.byteOffset+model.byteLength),'');
class BlobReader{result:ArrayBuffer|null=null;onloadend?:()=>void;readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(r=>{this.result=r;this.onloadend?.();});}}
Object.assign(globalThis,{FileReader:BlobReader});
try{
  const bindings=sourceBuildingBindings(scene,repo.getAll()),control=createAcademicPlanPreview(scene,repo.getAll());
  if(bindings.length!==162||control.root.children.length!==11)throw Error('Exact unique source bindings required');
  let triangles=0;control.root.traverse(o=>{if((o as Mesh).isMesh){const g=(o as Mesh).geometry;triangles+=(g.index?.count??g.attributes.position!.count)/3;}});
  const records=ACADEMIC_PLAN_GEOMETRIES.map(r=>{
    const source=bindings.find(b=>b.id===r.id)!.root,parts:string[]=[];
    for(let node:typeof source|null=source;node;node=node.parent){const i=parser.associations.get(node)?.nodes;if(i!==undefined)parts.unshift(parser.json.nodes[i].name);}
    const mesh=control.root.children.find(o=>o.userData.featureId===r.id)!;
    return {...r,geometryLocal:r.geometry,sourceModelPath:parts.join('/'),sourceBodyHeightMeters:mesh.userData.sourceBodyHeightMeters,
      sourceBaseElevationMeters:mesh.userData.sourceBaseElevationMeters,ownershipStatus:'SOURCE_IDS_REMAIN_INDEPENDENT',representation:'REVIEWED_SOURCE_BODY_NOT_WHOLE_COMPLEX'};
  });
  const review=JSON.parse(await readFile('../reference/buildings/campus_building_review_v006.json','utf8'));
  review.schemaVersion=7;review.summary.academicWork=11;review.summary.otherSourceFootprints=84;
  for(const r of review.records){const match=records.find(a=>a.id===r.id);if(match){r.stage='ACADEMIC_DISPLAY_V001_NOT_AS_BUILT';r.planLabel=match.planLabel;}}
  for(const sector of Object.values(review.sectors) as any[])sector.remaining=sector.ids.filter((id:string)=>review.records.find((r:any)=>r.id===id).stage==='SOURCE_ROUGH_UNREVIEWED').length;
  review.nextPriority=['Continue southwest/southeast academic blocks by exact source ID.','D-area untraced connectors and small parts remain independent until ownership evidence exists.','Do not recreate historical replaced stadium stand 086.'];
  const queue=JSON.parse(await readFile('../reference/buildings/campus_whole_school_queue_v001.json','utf8'));
  queue.schemaVersion=2;queue.sectors=review.sectors;
  for(const r of queue.records){const match=records.find(a=>a.id===r.id);if(match){
    if(r.sourceModelPath!==match.sourceModelPath)throw Error('Source path drift');
    r.stage='ACADEMIC_DISPLAY_V001_NOT_AS_BUILT';r.planLabel=match.planLabel;r.nextAction='PRESERVE_EXISTING_WORK_OR_REFERENCE';r.priority=null;r.geometryStatus='APPROXIMATE_DISPLAY_ONLY';
  }}
  const pending=queue.records.filter((r:any)=>r.stage==='SOURCE_ROUGH_UNREVIEWED');
  queue.pendingIds=pending.sort((a:any,b:any)=>(a.priority??99)-(b.priority??99)||a.reviewSector.localeCompare(b.reviewSector)).map((r:any)=>r.id);
  Object.assign(queue.summary,{workingAcademicBodies:11,pendingSourceBodies:pending.length,
    pendingMainTrace:pending.filter((r:any)=>r.nextAction==='TRACE_MAIN_BODY_FROM_REGISTERED_PLAN').length,
    pendingDiagonalOrCurved:pending.filter((r:any)=>r.nextAction==='INDIVIDUAL_DIAGONAL_OR_CURVED_TRACE_REQUIRED').length,
    pendingSmallOrOwnership:pending.filter((r:any)=>r.nextAction==='INDIVIDUAL_SMALL_SOURCE_REVIEW_NO_NEIGHBOR_UNION'||r.nextAction==='HOLD_INDEPENDENT_PART_UNTIL_OWNERSHIP_EVIDENCE').length});
  queue.limitations=queue.limitations.map((s:string)=>s.startsWith('The 95 remaining')?'The 84 remaining source records include one historical replaced stadium stand; 83 require further building review.':s);
  if(pending.length!==84||review.records.length!==166)throw Error('Review accounting differs');
  control.root.removeFromParent();control.root.updateMatrixWorld(true);
  const binary=await new GLTFExporter().parseAsync(control.root,{binary:true,onlyVisible:true});if(!(binary instanceof ArrayBuffer))throw Error('GLB required');
  const batch={...ACADEMIC_PLAN_PROVENANCE,sourceSha256:sha(source),formalGlbSha256:sha(model),previewSha256:sha(new Uint8Array(binary)),meshes:11,triangles,records,
    deferredSourceLabels:ACADEMIC_DEFERRED_IDS.map(n=>`建筑 ${n}`),limitations:['Registered schematic, not as-built survey.','Plan labels are aliases only; source names and IDs remain unchanged.','Source height and base retained, not measured floor counts.','Do not union nearby wings or inferred connectors.','D1 and D9 courtyard openings are actual geometry voids; indoor roof detail is not reconstructed.','D4 north western bar and D3 connectors remain unassigned; source groups are not declared complete.']};
  if(sha(await readFile('public/data/buildings.geojson'))!==sha(source)||sha(await readFile('../output/campus_refined_v005.glb'))!==sha(model))throw Error('Protected source changed');
  await writeFile(targets[0]!,Buffer.from(binary),{flag:'wx'});
  for(const [i,data] of [[1,batch],[2,review],[3,queue]] as const)await writeFile(targets[i]!,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({targets,meshes:11,triangles,bytes:binary.byteLength,summary:queue.summary},null,2));
  disposeModel(control.root);
}finally{disposeModel(scene);}
