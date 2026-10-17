import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { FeatureCollection } from 'geojson';
import { bbox } from '@turf/turf';
import { Box3, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { StaticFeatureRepository, type FeatureSources } from '../src/gis/repositories/StaticFeatureRepository';
import { ApiFeatureRepository } from '../src/gis/repositories/ApiFeatureRepository';
import { httpClient } from '../src/api/httpClient';
import { TEACHING_BUILDINGS, TEACHING_MODEL_BINDINGS, ROUGH_HEIGHT_STATUS, teachingPresentation, teachingRelatedIds } from '../src/gis/features/TeachingBuildingPresentation';
import { displayProperties } from '../src/gis/interaction/FeatureDisplayConfig';
import { hideDiagnosticContours, modelAtPath } from '../src/gis/three/CampusModelPresentation';
import { createCampusModelIndex } from '../src/gis/three/ModelNodeIndex';
import { coordinates } from '../src/gis/coordinate/CampusCoordinateService';
import { resolveFeatureView } from '../src/gis/three/immersive/ImmersiveFeatureNavigator';
import { disposeModel } from '../src/gis/three/ThreeResourceManager';

const read=(name:string)=>JSON.parse(readFileSync(`public/data/${name}.geojson`,'utf8')) as FeatureCollection;
const sources:FeatureSources={buildings:read('buildings'),sports:read('sports'),landmarks:read('landmarks'),pois:read('pois')};
const repo=new StaticFeatureRepository(sources);

test('eight teaching plan labels use stable IDs, not array position',()=>{
  const reordered=new StaticFeatureRepository({...sources,buildings:{...sources.buildings,features:[...sources.buildings.features].reverse()}});
  assert.equal(TEACHING_BUILDINGS.length,8);
  for(const ref of TEACHING_BUILDINGS){
    const feature=repo.getById(ref.id)!;
    assert.equal(feature.name,`${ref.name}（${ref.block} 座）`);
    assert.equal(reordered.getById(ref.id)!.name,feature.name);
    assert.equal(repo.search(ref.name)[0]!.id,ref.id);
    assert.equal(repo.search(ref.sourceLabel)[0]!.id,ref.id);
    assert.equal(repo.search(`${ref.block}座`)[0]!.id,ref.id);
    assert.equal(repo.resolveGis('campus-buildings',ref.id),ref.id);
  }
});

test('presentation decoration preserves source geometry, bounds, bindings and IDs',()=>{
  for(const ref of TEACHING_MODEL_BINDINGS){
    const feature=repo.getById(ref.id)!,before=JSON.stringify(feature),copy=teachingPresentation(feature);
    assert.equal(copy.id,feature.id);assert.equal(copy.geometry,feature.geometry);
    assert.equal(copy.centroid,feature.centroid);assert.equal(copy.bounds,feature.bounds);
    assert.equal(copy.gisBindings,feature.gisBindings);assert.equal(JSON.stringify(feature),before);
    assert.equal(copy.refined,false);
  }
  assert.equal(repo.getAll().length,sources.buildings.features.length+8);
});

test('nearby fragments stay independent selectable features with explicit uncertainty',()=>{
  const main=TEACHING_BUILDINGS[1]!;
  const parts=teachingRelatedIds(main.id);assert.equal(parts.length,2);
  for(const id of parts){
    const part=repo.getById(id)!;
    assert.ok(part.name.startsWith(main.name));assert.equal(part.properties.identityKind,'UNCERTAIN_FRAGMENT');assert.match(part.description,/未合并/);
    assert.equal(repo.resolveGis('campus-buildings',id),id);
    assert.deepEqual(teachingRelatedIds(id),[main.id]);
    assert.equal(main.id===part.id,false);
  }
  for(const ref of TEACHING_BUILDINGS.filter(x=>x.planConnection))assert.match(repo.getById(ref.id)!.description,/连廊轮廓与实建状态待核实/);
});

test('default 6m height is visibly non-surveyed, and explicit API height quality is preserved',()=>{
  const feature=repo.getById(TEACHING_BUILDINGS[0]!.id)!;
  assert.equal(feature.properties.heightStatus,ROUGH_HEIGHT_STATUS);
  assert.ok(displayProperties(feature).some(row=>row.label==='源粗模高度（非实测）'&&row.value==='6.0 m'));
  assert.ok(displayProperties(feature).some(row=>row.label==='楼名依据'&&row.value.includes('非现行官方目录')));
  const surveyed=teachingPresentation({...feature,properties:{height:22.3,heightStatus:'SURVEYED'}});
  assert.equal(surveyed.properties.heightStatus,'SURVEYED');assert.equal(surveyed.properties.height,22.3);
});

test('API mode applies same labels and merges plan-name matches into remote search without changing API geometry',async()=>{
  const old=httpClient.defaults.adapter;
  const records=repo.getAll().map(feature=>({...feature,name:String(feature.properties.sourceLabel??feature.name),aliases:[],modelBinding:undefined,properties:{height:6}}));
  const before=JSON.stringify(records);
  try{
    httpClient.defaults.adapter=async config=>({data:config.url==='/search'?[]:{features:records},status:200,statusText:'OK',headers:{},config});
    const api=new ApiFeatureRepository();await api.load();
    for(const ref of TEACHING_BUILDINGS){
      assert.equal(api.getById(ref.id)!.name,repo.getById(ref.id)!.name);
      assert.equal(api.getById(ref.id)!.geometry,records.find(f=>f.id===ref.id)!.geometry);
      assert.equal((await api.searchRemote(ref.name))[0]!.id,ref.id);
    }
    assert.equal(JSON.stringify(records),before);
    httpClient.defaults.adapter=async()=>{throw Error('Backend unavailable');};
    await assert.rejects(api.searchRemote('知行楼'),/Backend unavailable/);
  }finally{httpClient.defaults.adapter=old;}
});

test('real v005 mesh paths bind all eleven source IDs with matching bounds; hide only 109 contour lines',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURES',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('public/models/campus_refined_v005.glb');
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  try{
    scene.updateMatrixWorld(true);
    const before=new Map<string,boolean>();scene.traverse(o=>before.set(o.uuid,o.visible));
    const index=createCampusModelIndex(scene);
    for(const binding of TEACHING_MODEL_BINDINGS){
      const object=modelAtPath(scene,binding.path)!;assert.ok(object,binding.path);
      assert.equal(index.get(binding.id)!.length,1);assert.equal(index.resolveFeatureId(object),binding.id);
      const bounds=new Box3().setFromObject(object),f=repo.getById(binding.id)!;
      const g=f.geometry;assert.ok(g.type==='Polygon'||g.type==='MultiPolygon');
      const local=(g.type==='Polygon'?[g.coordinates]:g.coordinates).flat(2).map(p=>coordinates.wgs84ToLocal([p[0]!,p[1]!]));
      const expected=[Math.min(...local.map(p=>p[0])),Math.min(...local.map(p=>p[1])),Math.max(...local.map(p=>p[0])),Math.max(...local.map(p=>p[1]))];
      assert.ok([bounds.min.x,bounds.min.y,bounds.max.x,bounds.max.y].every((v,i)=>Math.abs(v-expected[i]!)<0.001));
      assert.equal(resolveFeatureView(f,index)!.source,'model');
      assert.ok(bbox({type:'Feature',properties:{},geometry:g}).every(Number.isFinite));
    }
    assert.equal(hideDiagnosticContours(scene),109);
    let changed=0;scene.traverse(o=>{if(o.visible!==before.get(o.uuid)){changed++;assert.ok((o as any).isLine);}});
    assert.equal(changed,109);assert.equal(hideDiagnosticContours(scene),109);
    assert.equal(scene.getObjectByName('LIBRARY_REFINED_ROOT')!.visible,true);
    assert.equal(scene.getObjectByName('AUDITORIUM_REFINED_ROOT')!.visible,true);
  }finally{disposeModel(scene);}
});

test('protected original and served GIS/model assets stay unchanged',()=>{
  const hashes:Record<string,string>={
    '../output/campus_refined_v005.glb':'7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65',
    'public/models/campus_refined_v005.glb':'7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65',
    '../output/geojson/buildings.geojson':'88C83542D2FB6702B4EFB258491DEA4DBD18A5B08BFE6642FD2C0A6A526E72EE',
    'public/data/buildings.geojson':'118D98BA970E9FCE28074AFA5F29B5089B5BF02A487D2645A55D1A1529AED8F6',
  };
  for(const [path,hash] of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase(),hash);
});
