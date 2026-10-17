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
import {shapeReleaseEnabled} from '../src/gis/three/CampusDetailReview';
import manifest from '../src/gis/three/CampusAcademicRefinementManifest.json';
import {academicRefinementGeometry} from '../src/gis/layers/CampusAcademicRefinement';
import {coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import {booleanPointInPolygon,point} from '@turf/turf';
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase();
test('v005 is explicit; prior sources remain protected and 2D includes overhead portals',()=>{
  assert.equal(shapeReleaseEnabled({VITE_CAMPUS_SHAPE_RELEASE:'5'}),true);
  assert.equal(shapeReleaseEnabled({VITE_CAMPUS_SHAPE_RELEASE:'6'}),true);
  assert.equal(shapeReleaseEnabled({VITE_CAMPUS_SHAPE_RELEASE:'7'}),false);
  assert.equal(hash('../output/campus_shape_review_v005.glb'),manifest.sha256);
  assert.equal(hash('public/models/campus_shape_review_v005.glb'),manifest.sha256);
  const v=JSON.parse(readFileSync('../reference/buildings/academic_refinement_v005/validation.json','utf8'));
  for(const [p,h] of Object.entries(v.protectedInputs))assert.equal(hash('../'+p),h);
  for(const g of manifest.groups){
    const [x,y]=g.portal.centerLocal;const w=coordinates.localToWgs84([x!,y!]);
    assert.ok(booleanPointInPolygon(point(w),academicRefinementGeometry(g.root)!));
  }
});
test('real GLB portal is pickable overhead but open at pedestrian height; old IDs retain aliases',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'NO_TEXTURE_TEST',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('../output/campus_shape_review_v005.glb');
  const scene=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
  const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(n=>[n,JSON.parse(readFileSync(`public/data/${n}.geojson`,'utf8'))])) as unknown as FeatureSources;
  try{
    hideShapeReviewReferences(scene);scene.updateMatrixWorld(true);const index=createCampusModelIndex(scene,new StaticFeatureRepository(sources).getAll());
    const meshes:Mesh[]=[];scene.traverseVisible(n=>{if(n instanceof Mesh&&n.userData.academic_refinement_v005)meshes.push(n);});
    for(const g of manifest.groups){
      const [x,y]=g.portal.centerLocal;
      const down=new Raycaster(new Vector3(x,y,100),new Vector3(0,0,-1)).intersectObjects(meshes,false)[0];
      assert.ok(down,g.name);assert.equal(index.resolveFeatureId(down.object),g.root);
      // Cross the whole doorway, not just sample a single empty point.
      const c=g.portal.footprint.coordinates[0]!;const a=c[0]!,b=c[1]!;const dx=b[0]!-a[0]!,dy=b[1]!-a[1]!;const l=Math.hypot(dx,dy);
      const ray=new Raycaster(new Vector3(x!-dx/l*4,y!-dy/l*4,2),new Vector3(dx/l,dy/l,0),0,8);
      assert.equal(ray.intersectObjects(meshes,false).length,0,`${g.name}: open ground passage`);
      for(const alias of g.members)assert.deepEqual(index.get(alias),index.get(g.root));
    }
    const courtyard=new Raycaster(new Vector3(1289,1396,100),new Vector3(0,0,-1)).intersectObjects(meshes,false);
    assert.equal(courtyard.length,0,'D3 courtyard remains open');
  }finally{disposeModel(scene);}
});
