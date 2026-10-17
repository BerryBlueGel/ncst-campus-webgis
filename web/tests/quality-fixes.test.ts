import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {point,polygon} from '@turf/turf';
import {Group,Mesh,BoxGeometry,MeshBasicMaterial,Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {FeatureCollection} from 'geojson';
import {AnalysisManager} from '../src/gis/analysis/AnalysisManager';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import {sourceBuildingBindings} from '../src/gis/three/SourceBuildingBindings';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {createTeachingPlanPreview} from '../src/gis/three/TeachingPlanModel';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';

const a:[number,number]=[118.6,39.2],b:[number,number]=[118.601,39.201],c:[number,number]=[118.61,39.21],d:[number,number]=[118.611,39.211];
const square=polygon([[[118.6,39.2],[118.601,39.2],[118.601,39.201],[118.6,39.201],[118.6,39.2]]]);
const fixtures:FeatureSources={buildings:{type:'FeatureCollection',features:[{...square,id:'building',properties:{height:6}}]},sports:{type:'FeatureCollection',features:[]},
  landmarks:{type:'FeatureCollection',features:[{...point(b),id:'library',properties:{name:'图书馆'}}]},pois:{type:'FeatureCollection',features:[]}};
const manager=()=>new AnalysisManager(new StaticFeatureRepository(fixtures),()=> 'building');

test('changing point buffer radius recomputes geometry, result and selected radius together',()=>{
  const m=manager();m.activateTool('buffer');m.addPoint(a);const before=JSON.stringify(m.getState().resultGeometry);
  m.setRadius(300);assert.equal(m.getState().bufferRadius,300);assert.match(m.getResult()!.primary,/300 m/);
  assert.notEqual(JSON.stringify(m.getState().resultGeometry),before);
  assert.deepEqual(m.getState().inputGeometry!.geometry,point(a).geometry);
});
test('selected polygon buffer preserves source and selection when radius changes',()=>{
  const m=manager();m.bufferSelected();const source=m.getState().inputGeometry;
  m.setRadius(200);assert.equal(m.getState().inputGeometry,source);assert.match(m.getResult()!.primary,/200 m/);
});
test('invalid radius clears misleading old results and valid radius recovers the original input',()=>{
  const m=manager();m.bufferSelected();m.setRadius(NaN);
  assert.equal(m.getState().status,'error');assert.equal(m.getResult(),null);assert.equal(m.getState().resultGeometry,null);
  m.setRadius(100);assert.equal(m.getState().status,'ready');assert.match(m.getResult()!.primary,/100 m/);
});
test('second bbox starts new corners, clears previous results, and automatically completes',()=>{
  const m=manager();m.activateTool('bbox');m.addPoint(a);m.addPoint(b);
  assert.equal(m.getState().status,'ready');const original=JSON.stringify(m.getState().resultGeometry);
  m.addPoint(c);assert.deepEqual(m.getState().points,[c]);assert.equal(m.getResult(),null);assert.equal(m.getState().resultFeatures.length,0);
  m.addPoint(d);assert.deepEqual(m.getState().points,[c,d]);assert.equal(m.getState().status,'ready');
  assert.notEqual(JSON.stringify(m.getState().resultGeometry),original);
});
test('undo clears related feature list as well as geometry and measurements',()=>{
  const m=manager();m.activateTool('bbox');m.addPoint(a);m.addPoint(b);assert.ok(m.getState().resultFeatures.length);
  m.undo();assert.equal(m.getState().points.length,1);assert.equal(m.getState().resultFeatures.length,0);assert.equal(m.getResult(),null);
});
test('single-point tools retain only current click for both Turf and backend comparison',()=>{
  for(const tool of ['coordinate','buffer','nearest'] as const){const m=manager();m.activateTool(tool);m.addPoint(a);m.addPoint(c);
    assert.deepEqual(m.getState().points,[c]);assert.equal(m.getState().status,'ready');}
});
test('nearest category change recomputes current result without another map click',()=>{
  const m=manager();m.activateTool('nearest');m.addPoint(a);m.setCategory('landmark');
  assert.equal(m.getState().resultFeatures[0]!.id,'library');
  m.setCategory('stadium');assert.equal(m.getState().status,'error');assert.equal(m.getResult(),null);
});
test('completed measurements begin a fresh drawing on next click',()=>{
  const m=manager();m.activateTool('distance');m.addPoint(a);m.addPoint(b);m.complete();
  m.addPoint(c);assert.deepEqual(m.getState().points,[c]);assert.equal(m.getResult(),null);
});

function bindingFixture(){
  const root=new Group(),mesh=new Mesh(new BoxGeometry(20,30,6),new MeshBasicMaterial());
  mesh.name='TPX_Buildings_0';mesh.position.set(100,200,3);root.add(mesh);
  const ring=[[90,185],[110,185],[110,215],[90,215],[90,185]].map(p=>coordinates.localToWgs84(p as [number,number]));
  const repository=new StaticFeatureRepository({...fixtures,buildings:{type:'FeatureCollection',features:[{...polygon([ring]),id:'ordinary-building'}]}});
  return {root,mesh,feature:repository.getById('ordinary-building')!};
}
test('ordinary building binds by unique original envelope, not mesh name or feature order',()=>{
  const {root,mesh,feature}=bindingFixture();const before=JSON.stringify(feature);
  const index=createCampusModelIndex(root,[feature]);assert.equal(index.resolveFeatureId(mesh),feature.id);
  assert.equal(JSON.stringify(feature),before);disposeModel(root);
});
test('shifted and ambiguous GIS footprints never get guessed model bindings',()=>{
  const {root,mesh,feature}=bindingFixture();
  assert.equal(sourceBuildingBindings(root,[feature,{...feature,id:'other'}]).length,0);
  mesh.position.x+=0.1;assert.equal(sourceBuildingBindings(root,[feature]).length,0);disposeModel(root);
});
test('coincident model objects remain unbound rather than implicitly merged',()=>{
  const {root,mesh,feature}=bindingFixture();const copy=mesh.clone();copy.name='TPX_Buildings_1';root.add(copy);
  assert.equal(sourceBuildingBindings(root,[feature]).length,0);disposeModel(root);
});
test('real v005 binds all 162 retained source buildings without altering GIS or refined roots',async()=>{
  const read=(name:string)=>JSON.parse(readFileSync(`public/data/${name}.geojson`,'utf8')) as FeatureCollection;
  const repository=new StaticFeatureRepository({buildings:read('buildings'),sports:read('sports'),landmarks:read('landmarks'),pois:read('pois')});
  const before=JSON.stringify(repository.getAll());
  const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURES',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('public/models/campus_refined_v005.glb');
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  try{
    createTeachingPlanPreview(scene);
    const index=createCampusModelIndex(scene,repository.getAll());
    const buildings=repository.getByType('building');
    assert.equal(buildings.filter(f=>index.has(f.id)).length,162);
    // v005 removed these source bodies: two library footprints, auditorium,
    // and the east-01 stand. Their refined roots retain their business IDs.
    assert.deepEqual(buildings.filter(f=>!index.has(f.id)).map(f=>f.id).sort(),[
      'buildings:f0628c806053cd02be63','buildings:1a0bb5c5ce3fff43de3d',
      'buildings:29c44087930555db18c9','buildings:388e7ae428b6068062cb',
    ].sort());
    assert.ok(index.resolveFeatureId(scene.getObjectByName('TPX_Buildings_0')!));
    assert.equal(index.resolveFeatureId(scene.getObjectByName('LIBRARY_REFINED_ROOT')!),'library');
    assert.equal(JSON.stringify(repository.getAll()),before);
  }finally{disposeModel(scene);}
});
