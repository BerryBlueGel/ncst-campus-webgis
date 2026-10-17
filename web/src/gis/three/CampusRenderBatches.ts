import {Group,Matrix4,Mesh,Vector3,type Object3D,type BufferGeometry} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {isEmbeddedDetailReview} from './CampusDetailReview';

/** Runtime-only static batches. Never merge across feature IDs or alter the GLB. */
export function createCampusRenderBatches(scene:Object3D,cellSize=160){
  if(!Number.isFinite(cellSize)||cellSize<=0)throw Error('Invalid batch cell size');
  const originals:Mesh[]=[],batches:Mesh[]=[],containers:Group[]=[];
  const stats={sourceMeshes:0,batches:0,savedDrawCalls:0,treeMeshes:0,buildingMeshes:0};
  if(!isEmbeddedDetailReview(scene))return {stats,dispose(){}};
  scene.updateWorldMatrix(true,true);
  const groups=new Map<string,{parent:Object3D;meshes:Mesh[];tree:boolean}>();
  scene.traverse(object=>{
    const mesh=object as Mesh;
    if(!mesh.isMesh||'isInstancedMesh' in mesh||'isSkinnedMesh' in mesh||Array.isArray(mesh.material))return;
    const material=mesh.material,geometry=mesh.geometry;
    if(material.transparent||Object.values(geometry.morphAttributes).some(a=>a.length)||geometry.drawRange.start!==0||geometry.drawRange.count!==Infinity)return;
    let feature:Object3D|undefined,tree=false;
    for(let node:Object3D|null=mesh;node;node=node.parent){
      if(!node.visible)return;
      if(node.userData.feature_id&&!(node as Mesh).isMesh&&!feature)feature=node;
      tree ||= /^TPX_Trees(?:_|$)/.test(node.name);
    }
    if(!feature&&!tree)return;
    if(feature&&mesh.userData.feature_id&&mesh.userData.feature_id!==feature.userData.feature_id)return;
    const parent=feature??scene;
    const matrix=parent.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    if(matrix.determinant()<=0)return;
    const p=new Vector3().setFromMatrixPosition(matrix);
    const attrs=Object.entries(geometry.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>[name,a.itemSize,a.normalized,a.array.constructor.name].join(':')).join(';');
    // Geometry groups are unnecessary only for a single material. All surfaces stay identical.
    const key=[parent.uuid,material.uuid,attrs,!!geometry.index,mesh.layers.mask,mesh.renderOrder,mesh.castShadow,mesh.receiveShadow,
      feature?'feature':`${Math.floor(p.x/cellSize)},${Math.floor(p.y/cellSize)}`].join('|');
    let group=groups.get(key);if(!group){group={parent,meshes:[],tree:!feature};groups.set(key,group);}group.meshes.push(mesh);
  });
  const byParent=new Map<Object3D,Group>();
  for(const {parent,meshes,tree} of groups.values()){
    if(meshes.length<2)continue;
    const inverse=parent.matrixWorld.clone().invert();
    const copies:BufferGeometry[]=meshes.map(mesh=>{
      const geometry=mesh.geometry.clone();geometry.clearGroups();
      geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));return geometry;
    });
    const merged=mergeGeometries(copies,false);copies.forEach(g=>g.dispose());
    if(!merged)continue;
    merged.computeBoundingBox();merged.computeBoundingSphere();
    let container=byParent.get(parent);
    if(!container){container=new Group();container.name='CAMPUS_RENDER_BATCHES';parent.add(container);byParent.set(parent,container);containers.push(container);}
    const source=meshes[0],batch=new Mesh(merged,source.material);
    batch.name='CAMPUS_STATIC_BATCH_'+batches.length;
    batch.layers.mask=source.layers.mask;batch.renderOrder=source.renderOrder;batch.castShadow=source.castShadow;batch.receiveShadow=source.receiveShadow;
    batch.userData.batchedSourceCount=meshes.length;
    container.add(batch);batches.push(batch);
    meshes.forEach(mesh=>{mesh.visible=false;mesh.userData.campusBatchedSource=true;originals.push(mesh);});
    stats.sourceMeshes+=meshes.length;stats.batches++;stats.savedDrawCalls+=meshes.length-1;
    if(tree)stats.treeMeshes+=meshes.length;else stats.buildingMeshes+=meshes.length;
  }
  scene.updateWorldMatrix(true,true);
  let disposed=false;
  return {stats,dispose(){if(disposed)return;disposed=true;originals.forEach(mesh=>{mesh.visible=true;delete mesh.userData.campusBatchedSource;});containers.forEach(group=>group.removeFromParent());batches.forEach(mesh=>mesh.geometry.dispose());}};
}
