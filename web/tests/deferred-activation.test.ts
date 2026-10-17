import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DeferredActivation} from '../src/gis/map/DeferredActivation';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('optional download coalesces, and hiding while downloading prevents activation',async()=>{
  let wanted=true,loads=0,active=0,resolve!:(value:number)=>void;
  const task=new DeferredActivation(()=>{loads++;return new Promise<number>(done=>resolve=done);},()=>wanted,()=>active++,()=>assert.fail());
  task.request();task.request();await settle();assert.equal(loads,1);
  wanted=false;resolve(1);await settle();assert.equal(active,0);
  wanted=true;task.request();await settle();resolve(1);await settle();assert.equal(active,1);
});
test('disposed map never recreates a layer from a late import',async()=>{
  let resolve!:(value:number)=>void,active=0;
  const task=new DeferredActivation(()=>new Promise<number>(done=>resolve=done),()=>true,()=>active++,()=>assert.fail());
  task.request();await settle();task.dispose();resolve(1);await settle();task.request();await settle();assert.equal(active,0);
});
test('failed imports are reported and can retry, obsolete failures stay silent',async()=>{
  let wanted=true,attempts=0,errors=0,active=0;
  const task=new DeferredActivation(async()=>{if(++attempts<3)throw Error('offline');return 1;},()=>wanted,()=>active++,()=>errors++);
  task.request();await settle();assert.equal(errors,1);
  wanted=false;task.request();await settle();assert.equal(errors,1);
  wanted=true;task.request();await settle();assert.equal(active,1);
});
