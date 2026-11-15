import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../web/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const ledger=read('../reference/buildings/storeys_v003/storey_parameters.json');
const report=read('../reference/buildings/storeys_v003/build_validation.json');
const loader=new GLTFLoader();loader.register(()=>({name:'GEOMETRY_ONLY_TEXTURE_STUB',loadTexture:()=>Promise.resolve(new T.Texture())}));
async function load(version){const b=readFileSync(new URL(`../output/campus_detail_preview_${version}.glb`,import.meta.url));
 const {scene}=await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');scene.updateMatrixWorld(true);return scene;}
const old=await load('v002'),fresh=await load('v003');
function features(scene){const map=new Map();scene.traverse(o=>{if(o.userData.feature_id&&!o.isMesh){assert.ok(!map.has(o.userData.feature_id));map.set(o.userData.feature_id,o);}});return map;}
const before=features(old),after=features(fresh),eligible=new Set(ledger.assets.map(a=>a.id));
test('actual v003 retains 124 stable selectable feature hierarchies and original root transforms',()=>{
 assert.equal(report.status,'PASS');assert.equal(after.size,124);assert.deepEqual([...after.keys()],[...before.keys()]);
 for(const [id,a] of before){const b=after.get(id);assert.deepEqual(a.matrixWorld.toArray(),b.matrixWorld.toArray());assert.deepEqual(a.children.map(x=>x.name),b.children.map(x=>x.name));}
});
test('92 updated facades have real discrete glass vertices for four/five rows, not just changed metadata',()=>{
 assert.equal(eligible.size,92);
 for(const a of ledger.assets){const root=after.get(a.id);assert.equal(root.userData.floor_count,a.storeys);
  assert.equal(root.userData.floor_count_status,'USER_CONFIRMED_TYPICAL_STOREYS');assert.equal(root.userData.height_status,'ESTIMATED_FROM_STOREYS_NOT_MEASURED');
  let panes=0;root.traverse(o=>{if(o.isMesh&&['glass','warm_glass'].includes(o.userData.mesh_role)){
   panes++;const zs=[...o.geometry.attributes.position.array].filter((_,i)=>i%3===2);
   assert.deepEqual([...new Set(zs.map(z=>+z.toFixed(3)))].sort((x,y)=>x-y),a.windowRowsLocalZ.flat().map(z=>+z.toFixed(3)).sort((x,y)=>x-y));
  }});assert.ok(panes>0);const box=new T.Box3().setFromObject(root);assert.ok(Math.abs(box.max.z-root.position.z-a.heightAboveRootMeters)<.00001);
 }
});
test('all bases and non-eligible feature meshes retain exact positions, indices, material and metadata',()=>{
 for(const [id,a] of before){const b=after.get(id);if(!eligible.has(id))assert.deepEqual(a.userData,b.userData);
  for(let i=0;i<a.children.length;i++){const x=a.children[i],y=b.children[i];if(!x.isMesh||eligible.has(id)&&x.userData.mesh_role!=='base')continue;
   assert.deepEqual(x.userData,y.userData);assert.deepEqual(x.geometry.index?.array,y.geometry.index?.array);
   for(const name of Object.keys(x.geometry.attributes))assert.deepEqual(x.geometry.attributes[name].array,y.geometry.attributes[name].array);
   assert.deepEqual(x.material.color.toArray(),y.material.color.toArray());assert.equal(x.material.roughness,y.material.roughness);
  }
 }
});
test('all 124 actual building meshes remain raycastable with source feature identity',()=>{
 const ray=new T.Raycaster(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),normal=new T.Vector3();
 for(const [id,root] of after){let hit=false;root.traverse(mesh=>{if(hit||!mesh.isMesh)return;const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  for(let i=0;i<(index?index.count:p.count);i+=3){
   a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
   b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
   c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
   normal.crossVectors(b.clone().sub(a),c.clone().sub(a));if(normal.lengthSq()<1e-8)continue;normal.normalize();
   ray.set(a.clone().add(b).add(c).multiplyScalar(1/3).addScaledVector(normal,.1),normal.clone().negate());ray.near=0;ray.far=.2;
   if(ray.intersectObject(mesh,false).length){hit=true;break;}
  }
 });assert.ok(hit,id);}
});
test('line geometry and all original material definitions survive the storey adjustment',()=>{
 function lines(s){const found=[];s.traverse(o=>{if(o.isLine)found.push({name:o.name,positions:Array.from(o.geometry.attributes.position.array),indices:Array.from(o.geometry.index?.array??[]),world:o.matrixWorld.toArray()});});return found;}
 assert.equal(lines(fresh).length,321);assert.deepEqual(lines(old),lines(fresh));
});
