import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Texture, type Mesh, type Object3D} from 'three';
import {detailReviewEnabled,detailReleaseEnabled,DETAIL_REVIEW_ASSET} from '../src/gis/three/CampusDetailReview';
import {StaticFeatureRepository, type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {createCampusBuildingWorkPreview} from '../src/gis/three/CampusBuildingWorkPreview';
import {ThreeFeatureHighlighter} from '../src/gis/three/ThreeFeatureHighlighter';
import {prepareProjection} from '../src/gis/three/CampusModelTransform';
import {displayProperties} from '../src/gis/interaction/FeatureDisplayConfig';

const bytes=readFileSync('../output/campus_detail_release_v004.glb');
const loader=new GLTFLoader();
loader.register(()=>({name:'NODE_TEST_IMAGE_DECODER',loadTexture:()=>Promise.resolve(new Texture())}));
const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(key=>[key,JSON.parse(readFileSync(`public/data/${key}.geojson`,'utf8'))])) as unknown as FeatureSources;
const repository=new StaticFeatureRepository(sources);
const features=repository.getAll();
const roots:Object3D[]=[];
scene.traverse(root=>{if(typeof root.userData.feature_id==='string'&&!(root as Mesh).isMesh)roots.push(root);});

test('review is explicitly opted in for dev only; production remains formal v005',()=>{
  assert.equal(detailReviewEnabled(undefined),false);
  assert.equal(detailReviewEnabled({DEV:false,VITE_CAMPUS_DETAIL_REVIEW:'1'}),false);
  assert.equal(detailReviewEnabled({DEV:true}),false);
  assert.equal(detailReviewEnabled({DEV:true,VITE_CAMPUS_DETAIL_REVIEW:'0'}),false);
  assert.equal(detailReviewEnabled({DEV:true,VITE_CAMPUS_DETAIL_REVIEW:'1'}),true);
  assert.equal(detailReleaseEnabled({DEV:false,VITE_CAMPUS_DETAIL_REVIEW:'1'}),false);
  assert.equal(detailReleaseEnabled({DEV:false,VITE_CAMPUS_DETAIL_RELEASE:'1'}),true);
});
test('release and transparent gzip delivery have the exact configured SHA-256',()=>{
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),DETAIL_REVIEW_ASSET.hash);
  assert.deepEqual(gunzipSync(readFileSync('../output/campus_detail_release_v004.glb.gz')),bytes);
});
test('all 124 facade IDs resolve to repository IDs exactly once, including every descendant mesh',()=>{
  const index=createCampusModelIndex(scene,features);
  assert.equal(roots.length,124);
  for(const root of roots){
    const id=root.userData.feature_id as string;
    assert.ok(repository.getById(id),id);
    assert.deepEqual(index.get(id),[root],id);
    root.traverse(mesh=>assert.equal(index.resolveFeatureId(mesh),id));
    index.addBinding(id,root);assert.deepEqual(index.get(id),[root]);
  }
  for(const id of ['library','south-gate','auditorium','fusion-sculpture','stadium-east-01','stadium-east-02','stadium-west-01','stadium-west-02'])assert.ok(index.has(id),id);
});
test('embedded candidate never injects old six-metre preview prisms on repeated toggles',()=>{
  const before:Object3D[]=[];scene.traverse(node=>before.push(node));
  const controls=createCampusBuildingWorkPreview(scene,features);
  for(let i=0;i<10;i++){controls.setEnabled(false);controls.setEnabled(true);}
  const after:Object3D[]=[];scene.traverse(node=>after.push(node));
  assert.deepEqual(after,before);
});
test('candidate selection highlights restore original shared materials after ten changes',()=>{
  const index=createCampusModelIndex(scene,features),highlighter=new ThreeFeatureHighlighter(index);
  const meshes:Mesh[]=[];for(const root of roots.slice(0,10))root.traverse(node=>{if((node as Mesh).isMesh)meshes.push(node as Mesh);});
  const originals=meshes.map(mesh=>mesh.material);
  for(const root of roots.slice(0,10)){highlighter.set(root.userData.feature_id,null);highlighter.set(null,null);}
  highlighter.dispose();assert.deepEqual(meshes.map(mesh=>mesh.material),originals);
});
test('candidate panel labels original GIS height without altering analysis properties',()=>{
  const feature=features.find(feature=>feature.category==='building')!;
  const original=JSON.stringify(feature);
  assert.ok(displayProperties(feature,true).some(row=>row.label==='原始 GIS 高度（不用于候选模型）'));
  assert.equal(JSON.stringify(feature),original);
});
test('release projects to MapLibre with the six protected landmark alignments retained',()=>{
  const rows=prepareProjection(scene);
  assert.equal(rows.length,6);assert.ok(Math.max(...rows.map(row=>row.meterError))<0.001);
  const index=createCampusModelIndex(scene,features);
  for(const root of roots)assert.equal(index.resolveFeatureId(root),root.userData.feature_id);
});
