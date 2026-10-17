import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type Object3D, type Mesh, type Material } from 'three';
import { ACTIVE_MODEL_URL, ACTIVE_MODEL_HASH } from './CampusThreeConfig';
import { prepareProjectionAsync } from './CampusModelTransform';
import { disposeModel } from './ThreeResourceManager';
import { createCampusModelIndex } from './ModelNodeIndex';
import { hideDiagnosticContours,hideShapeReviewReferences } from './CampusModelPresentation';
import { createCampusBuildingWorkPreview } from './CampusBuildingWorkPreview';
import type { CampusFeature } from '../../types/CampusFeature';
import {createCampusRenderBatches} from './CampusRenderBatches';
export async function loadCampus(signal:AbortSignal,features:readonly CampusFeature[]=[]) {
  const stages:Record<string,number>={};let stageStart=performance.now();
  const stage=(name:string)=>{const now=performance.now();stages[name]=now-stageStart;stageStart=now;};
  const start=performance.now(),response=await fetch(ACTIVE_MODEL_URL,{signal});
  if(!response.ok)throw Error(`校园模型加载失败（HTTP ${response.status}）`);
  const buffer=await response.arrayBuffer();
  stage('downloadMs');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
  if(hash!==ACTIVE_MODEL_HASH)throw Error('校园模型校验不符，请恢复当前配置对应文件');
  stage('hashMs');
  signal.throwIfAborted();
  const {scene}=await new GLTFLoader().parseAsync(buffer,'/models/');
  stage('decodeMs');
  try {
  hideDiagnosticContours(scene);
  hideShapeReviewReferences(scene);
  const teachingPreview=createCampusBuildingWorkPreview(scene,features);
  stage('previewMs');
  const index=createCampusModelIndex(scene,features);stage('indexMs');
  const alignment=await prepareProjectionAsync(scene,signal);stage('projectionMs');
  for(const name of ['REFINED_BUILDINGS','REFINED_LANDMARKS','REFINED_SPORTS']) {const node=scene.getObjectByName(name);if(node)index.set(name,[node]);}
  const ground=new Set<Material>();let nodes=0;
  scene.traverse(o=>{
    nodes++;const mesh=o as Mesh;if(!mesh.material)return;
    let isGround=false;for(let p:Object3D|null=o;p;p=p.parent)if(/Ground/i.test(p.name))isGround=true;
    if(isGround){mesh.material=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>{const c=m.clone();c.polygonOffset=true;c.polygonOffsetFactor=1;c.polygonOffsetUnits=1;ground.add(c);return c;});}
  });
  stage('materialsMs');
  const renderBatches=createCampusRenderBatches(scene);
  stage('batchesMs');
  return {scene,index,ground,alignment,nodes,teachingPreview,renderBatches,stages,loadMs:performance.now()-start};
  } catch(error) {disposeModel(scene);throw error;}
}
