import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Texture,Vector2,ShapeUtils} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PLAN_ROOF_GROUPS,roofGroupGeometry} from '../src/gis/layers/CampusPlanRoofGroups';
import {coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {academicPlanFor} from '../src/gis/features/CampusAcademicPlan';
const sources=Object.fromEntries(await Promise.all(['buildings','sports','landmarks','pois'].map(async name=>[name,JSON.parse(await readFile(`public/data/${name}.geojson`,'utf8'))]))) as unknown as FeatureSources;
const repository=new StaticFeatureRepository(sources),loader=new GLTFLoader();
loader.register(()=>({name:'GEOMETRY_REVIEW_NO_TEXTURE_DOWNLOAD',loadTexture:()=>Promise.resolve(new Texture())}));
const bytes=await readFile('../output/campus_detail_release_v004.glb');
const result=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const index=createCampusModelIndex(result.scene,repository.getAll());
const queue=JSON.parse(await readFile('../reference/buildings/campus_whole_school_queue_v005.json','utf8'));
function originalNode(id:string){
  const path=queue.records.find((r:any)=>r.id===id)?.sourceModelPath;
  if(!path)return undefined;
  const doc=result.parser.json;let children=doc.scenes[doc.scene??0].nodes as number[],found:number|undefined;
  for(const name of path.split('/')){found=children.find(i=>doc.nodes[i].name===name);if(found===undefined)return;children=doc.nodes[found].children??[];}
  return found;
}
const groups=PLAN_ROOF_GROUPS.map(group=>{
  const geometry=roofGroupGeometry(group.root)!;
  const polys=(geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates).map(poly=>poly.map(ring=>ring.map(p=>coordinates.wgs84ToLocal([p[0]!,p[1]!]))));
  const triangles=polys.flatMap(poly=>{
    const rings=poly.map(r=>r.slice(0,-1).map(p=>new Vector2(...p)));
    const points=rings.flat();return ShapeUtils.triangulateShape(rings[0]!,rings.slice(1)).map(t=>t.map(i=>points[i]!.toArray()));
  });
  return {...group,geometryLocal:{type:polys.length===1?'Polygon':'MultiPolygon',coordinates:polys.length===1?polys[0]:polys},triangles,
    bindings:[group.root,...group.members].map(id=>{const mapped=(index.get(id)??[]).map(node=>result.parser.associations.get(node)?.nodes).filter(i=>i!==undefined);const original=originalNode(id);return {id,nodeIndices:mapped.length?mapped:original===undefined?[]:[original]};})};
});
const dir=resolve('../reference/buildings/shape_review_v001');await mkdir(dir,{recursive:true});
const neighborId='buildings:dcea1c9614744dcfce1d';
const neighbor=academicPlanFor(neighborId)!;
const neighbors=[{id:neighborId,geometryLocal:neighbor.geometry,nodeIndices:(index.get(neighborId)??[]).map(node=>result.parser.associations.get(node)?.nodes).filter(i=>i!==undefined)}];
await writeFile(resolve(dir,'registered_input_v002.json'),JSON.stringify({source:'USER_MAP_REGISTERED_ROOFS_NOT_SURVEYED',map:'../bb9e69ad7ce16bfda1a854e938151961.jpg',reference:'https://www.720yun.com/vr/3a8jtrevsu9',groups,neighbors},null,2),{flag:'wx'});
console.log(JSON.stringify({groups:groups.length,missing:groups.flatMap(g=>g.bindings.filter(b=>!b.nodeIndices.length).map(b=>b.id))}));
