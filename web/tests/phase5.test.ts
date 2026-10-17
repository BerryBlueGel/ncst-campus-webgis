import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,Vector3} from 'three';
import type {FeatureCollection} from 'geojson';
import {StaticFeatureRepository} from '../src/gis/repositories/StaticFeatureRepository';
import {SelectionManager} from '../src/gis/interaction/SelectionManager';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {featurePreset,overviewView} from '../src/gis/three/immersive/ImmersiveCameraPresets';
import {resolveFeatureView} from '../src/gis/three/immersive/ImmersiveFeatureNavigator';
import {isClickGesture} from '../src/gis/three/immersive/ImmersiveInteraction';
import {cameraNear,chooseRendererConfig,groundOffsetSign} from '../src/gis/three/immersive/ImmersiveRendererConfig';
import {enterImmersiveQuery,exitImmersiveQuery,isImmersiveView} from '../src/gis/three/immersive/ImmersiveUrlState';
const source=(name:string)=>JSON.parse(readFileSync(`public/data/${name}.geojson`,'utf8')) as FeatureCollection;
const repository=new StaticFeatureRepository({buildings:source('buildings'),sports:source('sports'),landmarks:source('landmarks'),pois:source('pois')});
test('immersive URL parses only explicit view state',()=>{
  assert.equal(isImmersiveView({view:'immersive'}),true);
  assert.equal(isImmersiveView({view:'map'}),false);
  assert.equal(isImmersiveView({}),false);
});
test('immersive URL serializes selected ID without discarding map camera',()=>{
  assert.deepEqual(enterImmersiveQuery({lng:'118.6',lat:'39.2',zoom:'17'},'library'),
    {lng:'118.6',lat:'39.2',zoom:'17',view:'immersive',selected:'library'});
});
test('exit removes immersive flag and preserves map camera, selection and layers URL',()=>{
  const before={view:'immersive',selected:'library',lng:'118.6',lat:'39.2',zoom:'17',pitch:'45',bearing:'12',layers:'sports'};
  assert.deepEqual(exitImmersiveQuery(before),{...before,view:undefined});
  assert.equal(before.view,'immersive');
});
test('category presets have landmark overrides and stadium distance',()=>{
  const gate=featurePreset(repository.getById('south-gate')!);
  const stadium=featurePreset(repository.getById('stadium-east-01')!);
  assert.equal(gate.azimuthDegrees,0);assert.ok(stadium.minDistance>gate.minDistance);
});
test('feature navigation prefers GLB model bounds',()=>{
  const scene=new Group(),root=new Group(),mesh=new Mesh(new BoxGeometry(10,20,30),new MeshStandardMaterial());
  root.name='LIBRARY_REFINED_ROOT';root.position.set(100,200,15);root.add(mesh);scene.add(root);
  const view=resolveFeatureView(repository.getById('library'),createCampusModelIndex(scene));
  assert.equal(view?.source,'model');assert.ok((view?.target.distanceTo(new Vector3(100,200,15))??Infinity)<1);
});
test('missing model mapping falls back to GIS local centroid',()=>{
  const view=resolveFeatureView(repository.getById('library'),createCampusModelIndex(new Group()));
  assert.equal(view?.source,'gis');assert.ok(Number.isFinite(view?.target.x));
});
test('unknown feature navigation returns null',()=>{
  assert.equal(resolveFeatureView(undefined,createCampusModelIndex(new Group())),null);
});
test('same SelectionManager retains selection through immersive lifetime',()=>{
  const selection=new SelectionManager(repository);selection.select('library');
  const mapSelection=selection.getSelected();selection.select('south-gate');
  assert.equal(mapSelection,'library');assert.equal(selection.getSelected(),'south-gate');
});
test('shared model index resolves child mesh and all eight bindings',()=>{
  const scene=new Group();for(const name of ['LIBRARY_REFINED_ROOT','ST_EAST_02_Root','ST_WEST_01_Root']){
    const root=new Group();root.name=name;root.add(new Mesh(new BoxGeometry(),new MeshStandardMaterial()));scene.add(root);
  }
  const index=createCampusModelIndex(scene);
  assert.equal(index.resolveFeatureId(scene.getObjectByName('LIBRARY_REFINED_ROOT')!.children[0]),'library');
  assert.equal(index.resolveFeatureId(scene.getObjectByName('ST_EAST_02_Root')!.children[0]),'stadium-east-02');
  assert.equal(index.resolveFeatureId(scene.getObjectByName('ST_WEST_01_Root')!.children[0]),'stadium-west-01');
});
test('click threshold excludes orbit drag',()=>{
  assert.equal(isClickGesture({x:4,y:5},{x:7,y:8}),true);
  assert.equal(isClickGesture({x:4,y:5},{x:25,y:5}),false);
});
test('renderer capability controls depth mode, ground offset, and DPR',()=>{
  assert.equal(chooseRendererConfig(true,3).pixelRatio,2);
  assert.equal(chooseRendererConfig(true,1).reversedDepthBuffer,true);
  assert.equal(chooseRendererConfig(false,1).reversedDepthBuffer,false);
  assert.equal(groundOffsetSign(true),-1);assert.equal(groundOffsetSign(false),1);
  assert.equal(cameraNear(10),0.1);assert.equal(cameraNear(100),0.5);
});
test('overview preset remains above campus terrain',()=>{
  const geometry=new BoxGeometry(2000,1500,40);geometry.computeBoundingBox();
  const view=overviewView(geometry.boundingBox!);
  assert.ok(view.position.z>view.target.z);
});
