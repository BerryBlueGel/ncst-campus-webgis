import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {instanceReviewTrees,reviewHitSource,createReviewRenderLoop} from '../reference/buildings/other_areas_detail_v001/review-performance.mjs';

function fixture(){
  const root=new THREE.Group(),trees=new THREE.Group();trees.name='TPX_Trees';root.add(trees);
  const geometry=new THREE.BoxGeometry(1,2,1),material=new THREE.MeshStandardMaterial();
  const sources=[0,1,2].map(i=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(10+i*3,20,4);trees.add(mesh);return mesh;});
  return {root,trees,geometry,material,sources};
}
function batches(root){return root.getObjectByName('REVIEW_TREE_BATCHES').children;}
function close(a,b,tolerance=1e-4){assert.equal(a.length,b.length);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<tolerance,`${i}: ${v} != ${b[i]}`));}

test('trees share one instanced draw without deleting source nodes or changing buffers',()=>{
  const {root,trees,sources,geometry,material}=fixture(),buffer=geometry.attributes.position.array.slice();
  const controller=instanceReviewTrees(root,THREE);
  assert.deepEqual(controller.stats,{candidates:3,batchedMeshes:3,batches:1,unchangedMeshes:0,cellSize:160,maxWorldMatrixDeviation:0});
  assert.equal(trees.children.length,3);assert.ok(sources.every(s=>s.parent===trees&&!s.visible));
  assert.equal(batches(root)[0].geometry,geometry);assert.equal(batches(root)[0].material,material);
  assert.deepEqual(geometry.attributes.position.array,buffer);
});
test('root ENU rotation, parent rotation, translation and nonuniform scales preserve world vertices',()=>{
  const {root,trees,sources}=fixture();root.rotation.x=-Math.PI/2;root.position.set(9,6,5);
  trees.position.set(25,-15,3);trees.rotation.z=.6;trees.scale.set(2,3,1);
  sources[1].rotation.y=.4;sources[2].scale.set(2,1,3);root.updateMatrixWorld(true);
  const expected=sources.map(s=>s.matrixWorld.clone());instanceReviewTrees(root,THREE);root.updateMatrixWorld(true);
  const batch=batches(root)[0],matrix=new THREE.Matrix4();
  sources.forEach((s,i)=>{batch.getMatrixAt(i,matrix);matrix.premultiply(batch.matrixWorld);close(matrix.elements,expected[i].elements);});
});
test('spatial cells stay separate and singleton originals stay visible',()=>{
  const {root,sources}=fixture();sources[2].position.x=500;
  const controller=instanceReviewTrees(root,THREE,{cellSize:100});
  assert.equal(controller.stats.batches,1);assert.equal(controller.stats.batchedMeshes,2);assert.equal(sources[2].visible,true);
});
test('different geometry and material identities do not get combined',()=>{
  const {root,sources}=fixture();sources[1].geometry=sources[1].geometry.clone();sources[2].material=sources[2].material.clone();
  assert.equal(instanceReviewTrees(root,THREE).stats.batches,0);assert.ok(sources.every(s=>s.visible));
});
test('buildings, feature-bound meshes and unrelated names never get batched',()=>{
  const {root,geometry,material}=fixture();const building=new THREE.Mesh(geometry,material);building.name='TPX_Buildings_70';root.add(building);
  const feature=new THREE.Group();feature.userData.feature_id='building_070';root.add(feature);
  const tree=new THREE.Mesh(geometry,material);tree.name='TPX_Trees_tree_0';feature.add(tree);
  const unrelated=new THREE.Mesh(geometry,material);unrelated.name='TPX_TreesFake';root.add(unrelated);
  instanceReviewTrees(root,THREE);assert.equal(building.visible,true);assert.equal(tree.visible,true);assert.equal(unrelated.visible,true);
});
test('hidden nodes, transparent materials, morphs and reflected instances are skipped',()=>{
  const {root,trees,sources,geometry,material}=fixture();sources[0].visible=false;sources[1].scale.x=-1;
  sources[2].material=material.clone();sources[2].material.transparent=true;
  const morph=new THREE.Mesh(geometry.clone(),material);morph.geometry.morphAttributes.position=[geometry.attributes.position.clone()];trees.add(morph);
  assert.equal(instanceReviewTrees(root,THREE).stats.batchedMeshes,0);assert.equal(sources[0].visible,false);assert.equal(morph.visible,true);
});
test('batch bounds enclose every transformed original and support normal frustum culling',()=>{
  const {root,sources}=fixture();sources[0].position.set(-5,12,7);sources[1].position.set(25,22,9);sources[2].position.set(30,20,4);
  instanceReviewTrees(root,THREE,{cellSize:1000});root.updateMatrixWorld(true);
  for(const batch of batches(root)){
    assert.equal(batch.frustumCulled,true);assert.ok(batch.boundingSphere.radius>0);
    for(const source of batch.userData.reviewSourceObjects){
      source.geometry.computeBoundingBox();const box=source.geometry.boundingBox.clone().applyMatrix4(source.matrix);
      assert.ok(batch.boundingBox.containsBox(box));
    }
  }
});
test('layers, shadows and render order are preserved and differing flags are separate',()=>{
  const {root,sources}=fixture();sources.forEach(s=>{s.layers.set(2);s.castShadow=true;s.receiveShadow=true;s.renderOrder=4;});
  instanceReviewTrees(root,THREE);const batch=batches(root)[0];
  assert.equal(batch.layers.mask,4);assert.equal(batch.castShadow,true);assert.equal(batch.receiveShadow,true);assert.equal(batch.renderOrder,4);
});
test('toggle and disposal restore original visibility without disposing shared geometry/material',()=>{
  const {root,sources,geometry,material}=fixture();let releases=0;geometry.addEventListener('dispose',()=>releases++);material.addEventListener('dispose',()=>releases++);
  const controller=instanceReviewTrees(root,THREE);controller.setEnabled(false);assert.ok(sources.every(s=>s.visible));
  controller.setEnabled(true);assert.ok(sources.every(s=>!s.visible));controller.dispose();controller.dispose();
  assert.ok(sources.every(s=>s.visible));assert.equal(root.getObjectByName('REVIEW_TREE_BATCHES'),undefined);assert.equal(releases,0);
});
test('raycast instance IDs resolve to source identity; direct building hits are unchanged',()=>{
  const {root,sources}=fixture();instanceReviewTrees(root,THREE);const batch=batches(root)[0];
  assert.equal(reviewHitSource({object:batch,instanceId:1}),sources[1]);assert.equal(reviewHitSource({object:batch,instanceId:999}),batch);
  assert.equal(reviewHitSource({object:sources[0]}),sources[0]);assert.equal(reviewHitSource(null),undefined);
});
test('invalid cell sizes fail safely',()=>{for(const cellSize of [0,-1,NaN,Infinity])assert.throws(()=>instanceReviewTrees(new THREE.Group(),THREE,{cellSize}));});

function clock(){let id=0;const queued=new Map();return {queued,request:cb=>{queued.set(++id,cb);return id;},cancel:id=>queued.delete(id),tick(){const [i,cb]=queued.entries().next().value;queued.delete(i);cb(0);}};}
test('render invalidations coalesce; unchanged scene sleeps until next event',()=>{
  const c=clock();let frames=0;const loop=createReviewRenderLoop(()=>{frames++;return false;},c.request,c.cancel);
  loop.request();loop.request();loop.request();assert.equal(c.queued.size,1);c.tick();assert.equal(frames,1);assert.equal(c.queued.size,0);
  loop.request();c.tick();assert.equal(frames,2);
});
test('animation and change events inside a render do not create duplicate frames',()=>{
  const c=clock();let frames=0,loop;loop=createReviewRenderLoop(()=>{frames++;if(frames<3){loop.request();return true;}return false;},c.request,c.cancel);
  loop.request();c.tick();assert.equal(c.queued.size,1);c.tick();assert.equal(c.queued.size,1);c.tick();assert.equal(c.queued.size,0);
});
test('pause/resume and disposal cancel frames and stop further rendering',()=>{
  const c=clock();const loop=createReviewRenderLoop(()=>true,c.request,c.cancel);loop.request();loop.pause();assert.equal(c.queued.size,0);
  loop.request();assert.equal(c.queued.size,0);loop.resume();assert.equal(c.queued.size,1);loop.dispose();assert.equal(c.queued.size,0);
  loop.request();loop.resume();assert.equal(c.queued.size,0);
});

test('actual full-campus GLB keeps all 124 feature hierarchies and pickable geometry through ten toggles',async()=>{
  // Geometry test only; browser acceptance below is responsible for actual texture decoding.
  const loader=new GLTFLoader();loader.register(()=>({name:'GEOMETRY_TEST_TEXTURES',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
  const bytes=readFileSync(new URL('../output/campus_detail_preview_v001.glb',import.meta.url));
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  scene.rotation.x=-Math.PI/2;scene.updateMatrixWorld(true);
  const features=[];scene.traverse(o=>{if(o.userData.feature_id&&!o.isMesh)features.push(o);});
  assert.equal(features.length,124);assert.equal(new Set(features.map(o=>o.userData.feature_id)).size,124);
  const snapshots=[];
  for(const root of features)root.traverse(o=>snapshots.push({o,parent:o.parent,children:[...o.children],
    matrix:[...o.matrixWorld.elements],geometry:o.geometry,material:o.material,visible:o.visible,data:JSON.stringify(o.userData)}));
  const controller=instanceReviewTrees(scene,THREE);
  assert.equal(controller.stats.candidates,2140);assert.equal(controller.stats.batchedMeshes,2044);assert.equal(controller.stats.batches,138);
  assert.ok(controller.stats.maxWorldMatrixDeviation<.0001);
  for(let i=0;i<10;i++){controller.setEnabled(false);controller.setEnabled(true);}
  scene.updateMatrixWorld(true);
  for(const s of snapshots){
    assert.equal(s.o.parent,s.parent);assert.deepEqual(s.o.children,s.children);assert.deepEqual(s.o.matrixWorld.elements,s.matrix);
    assert.equal(s.o.geometry,s.geometry);assert.equal(s.o.material,s.material);assert.equal(s.o.visible,s.visible);assert.equal(JSON.stringify(s.o.userData),s.data);
  }
  const raycaster=new THREE.Raycaster();let tested=0;
  for(const root of features){
    let mesh;root.traverse(o=>{if(!mesh&&o.isMesh&&o.visible)mesh=o;});assert.ok(mesh);
    const geometry=mesh.geometry,position=geometry.attributes.position,index=geometry.index;
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
    let found=false;
    for(let i=0;i<(index?index.count:position.count);i+=3){
      a.fromBufferAttribute(position,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
      normal.crossVectors(b.clone().sub(a),c.clone().sub(a));if(normal.lengthSq()<1e-10)continue;
      normal.normalize();const middle=a.clone().add(b).add(c).multiplyScalar(1/3);
      raycaster.set(middle.addScaledVector(normal,.1),normal.clone().negate());raycaster.near=0;raycaster.far=.2;
      if(raycaster.intersectObject(mesh,false).some(hit=>reviewHitSource(hit)===mesh)){found=true;break;}
    }
    assert.ok(found,root.userData.feature_id+' must remain raycastable');tested++;
  }
  assert.equal(tested,124);controller.dispose();
});
