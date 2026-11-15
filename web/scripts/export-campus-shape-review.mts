import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {TEACHING_PLAN_GEOMETRIES} from '../src/gis/features/TeachingPlanGeometry';
import {RESIDENTIAL_PLAN_GEOMETRIES} from '../src/gis/features/CampusResidentialPlan';
import {ACADEMIC_PLAN_GEOMETRIES} from '../src/gis/features/CampusAcademicPlan';
import {SOUTHWEST_PLAN_GEOMETRIES} from '../src/gis/features/CampusSouthwestPlan';
import {REMAINING_PLAN_GEOMETRIES} from '../src/gis/features/CampusRemainingPlan';
import {roofGroupFor,roofGroupGeometry} from '../src/gis/layers/CampusPlanRoofGroups';
import {coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import {createCampusModelIndex} from '../src/gis/three/ModelNodeIndex';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {hideShapeReviewReferences} from '../src/gis/three/CampusModelPresentation';
import heights from '../src/gis/three/CampusDetailReviewManifest.json';
import {DORMITORY_COMPOUNDS} from '../src/gis/features/CampusDormitoryCompounds';

const sourceModel='output/campus_shape_review_v003.glb';
const loader=new GLTFLoader();loader.register(()=>({name:'NO_TEXTURE_EXPORT',loadTexture:()=>Promise.resolve(new Texture())}));
const bytes=await readFile('../'+sourceModel),gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
hideShapeReviewReferences(gltf.scene);gltf.scene.updateMatrixWorld(true);
const sources=Object.fromEntries(await Promise.all(['buildings','sports','landmarks','pois'].map(async n=>[n,JSON.parse(await readFile(`public/data/${n}.geojson`,'utf8'))]))) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources),index=createCampusModelIndex(gltf.scene,repo.getAll());
const plans=[...TEACHING_PLAN_GEOMETRIES,...RESIDENTIAL_PLAN_GEOMETRIES,...ACADEMIC_PLAN_GEOMETRIES,...SOUTHWEST_PLAN_GEOMETRIES,...REMAINING_PLAN_GEOMETRIES];
const dorms=new Set([...Object.entries(heights.heightEstimates).filter(([,h])=>h.storeys===5).map(([id])=>id),...DORMITORY_COMPOUNDS.flatMap(g=>[g.root,...g.members])]);
const groups=[];
for(const p of plans){
  if(dorms.has(p.id))continue;
  const group=roofGroupFor(p.id);if(group&&group.root!==p.id)continue;
  const projected=roofGroupGeometry(p.id);
  const transform=(rings:number[][][])=>rings.map(r=>r.map(([x,y])=>coordinates.wgs84ToLocal([x!,y!])));
  const geometryLocal=projected?(projected.type==='Polygon'?{type:'Polygon',coordinates:transform(projected.coordinates)}:{type:'MultiPolygon',coordinates:projected.coordinates.map(transform)}):p.geometry;
  const roots=[...new Set([p.id,...(group?.members??[])].flatMap(id=>index.get(id)??[]))].filter(root=>{for(let n:typeof root|null=root;n;n=n.parent)if(!n.visible)return false;return true;});
  const bindings=roots.map(root=>({id:root.userData.feature_id??p.id,nodeIndices:[gltf.parser.associations.get(root)?.nodes]}));
  if(!bindings.length||bindings.some(b=>typeof b.nodeIndices[0]!=='number'))throw Error('Missing exact visible roof '+p.id);
  groups.push({id:p.id,root:p.id,name:'name' in p?p.name:p.planLabel,members:group?.members??[],geometryLocal,bindings});
}
const dir='../reference/buildings/campus_shapes_v004';await mkdir(dir,{recursive:true});
await writeFile(dir+'/input.json',JSON.stringify({sourceModel,source:'REGISTERED_TIFF_NON_DORM_ROOF_COMPARISON_NOT_SURVEY',groups,neighbors:[],compounds:[],excludedDormIds:[...dorms]},null,2),{flag:'wx'});
console.log(JSON.stringify({nonDormScopes:groups.length,sourceRecords:sources.buildings.features.length}));
