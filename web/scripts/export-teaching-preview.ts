import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createTeachingPlanPreview } from '../src/gis/three/TeachingPlanModel';
import { disposeModel } from '../src/gis/three/ThreeResourceManager';

// Node-only exporter shim: model has no textures; never exports campus or private files.
class BlobReader {
  result:ArrayBuffer|null=null;onloadend?:()=>void;
  readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}
}
Object.assign(globalThis,{FileReader:BlobReader});
const target=resolve('../output/teaching_area_preview_v004.glb');
try{await access(target);throw Error(`Refusing to overwrite ${target}`);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const bytes=await readFile('public/models/campus_refined_v005.glb');
const loader=new GLTFLoader();loader.register(()=>({name:'NO_TEXTURES_FOR_GEOMETRY_ONLY_EXPORT',loadTexture:()=>Promise.resolve(new Texture())}));
const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
try{
  const preview=createTeachingPlanPreview(scene);
  preview.root.removeFromParent();preview.root.updateMatrixWorld(true);
  const result=await new GLTFExporter().parseAsync(preview.root,{binary:true,onlyVisible:true});
  if(!(result instanceof ArrayBuffer))throw Error('Binary export expected');
  await writeFile(target,Buffer.from(result),{flag:'wx'});
  console.log(JSON.stringify({target,bytes:result.byteLength,meshes:preview.root.children.length,status:'APPROXIMATE_DISPLAY_ONLY',frame:'ENU',bodyHeight:'6m SOURCE ROUGH, NOT SURVEYED',connectionRepresentation:'GROUND_DRAPED_PLAN_MARKER_NOT_BUILDING'}));
  disposeModel(preview.root);
}finally{disposeModel(scene);}
