import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Texture,Mesh,Raycaster,Vector3} from 'three';
import {hideShapeReviewReferences} from '../src/gis/three/CampusModelPresentation';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {globalRasterToLocal} from '../src/gis/features/CampusRemainingPlan';
import {TEACHING_PLAN_GEOMETRIES} from '../src/gis/features/TeachingPlanGeometry';
import {shapeReviewEnabled} from '../src/gis/three/CampusDetailReview';
import manifest from '../src/gis/three/CampusShapeReviewManifest.json';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(n=>[n,JSON.parse(readFileSync(`public/data/${n}.geojson`,'utf8'))])) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources);
async function load(){const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURE',loadTexture:()=>Promise.resolve(new Texture())}));const bytes=readFileSync('../output/campus_shape_review_v001.glb');return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;}
test('shape review is explicitly local-only and actual artifact has the declared hash',()=>{
  assert.equal(shapeReviewEnabled({DEV:true,VITE_CAMPUS_SHAPE_REVIEW:'1'}),true);
  assert.equal(shapeReviewEnabled({DEV:false,VITE_CAMPUS_SHAPE_REVIEW:'1'}),false);
  assert.equal(shapeReviewEnabled(undefined),false);
  assert.equal(createHash('sha256').update(readFileSync('../output/campus_shape_review_v001.glb')).digest('hex').toUpperCase(),manifest.sha256);
  const validation=JSON.parse(readFileSync('../reference/buildings/shape_review_v001/validation.json','utf8'));
  assert.equal(validation.status,'PASS');assert.equal(validation.changedShapeScopes,12);assert.equal(validation.rebuiltBodies,8);
  for(const [path,hash] of Object.entries(validation.protectedInputs))assert.equal(createHash('sha256').update(readFileSync('../'+path)).digest('hex').toUpperCase(),hash);
});
test('revised bodies pick stable group IDs, source aliases select the same visible shape, old references cannot pick',async()=>{
  const scene=await load();try{
    hideShapeReviewReferences(scene);scene.updateMatrixWorld(true);
    const index=createCampusModelIndex(scene,repo.getAll()),ray=new Raycaster();
    for(const [id,pixel] of [
      ['buildings:4b4e002af6e98d730dd3',[1915,3835]],
      ['buildings:01f4781169cdebc320a0',[4150,2190]],
      ['buildings:c4413d5a7dda1c0312d4',[3820,2030]],
    ] as const){
      const [x,y]=globalRasterToLocal([...pixel]);ray.set(new Vector3(x,y,200),new Vector3(0,0,-1));
      const hit=ray.intersectObjects(index.visiblePickMeshes(),false)[0];assert.ok(hit,id);assert.equal(index.resolveFeatureId(hit.object),id);
    }
    const root='buildings:7612d4df140331fe641e',alias='buildings:b910aecdb252a70a2f2b';
    assert.deepEqual(index.get(alias),index.get(root));
    assert.ok(index.visiblePickMeshes().every(node=>{for(let p=node;p;p=p.parent!)if(p.userData.shape_review_reference_only)return false;return true;}));
    assert.equal(repo.getById(alias)!.geometry,sources.buildings.features.find(f=>f.id===alias)!.geometry);
  }finally{disposeModel(scene);}
});
test('teaching courtyard holes remain open after shape-reference suppression',async()=>{
  const scene=await load();try{
    hideShapeReviewReferences(scene);scene.updateMatrixWorld(true);const index=createCampusModelIndex(scene,repo.getAll());
    for(const ref of TEACHING_PLAN_GEOMETRIES.filter(r=>r.geometry.coordinates.length>1)){
      const ring=ref.geometry.coordinates[1]!.slice(0,-1),x=ring.reduce((sum,p)=>sum+p[0]!,0)/ring.length,y=ring.reduce((sum,p)=>sum+p[1]!,0)/ring.length;
      const meshes:Mesh[]=[];for(const root of index.get(ref.id)??[])root.traverseVisible(n=>{if((n as Mesh).isMesh)meshes.push(n as Mesh);});
      const ray=new Raycaster(new Vector3(x,y,200),new Vector3(0,0,-1));assert.equal(ray.intersectObjects(meshes,false).length,0,ref.id);
    }
  }finally{disposeModel(scene);}
});
