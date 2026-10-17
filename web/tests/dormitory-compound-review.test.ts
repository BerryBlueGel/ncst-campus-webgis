import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Texture,Raycaster,Vector3,Mesh} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {booleanPointInPolygon,point} from '@turf/turf';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {hideShapeReviewReferences} from '../src/gis/three/CampusModelPresentation';
import {dormCompoundReviewEnabled,shapeReviewEnabled} from '../src/gis/three/CampusDetailReview';
import {DORMITORY_COMPOUNDS,dormitoryCompoundFor,dormitoryCompoundGeometry} from '../src/gis/features/CampusDormitoryCompounds';
import {globalRasterToLocal} from '../src/gis/features/CampusRemainingPlan';
import {coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
import manifest from '../src/gis/three/CampusDormitoryCompoundManifest.json';

const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const audit=json('../reference/buildings/dorm_compounds_v003/compound_validation.json');
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(n=>[n,json(`public/data/${n}.geojson`)])) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources);
test('compound candidate is dev-only, accounts for 25 groups / 52 bodies, and preserves prior assets',()=>{
  assert.equal(dormCompoundReviewEnabled({DEV:true,VITE_CAMPUS_SHAPE_REVIEW:'3'}),true);
  assert.equal(shapeReviewEnabled({DEV:true,VITE_CAMPUS_SHAPE_REVIEW:'3'}),true);
  assert.equal(dormCompoundReviewEnabled({DEV:false,VITE_CAMPUS_SHAPE_REVIEW:'3'}),false);
  assert.equal(dormCompoundReviewEnabled({DEV:true,VITE_CAMPUS_SHAPE_REVIEW:'2'}),false);
  assert.equal(DORMITORY_COMPOUNDS.length,25);
  assert.equal(new Set(DORMITORY_COMPOUNDS.flatMap(g=>g.bodyIds)).size,52);
  assert.equal(DORMITORY_COMPOUNDS.flatMap(g=>g.connections).length,33);
  assert.equal(DORMITORY_COMPOUNDS.filter(g=>g.bodyIds.length===3).length,2);
  assert.ok(DORMITORY_COMPOUNDS.every(g=>!g.name.startsWith('兰园7')));
  assert.equal(audit.status,'PASS');assert.ok(Object.values(audit.checks).every(Boolean));
  const validation=json('../reference/buildings/dorm_compounds_v003/validation.json');
  assert.equal(createHash('sha256').update(readFileSync('../output/campus_shape_review_v003.glb')).digest('hex').toUpperCase(),manifest.sha256);
  for(const [p,h] of Object.entries(validation.protectedInputs))assert.equal(createHash('sha256').update(readFileSync('../'+p)).digest('hex').toUpperCase(),h);
});
test('compound display geometries leave courtyards empty and repository geometry remains unmerged',()=>{
  const g=DORMITORY_COMPOUNDS.find(g=>g.name==='菊园2号楼')!;
  for(const id of [g.root,...g.members])assert.equal(dormitoryCompoundFor(id),g);
  const geometry=dormitoryCompoundGeometry(g.root)!;
  const wgs=(p:[number,number])=>point(coordinates.localToWgs84(globalRasterToLocal(p)));
  assert.equal(booleanPointInPolygon(wgs([3620,3060]),geometry),true);
  assert.equal(booleanPointInPolygon(wgs([3690,3090]),geometry),false);
  for(const id of g.bodyIds)assert.equal(repo.getById(id)!.geometry,sources.buildings.features.find(f=>f.id===id)!.geometry);
  assert.equal(sources.buildings.features.length,166);
});
test('real v003 raycasts verify lower connecting roofs, empty courtyard and whole-compound picking aliases',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'NO_TEXTURE_TEST',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('../output/campus_shape_review_v003.glb');
  const scene=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
  try{
    hideShapeReviewReferences(scene);scene.updateMatrixWorld(true);
    const index=createCampusModelIndex(scene,repo.getAll());
    for(const g of DORMITORY_COMPOUNDS){
      const roots=index.get(g.root)!;assert.equal(roots.length,g.bodyIds.length+g.connections.length,g.name);
      for(const id of g.members)assert.deepEqual(index.get(id),roots,g.name);
      for(const root of roots){let mesh:Mesh|undefined;root.traverseVisible(n=>{if((n as Mesh).isMesh)mesh=n as Mesh;});assert.ok(mesh);assert.equal(index.resolveFeatureId(mesh),g.root);}
    }
    const g=DORMITORY_COMPOUNDS.find(g=>g.name==='菊园2号楼')!;
    const meshes:Mesh[]=[];for(const root of index.get(g.root)!)root.traverseVisible(n=>{if((n as Mesh).isMesh)meshes.push(n as Mesh);});
    const hits=(p:[number,number])=>{const [x,y]=globalRasterToLocal(p);return new Raycaster(new Vector3(x,y,200),new Vector3(0,0,-1)).intersectObjects(meshes,false);};
    const low=hits([3620,3060])[0],north=hits([3660,3010])[0],south=hits([3680,3150])[0];
    assert.ok(low&&north&&south);assert.ok(north.point.z-low.point.z>5);assert.ok(south.point.z-low.point.z>5);
    assert.equal(hits([3690,3090]).length,0);
    for(const hit of [low,north,south])assert.equal(index.resolveFeatureId(hit.object),g.root);
    const lows=index.get(g.root)!.filter(root=>root.userData.dorm_connection);
    assert.ok(lows.every(root=>root.userData.floor_count===2));
  }finally{disposeModel(scene);}
});
