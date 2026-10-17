import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {booleanValid,booleanPointInPolygon,intersect,featureCollection,feature,polygon} from '@turf/turf';
import {Texture,Box3,Mesh,Raycaster,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {SOUTHWEST_PLAN_GEOMETRIES,SOUTHWEST_DEFERRED_LABELS,southwestRasterToLocal} from '../src/gis/features/CampusSouthwestPlan';
import {ACADEMIC_PLAN_GEOMETRIES,academicPlanFor} from '../src/gis/features/CampusAcademicPlan';
import {RESIDENTIAL_PLAN_GEOMETRIES} from '../src/gis/features/CampusResidentialPlan';
import {createSouthwestPlanPreview,southwestNodeName} from '../src/gis/three/CampusSouthwestModel';
import {sourceBuildingBindings} from '../src/gis/three/SourceBuildingBindings';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {ApiFeatureRepository} from '../src/gis/repositories/ApiFeatureRepository';
import {httpClient} from '../src/api/httpClient';
import {displayCollection} from '../src/gis/layers/CampusDisplayGeometry';
import {campusMapName} from '../src/gis/features/CampusMapNames';
import {suppressedInPlanPreview} from '../src/gis/features/CampusPlanDispositions';
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(k=>[k,JSON.parse(readFileSync(`public/data/${k}.geojson`,'utf8'))])) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources);
const gaps=[[940,770],[1305,685],[950,290],[1390,550],[435,700],[1150,395]];
const polygons=SOUTHWEST_PLAN_GEOMETRIES.flatMap(r=>r.geometry.type==='Polygon'?[r.geometry]:r.geometry.coordinates.map(coordinates=>({type:'Polygon' as const,coordinates})));

test('southwest shared registration retains nine IDs, twelve disjoint roofs, open courtyards and diagonal edges',()=>{
  assert.equal(SOUTHWEST_PLAN_GEOMETRIES.length,9);assert.equal(polygons.length,12);
  assert.equal(new Set(SOUTHWEST_PLAN_GEOMETRIES.map(r=>r.id)).size,9);
  for(const r of SOUTHWEST_PLAN_GEOMETRIES){
    assert.ok(booleanValid(feature(r.geometry)),r.sourceLabel);assert.ok(repo.getById(r.id));
    const components=r.geometry.type==='Polygon'?[r.geometry.coordinates]:r.geometry.coordinates;
    assert.deepEqual(components.map(poly=>poly.map(ring=>ring.slice(0,-1))),r.tracePixels.map(poly=>poly.map(ring=>ring.map(southwestRasterToLocal))));
  }
  for(let i=0;i<polygons.length;i++)for(let j=i+1;j<polygons.length;j++)
    assert.equal(intersect(featureCollection([feature(polygons[i]!),feature(polygons[j]!)])),null);
  for(const r of SOUTHWEST_PLAN_GEOMETRIES)for(const other of [...RESIDENTIAL_PLAN_GEOMETRIES,...ACADEMIC_PLAN_GEOMETRIES])
    assert.equal(intersect(featureCollection([feature(r.geometry),polygon(other.geometry.coordinates)])),null);
  for(const [x,y] of gaps)assert.ok(polygons.every(p=>!booleanPointInPolygon(southwestRasterToLocal([x!,y!]),feature(p))),`gap ${x},${y}`);
});

test('southwest aliases and MultiPolygon display never rewrite authority geometry or deferred fragments',()=>{
  const before=JSON.stringify(sources),display=displayCollection('buildings',sources.buildings,true);
  for(const r of SOUTHWEST_PLAN_GEOMETRIES){
    const source=repo.getById(r.id)!;
    assert.equal(source.name,campusMapName(r.sourceLabel,r.planLabel));assert.ok(source.aliases.includes(r.sourceLabel));assert.ok(repo.search(r.planLabel).some(f=>f.id===r.id));
    assert.equal(display.features.find(f=>f.id===r.id)!.geometry.type,r.geometry.type);
    assert.deepEqual(displayCollection('buildings',sources.buildings,false).features.find(f=>f.id===r.id)!.geometry,source.geometry);
  }
  const queue=JSON.parse(readFileSync('../reference/buildings/campus_whole_school_queue_v003.json','utf8'));
  for(const label of SOUTHWEST_DEFERRED_LABELS){const row=queue.records.find((r:any)=>r.sourceLabel===`建筑 ${label}`)!;
    assert.equal(academicPlanFor(row.id),undefined);
    if(suppressedInPlanPreview(row.id))assert.equal(display.features.find(f=>f.id===row.id),undefined);
    else assert.deepEqual(display.features.find(f=>f.id===row.id)!.geometry,repo.getById(row.id)!.geometry);
    assert.deepEqual(displayCollection('buildings',sources.buildings,false).features.find(f=>f.id===row.id)!.geometry,repo.getById(row.id)!.geometry);
  }
  assert.equal(JSON.stringify(sources),before);
  for(const [query,label] of [['B区6号楼','建筑 004'],['B区8号楼南侧','建筑 004'],['B区5号楼北楼','建筑 027']])
    assert.ok(repo.search(query!).some(f=>f.aliases.includes(label!)),query);
});

test('southwest API search preserves original metadata and surfaces backend failures',async()=>{
  const features=repo.getAll(),adapter=httpClient.defaults.adapter;
  httpClient.defaults.adapter=async config=>({data:config.url==='/search'?[]:{features},status:200,statusText:'OK',headers:{},config});
  try{
    const api=new ApiFeatureRepository();await api.load();
    for(const r of SOUTHWEST_PLAN_GEOMETRIES){const original=repo.getById(r.id)!;
      assert.deepEqual(api.getById(r.id)!.geometry,original.geometry);assert.equal(api.getById(r.id)!.name,original.name);
      assert.ok((await api.searchRemote(r.planLabel)).some(f=>f.id===r.id));
    }
    assert.ok((await api.searchRemote('B区6号楼')).some(f=>f.aliases.includes('建筑 004')));
    assert.ok((await api.searchRemote('B区5号楼北楼')).some(f=>f.aliases.includes('建筑 027')));
    httpClient.defaults.adapter=async()=>{throw Error('Backend unavailable');};
    await assert.rejects(api.searchRemote('B区6号楼'),/Backend unavailable/);
  }finally{httpClient.defaults.adapter=adapter;}
});

test('actual v005 southwest meshes bind original IDs/heights, keep gaps empty and restore visibility ten times',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'GEOMETRY_TEST',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('public/models/campus_refined_v005.glb');
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  try{
    const bindings=sourceBuildingBindings(scene,repo.getAll()),originals=SOUTHWEST_PLAN_GEOMETRIES.map(r=>bindings.find(b=>b.id===r.id)!.root as Mesh);
    originals[0]!.visible=false;const visibility=originals.map(o=>o.visible);
    const buffers=originals.map(o=>o.geometry.attributes.position!.array.slice()),control=createSouthwestPlanPreview(scene,repo.getAll());
    assert.equal(control.root.children.length,9);control.setEnabled(true);scene.updateMatrixWorld(true);
    const index=createCampusModelIndex(scene,repo.getAll());
    for(const r of SOUTHWEST_PLAN_GEOMETRIES){const mesh=scene.getObjectByName(southwestNodeName(r.id))!;
      const source=bindings.find(b=>b.id===r.id)!.root,b=new Box3().setFromObject(source),roof=new Box3().setFromObject(mesh);
      assert.equal(index.resolveFeatureId(mesh),r.id);assert.equal(source.visible,false);
      assert.ok(Math.abs(roof.min.z-b.min.z)<0.001);assert.ok(Math.abs(roof.max.z-b.max.z)<0.001);
    }
    for(const [x,y] of gaps){const [east,north]=southwestRasterToLocal([x!,y!]);
      assert.equal(new Raycaster(new Vector3(east,north,100),new Vector3(0,0,-1)).intersectObject(control.root).length,0,`3D gap ${x},${y}`);
    }
    for(const [x,y] of [[1160,760],[1100,280]]){const [east,north]=southwestRasterToLocal([x!,y!]);
      assert.ok(new Raycaster(new Vector3(east,north,100),new Vector3(0,0,-1)).intersectObject(control.root).length>0);
    }
    for(let i=0;i<10;i++){control.setEnabled(false);assert.deepEqual(originals.map(o=>o.visible),visibility);control.setEnabled(true);}
    originals.forEach((o,i)=>assert.deepEqual(o.geometry.attributes.position!.array,buffers[i]));
    assert.throws(()=>createSouthwestPlanPreview(scene,repo.getAll()),/Duplicate/);
  }finally{disposeModel(scene);}
});

test('missing exact source bindings do not substitute neighbors or hide their original bodies',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'GEOMETRY_TEST',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('public/models/campus_refined_v005.glb');
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  try{
    const missing=SOUTHWEST_PLAN_GEOMETRIES[0]!,source=sourceBuildingBindings(scene,repo.getAll()).find(b=>b.id===missing.id)!.root;
    const control=createSouthwestPlanPreview(scene,repo.getAll().filter(f=>f.id!==missing.id));control.setEnabled(true);
    assert.equal(control.root.children.length,8);assert.equal(control.root.getObjectByName(southwestNodeName(missing.id)),undefined);
    assert.equal(source.visible,true);
  }finally{disposeModel(scene);}
});

test('versioned southwest pack accounts for all 166 sources while older packs and formal v005 are unchanged',()=>{
  const batch=JSON.parse(readFileSync('../reference/buildings/southwest_batch_v001.json','utf8'));
  const queue=JSON.parse(readFileSync('../reference/buildings/campus_whole_school_queue_v003.json','utf8'));
  const previous=JSON.parse(readFileSync('../reference/buildings/campus_whole_school_queue_v002.json','utf8'));
  assert.equal(batch.meshes,9);assert.equal(batch.roofComponents,12);assert.equal(batch.triangles,308);
  assert.equal(queue.records.length,166);assert.equal(queue.pendingIds.length,75);assert.equal(new Set(queue.pendingIds).size,75);
  assert.equal(queue.summary.workingAcademicBodies,20);assert.equal(queue.summary.workingResidentialBodies,57);assert.equal(queue.summary.workingTeachingBodies,8);
  assert.equal(queue.summary.pendingMainTrace+queue.summary.pendingDiagonalOrCurved+queue.summary.pendingSmallOrOwnership+queue.summary.pendingHistoricalSourceStand,75);
  for(const old of previous.records)if(!SOUTHWEST_PLAN_GEOMETRIES.some(r=>r.id===old.id))assert.deepEqual(queue.records.find((r:any)=>r.id===old.id),old);
  for(const r of SOUTHWEST_PLAN_GEOMETRIES){const exported=batch.records.find((b:any)=>b.id===r.id);
    assert.deepEqual(exported.geometryLocal,r.geometry);assert.ok(exported.sourceBodyHeightMeters>0);
  }
  const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
  assert.equal(sha('public/models/campus_refined_v005.glb'),'7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65');
  assert.equal(sha('public/data/buildings.geojson'),'118D98BA970E9FCE28074AFA5F29B5089B5BF02A487D2645A55D1A1529AED8F6');
  assert.equal(sha('../output/academic_area_preview_v001.glb'),'31647644FD2F04B698CA03E6DBA110173191C6766DB7CDDBB8D79B17E7D7CCF1');
  assert.equal(sha('../output/residential_area_preview_v004.glb'),'9374AE7557ECC931A2449F0BC64403C5E81F19668C52EE6077F6220AF0C57E6C');
});
