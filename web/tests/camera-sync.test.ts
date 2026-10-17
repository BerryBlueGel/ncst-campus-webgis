import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraUrlSync } from '../src/gis/map/CameraUrlSync';
import { DEFAULT_CAMERA, cameraQuery } from '../src/gis/map/MapConfig';

test('a new gesture cancels the old settled-camera URL timer', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let state={...DEFAULT_CAMERA}; const writes:unknown[]=[];
  const sync=new CameraUrlSync(()=>state,()=>false,async query=>{writes.push(query)});
  sync.schedule();t.mock.timers.tick(100);sync.cancel();
  state={...state,lng:state.lng+0.001};t.mock.timers.tick(500);
  assert.equal(writes.length,0);
  sync.schedule();t.mock.timers.tick(300);
  assert.deepEqual(writes,[cameraQuery(state)]);sync.dispose();
});
test('URL publication reads the current camera instead of a captured snapshot', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let state={...DEFAULT_CAMERA};const writes:unknown[]=[];
  const sync=new CameraUrlSync(()=>state,()=>false,async query=>{writes.push(query)});
  sync.schedule();state={...state,zoom:18.5};t.mock.timers.tick(300);
  assert.deepEqual(writes,[cameraQuery(state)]);sync.dispose();
});
test('no camera URL is published while the map is moving', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let moving=true;const writes:unknown[]=[];
  const sync=new CameraUrlSync(()=>DEFAULT_CAMERA,()=>moving,async query=>{writes.push(query)});
  sync.schedule();t.mock.timers.tick(300);assert.equal(writes.length,0);
  moving=false;sync.schedule();t.mock.timers.tick(300);assert.equal(writes.length,1);sync.dispose();
});
test('own pending route writes are not inbound camera commands, external history remains eligible', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let finish!:()=>void;
  const sync=new CameraUrlSync(()=>DEFAULT_CAMERA,()=>false,()=>new Promise<void>(resolve=>{finish=resolve}));
  sync.schedule();t.mock.timers.tick(300);
  assert.equal(sync.owns({...cameraQuery(DEFAULT_CAMERA),selected:'library',mode:'3d'}),true);
  assert.equal(sync.owns(cameraQuery({...DEFAULT_CAMERA,zoom:18})),false);
  finish();await Promise.resolve();
  assert.equal(sync.owns(cameraQuery(DEFAULT_CAMERA)),false);sync.dispose();
});
test('dispose cancels pending camera updates and repeated schedule coalesces', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const sync=new CameraUrlSync(()=>DEFAULT_CAMERA,()=>false,async()=>{calls++});
  sync.schedule();t.mock.timers.tick(200);sync.schedule();t.mock.timers.tick(200);
  assert.equal(calls,0);sync.dispose();t.mock.timers.tick(1000);sync.schedule();t.mock.timers.tick(1000);
  assert.equal(calls,0);
});
