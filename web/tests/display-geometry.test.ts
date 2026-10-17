import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { FeatureCollection } from 'geojson';
import { bbox, booleanValid, booleanPointInPolygon, feature } from '@turf/turf';
import { Texture, Box3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { coordinates } from '../src/gis/coordinate/CampusCoordinateService';
import { createLayerManager } from '../src/gis/layers/LayerManager';
import { displayCollection, auditoriumDisplayGeometry, AUDITORIUM_SOURCE_ID, CAMPUS_BASEMAP_MASK } from '../src/gis/layers/CampusDisplayGeometry';
const read=(name:string)=>JSON.parse(readFileSync(`public/data/${name}.geojson`,'utf8')) as FeatureCollection;

test('auditorium display geometry keeps IDs and authority data immutable',()=>{
  const data=read('buildings'),before=JSON.stringify(data),display=displayCollection('buildings',data);
  assert.equal(JSON.stringify(data),before);assert.equal(display.features.length,data.features.length);
  assert.deepEqual(display.features.map(f=>f.id),data.features.map(f=>f.id));
  assert.deepEqual(display.features.map(f=>f.properties),data.features.map(f=>f.properties));
  for(let i=0;i<data.features.length;i++) {
    if(String(data.features[i]!.id)===AUDITORIUM_SOURCE_ID)assert.notDeepEqual(display.features[i]!.geometry,data.features[i]!.geometry);
    else assert.equal(display.features[i],data.features[i]);
  }
  assert.equal(displayCollection('waterways',data),data);
});

test('refined auditorium is a valid closed outline with model centre and entrance',()=>{
  const outline=feature(auditoriumDisplayGeometry());assert.ok(booleanValid(outline));
  for(const local of [[981.0432739257812,1212],[981.0432739257812,1140]])
    assert.ok(booleanPointInPolygon(coordinates.localToWgs84(local as [number,number]),outline));
  assert.equal(booleanPointInPolygon(coordinates.localToWgs84([981.0432739257812,1280]),outline),false);
});

test('display outline matches the real v005 platform and entrance mesh bounds',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'TEST_IMAGES',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('public/models/campus_refined_v005.glb');
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  scene.updateMatrixWorld(true);
  const platform=scene.getObjectByName('AUD_Base_Platform')!,stairs=scene.getObjectByName('AUD_Stairs_01')!;
  assert.ok(platform&&stairs);
  const platformBounds=new Box3().setFromObject(platform),stairsBounds=new Box3().setFromObject(stairs);
  const b=bbox(feature(auditoriumDisplayGeometry()));
  const localWest=coordinates.wgs84ToLocal([b[0],b[1]])[0],localNorth=coordinates.wgs84ToLocal([b[2],b[3]])[1];
  // UTM grid north differs slightly from geographic north. Check all ring points
  // in authoritative local coordinates instead of treating a lon/lat bbox as UTM.
  const geometry=auditoriumDisplayGeometry();
  const polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  const points=polys.flat(2).map(p=>coordinates.wgs84ToLocal([p[0]!,p[1]!]));
  assert.ok(Number.isFinite(localWest)&&Number.isFinite(localNorth));
  assert.ok(Math.abs(Math.min(...points.map(p=>p[0]))-platformBounds.min.x)<0.001);
  assert.ok(Math.abs(Math.max(...points.map(p=>p[0]))-platformBounds.max.x)<0.001);
  assert.ok(Math.abs(Math.max(...points.map(p=>p[1]))-platformBounds.max.y)<0.001);
  assert.ok(Math.abs(Math.min(...points.map(p=>p[1]))-stairsBounds.min.y)<0.001);
});

test('campus mask stays below GIS and 3D, independent of visibility toggles, and cleans up',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>new Response(readFileSync(`public${url}`,'utf8'));
  const layers=new Map<string,any>(),sources=new Map<string,any>();const order:string[]=[];
  const map:any={
    addSource:(id:string,s:any)=>sources.set(id,s),
    addLayer:(layer:any,before?:string)=>{layers.set(layer.id,{...layer,layout:{},paint:{...layer.paint}});const i=before?order.indexOf(before):-1;i<0?order.push(layer.id):order.splice(i,0,layer.id);},
    getLayer:(id:string)=>layers.get(id),getSource:(id:string)=>sources.get(id),
    setLayoutProperty:(id:string,k:string,v:any)=>layers.get(id).layout[k]=v,
    setPaintProperty:(id:string,k:string,v:any)=>layers.get(id).paint[k]=v,
    removeLayer:(id:string)=>{layers.delete(id);order.splice(order.indexOf(id),1);},
    removeSource:(id:string)=>{assert.ok(![...layers.values()].some(l=>l.source===id),'source removed before its mask');sources.delete(id);},
    once:()=>{},off:()=>{},
  };
  const manager=createLayerManager();
  try {
    await manager.load(map);
    const mask=layers.get(CAMPUS_BASEMAP_MASK);assert.ok(mask);
    assert.equal(mask.source,'campus-campus-boundary');assert.equal(mask.paint['fill-opacity'],1);
    assert.equal(order[0],CAMPUS_BASEMAP_MASK);assert.equal(sources.get(mask.source).data.features.length,1);
    assert.deepEqual(sources.get(mask.source).data.features[0].geometry,read('campus_boundary').features[0]!.geometry);
    manager.hide('campus-boundary');manager.hide('buildings');manager.setCampus3DActive(true);
    assert.notEqual(mask.layout.visibility,'none');assert.equal(layers.get('buildings-fill').layout.visibility,'none');
    manager.setCampus3DActive(false);manager.show('buildings');assert.equal(layers.get('buildings-fill').layout.visibility,'visible');
    const rendered=sources.get('campus-buildings').data.features.find((f:any)=>f.id===AUDITORIUM_SOURCE_ID);
    assert.equal(rendered.properties.__sourceId,AUDITORIUM_SOURCE_ID);
    assert.deepEqual(rendered.geometry,auditoriumDisplayGeometry());
    await manager.load(map);assert.equal(order.filter(id=>id===CAMPUS_BASEMAP_MASK).length,1);
    manager.remove('campus-boundary');assert.equal(layers.has(CAMPUS_BASEMAP_MASK),false);
    manager.detach();assert.equal(layers.size,0);assert.equal(sources.size,0);
  } finally {globalThis.fetch=original;manager.detach();}
});
