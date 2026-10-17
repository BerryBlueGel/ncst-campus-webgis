import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import proj4 from 'proj4';
import {Texture,type Mesh,type Object3D} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CAMPUS_CRS,coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import {prepareProjection,prepareProjectionAsync} from '../src/gis/three/CampusModelTransform';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';

async function scene(){
  const loader=new GLTFLoader();loader.register(()=>({name:'TEST_IMAGE_DECODER',loadTexture:()=>Promise.resolve(new Texture())}));
  const bytes=readFileSync('../output/campus_detail_release_v004.glb');
  return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
}
function nodes(root:Object3D){const list:Object3D[]=[];root.traverse(node=>list.push(node));return list;}

test('reused CRS converter matches independent proj4 across campus and retains inverse precision',()=>{
  for(const x of [-100,0,900,2100])for(const y of [-100,0,1100,2600]){
    const utm=coordinates.localToUtm([x,y]),ll=coordinates.utmToWgs84(utm);
    assert.deepEqual(ll,proj4(CAMPUS_CRS,'EPSG:4326',utm));
    assert.deepEqual(coordinates.wgs84ToUtm(ll),proj4('EPSG:4326',CAMPUS_CRS,ll));
    const local=coordinates.wgs84ToLocal(ll);assert.ok(Math.hypot(local[0]-x,local[1]-y)<1e-6);
  }
});

test('cooperative projection yields and matches synchronous positions, normals, hierarchy and six alignments',async()=>{
  const sync=await scene(),asyncScene=await scene();let yields=0;
  try {
    const alignment=prepareProjection(sync);
    const actual=await prepareProjectionAsync(asyncScene,new AbortController().signal,async()=>{yields++;});
    assert.deepEqual(actual,alignment);assert.ok(yields>0);
    const a=nodes(sync),b=nodes(asyncScene);assert.equal(a.length,b.length);
    for(let i=0;i<a.length;i++){
      assert.equal(b[i].name,a[i].name);assert.deepEqual(b[i].matrix.elements,a[i].matrix.elements);
      const first=(a[i] as Mesh).geometry,second=(b[i] as Mesh).geometry;if(!first)continue;
      for(const key of Object.keys(first.attributes))assert.deepEqual(second.getAttribute(key).array,first.getAttribute(key).array,a[i].name+':'+key);
      assert.deepEqual(second.index?.array,first.index?.array);
      assert.deepEqual(second.boundingBox,first.boundingBox);assert.deepEqual(second.boundingSphere,first.boundingSphere);
    }
  }finally{disposeModel(sync);disposeModel(asyncScene);}
});

test('abort during projection prevents attachment and leaves a disposable partial scene',async()=>{
  const root=await scene(),controller=new AbortController();let yields=0;
  try {
    await assert.rejects(prepareProjectionAsync(root,controller.signal,async()=>{yields++;controller.abort();}),{name:'AbortError'});
    assert.equal(yields,1);assert.equal(root.parent,null);
  }finally{disposeModel(root);}
});

test('already aborted projection does not mutate input nodes or geometry',async()=>{
  const root=await scene(),original=nodes(root).map(node=>({node,matrix:node.matrix.elements.slice(),geometry:(node as Mesh).geometry}));
  const controller=new AbortController();controller.abort();
  try {
    await assert.rejects(prepareProjectionAsync(root,controller.signal),{name:'AbortError'});
    for(const {node,matrix,geometry} of original){assert.deepEqual(node.matrix.elements,matrix);assert.equal((node as Mesh).geometry,geometry);}
  }finally{disposeModel(root);}
});
