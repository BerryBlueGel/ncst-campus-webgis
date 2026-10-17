import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {booleanValid,booleanPointInPolygon,intersect,featureCollection,polygon} from '@turf/turf';
import {Texture,Box3,Mesh,Raycaster,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ACADEMIC_PLAN_GEOMETRIES,academicPlanFor,academicPresentation} from '../src/gis/features/CampusAcademicPlan';
import {residentialRasterToLocal,RESIDENTIAL_PLAN_GEOMETRIES} from '../src/gis/features/CampusResidentialPlan';
import {createAcademicPlanPreview,academicNodeName} from '../src/gis/three/CampusAcademicModel';
import {sourceBuildingBindings} from '../src/gis/three/SourceBuildingBindings';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {ApiFeatureRepository} from '../src/gis/repositories/ApiFeatureRepository';
import {httpClient} from '../src/api/httpClient';
import {displayCollection} from '../src/gis/layers/CampusDisplayGeometry';
import {campusMapName} from '../src/gis/features/CampusMapNames';
import {suppressedInPlanPreview} from '../src/gis/features/CampusPlanDispositions';
import {planDisplayId,roofGroupGeometry} from '../src/gis/layers/CampusPlanRoofGroups';
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(k=>[k,JSON.parse(readFileSync(`public/data/${k}.geojson`,'utf8'))])) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources);
const crop=(x:number,y:number)=>residentialRasterToLocal([x+2800,y-2700]);
const gaps=[[500,765],[250,805],[820,827],[850,965],[810,1240],[800,1340]];
test('eleven individually registered academic bodies retain IDs, valid holes and an oblique wing',()=>{
  assert.equal(ACADEMIC_PLAN_GEOMETRIES.length,11);assert.equal(new Set(ACADEMIC_PLAN_GEOMETRIES.map(r=>r.id)).size,11);
  for(const r of ACADEMIC_PLAN_GEOMETRIES){assert.ok(booleanValid(polygon(r.geometry.coordinates)),r.sourceLabel);assert.ok(repo.getById(r.id));}
  assert.equal(ACADEMIC_PLAN_GEOMETRIES.filter(r=>r.geometry.coordinates.length>1).length,2);
  const diagonal=ACADEMIC_PLAN_GEOMETRIES.find(r=>r.sourceLabel==='建筑 161')!;
  assert.deepEqual(diagonal.geometry.coordinates[0]!.slice(0,-1),diagonal.tracePixels[0]!.map(([x,y])=>crop(x,y)));
  for(let i=0;i<ACADEMIC_PLAN_GEOMETRIES.length;i++)for(let j=i+1;j<ACADEMIC_PLAN_GEOMETRIES.length;j++)
    assert.equal(intersect(featureCollection([polygon(ACADEMIC_PLAN_GEOMETRIES[i]!.geometry.coordinates),polygon(ACADEMIC_PLAN_GEOMETRIES[j]!.geometry.coordinates)])),null);
  for(const r of ACADEMIC_PLAN_GEOMETRIES)for(const living of RESIDENTIAL_PLAN_GEOMETRIES)
    assert.equal(intersect(featureCollection([polygon(r.geometry.coordinates),polygon(living.geometry.coordinates)])),null);
  for(const [x,y] of gaps)assert.ok(ACADEMIC_PLAN_GEOMETRIES.every(r=>!booleanPointInPolygon(crop(x!,y!),polygon(r.geometry.coordinates))),`gap ${x},${y}`);
});
test('academic presentation/search and 2D replacements are copy-only; uncertain source fragments stay independent',()=>{
  const before=JSON.stringify(sources),display=displayCollection('buildings',sources.buildings,true);
  for(const r of ACADEMIC_PLAN_GEOMETRIES){
    const feature=repo.getById(r.id)!;const decorated=academicPresentation(feature);
    assert.equal(feature.name,campusMapName(r.sourceLabel,r.planLabel));assert.ok(feature.aliases.includes(r.sourceLabel));assert.equal(decorated.geometry,feature.geometry);
    assert.ok(repo.search(r.planLabel).some(f=>f.id===r.id));assert.notDeepEqual(display.features.find(f=>f.id===planDisplayId(r.id))!.geometry,feature.geometry);
    assert.deepEqual(displayCollection('buildings',sources.buildings,false).features.find(f=>f.id===r.id)!.geometry,feature.geometry);
  }
  const queue=JSON.parse(readFileSync('../reference/buildings/campus_whole_school_queue_v001.json','utf8'));
  for(const label of ['131','134','137','138','140','142','143','164']){
    const source=queue.records.find((r:any)=>r.sourceLabel===`建筑 ${label}`)!;
    assert.equal(academicPlanFor(source.id),undefined);
    if(suppressedInPlanPreview(source.id))assert.equal(display.features.find(f=>f.id===source.id),undefined);
    else if(planDisplayId(source.id)!==source.id)assert.equal(display.features.find(f=>f.id===source.id),undefined);
    else if(roofGroupGeometry(source.id))assert.deepEqual(display.features.find(f=>f.id===source.id)!.geometry,roofGroupGeometry(source.id));
    else assert.deepEqual(display.features.find(f=>f.id===source.id)!.geometry,repo.getById(source.id)!.geometry);
    assert.deepEqual(displayCollection('buildings',sources.buildings,false).features.find(f=>f.id===source.id)!.geometry,repo.getById(source.id)!.geometry);
  }
  assert.equal(JSON.stringify(sources),before);
});
test('API source metadata is preserved while academic plan aliases remain searchable',async()=>{
  const features=repo.getAll(),adapter=httpClient.defaults.adapter;
  httpClient.defaults.adapter=async config=>({data:config.url==='/search'?[]:{features},status:200,statusText:'OK',headers:{},config});
  try{
    const api=new ApiFeatureRepository();await api.load();
    for(const r of ACADEMIC_PLAN_GEOMETRIES){const original=repo.getById(r.id)!;
      assert.deepEqual(api.getById(r.id)!.geometry,original.geometry);assert.equal(api.getById(r.id)!.name,original.name);
      assert.ok((await api.searchRemote(r.planLabel)).some(f=>f.id===r.id));
    }
    httpClient.defaults.adapter=async()=>{throw Error('Backend unavailable');};
    await assert.rejects(api.searchRemote('D区1号楼主体'),/Backend unavailable/);
  }finally{httpClient.defaults.adapter=adapter;}
});
test('actual v005 academic preview binds exact originals; real roof holes and ten reversible toggles',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'GEOMETRY_TEST',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('public/models/campus_refined_v005.glb');
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  try{
    const bindings=sourceBuildingBindings(scene,repo.getAll()),originals=ACADEMIC_PLAN_GEOMETRIES.map(r=>bindings.find(b=>b.id===r.id)!.root as Mesh);
    const buffers=originals.map(o=>o.geometry.attributes.position!.array.slice()),control=createAcademicPlanPreview(scene,repo.getAll());
    assert.equal(control.root.children.length,11);control.setEnabled(true);scene.updateMatrixWorld(true);
    const index=createCampusModelIndex(scene,repo.getAll());
    for(const r of ACADEMIC_PLAN_GEOMETRIES){const mesh=scene.getObjectByName(academicNodeName(r.id))!;
      const source=bindings.find(b=>b.id===r.id)!.root,b=new Box3().setFromObject(source),roof=new Box3().setFromObject(mesh);
      assert.equal(index.resolveFeatureId(mesh),r.id);assert.equal(source.visible,false);
      assert.ok(Math.abs(roof.min.z-b.min.z)<0.001);assert.ok(Math.abs(roof.max.z-b.max.z)<0.001);
    }
    for(const [x,y] of gaps){const [east,north]=crop(x!,y!);
      assert.equal(new Raycaster(new Vector3(east,north,100),new Vector3(0,0,-1)).intersectObject(control.root).length,0,`3D gap ${x},${y}`);
    }
    const [east,north]=crop(500,670);assert.ok(new Raycaster(new Vector3(east,north,100),new Vector3(0,0,-1)).intersectObject(control.root).length>0);
    for(let i=0;i<10;i++){control.setEnabled(false);assert.ok(originals.every(o=>o.visible));control.setEnabled(true);}
    originals.forEach((o,i)=>assert.deepEqual(o.geometry.attributes.position!.array,buffers[i]));
    assert.throws(()=>createAcademicPlanPreview(scene,repo.getAll()),/Duplicate/);
  }finally{disposeModel(scene);}
});

test('versioned academic export and updated campus queue account for all 166 sources without rewriting previous batches',()=>{
  const batch=JSON.parse(readFileSync('../reference/buildings/academic_batch_v001.json','utf8'));
  const review=JSON.parse(readFileSync('../reference/buildings/campus_building_review_v007.json','utf8'));
  const queue=JSON.parse(readFileSync('../reference/buildings/campus_whole_school_queue_v002.json','utf8'));
  const previous=JSON.parse(readFileSync('../reference/buildings/campus_whole_school_queue_v001.json','utf8'));
  assert.equal(batch.meshes,11);assert.equal(batch.triangles,428);assert.equal(batch.records.length,11);
  assert.equal(new Set(batch.records.map((r:any)=>r.sourceModelPath)).size,11);
  assert.equal(review.records.length,166);assert.equal(review.summary.academicWork,11);assert.equal(review.summary.otherSourceFootprints,84);
  assert.equal(queue.pendingIds.length,84);assert.equal(new Set(queue.pendingIds).size,84);
  assert.equal(queue.summary.pendingMainTrace+queue.summary.pendingDiagonalOrCurved+queue.summary.pendingSmallOrOwnership+queue.summary.pendingHistoricalSourceStand,84);
  for(const old of previous.records){
    const current=queue.records.find((r:any)=>r.id===old.id);
    // Historical v002 pack is frozen to the original eleven NE records.
    if(!ACADEMIC_PLAN_GEOMETRIES.some(r=>r.id===old.id))assert.deepEqual(current,old);
    else assert.equal(current.sourceModelPath,old.sourceModelPath);
  }
  const sector=queue.sectors['northeast-academic-and-services'];assert.equal(sector.remaining,14);
  for(const r of ACADEMIC_PLAN_GEOMETRIES){const exported=batch.records.find((b:any)=>b.id===r.id);
    assert.deepEqual(exported.geometryLocal,r.geometry);assert.ok(exported.sourceBodyHeightMeters>0);
  }
});
