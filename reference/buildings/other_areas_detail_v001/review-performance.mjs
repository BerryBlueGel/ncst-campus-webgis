/** Runtime-only, reversible batching. Buildings and source buffers are never merged. */
export function instanceReviewTrees(root, THREE, {cellSize=160}={}) {
  if(!Number.isFinite(cellSize)||cellSize<=0)throw new Error('cellSize must be positive');
  root.updateWorldMatrix(true,true);
  const inverse=new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups=new Map(), originals=[], batches=[];
  let candidates=0;
  root.traverse(object=>{
    if(!object.isMesh||object.isInstancedMesh||object.isSkinnedMesh)return;
    let tree=false;
    for(let node=object;node;node=node.parent){
      if(node.visible===false||node.userData.feature_id||node.userData.featureId)return;
      tree ||= /^TPX_Trees(?:_|$)/.test(node.name);
    }
    if(!tree)return;
    candidates++;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    if(materials.some(m=>m.transparent)||Object.values(object.geometry.morphAttributes).some(a=>a.length))return;
    const matrix=new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld);
    if(matrix.determinant()<=0)return;
    const position=new THREE.Vector3().setFromMatrixPosition(matrix);
    const key=[object.geometry.uuid,materials.map(m=>m.uuid).join(','),
      Math.floor(position.x/cellSize),Math.floor(position.y/cellSize),
      object.layers.mask,object.renderOrder,object.castShadow,object.receiveShadow].join('|');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({object,matrix});
  });
  const container=new THREE.Group();container.name='REVIEW_TREE_BATCHES';root.add(container);
  for(const entries of groups.values()){
    if(entries.length<2)continue;
    const source=entries[0].object;
    const batch=new THREE.InstancedMesh(source.geometry,source.material,entries.length);
    batch.name='REVIEW_TREE_BATCH_'+batches.length;
    batch.layers.mask=source.layers.mask;batch.renderOrder=source.renderOrder;
    batch.castShadow=source.castShadow;batch.receiveShadow=source.receiveShadow;
    batch.userData.reviewSourceObjects=entries.map(e=>e.object);
    entries.forEach(({object,matrix},i)=>{batch.setMatrixAt(i,matrix);originals.push(object);});
    batch.instanceMatrix.needsUpdate=true;batch.computeBoundingBox();batch.computeBoundingSphere();
    container.add(batch);batches.push(batch);
  }
  root.updateWorldMatrix(true,true);
  let maxWorldMatrixDeviation=0;
  const instanceMatrix=new THREE.Matrix4(),worldMatrix=new THREE.Matrix4();
  for(const batch of batches)batch.userData.reviewSourceObjects.forEach((source,i)=>{
    batch.getMatrixAt(i,instanceMatrix);worldMatrix.multiplyMatrices(batch.matrixWorld,instanceMatrix);
    worldMatrix.elements.forEach((v,j)=>{maxWorldMatrixDeviation=Math.max(maxWorldMatrixDeviation,Math.abs(v-source.matrixWorld.elements[j]));});
  });
  let enabled=false,disposed=false;
  const setEnabled=value=>{
    if(disposed)return;
    enabled=Boolean(value);container.visible=enabled;
    originals.forEach(object=>{object.visible=!enabled;});
  };
  setEnabled(true);
  return {
    stats:{candidates,batchedMeshes:originals.length,batches:batches.length,
      unchangedMeshes:candidates-originals.length,cellSize,maxWorldMatrixDeviation},
    setEnabled,
    get enabled(){return enabled;},
    dispose(){
      if(disposed)return;
      setEnabled(false);root.remove(container);batches.forEach(batch=>batch.dispose());disposed=true;
    },
  };
}

/** Preserve the original identity when a tree instance is raycast. */
export function reviewHitSource(hit){
  return hit?.object?.isInstancedMesh&&Number.isInteger(hit.instanceId)
    ? hit.object.userData.reviewSourceObjects?.[hit.instanceId]??hit.object : hit?.object;
}

/** At most one pending RAF. Controls change events keep damping alive, not idle CPU. */
export function createReviewRenderLoop(render, requestFrame, cancelFrame){
  let pending=null,disposed=false,paused=false;
  const request=()=>{
    if(disposed||paused||pending!==null)return;
    pending=requestFrame(now=>{
      pending=null;
      if(!disposed&&!paused&&render(now))request();
    });
  };
  const cancel=()=>{if(pending!==null){cancelFrame(pending);pending=null;}};
  return {request,pause(){paused=true;cancel();},resume(){paused=false;request();},
    dispose(){disposed=true;cancel();}};
}
