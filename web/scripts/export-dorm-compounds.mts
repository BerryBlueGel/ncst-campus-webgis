import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {feature,featureCollection,union,difference} from '@turf/turf';
import {DORMITORY_COMPOUNDS} from '../src/gis/features/CampusDormitoryCompounds';
const source=JSON.parse(await readFile('../reference/buildings/dorm_shapes_v002/corrected_input.json','utf8'));
const groups:any[]=[],compounds:any[]=[];
for(const c of DORMITORY_COMPOUNDS){
  const low=c.connections.length===1?c.connections[0]!.geometry:union(featureCollection(c.connections.map(x=>feature(x.geometry))))!.geometry;
  const bodies=c.bodyIds.map(id=>source.rows.find((r:any)=>r.id===id));
  if(bodies.some((r:any)=>!r))throw Error('Unbound compound '+c.name);
  for(const row of bodies){
    const high=difference(featureCollection([feature(row.geometryLocal),feature(low)]));
    if(!high)throw Error('Connection removes main body '+row.name);
    groups.push({...row,root:row.id,geometryLocal:high.geometry,compoundRoot:c.root,compoundMembers:[c.root,...c.members]});
  }
  compounds.push({...c,connections:c.connections,geometryLocal:union(featureCollection([...bodies.map((b:any)=>feature(b.geometryLocal)),feature(low)]))!.geometry});
}
const dir='../reference/buildings/dorm_compounds_v003';await mkdir(dir,{recursive:true});
await writeFile(dir+'/input.json',JSON.stringify({sourceModel:'output/campus_shape_review_v002.glb',groups,neighbors:[],compounds,
 source:'USER_CONFIRMED_CONNECTED_COMPOUND_WITH_REGISTERED_TIFF_AND_720_PANORAMA_TYPE',
 limitations:['Not an ownership union. Original GIS records remain separate.','Two-level connector estimate is illustrative, not a measured height.','Lan7 remains a standalone bar.']},null,2),{flag:'wx'});
console.log(JSON.stringify({compounds:compounds.length,bodies:groups.length,connections:compounds.reduce((n,c)=>n+c.connections.length,0)}));
