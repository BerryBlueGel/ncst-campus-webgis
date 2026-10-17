import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {booleanValid,polygon,booleanPointInPolygon,intersect,featureCollection} from '@turf/turf';
import {Texture,Box3,Mesh,Raycaster,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RESIDENTIAL_PLAN_GEOMETRIES,residentialToWgs84,RESIDENTIAL_PLAN_PROVENANCE,residentialPresentation,residentialRasterToLocal} from '../src/gis/features/CampusResidentialPlan';
import {ringCornerErrors} from '../src/gis/features/RectilinearGeometry';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {createResidentialPlanPreview,residentialNodeName} from '../src/gis/three/CampusResidentialModel';
import {sourceBuildingBindings} from '../src/gis/three/SourceBuildingBindings';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {visibleInHierarchy} from '../src/gis/three/TeachingPlanModel';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
import {displayCollection} from '../src/gis/layers/CampusDisplayGeometry';
import {roofGroupGeometry,planDisplayId} from '../src/gis/layers/CampusPlanRoofGroups';
import {campusMapName} from '../src/gis/features/CampusMapNames';
import {buildingReviewSector} from '../src/gis/features/CampusBuildingReviewSectors';
import {ApiFeatureRepository} from '../src/gis/repositories/ApiFeatureRepository';
import {httpClient} from '../src/api/httpClient';
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(n=>[n,JSON.parse(readFileSync(`public/data/${n}.geojson`,'utf8'))])) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources);
// Interior points visibly outside the north/south white building bodies, not guessed holes.
const COURTS:[[number,number],string][]=[[[476,735],'orchid-04'],[[590,738],'orchid-03'],[[679,832],'orchid-01'],[[681,711],'orchid-02']];

test('fifty-seven reviewed residential bodies retain independent IDs and open courtyard gaps',()=>{
  assert.equal(new Set(RESIDENTIAL_PLAN_GEOMETRIES.map(r=>r.id)).size,57);
  for(const ref of RESIDENTIAL_PLAN_GEOMETRIES){
    assert.ok(booleanValid(polygon(ref.geometry.coordinates)),ref.sourceLabel);
    assert.ok(booleanValid(polygon(residentialToWgs84(ref.geometry).coordinates)));
    assert.ok(ref.maxRegularizationMeters<=RESIDENTIAL_PLAN_PROVENANCE.maxDisplacementMeters);
    if(ref.wallPolicy==='SHARED_RECTILINEAR_FRAME')
      assert.ok(Math.max(...ringCornerErrors(ref.geometry.coordinates[0]!.slice(0,-1) as [number,number][]))<1e-6);
    assert.equal(ref.geometry.coordinates.length,1,'open group courtyard is not falsely assigned to one building');
  }
  for(const [center,pair] of COURTS){
    const members=RESIDENTIAL_PLAN_GEOMETRIES.filter(r=>r.pair===pair);assert.equal(members.length,2);
    assert.equal(intersect(featureCollection(members.map(r=>polygon(r.geometry.coordinates)))),null,'north/south roofs do not overlap');
    assert.ok(members.every(r=>!booleanPointInPolygon(center,polygon(r.geometry.coordinates))),`${pair} clear courtyard`);
  }
});

test('copy-only residential display leaves source areas, IDs and nearby uncertain parts untouched',()=>{
  const data=sources.buildings,before=JSON.stringify(data),shown=displayCollection('buildings',data,true);
  for(const ref of RESIDENTIAL_PLAN_GEOMETRIES){
    assert.deepEqual(shown.features.find(f=>f.id===planDisplayId(ref.id))!.geometry,roofGroupGeometry(ref.id)??residentialToWgs84(ref.geometry));
    assert.deepEqual(repo.getById(ref.id)!.geometry,data.features.find(f=>f.id===ref.id)!.geometry);
    assert.equal(repo.getById(ref.id)!.name,campusMapName(ref.sourceLabel,ref.planLabel),'map reference names are now visible');
    assert.equal(repo.getById(ref.id)!.properties.sourceName,ref.sourceLabel,'authority source name retained');
    assert.deepEqual(displayCollection('buildings',data,false).features.find(f=>f.id===ref.id)!.geometry,data.features.find(f=>f.id===ref.id)!.geometry);
  }
  // Registered display groups do not merge or delete authority records.
  assert.equal(shown.features.some(f=>f.id==='buildings:cb64ee8051756c097c6b'),false,'047 is now grouped for 2D presentation only');
  for(const id of ['buildings:8c3f21b9a8bd43f5dbc2','buildings:5406aa5430d00212d9e7']){
    assert.equal(shown.features.find(f=>f.id===id),undefined);
    assert.deepEqual(repo.getById(id)!.geometry,data.features.find(f=>f.id===id)!.geometry);
  }
  assert.equal(JSON.stringify(data),before);
});

test('plan-label search aliases preserve API names, heights and source polygon identities',()=>{
  for(const ref of RESIDENTIAL_PLAN_GEOMETRIES){
    const original=repo.getById(ref.id)!,apiRecord={...original,name:'后端保留名称',aliases:[],properties:{height:22,heightStatus:'SURVEYED',area:1234}};
    const before=JSON.stringify(apiRecord),presented=residentialPresentation(apiRecord);
    assert.equal(presented.name,'后端保留名称');assert.equal(presented.geometry,apiRecord.geometry);
    assert.equal(presented.properties.height,22);assert.equal(presented.properties.area,1234);assert.equal(presented.properties.heightStatus,'SURVEYED');
    assert.ok(presented.aliases.includes(ref.planLabel));assert.equal(JSON.stringify(apiRecord),before);
    assert.ok(repo.search(ref.planLabel).some(f=>f.id===ref.id));
  }
});

test('API repository merges residential alias matches without suppressing backend failures or changing polygons',async()=>{
  const adapter=httpClient.defaults.adapter;
  const records=repo.getAll().map(f=>({...f,aliases:[],properties:{...f.properties}})),before=JSON.stringify(records);
  try{
    httpClient.defaults.adapter=async config=>({data:config.url==='/search'?[]:{features:records},status:200,statusText:'OK',headers:{},config});
    const api=new ApiFeatureRepository();await api.load();
    for(const ref of RESIDENTIAL_PLAN_GEOMETRIES){
      assert.equal(api.getById(ref.id)!.geometry,records.find(f=>f.id===ref.id)!.geometry);
      assert.equal(api.getById(ref.id)!.name,campusMapName(ref.sourceLabel,ref.planLabel));
      assert.ok(api.getById(ref.id)!.aliases.includes(ref.sourceLabel));
      assert.ok((await api.searchRemote(ref.planLabel)).some(f=>f.id===ref.id));
    }
    assert.equal(JSON.stringify(records),before);
    httpClient.defaults.adapter=async()=>{throw Error('Backend unavailable');};
    await assert.rejects(api.searchRemote('兰园4号楼北楼'),/Backend unavailable/);
  }finally{httpClient.defaults.adapter=adapter;}
});

test('real v005 residential replacement preserves exact source base/height, bindings and buffers through ten toggles',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'TEST_GEOMETRY_TEXTURES',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('public/models/campus_refined_v005.glb');
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  try{
    const bindings=sourceBuildingBindings(scene,repo.getAll());
    const originals=RESIDENTIAL_PLAN_GEOMETRIES.map(r=>bindings.find(b=>b.id===r.id)!.root as Mesh);
    const buffers=originals.map(o=>o.geometry.attributes.position!.array.slice());
    const control=createResidentialPlanPreview(scene,repo.getAll()),index=createCampusModelIndex(scene,repo.getAll());
    assert.equal(control.root.children.length,57);control.setEnabled(true);scene.updateMatrixWorld(true);
    for(const ref of RESIDENTIAL_PLAN_GEOMETRIES){
      const mesh=scene.getObjectByName(residentialNodeName(ref.id)) as Mesh,original=bindings.find(b=>b.id===ref.id)!.root;
      assert.equal(index.resolveFeatureId(mesh),ref.id);assert.equal(index.get(ref.id)!.length,2);
      const a=new Box3().setFromObject(original),b=new Box3().setFromObject(mesh);
      assert.ok(Math.abs(a.min.z-b.min.z)<1e-5);assert.ok(Math.abs(a.max.z-b.max.z)<1e-5);
      assert.equal(mesh.userData.heightStatus,'SOURCE_ROUGH_MODEL_NOT_SURVEYED');
      assert.equal(visibleInHierarchy(original),false);
    }
    for(const [center] of COURTS){
      const ray=new Raycaster(new Vector3(...center,100),new Vector3(0,0,-1));
      assert.equal(ray.intersectObject(control.root).length,0,'no roof at group courtyard point');
    }
    for(const center of [[480,615],[485,558]]){
      const ray=new Raycaster(new Vector3(center[0]!,center[1]!,100),new Vector3(0,0,-1));
      assert.equal(ray.intersectObject(control.root).length,0,'5 middle/south unroofed gap remains open');
    }
    const canteen=scene.getObjectByName(residentialNodeName('buildings:b1a16e4a0a003281a758'))!;
    assert.ok(new Raycaster(new Vector3(685,607,100),new Vector3(0,0,-1)).intersectObject(canteen).length>0,'roof seam does not cut a footprint void');
    for(let i=0;i<10;i++){control.setEnabled(false);assert.ok(originals.every(visibleInHierarchy));assert.equal(control.root.visible,false);control.setEnabled(true);}
    originals.forEach((o,i)=>assert.deepEqual(o.geometry.attributes.position!.array,buffers[i]));
    assert.throws(()=>createResidentialPlanPreview(scene,repo.getAll()),/Duplicate/);
  }finally{disposeModel(scene);}
});

test('second batch does not move any first-batch trace or regularized vertex',()=>{
  const previous=JSON.parse(readFileSync('../reference/buildings/residential_batch_v001.json','utf8'));
  for(const old of previous.records){
    const current=RESIDENTIAL_PLAN_GEOMETRIES.find(r=>r.id===old.id)!;
    assert.equal(current.batchVersion,'v001');
    assert.deepEqual(current.trace,old.tracePixels);
    assert.deepEqual(current.geometry,old.geometryLocal);
    assert.equal(current.maxRegularizationMeters,old.regularizationMeters);
  }
  assert.equal(RESIDENTIAL_PLAN_GEOMETRIES.filter(r=>r.batchVersion==='v002').length,4);
});

test('frozen second-batch inventory and cumulative export retain ten exact independent bindings',()=>{
  const review=JSON.parse(readFileSync('../reference/buildings/campus_building_review_v004.json','utf8'));
  const batch=JSON.parse(readFileSync('../reference/buildings/residential_batch_v002.json','utf8'));
  assert.equal(review.records.length,166);assert.equal(review.summary.otherSourceFootprints,142);
  assert.equal(review.summary.residentialWork,10);
  assert.equal(new Set(Object.values(review.sectors).flatMap((v:any)=>v.ids)).size,166);
  assert.equal(batch.records.length,10);assert.equal(batch.meshes,10);assert.equal(batch.triangles,192);
  assert.equal(new Set(batch.records.map((r:any)=>r.sourceModelPath)).size,10);
  for(const ref of RESIDENTIAL_PLAN_GEOMETRIES.filter(r=>r.batchVersion==='v001'||r.batchVersion==='v002')){
    const exported=batch.records.find((r:any)=>r.id===ref.id)!;
    assert.deepEqual(exported.geometryLocal,ref.geometry);assert.equal(exported.batchVersion,ref.batchVersion);
  }
  for(const id of batch.excludedIds)assert.equal(review.records.find((r:any)=>r.id===id).stage,'SOURCE_ROUGH_UNREVIEWED');
});

test('campus-wide living batch freezes thirteen preceding bodies and binds forty-four new IDs',()=>{
  const old=JSON.parse(readFileSync('../reference/buildings/residential_batch_v003.json','utf8'));
  const current=JSON.parse(readFileSync('../reference/buildings/residential_batch_v004.json','utf8'));
  const review=JSON.parse(readFileSync('../reference/buildings/campus_building_review_v006.json','utf8'));
  for(const previous of old.records){
    const ref=RESIDENTIAL_PLAN_GEOMETRIES.find(r=>r.id===previous.id)!;
    const exported=current.records.find((r:any)=>r.id===previous.id)!;
    assert.deepEqual(ref.geometry,previous.geometryLocal);assert.deepEqual(ref.trace,previous.tracePixels);
    for(const key of ['sourceModelPath','sourceBodyHeightMeters','sourceBaseElevationMeters','batchVersion','wallPolicy'])
      assert.equal(exported[key],previous[key]);
  }
  assert.equal(RESIDENTIAL_PLAN_GEOMETRIES.filter(r=>r.batchVersion==='v004').length,44);
  assert.equal(current.records.length,57);assert.equal(current.triangles,1568);
  assert.equal(new Set(current.records.map((r:any)=>r.sourceModelPath)).size,57);
  assert.equal(review.records.length,166);assert.equal(review.summary.residentialWork,57);
  assert.equal(review.summary.otherSourceFootprints,95);
  assert.equal(new Set(Object.values(review.sectors).flatMap((s:any)=>s.ids)).size,166);
  for(const id of current.excludedIds)assert.equal(review.records.find((r:any)=>r.id===id).stage,'SOURCE_ROUGH_UNREVIEWED');
});

test('whole-campus queue accounts for all source IDs and does not recreate the replaced stadium stand',()=>{
  const queue=JSON.parse(readFileSync('../reference/buildings/campus_whole_school_queue_v001.json','utf8'));
  assert.equal(queue.records.length,166);assert.equal(new Set(queue.records.map((r:any)=>r.id)).size,166);
  assert.equal(queue.summary.exactRetainedBindings,162);
  assert.equal(queue.records.filter((r:any)=>r.bindingStatus==='EXACT_ORIGINAL_ENVELOPE').length,162);
  assert.equal(queue.records.filter((r:any)=>r.bindingStatus==='NO_RETAINED_SOURCE_ROOT_REVIEW_REQUIRED').length,0);
  assert.equal(queue.summary.invalidSourceGeometries,0);assert.deepEqual(queue.summary.duplicateSourceIds,[]);
  assert.equal(queue.pendingIds.length,95);assert.equal(new Set(queue.pendingIds).size,95);
  assert.equal(queue.summary.pendingMainTrace+queue.summary.pendingDiagonalOrCurved+queue.summary.pendingSmallOrOwnership+queue.summary.pendingHistoricalSourceStand,95);
  const stand=queue.records.find((r:any)=>r.sourceLabel==='建筑 086');
  assert.equal(stand.sourceModelPath,'Area_03/TPX_Buildings/TPX_Buildings_1');
  assert.equal(stand.bindingStatus,'HISTORICAL_EXACT_STADIUM_STAND_REPLACED_IN_V005');
  assert.equal(stand.nextAction,'PRESERVE_REPLACED_STADIUM_SOURCE_REFERENCE_DO_NOT_REBUILD');assert.equal(stand.priority,null);
  for(const r of queue.records.filter((r:any)=>r.nextAction==='HOLD_INDEPENDENT_PART_UNTIL_OWNERSHIP_EVIDENCE')){
    assert.equal(r.stage,'SOURCE_ROUGH_UNREVIEWED');assert.equal(r.planLabel,null);
  }
});

test('bamboo chrysanthemum and plum courtyards are unroofed and all reviewed roofs are disjoint',()=>{
  const cropCourts:[number,number,number,number][]=[
    [700,2900,420,345],[700,2900,665,398],[700,2900,1255,338],[700,2900,1265,630],[700,2900,427,675],
    [3500,2600,204,480],[3500,2600,440,540],[3500,2600,201,788],[3500,2600,711,365],[3500,2600,711,655],
    [3500,3650,205,190],[3500,3650,435,190],[3500,3650,203,485],[3500,3650,443,495],
    [3500,3650,731,370],[3500,3650,943,375],[3500,3650,730,657],[3500,3650,945,708],
  ];
  for(const [col,row,x,y] of cropCourts){
    const point=residentialRasterToLocal([col+x-700,row+y-3600]);
    assert.ok(RESIDENTIAL_PLAN_GEOMETRIES.every(r=>!booleanPointInPolygon(point,polygon(r.geometry.coordinates))),`unroofed court ${col+x},${row+y}`);
  }
  for(let i=0;i<RESIDENTIAL_PLAN_GEOMETRIES.length;i++)for(let j=i+1;j<RESIDENTIAL_PLAN_GEOMETRIES.length;j++){
    const a=RESIDENTIAL_PLAN_GEOMETRIES[i]!,b=RESIDENTIAL_PLAN_GEOMETRIES[j]!;
    assert.equal(intersect(featureCollection([polygon(a.geometry.coordinates),polygon(b.geometry.coordinates)])),null,`${a.sourceLabel}/${b.sourceLabel}`);
  }
  for(const name of ['竹园食堂','梅园食堂']){
    const ref=RESIDENTIAL_PLAN_GEOMETRIES.find(r=>r.planLabel===name)!;
    assert.equal(ref.geometry.coordinates.length,1,'roof seam is not a fictitious courtyard');
  }
  const source097=repo.getById('buildings:838f69cbcb84b6bed2b2')!;
  assert.equal(residentialPresentation(source097).properties.planLabel,undefined,'detached source is not silently given north-dorm ownership');
});

test('third batch freezes both preceding batches without moving their vertices or heights',()=>{
  const previous=JSON.parse(readFileSync('../reference/buildings/residential_batch_v002.json','utf8'));
  const current=JSON.parse(readFileSync('../reference/buildings/residential_batch_v003.json','utf8'));
  for(const old of previous.records){
    const ref=RESIDENTIAL_PLAN_GEOMETRIES.find(r=>r.id===old.id)!;
    const exported=current.records.find((r:any)=>r.id===old.id)!;
    assert.deepEqual(ref.trace,old.tracePixels);assert.deepEqual(ref.geometry,old.geometryLocal);
    assert.equal(ref.batchVersion,old.batchVersion);assert.equal(ref.maxRegularizationMeters,old.regularizationMeters);
    assert.equal(exported.sourceModelPath,old.sourceModelPath);
    assert.equal(exported.sourceBodyHeightMeters,old.sourceBodyHeightMeters);
    assert.equal(exported.sourceBaseElevationMeters,old.sourceBaseElevationMeters);
  }
  const review=JSON.parse(readFileSync('../reference/buildings/campus_building_review_v005.json','utf8'));
  assert.equal(review.records.length,166);assert.equal(review.summary.residentialWork,13);
  assert.equal(review.summary.otherSourceFootprints,139);
  assert.equal(current.records.length,13);assert.equal(current.meshes,13);assert.equal(current.triangles,316);
  assert.equal(new Set(current.records.map((r:any)=>r.sourceModelPath)).size,13);
  assert.equal(new Set(Object.values(review.sectors).flatMap((s:any)=>s.ids)).size,166);
});

test('south dormitory keeps traced slanted boundaries, canteen roof seams are not extra buildings or holes',()=>{
  const south=RESIDENTIAL_PLAN_GEOMETRIES.find(r=>r.sourceLabel==='建筑 014')!;
  assert.equal(south.wallPolicy,'TRACED_NON_RECTILINEAR');assert.equal(south.maxRegularizationMeters,0);
  assert.deepEqual(south.geometry.coordinates[0]!.slice(0,-1),south.registered);
  assert.ok(Math.max(...ringCornerErrors(south.registered))>5,'not silently converted to rectangles');
  const canteen=RESIDENTIAL_PLAN_GEOMETRIES.filter(r=>r.planLabel==='兰园食堂');assert.equal(canteen.length,1);
  assert.equal(canteen[0]!.geometry.coordinates.length,1);
  assert.ok(booleanPointInPolygon([685,607],polygon(canteen[0]!.geometry.coordinates)));
  for(const center of [[480,615],[485,558]])
    assert.ok(RESIDENTIAL_PLAN_GEOMETRIES.every(r=>!booleanPointInPolygon(center,polygon(r.geometry.coordinates))));
});

test('missing source feature binding fails closed rather than hiding or guessing a model root',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURES',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('public/models/campus_refined_v005.glb');
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  try{const control=createResidentialPlanPreview(scene,[]);assert.equal(control.root.children.length,0);control.setEnabled(true);}
  finally{disposeModel(scene);}
});

test('frozen first-batch inventory still accounts for 166 records and its historical 146 remaining',()=>{
  const review=JSON.parse(readFileSync('../reference/buildings/campus_building_review_v003.json','utf8'));
  assert.equal(review.records.length,166);assert.equal(review.summary.otherSourceFootprints,146);
  const sectorIds=Object.values(review.sectors).flatMap((v:any)=>v.ids);
  assert.equal(sectorIds.length,166);assert.equal(new Set(sectorIds).size,166);
  for(const r of review.records)assert.equal(r.reviewSector,buildingReviewSector(r.boundsLocalEastNorth));
  assert.equal(review.records.filter((r:any)=>r.stage==='RESIDENTIAL_DISPLAY_V001_NOT_AS_BUILT').length,6);
  const batch=JSON.parse(readFileSync('../reference/buildings/residential_batch_v001.json','utf8'));
  assert.equal(batch.records.length,6);assert.equal(batch.meshes,6);assert.equal(batch.triangles,136);
  assert.ok(batch.records.every((r:any)=>r.sourceModelPath.startsWith('Area_')));
});
