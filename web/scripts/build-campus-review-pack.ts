import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Texture,Mesh} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {createResidentialPlanPreview} from '../src/gis/three/CampusResidentialModel';
import {sourceBuildingBindings} from '../src/gis/three/SourceBuildingBindings';
import {disposeModel} from '../src/gis/three/ThreeResourceManager';
import {buildingReviewSector} from '../src/gis/features/CampusBuildingReviewSectors';
import {RESIDENTIAL_PLAN_GEOMETRIES,RESIDENTIAL_PLAN_PROVENANCE,RESIDENTIAL_WALL_ANGLE} from '../src/gis/features/CampusResidentialPlan';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex').toUpperCase();
const glbPath=resolve('../output/campus_refined_v005.glb'),sourcePath=resolve('public/data/buildings.geojson');
const input=await readFile(glbPath),source=await readFile(sourcePath);
if(hash(input)!=='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65')throw Error('Formal v005 differs');
if(hash(source)!=='118D98BA970E9FCE28074AFA5F29B5089B5BF02A487D2645A55D1A1529AED8F6')throw Error('Source GIS differs');
const targets=['../output/residential_area_preview_v004.glb','../reference/buildings/campus_building_review_v006.json','../reference/buildings/residential_batch_v004.json'].map(p=>resolve(p));
for(const target of targets){try{await access(target);throw Error(`Refusing to overwrite ${target}`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
const sources=Object.fromEntries(await Promise.all(['buildings','sports','landmarks','pois'].map(async key=>[key,JSON.parse(await readFile(`public/data/${key}.geojson`,'utf8'))]))) as unknown as FeatureSources;
const repository=new StaticFeatureRepository(sources);
const loader=new GLTFLoader();loader.register(()=>({name:'GEOMETRY_ONLY_EXPORT',loadTexture:()=>Promise.resolve(new Texture())}));
const gltf=await loader.parseAsync(input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength),'');
class BlobReader{result:ArrayBuffer|null=null;onloadend?:()=>void;readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}}
Object.assign(globalThis,{FileReader:BlobReader});
try{
  const bindings=sourceBuildingBindings(gltf.scene,repository.getAll());
  const control=createResidentialPlanPreview(gltf.scene,repository.getAll());
  if(control.root.children.length!==57)throw Error('Fifty-seven exact source bindings required');
  const originalPath=(id:string)=>{
    let root=bindings.find(b=>b.id===id)!.root;const parts:string[]=[];
    for(let node:typeof root|null=root;node;node=node.parent){
      const idx=gltf.parser.associations.get(node)?.nodes;
      if(idx!==undefined)parts.unshift(gltf.parser.json.nodes[idx].name);
    }
    return parts.join('/');
  };
  let triangles=0;control.root.traverse(o=>{if((o as Mesh).isMesh){const g=(o as Mesh).geometry;triangles+=(g.index?.count??g.attributes.position!.count)/3;}});
  const records=RESIDENTIAL_PLAN_GEOMETRIES.map(ref=>{
    const mesh=control.root.children.find(m=>m.userData.featureId===ref.id)!;
    return {id:ref.id,batchVersion:ref.batchVersion,wallPolicy:ref.wallPolicy,sourceLabel:ref.sourceLabel,planLabel:ref.planLabel,pair:ref.pair,sourceModelPath:originalPath(ref.id),
      tracePixels:ref.trace,geometryLocal:ref.geometry,regularizationMeters:ref.maxRegularizationMeters,
      sourceBodyHeightMeters:mesh.userData.sourceBodyHeightMeters,sourceBaseElevationMeters:mesh.userData.sourceBaseElevationMeters,
      representation:'INDEPENDENT_SOURCE_ID_NOT_GROUP_UNION',ownershipStatus:'SOURCE_IDS_REMAIN_INDEPENDENT'};
  });
  const batch={...RESIDENTIAL_PLAN_PROVENANCE,wallAngleDegrees:RESIDENTIAL_WALL_ANGLE*180/Math.PI,
    meshes:57,triangles,records,excludedIds:['buildings:c1a62d3431a6223b40f3','buildings:8c3f21b9a8bd43f5dbc2','buildings:cb64ee8051756c097c6b','buildings:5406aa5430d00212d9e7','buildings:6d188b2b59ca4eb32182','buildings:b795fc43df83ff863ac7','buildings:b910aecdb252a70a2f2b','buildings:73bcd79a72a4bcf7af29','buildings:c82b0c4a55bcfdab22a7','buildings:0e28bd126b55d619bf5c','buildings:7371e64fc4bf9ae493c7','buildings:62cb4835dfd1bc3dc02c','buildings:ee41f8d6bdc58b5467de','buildings:838f69cbcb84b6bed2b2'],
    limitations:['Plan labels, not current official names.','Source coarse height retained, not measured.','Small independent source fragments remain unmerged and undeleted.','Source bars are not claimed to include every nearby wing.','014 and diagonal public-building traces retain schematic slanted walls without orthogonalization; apparent connectors are not elevated structures.','Canteens use exterior footprints; internal roof seams do not create building IDs or holes.','Whole-campus queue is not proof of completed whole-campus modeling.']};
  control.root.removeFromParent();control.root.updateMatrixWorld(true);
  const binary=await new GLTFExporter().parseAsync(control.root,{binary:true,onlyVisible:true});
  if(!(binary instanceof ArrayBuffer))throw Error('Binary export required');
  const inventory=JSON.parse(await readFile('../reference/buildings/campus_building_inventory_v002.json','utf8'));
  const reviews=inventory.records.map((record:any)=>({...record,reviewSector:buildingReviewSector(record.boundsLocalEastNorth),
    stage:records.some(r=>r.id===record.id)?`RESIDENTIAL_DISPLAY_${records.find(r=>r.id===record.id)!.batchVersion.toUpperCase()}_NOT_AS_BUILT`:record.stage,
    planLabel:records.find(r=>r.id===record.id)?.planLabel??null}));
  const sectors=Object.fromEntries([...new Set(reviews.map((r:any)=>r.reviewSector))].sort().map(sector=>{
    const entries=reviews.filter((r:any)=>r.reviewSector===sector);
    return [sector,{total:entries.length,remaining:entries.filter((r:any)=>r.stage==='SOURCE_ROUGH_UNREVIEWED').length,ids:entries.map((r:any)=>r.id)}];
  }));
  const review={schemaVersion:6,sectorMethod:'SOURCE_BOUNDS_CENTER_APPROXIMATE_SCHEDULING_NOT_OFFICIAL_ZONING',
    summary:{totalSourceFootprints:166,teachingWork:8,residentialWork:57,independentTeachingParts:3,refinedSourceReferences:3,
      otherSourceFootprints:reviews.filter((r:any)=>r.stage==='SOURCE_ROUGH_UNREVIEWED').length},sectors,records:reviews,
    sourceOverlapPairs:inventory.pairs.filter((p:any)=>p.overlapSquareMeters!==undefined),
    nextPriority:['Review independent 062/063 and 047 with additional views; do not infer ownership from overlap.',
      'Continue living-area north/south blocks by stable source ID, keeping courtyards open.',
      'Academic wings, gymnasium and diagonal buildings require individual traces, not this rectilinear template.'],
    sourceSha256:hash(source),formalGlbSha256:hash(input),limitations:inventory.limitations};
  if(hash(await readFile(glbPath))!==hash(input)||hash(await readFile(sourcePath))!==hash(source))throw Error('Protected input changed');
  await writeFile(targets[0]!,Buffer.from(binary),{flag:'wx'});
  await writeFile(targets[1]!,JSON.stringify(review,null,2)+'\n',{flag:'wx'});
  await writeFile(targets[2]!,JSON.stringify({...batch,previewSha256:hash(new Uint8Array(binary))},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({targets,bytes:binary.byteLength,triangles,reviewSummary:review.summary,sectors:Object.fromEntries(Object.entries(sectors).map(([k,v]:any)=>[k,{total:v.total,remaining:v.remaining}]))},null,2));
  disposeModel(control.root);
}finally{disposeModel(gltf.scene);}
