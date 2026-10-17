import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Texture,Raycaster,Vector3,Mesh} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {hideShapeReviewReferences} from '../src/gis/three/CampusModelPresentation';
import {dormShapeReviewEnabled,shapeReviewEnabled} from '../src/gis/three/CampusDetailReview';
import {DORMITORY_SHAPE_CORRECTIONS} from '../src/gis/features/CampusDormitoryShapeReview';
import {globalRasterToLocal} from '../src/gis/features/CampusRemainingPlan';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
import manifest from '../src/gis/three/CampusDormitoryShapeManifest.json';

const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const audit=json('../reference/buildings/dorm_shapes_v002/audit_after.json');
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(n=>[n,json(`public/data/${n}.geojson`)])) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources);
async function load(){const loader=new GLTFLoader();loader.register(()=>({name:'NO_TEXTURE_TEST',loadTexture:()=>Promise.resolve(new Texture())}));const bytes=readFileSync('../output/campus_shape_review_v002.glb');return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;}
test('all four dormitory districts are individually accounted for, v002 stays dev-only and preserved assets keep exact hashes',()=>{
  assert.equal(audit.status,'PASS');assert.equal(audit.count,53);assert.deepEqual(audit.districts,manifest.districts);assert.deepEqual(audit.overlaps,[]);
  assert.deepEqual(audit.newReturnNeighborConflicts,[]);
  assert.equal(shapeReviewEnabled({DEV:true,VITE_CAMPUS_SHAPE_REVIEW:'2'}),true);
  assert.equal(dormShapeReviewEnabled({DEV:false,VITE_CAMPUS_SHAPE_REVIEW:'2'}),false);
  assert.equal(dormShapeReviewEnabled({DEV:true,VITE_CAMPUS_SHAPE_REVIEW:'1'}),false);
  const report=json('../reference/buildings/dorm_shapes_v002/validation.json');
  assert.equal(report.changedShapeScopes,2);assert.equal(report.rebuiltBodies,2);
  assert.equal(report.sha256,manifest.sha256);
  assert.equal(createHash('sha256').update(readFileSync('../output/campus_shape_review_v002.glb')).digest('hex').toUpperCase(),manifest.sha256);
  for(const [p,h] of Object.entries(report.protectedInputs))assert.equal(createHash('sha256').update(readFileSync('../'+p)).digest('hex').toUpperCase(),h);
});
test('real v002 geometry has both corrected returns, excludes the former wrong wing and courtyard, preserves business picks for all 53',async()=>{
  const scene=await load();try{
    hideShapeReviewReferences(scene);scene.updateMatrixWorld(true);const index=createCampusModelIndex(scene,repo.getAll());
    for(const row of audit.rows){
      const [x,y]=row.insideSampleLocal;const ray=new Raycaster(new Vector3(x,y,200),new Vector3(0,0,-1));
      const hit=ray.intersectObjects(index.visiblePickMeshes(),false)[0];assert.ok(hit,row.name);assert.equal(index.resolveFeatureId(hit.object),row.id,row.name);
    }
    for(const row of DORMITORY_SHAPE_CORRECTIONS){
      const meshes:Mesh[]=[];for(const root of index.get(row.id)??[])root.traverseVisible(n=>{if((n as Mesh).isMesh)meshes.push(n as Mesh);});
      for(const [expected,points] of [[true,row.includedCheckpoints],[false,row.excludedCheckpoints]] as const)
        for(const p of points){const [x,y]=globalRasterToLocal([p[0]!,p[1]!]);const hits=new Raycaster(new Vector3(x,y,200),new Vector3(0,0,-1)).intersectObjects(meshes,false);assert.equal(hits.length>0,expected,row.name);}
      assert.equal(index.get(row.id)![0]!.userData.floor_count,5);
      assert.equal(repo.getById(row.id)!.geometry,sources.buildings.features.find(f=>f.id===row.id)!.geometry);
    }
  }finally{disposeModel(scene);}
});
