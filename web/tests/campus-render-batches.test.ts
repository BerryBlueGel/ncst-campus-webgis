import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Texture,Mesh,Box3,Vector3,Raycaster,type Object3D} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createCampusRenderBatches} from '../src/gis/three/CampusRenderBatches';
import {prepareProjection} from '../src/gis/three/CampusModelTransform';
import {ModelNodeIndex} from '../src/gis/three/ModelNodeIndex';
import {ThreeFeatureHighlighter} from '../src/gis/three/ThreeFeatureHighlighter';
async function load(){const loader=new GLTFLoader();loader.register(()=>({name:'NODE_TEST_IMAGE_DECODER',loadTexture:()=>Promise.resolve(new Texture())}));const bytes=readFileSync('../output/campus_detail_release_v004.glb');return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;}
function visibleMeshes(root:Object3D){const meshes:Mesh[]=[];root.traverseVisible(node=>{if((node as Mesh).isMesh)meshes.push(node as Mesh);});return meshes;}
function counts(root:Object3D){const meshes=visibleMeshes(root);return {calls:meshes.length,triangles:meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.getAttribute('position').count)/3,0)};}
for(const projected of [false,true])test(`runtime batches preserve all 124 feature bounds, sampled roof hits and triangles (${projected?'MapLibre':'ENU'})`,async()=>{
  const scene=await load();if(projected)prepareProjection(scene);scene.updateWorldMatrix(true,true);
  const roots:Object3D[]=[];scene.traverse(root=>{if(root.userData.feature_id&&!(root as Mesh).isMesh)roots.push(root);});
  const index=new ModelNodeIndex();roots.forEach(root=>index.addBinding(root.userData.feature_id,root));
  const before=counts(scene),ray=new Raycaster(),down=new Vector3(0,0,-1);
  const snapshots=roots.map(root=>{
    const meshes=visibleMeshes(root),bounds=new Box3();meshes.forEach(mesh=>bounds.union(new Box3().setFromObject(mesh)));
    const points:Array<{point:Vector3;z:number|null}>=[];
    for(let x=1;x<5;x++)for(let y=1;y<5;y++){
      const point=new Vector3(bounds.min.x+(bounds.max.x-bounds.min.x)*x/5,bounds.min.y+(bounds.max.y-bounds.min.y)*y/5,bounds.max.z+10);
      ray.set(point,down);const hit=ray.intersectObjects(meshes,false)[0];points.push({point,z:hit?.point.z??null});
    }
    return {root,bounds,points};
  });
  const batches=createCampusRenderBatches(scene),after=counts(scene);
  assert.equal(roots.length,124);assert.equal(after.triangles,before.triangles);
  assert.ok(before.calls-after.calls>2000,JSON.stringify({before,after,stats:batches.stats}));
  for(const {root,bounds,points} of snapshots){
    const meshes=visibleMeshes(root),current=new Box3();meshes.forEach(mesh=>{current.union(new Box3().setFromObject(mesh));assert.equal(index.resolveFeatureId(mesh),root.userData.feature_id);});
    assert.ok(current.min.distanceTo(bounds.min)<0.001&&current.max.distanceTo(bounds.max)<0.001,root.name);
    for(const {point,z} of points){ray.set(point,down);const hit=ray.intersectObjects(meshes,false)[0];if(z===null)assert.equal(hit,undefined);else assert.ok(hit&&Math.abs(hit.point.z-z)<0.001,root.name);}
  }
  const visible=index.visiblePickMeshes();assert.ok(visible.every(mesh=>mesh.visible));
  const originals=visible.map(mesh=>(mesh as Mesh).material),highlight=new ThreeFeatureHighlighter(index);
  for(let i=0;i<10;i++){highlight.set(roots[i].userData.feature_id,null);highlight.set(null,null);}highlight.dispose();
  assert.deepEqual(visible.map(mesh=>(mesh as Mesh).material),originals);
  batches.dispose();batches.dispose();assert.deepEqual(counts(scene),before);
});
