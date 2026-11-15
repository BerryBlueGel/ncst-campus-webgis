import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deepStrictEqual} from 'node:assert';
import {Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {auditCampusBuildingGeometry} from '../src/gis/features/CampusBuildingGeometryAudit';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {sourceBuildingBindings} from '../src/gis/three/SourceBuildingBindings';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';

/** Entire-campus QC/queue, not an automatic rectifier or fabricated completion.
 * Re-audits all original GIS footprints and checks actual formal model bindings. */
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex').toUpperCase();
const sourcePath='public/data/buildings.geojson',modelPath='../output/campus_refined_v005.glb';
const source=await readFile(sourcePath),model=await readFile(modelPath);
if(sha(source)!=='118D98BA970E9FCE28074AFA5F29B5089B5BF02A487D2645A55D1A1529AED8F6'||
   sha(model)!=='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65')throw Error('Protected inputs differ');
const sources=Object.fromEntries(await Promise.all(['buildings','sports','landmarks','pois'].map(async key=>
  [key,JSON.parse(await readFile(`public/data/${key}.geojson`,'utf8'))]))) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources),replaced=new Map<string,string>();
for(const f of sources.buildings.features){const id=repo.resolveGis('campus-buildings',String(f.id));
  if(id&&id!==String(f.id)&&repo.getById(id)?.refined)replaced.set(String(f.id),id);
}
const before=JSON.stringify(sources.buildings);
const audit=auditCampusBuildingGeometry(sources.buildings,replaced);
const review=JSON.parse(await readFile('../reference/buildings/campus_building_review_v006.json','utf8'));
const batch=JSON.parse(await readFile('../reference/buildings/residential_batch_v004.json','utf8'));
const loader=new GLTFLoader();loader.register(()=>({name:'QUEUE_GEOMETRY_ONLY',loadTexture:()=>Promise.resolve(new Texture())}));
const {scene,parser}=await loader.parseAsync(model.buffer.slice(model.byteOffset,model.byteOffset+model.byteLength),'');
// The fourth absent source is not a lost building: v005 replaced the east
// stadium stand. Verify its unique historical envelope, not proximity/name.
const historical=await readFile('../output/campus_refined_v004.glb');
const integration=JSON.parse(await readFile('../output/stadiums_integration_report.json','utf8'));
if(sha(historical)!==integration.sourceSha256||sha(model)!==integration.outputSha256)throw Error('Stadium provenance hash mismatch');
const old=await loader.parseAsync(historical.buffer.slice(historical.byteOffset,historical.byteOffset+historical.byteLength),'');
const oldStand=sourceBuildingBindings(old.scene,repo.getAll()).find(b=>b.id==='buildings:388e7ae428b6068062cb');
const standParts:string[]=[];
if(oldStand)for(let node:typeof oldStand.root|null=oldStand.root;node;node=node.parent){
  const index=old.parser.associations.get(node)?.nodes;if(index!==undefined)standParts.unshift(old.parser.json.nodes[index].name);
}
disposeModel(old.scene);
if(standParts.join('/')!==integration.removedSourceStand.path)throw Error('Historical source stand binding mismatch');
const standReference='buildings:388e7ae428b6068062cb';
try{
  const bindings=sourceBuildingBindings(scene,repo.getAll());
  if(bindings.length!==162)throw Error('Expected 162 retained exact source bindings');
  const records=audit.records.map(raw=>{
    const reviewed=review.records.find((r:any)=>r.id===raw.id);
    if(!reviewed)throw Error(`Unaccounted source ID ${raw.id}`);
    const ref=batch.records.find((r:any)=>r.id===raw.id);
    const binding=bindings.find(b=>b.id===raw.id);
    const parts:string[]=[];
    if(binding)for(let node:typeof binding.root|null=binding.root;node;node=node.parent){
      const index=parser.associations.get(node)?.nodes;if(index!==undefined)parts.unshift(parser.json.nodes[index].name);
    }
    const b=raw.boundsLocalEastNorth,width=b[2]!-b[0]!,depth=b[3]!-b[1]!;
    const narrow=Math.min(width,depth)<8;
    const overlaps=audit.pairs.filter(p=>p.overlapSquareMeters!==undefined&&p.ids.includes(raw.id));
    const pending=reviewed.stage==='SOURCE_ROUGH_UNREVIEWED';
    const ownershipHold=batch.excludedIds.includes(raw.id);
    const action=raw.id===standReference?'PRESERVE_REPLACED_STADIUM_SOURCE_REFERENCE_DO_NOT_REBUILD':!pending?'PRESERVE_EXISTING_WORK_OR_REFERENCE':ownershipHold?'HOLD_INDEPENDENT_PART_UNTIL_OWNERSHIP_EVIDENCE':
      raw.flags.includes('NON_RECTILINEAR_REVIEW_NOT_AUTOFIX')?'INDIVIDUAL_DIAGONAL_OR_CURVED_TRACE_REQUIRED':
      narrow?'INDIVIDUAL_SMALL_SOURCE_REVIEW_NO_NEIGHBOR_UNION':'TRACE_MAIN_BODY_FROM_REGISTERED_PLAN';
    return {...raw,stage:reviewed.stage,reviewSector:reviewed.reviewSector,planLabel:ref?.planLabel??null,
      sourceModelPath:parts.length?parts.join('/'):raw.id===standReference?standParts.join('/'):null,
      bindingStatus:binding?'EXACT_ORIGINAL_ENVELOPE':raw.id===standReference?'HISTORICAL_EXACT_STADIUM_STAND_REPLACED_IN_V005':replaced.has(raw.id)?'REFINED_REFERENCE_NOT_RENDERED_AS_SOURCE':'NO_RETAINED_SOURCE_ROOT_REVIEW_REQUIRED',
      bboxWidthMeters:width,bboxDepthMeters:depth,sourceOverlapWith:overlaps.map(p=>p.ids.find(id=>id!==raw.id)),
      nextAction:action,priority:!pending||raw.id===standReference?null:ownershipHold?4:narrow?3:raw.flags.includes('NON_RECTILINEAR_REVIEW_NOT_AUTOFIX')?2:1,
      geometryStatus:ref?'APPROXIMATE_DISPLAY_ONLY':'ORIGINAL_GIS_NOT_AS_BUILT_VERIFIED'};
  });
  const pending=records.filter(r=>r.stage==='SOURCE_ROUGH_UNREVIEWED');
  if(records.length!==166||new Set(records.map(r=>r.id)).size!==166||pending.length!==95)throw Error('Campus queue count mismatch');
  if(JSON.stringify(sources.buildings)!==before||sha(await readFile(sourcePath))!==sha(source)||sha(await readFile(modelPath))!==sha(model))throw Error('Protected source changed');
  const queue={schemaVersion:1,status:'WHOLE_CAMPUS_QC_AND_WORK_QUEUE_NOT_COMPLETE_MODEL',
    sourceSha256:sha(source),formalGlbSha256:sha(model),
    summary:{sourceFootprints:166,exactRetainedBindings:162,invalidSourceGeometries:audit.summary.invalidGeometryCount,
      duplicateSourceIds:audit.summary.duplicateIds,sourceOverlapPairs:audit.summary.sourceOverlapPairs,
      workingResidentialBodies:57,workingTeachingBodies:8,pendingSourceBodies:95,
      pendingMainTrace:pending.filter(r=>r.nextAction==='TRACE_MAIN_BODY_FROM_REGISTERED_PLAN').length,
      pendingDiagonalOrCurved:pending.filter(r=>r.nextAction==='INDIVIDUAL_DIAGONAL_OR_CURVED_TRACE_REQUIRED').length,
      pendingHistoricalSourceStand:pending.filter(r=>r.id===standReference).length,
      pendingSmallOrOwnership:pending.filter(r=>r.nextAction==='INDIVIDUAL_SMALL_SOURCE_REVIEW_NO_NEIGHBOR_UNION'||r.nextAction==='HOLD_INDEPENDENT_PART_UNTIL_OWNERSHIP_EVIDENCE').length},
    sectors:review.sectors,records,pendingIds:pending.sort((a,b)=>(a.priority??99)-(b.priority??99)||a.reviewSector.localeCompare(b.reviewSector)).map(r=>r.id),
    limitations:['QC validity and right angles are not proof of an as-built footprint.','Do not auto-union overlapping or nearby IDs.',
      'The 95 remaining source records include one historical replaced stadium stand; only 94 require further building review.','Retain surveyed authority data; plan work affects display only.',
      '162 exact retained bindings plus four removed/refined source references still account for all 166 source records.']};
  const target='../reference/buildings/campus_whole_school_queue_v001.json';
  if(process.argv.includes('--check'))deepStrictEqual(JSON.parse(await readFile(target,'utf8')),queue);
  else await writeFile(target,JSON.stringify(queue,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({target,mode:process.argv.includes('--check')?'READ_ONLY_REVALIDATED':'CREATED',...queue.summary},null,2));
}finally{disposeModel(scene);}
