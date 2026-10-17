import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Texture,Vector3} from 'three';
import {MODEL_HASH,MODEL_POINTS} from '../src/gis/three/CampusThreeConfig';
import {modelScale,prepareProjection,projectLocal,renderedLngLat,CampusModelAnchor} from '../src/gis/three/CampusModelTransform';
import {coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import {createLayerManager} from '../src/gis/layers/LayerManager';
import {CampusThreeLayer} from '../src/gis/three/CampusThreeLayer';
import {loadCampus} from '../src/gis/three/CampusModelLoader';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
import {Group,Mesh,BoxGeometry,MeshBasicMaterial} from 'three';
test('source and browser GLB are exact v005',()=>{
  for(const path of ['../output/campus_refined_v005.glb','public/models/campus_refined_v005.glb'])assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase(),MODEL_HASH);
});
test('unique anchor, positive metre scale, exact projection at campus corners',()=>{
  assert.ok(modelScale>0&&Number.isFinite(modelScale));
  assert.deepEqual(coordinates.localToWgs84([0,0]),[CampusModelAnchor.lng,CampusModelAnchor.lat]);
  for(const x of [0,1000,2000])for(const y of [0,1200,2400]) {
    const ll=renderedLngLat(projectLocal(new Vector3(x,y,0))),local=coordinates.wgs84ToLocal(ll);
    assert.ok(Math.hypot(local[0]-x,local[1]-y)<1e-6);
  }
});
test('GLTFLoader parses real model geometry; six actual roots retain alignment and hierarchy',async()=>{
  // Node has no image decoder. Texture decoding is separately checked in the real browser.
  const loader=new GLTFLoader();
  loader.register(()=>({name:'NODE_TEST_IMAGE_DECODER',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('public/models/campus_refined_v005.glb');
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const before:string[]=[];scene.traverse(o=>before.push(o.name));
  const rows=prepareProjection(scene);
  assert.equal(rows.length,6);assert.ok(Math.max(...rows.map(r=>r.meterError))<0.001);
  const after:string[]=[];scene.traverse(o=>after.push(o.name));assert.deepEqual(after,before);
  for(const p of MODEL_POINTS)assert.ok(scene.getObjectByName(p.node));
  for(const n of ['REFINED_BUILDINGS','REFINED_LANDMARKS','REFINED_SPORTS'])assert.ok(scene.getObjectByName(n));
});
test('custom layer contract and hide do not destroy or reload',()=>{
  const layer=new CampusThreeLayer(()=>{});assert.equal(layer.type,'custom');assert.equal(layer.renderingMode,'3d');
  layer.setVisible(true);assert.equal(layer.state.visible,true);layer.setVisible(false);assert.equal(layer.state.visible,false);assert.equal(layer.state.status,'idle');layer.onRemove();
});

test('unchanged selection does not schedule another 3D repaint',()=>{
  const layer=new CampusThreeLayer(()=>{});
  let paints=0;
  // Renderer-free contract: the map only needs a repaint when IDs change.
  Object.assign(layer,{map:{triggerRepaint:()=>paints++}});
  layer.setHighlight(null,null);assert.equal(paints,0);
  layer.setHighlight('library',null);assert.equal(paints,1);
  layer.setHighlight('library',null);assert.equal(paints,1);
  layer.setHighlight('library','south-gate');assert.equal(paints,2);
  layer.setHighlight(null,null);assert.equal(paints,3);
  layer.onRemove();
});

test('reapplying ground preference does not recompile unchanged materials',()=>{
  const layer=new CampusThreeLayer(()=>{}),material=new MeshBasicMaterial();
  material.polygonOffset=true;Object.assign(layer,{ground:new Set([material])});
  const version=material.version;
  layer.setGroundOffset(true);assert.equal(material.version,version);
  layer.setGroundOffset(false);assert.equal(material.polygonOffset,false);assert.equal(material.version,version+1);
  layer.setGroundOffset(false);assert.equal(material.version,version+1);
  layer.onRemove();material.dispose();
});
test('3D overlay suppresses duplicate surfaces and restores 2D preferences',()=>{
  const manager=createLayerManager();manager.hide('roads');
  manager.setCampus3DActive(true);assert.equal(manager.getState('buildings')!.visible,false);
  assert.equal(manager.getState('poi')!.visible,true);
  manager.show('buildings');assert.equal(manager.getState('buildings')!.visible,true);
  manager.setCampus3DActive(false);assert.equal(manager.getState('buildings')!.visible,true);assert.equal(manager.getState('roads')!.visible,false);
});
test('model HTTP failure is a catchable non-blocking error',async()=>{
  const original=globalThis.fetch;
  try {globalThis.fetch=async()=>new Response('',{status:404});await assert.rejects(loadCampus(new AbortController().signal),/HTTP 404/);}
  finally {globalThis.fetch=original;}
});
test('corrupt model is rejected before decoding',async()=>{
  const original=globalThis.fetch;
  try {globalThis.fetch=async()=>new Response('invalid glb');await assert.rejects(loadCampus(new AbortController().signal),/校验不符/);}
  finally {globalThis.fetch=original;}
});
test('destroy disposes shared Three resources exactly once',()=>{
  const root=new Group(),geometry=new BoxGeometry(),material=new MeshBasicMaterial();let geo=0,mat=0;
  geometry.addEventListener('dispose',()=>geo++);material.addEventListener('dispose',()=>mat++);
  root.add(new Mesh(geometry,material),new Mesh(geometry,material));disposeModel(root);
  assert.equal(geo,1);assert.equal(mat,1);assert.equal(root.children.length,0);
});
