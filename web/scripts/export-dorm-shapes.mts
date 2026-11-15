import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RESIDENTIAL_PLAN_GEOMETRIES,residentialRasterToLocal} from '../src/gis/features/CampusResidentialPlan';
import {remainingPlanFor} from '../src/gis/features/CampusRemainingPlan';
import {roofGroupFor,roofGroupGeometry} from '../src/gis/layers/CampusPlanRoofGroups';
import {coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import heights from '../src/gis/three/CampusDetailReviewManifest.json';
import {dormitoryShapeCorrection} from '../src/gis/features/CampusDormitoryShapeReview';

const bytes=await readFile('../output/campus_shape_review_v001.glb');
const loader=new GLTFLoader();loader.register(()=>({name:'NO_TEXTURE_RESEARCH',loadTexture:()=>Promise.resolve(new Texture())}));
const {parser}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const doc=parser.json;
const previous=JSON.parse(await readFile('../reference/buildings/shape_review_v001/registered_input_v002.json','utf8'));
const queue=JSON.parse(await readFile('../reference/buildings/campus_whole_school_queue_v005.json','utf8'));
const rows=Object.entries(heights.heightEstimates).filter(([,h])=>h.storeys===5).map(([id])=>{
  const residential=RESIDENTIAL_PLAN_GEOMETRIES.find(r=>r.id===id),remaining=remainingPlanFor(id);
  const group=roofGroupFor(id),old=previous.groups.find((g:any)=>g.root===id);
  const geo=roofGroupGeometry(id);
  const correction=process.argv.includes('--corrected')?dormitoryShapeCorrection(id):undefined;
  const geometryLocal=correction?.geometry??(geo?{...geo,coordinates:geo.type==='Polygon'?geo.coordinates.map(r=>r.map(p=>coordinates.wgs84ToLocal([p[0]!,p[1]!]))):geo.coordinates.map(poly=>poly.map(r=>r.map(p=>coordinates.wgs84ToLocal([p[0]!,p[1]!]))))}:(residential??remaining)!.geometry);
  const binding=old?.bindings??[{id,nodeIndices:doc.nodes.map((n:any,i:number)=>({n,i})).filter(({n}:any)=>!('mesh' in n)&&n.extras?.feature_id===id&&!n.extras?.reference_only).map(({i}:any)=>i)}];
  if(!binding.every((b:any)=>b.nodeIndices.length===1))throw Error('Ambiguous exact node: '+id);
  return {id,root:id,name:(residential??remaining)!.planLabel,district:(residential??remaining)!.planLabel.slice(0,2),
    geometryLocal,bindings:binding,groupMembers:group?.members??[],sourceLabel:queue.records.find((r:any)=>r.id===id)?.sourceLabel,
    tracePixels:residential?residential.trace.map(([x,y])=>[x+700,y+3600]):remaining!.tracePixels,
    heightEstimate:heights.heightEstimates[id as keyof typeof heights.heightEstimates],correction};
});
const dir=resolve('../reference/buildings/dorm_shapes_v002');await mkdir(dir,{recursive:true});
await writeFile(resolve(dir,process.argv.includes('--corrected')?'corrected_input.json':'input.json'),JSON.stringify({sourceModel:'output/campus_shape_review_v001.glb',sourceMap:'campus_georef.tif; user JPG names and topology only',rows,groups:rows,neighbors:[]},null,2),{flag:'wx'});
console.log(JSON.stringify({count:rows.length,districts:rows.reduce((a:any,r)=>({...a,[r.district]:(a[r.district]??0)+1}),{})}));
