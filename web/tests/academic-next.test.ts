import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Texture,Raycaster,Vector3,Mesh} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {hideShapeReviewReferences} from '../src/gis/three/CampusModelPresentation';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
import manifest from '../src/gis/three/CampusAcademicRefinementV006Manifest.json';
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
test('v006 retains protected baseline and previous connector release exactly',()=>{
  const v=JSON.parse(readFileSync('../reference/buildings/academic_refinement_v006/validation.json','utf8'));
  assert.ok(Object.values(v.checks).every(Boolean));
  for(const [p,h] of Object.entries(v.protectedInputs))assert.equal(hash('../'+p),h);
  assert.equal(hash('../output/campus_shape_review_v006.glb'),manifest.sha256);
  assert.equal(hash('public/models/campus_shape_review_v006.glb'),manifest.sha256);
  assert.equal(manifest.facadeOnly.length,2);
});
test('actual A4 GLB keeps three overhead passages, aliases and an empty courtyard',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'NO_TEXTURE_TEST',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('../output/campus_shape_review_v006.glb');
  const scene=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
  try{
    const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(n=>[n,JSON.parse(readFileSync(`public/data/${n}.geojson`,'utf8'))])) as unknown as FeatureSources;
    hideShapeReviewReferences(scene);scene.updateMatrixWorld(true);const index=createCampusModelIndex(scene,new StaticFeatureRepository(sources).getAll());
    const meshes:Mesh[]=[];scene.traverseVisible(n=>{if(n instanceof Mesh&&n.userData.academic_refinement_v006)meshes.push(n);});
    const a4=manifest.groups.find(g=>g.root==='buildings:2d7a6c32c34801f6495e')!;
    assert.ok('portals' in a4);
    for(const p of a4.portals!){
      const [x,y]=p.centerLocal;const hit=new Raycaster(new Vector3(x,y,100),new Vector3(0,0,-1)).intersectObjects(meshes,false)[0];
      assert.ok(hit,p.key);assert.equal(index.resolveFeatureId(hit.object),a4.root);
      const ring=p.footprint.coordinates[0]!;const a=ring[0]!,b=ring[1]!;const dx=b[0]!-a[0]!,dy=b[1]!-a[1]!,length=Math.hypot(dx,dy),clear=Math.min(8,length*.5);
      const ray=new Raycaster(new Vector3(x!-dx/length*clear/2,y!-dy/length*clear/2,2),new Vector3(dx/length,dy/length,0),0,clear);
      assert.equal(ray.intersectObjects(meshes,false).length,0,p.key+' ground passage');
    }
    for(const member of a4.members)assert.deepEqual(index.get(member),index.get(a4.root));
    assert.equal(new Raycaster(new Vector3(1280,202,100),new Vector3(0,0,-1)).intersectObjects(meshes,false).length,0,'A4 courtyard');
    const training=index.get('buildings:5078c3f4fbe6712427a1')![0]!;
    assert.equal(training.userData.floor_count,undefined);
    assert.equal(training.userData.facade_window_layout,'SINGLE_TALL_PANEL_UNKNOWN_STOREYS');
    const glassZ=new Set<number>();
    training.traverseVisible(n=>{if(n instanceof Mesh&&n.userData.academic_refinement_v006&&n.userData.mesh_role==='glass'){
      const p=n.geometry.getAttribute('position');for(let i=0;i<p.count;i++)glassZ.add(Math.round(new Vector3().fromBufferAttribute(p,i).applyMatrix4(n.matrixWorld).z*1e4));
    }});
    assert.equal(glassZ.size,2,'D9 must not invent four storey window bands');
  }finally{disposeModel(scene);}
});
