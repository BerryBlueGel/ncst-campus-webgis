import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3} from 'three';
import {constrainCampusPan} from '../src/gis/three/immersive/ImmersivePanConstraint';
import {NavigationGesture} from '../src/gis/interaction/NavigationGesture';
import {DemandRenderLoop} from '../src/gis/three/immersive/DemandRenderLoop';
import {visibleModelBounds} from '../src/gis/three/TeachingPlanModel';
import {ModelNodeIndex} from '../src/gis/three/ModelNodeIndex';
import {resolveFeatureView} from '../src/gis/three/immersive/ImmersiveFeatureNavigator';
import {StaticFeatureRepository} from '../src/gis/repositories/StaticFeatureRepository';
import {readFileSync} from 'node:fs';

const pointer=(pointerId=1,clientX=100,clientY=100,button=0)=>({pointerId,clientX,clientY,button});
test('single pointer small jitter is a click, a second release is not',()=>{
  const gesture=new NavigationGesture();gesture.begin(pointer());gesture.move(pointer(1,103,101));
  assert.equal(gesture.end(pointer(1,102,102)),true);assert.equal(gesture.active,false);
  assert.equal(gesture.end(pointer()),false);
});
test('out-and-back navigation remains a drag even when released at its origin',()=>{
  const gesture=new NavigationGesture();gesture.begin(pointer());gesture.move(pointer(1,160));gesture.move(pointer());
  assert.equal(gesture.end(pointer()),false);
  gesture.begin(pointer());assert.equal(gesture.end(pointer()),true);
});
test('pinch releases neither finger as a click, then an independent tap works',()=>{
  const gesture=new NavigationGesture();gesture.begin(pointer());gesture.begin(pointer(2));
  assert.equal(gesture.end(pointer(1)),false);assert.equal(gesture.end(pointer(2)),false);
  gesture.begin(pointer(3));assert.equal(gesture.end(pointer(3)),true);
});
test('right button and canceled/outside gestures never pick',()=>{
  const gesture=new NavigationGesture();gesture.begin(pointer(1,100,100,2));assert.equal(gesture.end(pointer()),false);
  gesture.begin(pointer());gesture.cancel();assert.equal(gesture.end(pointer()),false);assert.equal(gesture.active,false);
});
test('boundary pan preserves camera-target offset and orbit distance instead of rebounding',()=>{
  const bounds=new Box3(new Vector3(0,0,0),new Vector3(2000,1500,30));
  const target=new Vector3(2400,-400,180),position=target.clone().add(new Vector3(50,-100,200));
  const offset=position.clone().sub(target),distance=position.distanceTo(target);
  assert.equal(constrainCampusPan(position,target,bounds),true);
  assert.deepEqual(target.toArray(),[2120,-120,130]);
  assert.deepEqual(position.clone().sub(target).toArray(),offset.toArray());
  assert.equal(position.distanceTo(target),distance);assert.equal(constrainCampusPan(position,target,bounds),false);
});
test('ordinary pan and missing model bounds are unchanged',()=>{
  const target=new Vector3(100,200,3),position=new Vector3(150,100,200),before=position.toArray();
  assert.equal(constrainCampusPan(position,target,new Box3()),false);
  assert.equal(constrainCampusPan(position,target,new Box3(new Vector3(0,0,0),new Vector3(1000,1000,20))),false);
  assert.deepEqual(position.toArray(),before);assert.deepEqual(target.toArray(),[100,200,3]);
});

function scheduler(render:(now:number)=>boolean){
  let next=0;const callbacks=new Map<number,FrameRequestCallback>();
  const loop=new DemandRenderLoop(render,callback=>{callbacks.set(++next,callback);return next;},id=>{callbacks.delete(id);});
  return {loop,callbacks,tick(now=0){const [id,callback]=callbacks.entries().next().value!;callbacks.delete(id);callback(now);}};
}
test('idle invalidations coalesce into a single frame then stop',()=>{
  let frames=0;const s=scheduler(()=>{frames++;return false;});
  for(let i=0;i<30;i++)s.loop.request();assert.equal(s.callbacks.size,1);
  s.tick();assert.equal(frames,1);assert.equal(s.callbacks.size,0);
  s.loop.request();s.tick();assert.equal(frames,2);s.loop.dispose();
});
test('flight/damping keeps rendering, then quiesces without losing invalidations',()=>{
  let frames=0;const s=scheduler(()=>++frames<4);s.loop.request();
  for(let i=0;i<4;i++)s.tick(i*16);assert.equal(frames,4);assert.equal(s.callbacks.size,0);
  s.loop.request();s.tick();assert.equal(frames,5);
});
test('an invalidation raised during rendering creates only one follow-up frame',()=>{
  let frames=0;const s=scheduler(()=>{frames++;if(frames===1){s.loop.request();return true;}return false;});
  s.loop.request();s.tick();assert.equal(s.callbacks.size,1);s.tick();assert.equal(frames,2);assert.equal(s.callbacks.size,0);
});
test('hidden/context-lost pause cancels frames, resume redraws, dispose is terminal',()=>{
  let frames=0;const s=scheduler(()=>{frames++;return true;});s.loop.request();s.loop.pause();
  assert.equal(s.callbacks.size,0);s.loop.request();assert.equal(s.callbacks.size,0);
  s.loop.resume();s.tick();assert.equal(frames,1);s.loop.dispose();assert.equal(s.callbacks.size,0);
  s.loop.resume();s.loop.request();assert.equal(s.callbacks.size,0);
});
test('visible model bounds exclude hidden source roots and hidden children',()=>{
  const material=new MeshStandardMaterial(),geometry=new BoxGeometry(10,20,6),scene=new Group();
  const shown=new Mesh(geometry,material),hidden=new Mesh(geometry,material),child=new Mesh(geometry,material);
  shown.position.set(100,200,3);hidden.position.set(900,900,100);hidden.visible=false;
  child.position.set(900,900,100);child.visible=false;shown.add(child);scene.add(shown,hidden);
  const bounds=visibleModelBounds([scene]);assert.deepEqual(bounds.getCenter(new Vector3()).toArray(),[100,200,3]);
  assert.deepEqual(bounds.getSize(new Vector3()).toArray(),[10,20,6]);
  scene.visible=false;assert.equal(visibleModelBounds([shown]).isEmpty(),true);geometry.dispose();material.dispose();
});
test('feature focus uses the active model only, with GIS fallback when all roots are hidden',()=>{
  const get=(name:string)=>JSON.parse(readFileSync(`public/data/${name}.geojson`,'utf8'));
  const repository=new StaticFeatureRepository({buildings:get('buildings'),sports:get('sports'),landmarks:get('landmarks'),pois:get('pois')});
  const index=new ModelNodeIndex(),geometry=new BoxGeometry(10,20,6),material=new MeshStandardMaterial();
  const preview=new Mesh(geometry,material),source=new Mesh(geometry,material);preview.position.set(100,200,3);
  source.position.set(800,900,3);source.visible=false;index.addBinding('library',source);index.addBinding('library',preview);
  const view=resolveFeatureView(repository.getById('library'),index)!;assert.deepEqual(view.target.toArray(),[100,200,3]);
  assert.equal(view.source,'model');preview.visible=false;assert.equal(resolveFeatureView(repository.getById('library'),index)!.source,'gis');
  geometry.dispose();material.dispose();
});
