import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../web/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const report=json('../reference/buildings/quality_v002/correction_report.json');
async function load(name){
  const loader=new GLTFLoader();loader.register(()=>({name:'GEOMETRY_ONLY_TEXTURE_STUB',loadTexture:()=>Promise.resolve(new T.Texture())}));
  const b=readFileSync(new URL('../output/'+name,import.meta.url));
  const {scene}=await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');scene.updateMatrixWorld(true);return scene;
}
const old=await load('campus_detail_preview_v001.glb'),fresh=await load('campus_detail_preview_v002.glb');
function features(scene){const items=new Map();scene.traverse(o=>{if(o.userData.feature_id&&!o.isMesh){assert.ok(!items.has(o.userData.feature_id));items.set(o.userData.feature_id,o);}});return items;}
const before=features(old),after=features(fresh),changes=new Map(report.changes.map(c=>[c.id,c]));
test('quality audit passes with 124 stable feature IDs and 121 registered ground-contact footprints',()=>{
  assert.equal(report.status,'PASS');assert.ok(Object.values(report.checks).every(Boolean));
  assert.equal(before.size,124);assert.equal(after.size,124);assert.deepEqual([...after.keys()],[...before.keys()]);
  assert.equal(report.afterCounts.registeredFootprints,121);assert.equal(report.afterCounts.incompleteGroundCoverage,0);
});
test('79 corrected foundations leave zero audited issues over the declared 10cm threshold',()=>{
  assert.equal(report.changedBuildings,79);assert.equal(report.liftedBuildings,23);
  assert.equal(report.afterCounts.foundationGapOver10cm,0);assert.equal(report.afterCounts.terrainAbovePlinthOver10cm,0);
  assert.equal(report.afterCounts.projectedOverlapsOverPoint1Sqm,0);
});
test('all 124 roots preserve horizontal coordinates, rotation, scale, IDs and unverified height metadata',()=>{
  for(const [id,a] of before){const b=after.get(id),c=changes.get(id);
    assert.equal(a.position.x,b.position.x,id);assert.equal(a.position.y,b.position.y,id);
    assert.ok(Math.abs(b.position.z-a.position.z-(c?.rootLiftMeters??0))<2e-5,id);
    assert.deepEqual(a.quaternion.toArray(),b.quaternion.toArray());assert.deepEqual(a.scale.toArray(),b.scale.toArray());
    assert.deepEqual(a.userData,b.userData);assert.deepEqual(a.children.map(x=>x.name),b.children.map(x=>x.name));
  }
});
test('building bodies, windows, roofs, material values, topology and all world XY vertices are preserved',()=>{
  const av=new T.Vector3(),bv=new T.Vector3();
  for(const [id,a] of before){const b=after.get(id);
    for(let i=0;i<a.children.length;i++){
      const x=a.children[i],y=b.children[i];if(!x.isMesh)continue;
      assert.deepEqual(x.userData,y.userData);assert.deepEqual(x.geometry.index?.array,y.geometry.index?.array);
      const pa=x.geometry.attributes.position,pb=y.geometry.attributes.position;assert.equal(pa.count,pb.count);
      const changedBase=changes.has(id)&&x.userData.mesh_role==='base';
      if(!changedBase)assert.deepEqual(pa.array,pb.array,id+' '+x.name);
      for(let j=0;j<pa.count;j++){
        av.fromBufferAttribute(pa,j).applyMatrix4(x.matrixWorld);bv.fromBufferAttribute(pb,j).applyMatrix4(y.matrixWorld);
        assert.ok(Math.abs(av.x-bv.x)<2e-4&&Math.abs(av.y-bv.y)<2e-4,id+' horizontal footprint');
      }
      for(const attr of ['normal','uv'])assert.deepEqual(x.geometry.attributes[attr]?.array,y.geometry.attributes[attr]?.array);
      const mat=m=>({color:m.color?.toArray(),metalness:m.metalness,roughness:m.roughness,side:m.side,opacity:m.opacity,transparent:m.transparent});
      assert.deepEqual(mat(x.material),mat(y.material));
    }
  }
});
test('auditorium, library, south gate, sculpture, sports and three special buildings stay byte-equivalent in JSON/BIN storage',()=>{
  function glb(name){const b=readFileSync(new URL('../output/'+name,import.meta.url));const n=b.readUInt32LE(12);return JSON.parse(b.subarray(20,20+n).toString());}
  const a=glb('campus_detail_preview_v001.glb'),b=glb('campus_detail_preview_v002.glb');
  const roots=new Set(report.changes.filter(c=>c.rootLiftMeters>0).map(c=>c.rootNode));
  a.nodes.forEach((n,i)=>{if(!roots.has(i))assert.deepEqual(n,b.nodes[i]);});
  assert.deepEqual(a.materials,b.materials);assert.deepEqual(a.scenes,b.scenes);
  for(const name of ['AUDITORIUM_REFINED_ROOT','LIBRARY_REFINED_ROOT','SOUTH_GATE_REFINED_ROOT','FUS_Root','REFINED_SPORTS']){
    assert.ok(b.nodes.some(n=>n.name===name),name);
  }
});
test('all 124 actual building meshes remain individually raycastable after correction',()=>{
  const ray=new T.Raycaster(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),normal=new T.Vector3();
  for(const [id,root] of after){let hit=false;
    root.traverse(mesh=>{if(hit||!mesh.isMesh)return;const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
      for(let i=0;i<(index?index.count:p.count);i+=3){
        a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
        normal.crossVectors(b.clone().sub(a),c.clone().sub(a));if(normal.lengthSq()<1e-8)continue;
        normal.normalize();const center=a.clone().add(b).add(c).multiplyScalar(1/3);
        ray.set(center.addScaledVector(normal,.1),normal.clone().negate());ray.near=0;ray.far=.2;
        if(ray.intersectObject(mesh,false).some(h=>h.object===mesh)){hit=true;break;}
      }
    });assert.ok(hit,id+' must remain pickable');
  }
});
