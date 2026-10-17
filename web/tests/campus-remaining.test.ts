import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {feature,booleanValid,booleanPointInPolygon,intersect,featureCollection} from '@turf/turf';
import {Texture,Box3,Mesh,Vector3,Raycaster} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {REMAINING_PLAN_GEOMETRIES as ROOFS,globalRasterToLocal} from '../src/gis/features/CampusRemainingPlan';
import {CAMPUS_PLAN_DISPOSITIONS as DECISIONS,EARLIER_OWNERSHIP_GAPS,planDispositionFor,suppressedInPlanPreview} from '../src/gis/features/CampusPlanDispositions';
import {ACADEMIC_PLAN_GEOMETRIES,academicPlanFor} from '../src/gis/features/CampusAcademicPlan';
import {RESIDENTIAL_PLAN_GEOMETRIES} from '../src/gis/features/CampusResidentialPlan';
import {SOUTHWEST_PLAN_GEOMETRIES} from '../src/gis/features/CampusSouthwestPlan';
import {TEACHING_PLAN_GEOMETRIES} from '../src/gis/features/TeachingPlanGeometry';
import {createRemainingPlanPreview,remainingNodeName} from '../src/gis/three/CampusRemainingModel';
import {sourceBuildingBindings} from '../src/gis/three/SourceBuildingBindings';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
import {displayCollection,featureForDisplayCamera} from '../src/gis/layers/CampusDisplayGeometry';
import {campusMapName} from '../src/gis/features/CampusMapNames';
import {planDisplayId,roofGroupGeometry} from '../src/gis/layers/CampusPlanRoofGroups';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {ApiFeatureRepository} from '../src/gis/repositories/ApiFeatureRepository';
import {httpClient} from '../src/api/httpClient';
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(k=>[k,JSON.parse(readFileSync(`public/data/${k}.geojson`,'utf8'))])) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources);
const gaps:[[number,number],...Array<[number,number]>]=[[4030,5050],[3930,5150],[4380,5120],[4410,5210],[3630,5540],[2730,5500],[3200,5470]];
async function load(){const loader=new GLTFLoader();loader.register(()=>({name:'GEOMETRY_TEST',loadTexture:()=>Promise.resolve(new Texture())}));
  const b=readFileSync('public/models/campus_refined_v005.glb');return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
test('whole-campus added roofs are individually registered, valid and nonoverlapping with ALL earlier batches',()=>{
  assert.equal(ROOFS.length,39);assert.equal(new Set(ROOFS.map(r=>r.id)).size,39);
  assert.equal(ROOFS.reduce((n,r)=>n+(r.geometry.type==='Polygon'?1:r.geometry.coordinates.length),0),40);
  for(let i=0;i<ROOFS.length;i++){
    const r=ROOFS[i]!;assert.ok(booleanValid(feature(r.geometry)),r.sourceLabel);assert.ok(repo.getById(r.id));
    const polys=r.geometry.type==='Polygon'?[r.geometry.coordinates]:r.geometry.coordinates;
    assert.deepEqual(polys.map(poly=>poly.map(ring=>ring.slice(0,-1))),r.tracePixels.map(poly=>poly.map(ring=>ring.map(globalRasterToLocal))));
    for(const other of [...ROOFS.slice(i+1),...ACADEMIC_PLAN_GEOMETRIES,...RESIDENTIAL_PLAN_GEOMETRIES,...SOUTHWEST_PLAN_GEOMETRIES,...TEACHING_PLAN_GEOMETRIES])
      assert.equal(intersect(featureCollection([feature(r.geometry),feature(other.geometry)])),null,`${r.sourceLabel}/${other.id}`);
  }
  for(const p of gaps)assert.ok(ROOFS.every(r=>!booleanPointInPolygon(globalRasterToLocal(p),feature(r.geometry))),`passage ${p}`);
  const gym=ROOFS.find(r=>r.sourceLabel==='建筑 099')!;assert.ok(gym.tracePixels[0]![0]!.length>12);
  assert.equal(ROOFS.find(r=>r.sourceLabel==='建筑 101')!.geometry.type,'MultiPolygon');
  // Independent, full-resolution reference points catch an accidentally traced
  // resized screenshot (self-consistency alone would not catch that offset).
  for(const [label,pixel] of [['144',[4200,2730]],['145',[4200,2580]],['158',[3800,2680]],['156',[3770,3050]],['154',[3870,3150]],['074',[1320,2580]]] as const){
    const r=ROOFS.find(r=>r.sourceLabel===`建筑 ${label}`)!;
    assert.ok(booleanPointInPolygon(globalRasterToLocal([...pixel]),feature(r.geometry)),`native-raster roof ${label}`);
  }
});
test('plan-only suppression and roof replacement NEVER mutate source geometry, IDs or repository analysis',()=>{
  const original=JSON.stringify(sources),on=displayCollection('buildings',sources.buildings,true),off=displayCollection('buildings',sources.buildings,false);
  for(const r of ROOFS){const f=repo.getById(r.id)!;assert.equal(f.name,campusMapName(r.sourceLabel,r.planLabel));assert.ok(f.aliases.includes(r.sourceLabel));assert.equal(academicPlanFor(r.id),r);
    assert.ok(repo.search(r.planLabel).some(f=>f.id===r.id));
    if(planDisplayId(r.id)===r.id)assert.equal(on.features.find(f=>f.id===r.id)!.geometry.type,roofGroupGeometry(r.id)?.type??r.geometry.type);
    else assert.equal(on.features.find(f=>f.id===r.id),undefined,'reviewed display member is represented by root');
    assert.deepEqual(off.features.find(f=>f.id===r.id)!.geometry,f.geometry);}
  for(const r of DECISIONS){const f=repo.getById(r.id)!;assert.ok(f);
    if(suppressedInPlanPreview(r.id))assert.equal(on.features.find(f=>f.id===r.id),undefined);
    else if(planDisplayId(r.id)!==r.id)assert.equal(on.features.find(f=>f.id===r.id),undefined);
    else if(roofGroupGeometry(r.id))assert.deepEqual(on.features.find(f=>f.id===r.id)!.geometry,roofGroupGeometry(r.id));
    else assert.deepEqual(on.features.find(f=>f.id===r.id)!.geometry,f.geometry);
    assert.deepEqual(off.features.find(f=>f.id===r.id)!.geometry,f.geometry);
  }
  assert.equal(JSON.stringify(sources),original);assert.equal(repo.getAll().filter(f=>f.category==='building').length,166);
});
test('remaining API aliases remain searchable, authority geometry unchanged and backend failure is not masked',async()=>{
  const adapter=httpClient.defaults.adapter,features=repo.getAll();
  httpClient.defaults.adapter=async config=>({data:config.url==='/search'?[]:{features},status:200,statusText:'OK',headers:{},config});
  try{const api=new ApiFeatureRepository();await api.load();for(const r of ROOFS){
    assert.deepEqual(api.getById(r.id)!.geometry,repo.getById(r.id)!.geometry);assert.ok((await api.searchRemote(r.planLabel)).some(f=>f.id===r.id));}
    httpClient.defaults.adapter=async()=>{throw Error('Backend unavailable');};await assert.rejects(api.searchRemote('C区1号楼'),/Backend unavailable/);
  }finally{httpClient.defaults.adapter=adapter;}
});
test('39 actual v005 roof bindings retain base/height, pick stable IDs, preserve source buffers and toggle ten times',async()=>{
  const {scene}=await load();try{
    const bindings=sourceBuildingBindings(scene,repo.getAll()),control=createRemainingPlanPreview(scene,repo.getAll());
    const originals=[...ROOFS,...DECISIONS.filter(r=>r.suppressed)].map(r=>bindings.find(b=>b.id===r.id)!.root as Mesh);
    const bytes=originals.map(o=>o.geometry.attributes.position!.array.slice());
    control.setEnabled(true);scene.updateMatrixWorld(true);const index=createCampusModelIndex(scene,repo.getAll());
    assert.equal(control.root.children.length,39);assert.ok(originals.every(o=>!o.visible));
    for(const r of ROOFS){const mesh=scene.getObjectByName(remainingNodeName(r.id))!,source=bindings.find(b=>b.id===r.id)!.root;
      const a=new Box3().setFromObject(mesh),b=new Box3().setFromObject(source);
      assert.equal(index.resolveFeatureId(mesh),r.id);assert.ok(Math.abs(a.min.z-b.min.z)<0.001);assert.ok(Math.abs(a.max.z-b.max.z)<0.001);
    }
    for(const p of gaps){const [x,y]=globalRasterToLocal(p);assert.equal(new Raycaster(new Vector3(x,y,100),new Vector3(0,0,-1)).intersectObject(control.root).length,0,`3D passage ${p}`);}
    for(let n=0;n<10;n++){control.setEnabled(false);assert.ok(originals.every(o=>o.visible));control.setEnabled(true);}
    originals.forEach((o,i)=>assert.deepEqual(o.geometry.attributes.position!.array,bytes[i]));
    for(const r of DECISIONS.filter(r=>r.status==='OWNER_OR_ROOF_SCOPE_UNCERTAIN'))assert.equal(bindings.find(b=>b.id===r.id)!.root.visible,true);
    assert.throws(()=>createRemainingPlanPreview(scene,repo.getAll()),/Duplicate/);
  }finally{disposeModel(scene);}
});
test('missing exact source never substitutes a neighbor; initially hidden original visibility is restored',async()=>{
  const {scene}=await load();try{
    const bindings=sourceBuildingBindings(scene,repo.getAll()),missing=ROOFS[0]!,hidden=bindings.find(b=>b.id===ROOFS[1]!.id)!.root;
    hidden.visible=false;const control=createRemainingPlanPreview(scene,repo.getAll().filter(f=>f.id!==missing.id));control.setEnabled(true);
    assert.equal(control.root.children.length,38);assert.equal(scene.getObjectByName(remainingNodeName(missing.id)),undefined);
    assert.equal(bindings.find(b=>b.id===missing.id)!.root.visible,true);control.setEnabled(false);assert.equal(hidden.visible,false);
  }finally{disposeModel(scene);}
});
test('all 166 source records accounted for, 75 individually reviewed, TWELVE evidence gaps explicitly NOT marked modeled',()=>{
  const before=JSON.parse(readFileSync('../reference/buildings/campus_whole_school_queue_v003.json','utf8'));
  const after=JSON.parse(readFileSync('../reference/buildings/campus_whole_school_queue_v004.json','utf8'));
  const pack=JSON.parse(readFileSync('../reference/buildings/remaining_batch_v001.json','utf8'));
  assert.equal(after.records.length,166);assert.equal(new Set(after.records.map((r:any)=>r.id)).size,166);assert.deepEqual(after.unreviewedIds,[]);
  assert.equal(after.pendingIds.length,12);assert.equal(after.summary.newBatchEvidenceGaps,9);assert.equal(after.summary.previousEvidenceGaps,3);
  assert.equal(after.summary.workingRoofSourceIds,124);assert.equal(after.summary.planQcReviewedSourceRecords,166);
  assert.equal(pack.meshes,39);assert.equal(pack.roofComponents,40);assert.equal(pack.triangles,1240);
  assert.equal(pack.dispositions.length,36);assert.equal(pack.libraryCoverage.length,2);assert.ok(pack.libraryCoverage.every((r:any)=>r.coveredSamples===5));
  for(const r of before.records){const current=after.records.find((a:any)=>a.id===r.id)!;
    if(r.stage!=='SOURCE_ROUGH_UNREVIEWED')assert.deepEqual(current,r);
    else assert.notEqual(current.stage,'SOURCE_ROUGH_UNREVIEWED');
    assert.equal(current.sourceModelPath,r.sourceModelPath);
  }
  for(const id of after.pendingIds){assert.ok(['PLAN_QC_OWNER_OR_ROOF_SCOPE_UNCERTAIN','INDEPENDENT_PART_OWNERSHIP_UNVERIFIED'].includes(after.records.find((r:any)=>r.id===id).stage));assert.equal(academicPlanFor(id),undefined);
    assert.equal(planDispositionFor(id)?.suppressed,false);}
  assert.deepEqual(after.records.filter((r:any)=>r.stage.includes('UNVERIFIED')).map((r:any)=>r.id).sort(),EARLIER_OWNERSHIP_GAPS.map(r=>r.id).sort());
  assert.equal(after.summary.workingRoofSourceIds+36+3+3,166); // Three earlier refined references + three earlier unresolved parts.
});
test('camera bounds enclose every displayed roof component without replacing authority geometry or measurements',()=>{
  const repo=new StaticFeatureRepository(sources);
  for(const roof of ROOFS){const source=repo.getById(roof.id)!,snapshot=JSON.stringify(source),camera=featureForDisplayCamera(source,true);
    assert.equal(camera.id,source.id);assert.equal(camera.geometry,source.geometry);assert.equal(camera.properties,source.properties);
    const display=displayCollection('buildings',{type:'FeatureCollection',features:[{type:'Feature',id:source.id,properties:{},geometry:source.geometry}]},true).features[0]!;
    const rings=display.geometry.type==='Polygon'?display.geometry.coordinates:display.geometry.type==='MultiPolygon'?display.geometry.coordinates.flat():[];
    for(const ring of rings)for(const p of ring){assert.ok(p[0]!>=camera.bounds![0][0]&&p[0]!<=camera.bounds![1][0]);assert.ok(p[1]!>=camera.bounds![0][1]&&p[1]!<=camera.bounds![1][1]);}
    assert.equal(JSON.stringify(source),snapshot);assert.equal(featureForDisplayCamera(source,false),source);
  }
});
test('camera fallback preserves suppressed and unresolved originals instead of inventing display targets',()=>{
  const repo=new StaticFeatureRepository(sources);
  for(const record of DECISIONS.filter(r=>suppressedInPlanPreview(r.id))){
    const source=repo.getById(record.id)!;assert.equal(featureForDisplayCamera(source,true),source);
  }
});
test('protected formal model, authority GIS and ALL prior exported roof batches stay byte-identical',()=>{
  const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
  for(const path of ['../output/campus_refined_v005.glb','public/models/campus_refined_v005.glb'])assert.equal(sha(path),'7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65');
  assert.equal(sha('public/data/buildings.geojson'),'118D98BA970E9FCE28074AFA5F29B5089B5BF02A487D2645A55D1A1529AED8F6');
  assert.equal(sha('../output/academic_area_preview_v001.glb'),'31647644FD2F04B698CA03E6DBA110173191C6766DB7CDDBB8D79B17E7D7CCF1');
  assert.equal(sha('../output/residential_area_preview_v004.glb'),'9374AE7557ECC931A2449F0BC64403C5E81F19668C52EE6077F6220AF0C57E6C');
  assert.equal(sha('../output/southwest_area_preview_v001.glb'),'D54ED38756D859004A0E4D2806E12E40E8D6AB70A3AFD3E89EDCE1546BAFFDFD');
});
