import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { booleanValid, bbox, booleanPointInPolygon, intersect, featureCollection, polygon } from '@turf/turf';
import { Texture, Box3, Raycaster, Vector3, Mesh, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TEACHING_PLAN_GEOMETRIES, TEACHING_PLAN_CONNECTIONS, TEACHING_PLAN_PROVENANCE, planToWgs84, teachingGeometryBounds, legacyFittedTeachingGeometry, registeredTeachingGeometry } from '../src/gis/features/TeachingPlanGeometry';
import { displayCollection } from '../src/gis/layers/CampusDisplayGeometry';
import { createTeachingPlanPreview, visibleInHierarchy, previewNodeName, TEACHING_CONNECTION_RENDER } from '../src/gis/three/TeachingPlanModel';
import { createCampusModelIndex } from '../src/gis/three/ModelNodeIndex';
import { TEACHING_MODEL_BINDINGS } from '../src/gis/features/TeachingBuildingPresentation';
import { modelAtPath } from '../src/gis/three/CampusModelPresentation';
import { disposeModel } from '../src/gis/three/ThreeResourceManager';
import { LayerManager } from '../src/gis/layers/LayerManager';
import { CAMPUS_LAYERS } from '../src/gis/layers/CampusLayerRegistry';
import { CAMPUS_PLAN_DISPOSITIONS } from '../src/gis/features/CampusPlanDispositions';
import {PLAN_ROOF_GROUPS} from '../src/gis/layers/CampusPlanRoofGroups';
import {TEACHING_PART_IDS} from '../src/gis/features/TeachingPlanGeometry';
import {PLAN_NON_ROOF_REFERENCE_IDS} from '../src/gis/features/CampusPlanDispositions';

test('eight uniformly georeferenced display polygons are valid with six courtyard voids',()=>{
  assert.equal(TEACHING_PLAN_GEOMETRIES.length,8);
  assert.equal(TEACHING_PLAN_PROVENANCE.status,'APPROXIMATE_DISPLAY_ONLY');
  for(const [i,ref] of TEACHING_PLAN_GEOMETRIES.entries()){
    const feature=polygon(ref.geometry.coordinates);
    assert.ok(booleanValid(feature),ref.name);assert.deepEqual(bbox(feature),teachingGeometryBounds(ref.geometry));
    assert.equal(ref.geometry.coordinates.length,i<6?2:1);
    if(i<6){
      const hole=ref.geometry.coordinates[1]!.slice(0,-1);
      const center=[hole.reduce((a,p)=>a+p[0]!,0)/hole.length,hole.reduce((a,p)=>a+p[1]!,0)/hole.length];
      assert.equal(booleanPointInPolygon(center,feature),false,ref.name);
    }
    assert.ok(booleanValid(polygon(planToWgs84(ref.geometry).coordinates)));
  }
  for(const c of TEACHING_PLAN_CONNECTIONS){
    assert.ok(booleanValid(polygon(c.geometry.coordinates)));assert.equal(c.owners.length,2);
    for(const id of c.owners){const target=TEACHING_PLAN_GEOMETRIES.find(g=>g.id===id)!;
      assert.ok(intersect(featureCollection([polygon(c.geometry.coordinates),polygon(target.geometry.coordinates)])),`connection meets ${target.name}`);
    }
  }
});

test('display replacement is copy-only, source counts and analysis polygons are unchanged',()=>{
  const data=JSON.parse(readFileSync('public/data/buildings.geojson','utf8')),before=JSON.stringify(data);
  const displayed=displayCollection('buildings',data,true);
  const removed=new Set([...TEACHING_PART_IDS,...CAMPUS_PLAN_DISPOSITIONS.filter(r=>r.suppressed).map(r=>r.id),...PLAN_NON_ROOF_REFERENCE_IDS,...PLAN_ROOF_GROUPS.flatMap(g=>g.members)]);
  assert.equal(displayed.features.length,data.features.length-removed.size+2);
  for(const ref of TEACHING_PLAN_GEOMETRIES){
    const f=displayed.features.find(f=>f.id===ref.id)!;
    assert.deepEqual(f.geometry,planToWgs84(ref.geometry));assert.equal(f.properties!.displayStatus,'APPROXIMATE_DISPLAY_ONLY');
  }
  assert.equal(JSON.stringify(data),before);
  const restored=displayCollection('buildings',data,false);
  for(const binding of TEACHING_MODEL_BINDINGS)assert.deepEqual(restored.features.find(f=>f.id===binding.id)!.geometry,data.features.find((f:any)=>f.id===binding.id).geometry);
});

test('real model has reversible preview, stable bindings, actual 3D courtyard holes and no hidden picking',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURES',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('public/models/campus_refined_v005.glb');
  const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  try{
    const originals=TEACHING_MODEL_BINDINGS.map(b=>modelAtPath(scene,b.path)!);
    const originalBuffers=originals.map(o=>(o as Mesh).geometry.attributes.position!.array.slice());
    const control=createTeachingPlanPreview(scene),index=createCampusModelIndex(scene);
    assert.equal(control.root.children.length,10);
    control.setEnabled(true);scene.updateMatrixWorld(true);
    assert.ok(originals.every(o=>!visibleInHierarchy(o)));
    for(const ref of TEACHING_PLAN_GEOMETRIES){
      const mesh=scene.getObjectByName(previewNodeName(ref.id)) as Mesh;
      assert.equal(index.resolveFeatureId(mesh),ref.id);assert.equal(index.get(ref.id)!.length,2);
      const bounds=new Box3().setFromObject(mesh);
      assert.ok(Math.abs(bounds.max.z-bounds.min.z-6)<0.001);
      assert.ok([bounds.min.x,bounds.min.y,bounds.max.x,bounds.max.y].every((v,i)=>Math.abs(v-teachingGeometryBounds(ref.geometry)[i]!)<0.001));
      if(ref.geometry.coordinates[1]){
        const hole=ref.geometry.coordinates[1].slice(0,-1),center=hole.reduce((v,p)=>v.add(new Vector3(p[0],p[1],0)),new Vector3()).divideScalar(hole.length);
        center.z=bounds.max.z+10;
        assert.equal(new Raycaster(center,new Vector3(0,0,-1)).intersectObject(mesh).length,0,`${ref.name} courtyard roof absent`);
      }
    }
    for(const child of control.root.children.filter(c=>c.name.startsWith('plan-connection'))){
      assert.equal(index.resolveFeatureId(child),null);
      const mesh=child as Mesh,bounds=new Box3().setFromObject(mesh);
      assert.equal(mesh.userData.representation,'SCHEMATIC_GROUND_MARKER_NOT_BUILDING');
      assert.equal(mesh.userData.heightStatus,'NOT_A_BUILDING_HEIGHT');
      assert.ok(bounds.max.z-bounds.min.z<1,'terrain marker is not a 6m wall');
      assert.equal((mesh.material as MeshStandardMaterial).depthWrite,false);
      assert.equal((mesh.material as MeshStandardMaterial).transparent,true);
      const positions=mesh.geometry.attributes.position!,ray=new Raycaster();
      const ground:Mesh[]=[];scene.traverse(o=>{if(!(o as Mesh).isMesh)return;for(let p:any=o;p;p=p.parent)if(/Ground/i.test(p.name)){ground.push(o as Mesh);break;}});
      assert.ok(ground.length>0);
      for(let i=0;i<positions.count;i++){
        ray.set(new Vector3(positions.getX(i),positions.getY(i),100),new Vector3(0,0,-1));
        const hit=ray.intersectObjects(ground,false)[0];assert.ok(hit,'marker sampled real ground');
        assert.ok(Math.abs(positions.getZ(i)-hit.point.z-TEACHING_CONNECTION_RENDER.surfaceOffsetMeters)<0.001);
      }
    }
    for(let i=0;i<10;i++){control.setEnabled(false);assert.ok(originals.every(visibleInHierarchy));assert.equal(visibleInHierarchy(control.root),false);control.setEnabled(true);}
    originals.forEach((o,i)=>assert.deepEqual((o as Mesh).geometry.attributes.position!.array,originalBuffers[i]));
    // Avoid sharing geometry ownership assumptions: generated material is independent of source.
    assert.ok((control.root.children[0] as Mesh).material instanceof MeshStandardMaterial);
  }finally{disposeModel(scene);}
});

test('display toggle updates only the source data, retains source count, visibility and 3D overlay preferences',async()=>{
  const original=globalThis.fetch,data=JSON.parse(readFileSync('public/data/buildings.geojson','utf8'));
  let requests=0,updates=0;const sources=new Map<string,any>(),layers=new Map<string,any>();
  globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify(data));};
  const map:any={
    addSource:(id:string,source:any)=>sources.set(id,{...source,setData(value:any){this.data=value;updates++;}}),
    addLayer:(l:any)=>layers.set(l.id,{...l,layout:{},paint:{...l.paint}}),
    getSource:(id:string)=>sources.get(id),getLayer:(id:string)=>layers.get(id),
    setLayoutProperty:(id:string,k:string,v:any)=>layers.get(id).layout[k]=v,
    setPaintProperty:(id:string,k:string,v:any)=>layers.get(id).paint[k]=v,
    removeLayer:(id:string)=>layers.delete(id),removeSource:(id:string)=>sources.delete(id),once:()=>{},off:()=>{},
  };
  const manager=new LayerManager();manager.register(CAMPUS_LAYERS.find(d=>d.id==='buildings')!);
  try{
    await manager.load(map);manager.setCampus3DActive(true);
    manager.setOpacity('buildings',0.4);
    for(let i=0;i<10;i++)manager.setTeachingPlanPreview(i%2===0);
    assert.equal(requests,1);assert.equal(updates,10);assert.equal(manager.getState('buildings')!.count,166);
    assert.equal(layers.get('buildings-fill').layout.visibility,'none');assert.equal(layers.get('buildings-fill').paint['fill-opacity'],0.4);
    const raw=sources.get('campus-buildings').data.features.find((f:any)=>f.id===TEACHING_PLAN_GEOMETRIES[0]!.id);
    assert.deepEqual(raw.geometry,data.features.find((f:any)=>f.id===raw.id).geometry);
    manager.setCampus3DActive(false);assert.equal(layers.get('buildings-fill').layout.visibility,'visible');
    manager.setTeachingPlanPreview(true);manager.detach();assert.equal(sources.size,0);assert.equal(layers.size,0);
    manager.setTeachingPlanPreview(false); // no stale source retained after detach
  }finally{manager.detach();globalThis.fetch=original;}
});

test('current v004 GLB has ground markers; preserved v001/v002/v003 remain readable historical previews',async()=>{
  for(const version of ['v001','v002','v003','v004']){
  const bytes=readFileSync(`../output/teaching_area_preview_${version}.glb`);
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  try{
    scene.updateMatrixWorld(true);let count=0,triangles=0;
    scene.traverse(o=>{const mesh=o as Mesh;if(mesh.isMesh){count++;triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position!.count)/3;}});
    assert.equal(count,10);
    if(version==='v001'||version==='v002')assert.equal(triangles,484);else assert.ok(triangles>=464&&triangles<600);
    for(const [i,ref] of TEACHING_PLAN_GEOMETRIES.entries()){
      const expectedGeometry=version==='v001'?legacyFittedTeachingGeometry(i):version==='v004'?ref.geometry:registeredTeachingGeometry(i);
      const expectedBounds=teachingGeometryBounds(expectedGeometry);
      const node=scene.getObjectByName(previewNodeName(ref.id)) as Mesh;assert.ok(node);
      assert.equal(node.userData.status,'APPROXIMATE_DISPLAY_ONLY');
      const bounds=new Box3().setFromObject(node);
      assert.ok([bounds.min.x,bounds.min.y,bounds.max.x,bounds.max.y].every((v,i)=>Math.abs(v-expectedBounds[i]!)<0.001));
      if(version!=='v001')assert.equal(node.userData.fit,'SHARED_RASTER_GEOREFERENCE_NO_BUILDING_FIT');
      assert.ok(Math.abs(bounds.max.z-bounds.min.z-6)<0.001);
      if(expectedGeometry.coordinates[1]){
        const hole=expectedGeometry.coordinates[1].slice(0,-1),point=hole.reduce((v,p)=>v.add(new Vector3(p[0],p[1],0)),new Vector3()).divideScalar(hole.length);point.z=bounds.max.z+10;
        assert.equal(new Raycaster(point,new Vector3(0,0,-1)).intersectObject(node).length,0);
      }
    }
    for(const c of TEACHING_PLAN_CONNECTIONS){
      const node=scene.getObjectByName(c.id) as Mesh,bounds=new Box3().setFromObject(node);
      if(version==='v003'||version==='v004'){
        assert.equal(node.userData.representation,'SCHEMATIC_GROUND_MARKER_NOT_BUILDING');
        assert.equal(node.userData.heightStatus,'NOT_A_BUILDING_HEIGHT');
        assert.ok(bounds.max.z-bounds.min.z<1);
      }else assert.ok(Math.abs(bounds.max.z-bounds.min.z-6)<0.001);
    }
    assert.equal(scene.getObjectByName('REFINED_BUILDINGS'),undefined);
  }finally{disposeModel(scene);}
  }
});
