/** ESM export of the CURRENT registered teaching geometry, not a second trace. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {TEACHING_BUILDINGS,TEACHING_MODEL_BINDINGS} from '../web/src/gis/features/TeachingBuildingPresentation';
import {TEACHING_PLAN_GEOMETRIES,TEACHING_PLAN_CONNECTIONS,TEACHING_PLAN_PROVENANCE,TEACHING_WALL_FRAME} from '../web/src/gis/features/TeachingPlanGeometry';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=resolve(project,'reference/buildings/teaching_detail_v001');
await mkdir(directory,{recursive:true});
const sourceFiles=['web/src/gis/features/TeachingPlanGeometry.ts','web/src/gis/features/TeachingBuildingPresentation.ts'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,createHash('sha256').update(await readFile(resolve(project,name))).digest('hex').toUpperCase()])));
const result={version:'v001',status:'INDEPENDENT_FACADE_STUDY_SOURCE_HEIGHT_PLACEHOLDER_NOT_AS_BUILT',
  provenance:TEACHING_PLAN_PROVENANCE,wallFrame:TEACHING_WALL_FRAME,sourceFileHashes:hashes,
  primaryArticle:'https://www.astjc.org.cn/h-nd-139.html',
  sourcePhoto:'.firecrawl/teaching-primary.jpg',
  photoUrl:'https://25179804.s21i.faiusr.com/2/1/ABUIABACGAAgxOfZ-AUo2JCiwwQwuAg4gAU.jpg',
  photoScope:'GROUP_FACADE_LANGUAGE_NOT_EIGHT_INDIVIDUAL_ELEVATIONS',
  heightPolicy:'KEEP_SOURCE_6M_PLACEHOLDER_NO_UNVERIFIED_FLOOR_COUNT_OR_HEIGHT_ASSIGNMENT',
  newEntrances:false,newRaisedConnectors:false,
  assets:TEACHING_PLAN_GEOMETRIES.map((plan,index)=>({...TEACHING_BUILDINGS[index],geometry:plan.geometry,sourceBounds:plan.sourceBounds})),
  connections:TEACHING_PLAN_CONNECTIONS,
  independentReferences:TEACHING_MODEL_BINDINGS,
  externalEvidenceGaps:['逐栋楼高与屋面高差','每栋入口位置','建筑054/150/151归属','连廊实建状态和净空'],
};
const target=resolve(directory,'registered_input.json');
await writeFile(target,JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({target,assets:result.assets.length,closedCourtyards:result.assets.reduce((s,a)=>s+a.geometry.coordinates.length-1,0),independentReferences:result.independentReferences.length,connections:result.connections.length}));
