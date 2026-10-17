import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Texture,Raycaster,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {hideShapeReviewReferences} from '../src/gis/three/CampusModelPresentation';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {shapeReleaseEnabled,dormCompoundReviewEnabled} from '../src/gis/three/CampusDetailReview';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
import release from '../src/gis/three/CampusShapeReleaseManifest.json';
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const audit=json('../reference/buildings/campus_shapes_v004/audit_after.json');
const validation=json('../reference/buildings/campus_shapes_v004/release_validation.json');
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
test('publishing needs an explicit release switch, 58 scopes match, and source/protected hashes remain exact',()=>{
  assert.equal(shapeReleaseEnabled({DEV:false,VITE_CAMPUS_SHAPE_REVIEW:'3'}),false);
  assert.equal(dormCompoundReviewEnabled({DEV:false,VITE_CAMPUS_SHAPE_RELEASE:'4'}),false);
  assert.equal(shapeReleaseEnabled({DEV:false,VITE_CAMPUS_SHAPE_RELEASE:'4'}),true);
  assert.equal(audit.status,'PASS');assert.equal(audit.count,58);assert.equal(audit.mismatches.length,0);
  assert.equal(validation.wholePickingGroups.length,9);assert.ok(Object.values(validation.checks).every(Boolean));
  for(const [p,h] of Object.entries(validation.protectedInputs))assert.equal(hash('../'+p),h);
  assert.equal(hash('../output/campus_shape_review_v004.glb'),release.sha256);
  assert.equal(hash('public/models/campus_shape_review_v004.glb'),release.sha256);
});
test('real published model picks all 58 non-dorm scopes and highlights every grouped source alias',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'NO_TEXTURE_TEST',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('../output/campus_shape_review_v004.glb');
  const scene=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
  const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(n=>[n,json(`public/data/${n}.geojson`)])) as unknown as FeatureSources;
  const repo=new StaticFeatureRepository(sources);
  try{
    hideShapeReviewReferences(scene);scene.updateMatrixWorld(true);const index=createCampusModelIndex(scene,repo.getAll());
    for(const row of audit.rows){
      const [x,y]=row.insideSampleLocal;const hit=new Raycaster(new Vector3(x,y,200),new Vector3(0,0,-1)).intersectObjects(index.visiblePickMeshes(),false)[0];
      assert.ok(hit,row.name);assert.equal(index.resolveFeatureId(hit.object),row.id,row.name);
      assert.equal(repo.getById(row.id)!.geometry,sources.buildings.features.find(f=>f.id===row.id)!.geometry);
    }
    for(const g of validation.wholePickingGroups){const roots=index.get(g.id)!;assert.ok(roots.length);for(const member of g.members)assert.deepEqual(index.get(member),roots,g.name);}
  }finally{disposeModel(scene);}
});
