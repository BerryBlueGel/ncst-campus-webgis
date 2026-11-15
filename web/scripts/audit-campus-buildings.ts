import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {auditCampusBuildingGeometry} from '../src/gis/features/CampusBuildingGeometryAudit';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
const path=resolve('public/data/buildings.geojson'),bytes=await readFile(path);
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex').toUpperCase();
const collection=JSON.parse(bytes.toString('utf8'));
const sources={buildings:collection,...Object.fromEntries(await Promise.all(['sports','landmarks','pois'].map(async name=>
  [name,JSON.parse(await readFile(`public/data/${name}.geojson`,'utf8'))])))} as FeatureSources;
const repo=new StaticFeatureRepository(sources),replaced=new Map<string,string>();
for(const f of collection.features){const id=repo.resolveGis('campus-buildings',String(f.id));
  if(id!==String(f.id)&&id&&repo.getById(id)?.refined)replaced.set(String(f.id),id);
}
const report={...auditCampusBuildingGeometry(collection,replaced),
  sourceFile:'web/public/data/buildings.geojson',sourceSha256:sha(bytes)};
const target=resolve('../reference/buildings/campus_building_inventory_v002.json');
const payload=JSON.stringify(report,null,2)+'\n';
try{await writeFile(target,payload,{flag:'wx'});}catch(error){
  if((error as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(target,'utf8')!==payload)throw error;
}
if(sha(await readFile(path))!==report.sourceSha256)throw Error('Source GIS changed');
console.log(JSON.stringify({target,...report.summary},null,2));
