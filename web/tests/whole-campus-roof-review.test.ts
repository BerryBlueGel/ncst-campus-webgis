import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {area,booleanPointInPolygon,feature,featureCollection,intersect} from '@turf/turf';
import {PLAN_ROOF_GROUPS,roofGroupFor,roofGroupGeometry} from '../src/gis/layers/CampusPlanRoofGroups';
import {UNRESOLVED_DISPLAY_FRAGMENT_IDS} from '../src/gis/layers/SourceFragmentDisplay';
import {planDispositionFor,suppressedInPlanPreview} from '../src/gis/features/CampusPlanDispositions';
import {residentialPlanFor} from '../src/gis/features/CampusResidentialPlan';
import {academicPlanFor} from '../src/gis/features/CampusAcademicPlan';
import {TEACHING_PLAN_GEOMETRIES} from '../src/gis/features/TeachingPlanGeometry';
import {globalRasterToLocal} from '../src/gis/features/CampusRemainingPlan';
import {coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import {displayCollection} from '../src/gis/layers/CampusDisplayGeometry';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {campusIdentityPresentation,PLAN_NAME_STATUS} from '../src/gis/features/CampusBuildingIdentity';
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(n=>[n,JSON.parse(readFileSync(`public/data/${n}.geojson`,'utf8'))])) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources);

test('all 46 small source records are accounted for, including genuinely separate roofs, not blindly removed by size',()=>{
  const small=sources.buildings.features.filter(f=>area(f)<700);
  assert.equal(small.length,46);
  assert.deepEqual(small.map(f=>sources.buildings.features.indexOf(f)+1),[7,8,17,22,26,28,30,31,34,37,44,47,51,54,59,63,67,76,77,83,88,97,102,107,108,110,111,124,127,131,132,133,134,136,137,138,140,142,143,150,151,154,156,160,164,166]);
  for(const f of small){const id=String(f.id);
    assert.ok(roofGroupFor(id)||planDispositionFor(id)||residentialPlanFor(id)||academicPlanFor(id)||TEACHING_PLAN_GEOMETRIES.some(r=>r.id===id),`unreviewed ${id}`);
    assert.equal(repo.getById(id)!.geometry,f.geometry);assert.ok(Math.abs(Number(repo.getById(id)!.properties.area)-area(f))<1);
  }
  const preview=displayCollection('buildings',sources.buildings,true,true);
  for(const label of ['建筑 008','建筑 136']){
    const f=repo.getAll().find(f=>f.properties.sourceLabel===label)!;
    assert.ok(preview.features.some(r=>r.id===f.id),'small actual roof stays, not a min-area filter');
  }
});

test('twenty display groups have unique real IDs and map names; only two unresolved roof scopes remain',()=>{
  const ids=PLAN_ROOF_GROUPS.flatMap(g=>[g.root,...g.members]);
  assert.equal(new Set(ids).size,ids.length);
  for(const g of PLAN_ROOF_GROUPS){
    assert.equal(repo.getById(g.root)!.name,g.name);
    for(const id of [g.root,...g.members])assert.ok(repo.getById(id));
  }
  assert.deepEqual(UNRESOLVED_DISPLAY_FRAGMENT_IDS,['buildings:0469554fc5581a49cec3','buildings:e12e4a81d80ca570f2fa']);
  assert.equal(suppressedInPlanPreview('buildings:87beaaa3c2777edaca7b'),true);
  assert.equal(planDispositionFor('buildings:87beaaa3c2777edaca7b')!.suppressed,false,'2D-only decision must not change the previous 3D registry');
});

test('newly traced roofs contain independent native-raster checkpoints and exclude courtyards, gaps and neighboring roofs',()=>{
  const point=(p:[number,number])=>coordinates.localToWgs84(globalRasterToLocal(p));
  for(const [key,inside,outside] of [
    ['d1d687fd615e19da64ed',[1360,4390],[1430,4390]],
    ['69dee2704484a5676bd6',[1890,3540],[1960,3540]],
    ['3b216e82b3a5fbd7a8b8',[1300,3305],[1390,3305]],
    ['f873a346f9ac588fcb88',[4295,4290],[4200,4290]],
    ['01f4781169cdebc320a0',[4150,2190],[4160,2248]],
    ['c4413d5a7dda1c0312d4',[3820,2030],[3670,2030]],
    ['f7a2270ee46df0ba726d',[765,2690],[765,2658]],
  ] as const){
    const roof=feature(roofGroupGeometry(`buildings:${key}`)!);
    assert.equal(booleanPointInPolygon(point([...inside]),roof),true,key);
    assert.equal(booleanPointInPolygon(point([...outside]),roof),false,`${key} no invented fill`);
  }
  for(const key of ['52e6ff3e2b5b8b9f18f3','2d7a6c32c34801f6495e','41e976045d6ae2f14056'])
    assert.equal(roofGroupGeometry(`buildings:${key}`)!.type,'MultiPolygon','actual passages remain open');
});

test('teacher apartment map title upgrades cached managed titles, preserving old aliases and independently supplied API titles',()=>{
  const f=repo.getById('buildings:f7a2270ee46df0ba726d')!;
  assert.equal(f.name,'教师公寓');assert.ok(repo.search('教师办公楼').some(r=>r.id===f.id));
  const cached={...f,name:'教师办公楼',properties:{...f.properties,mapLabel:'教师办公楼',displayNameStatus:PLAN_NAME_STATUS}};
  const updated=campusIdentityPresentation(cached);assert.equal(updated.name,'教师公寓');assert.ok(updated.aliases.includes('教师办公楼'));
  assert.equal(campusIdentityPresentation({...f,name:'经独立核实的现行名称'}).name,'经独立核实的现行名称');
  for(const [label,title] of [['建筑 035','图书馆'],['建筑 036','图书馆主楼'],['建筑 069','大会堂']]){
    const source=repo.getAll().find(r=>r.properties.sourceLabel===label)!;
    assert.equal(source.name,title);assert.ok(repo.search(label!).some(r=>r.id===source.id));
  }
});

test('every grouped schematic roof is disjoint from all other registered display roofs',()=>{
  const roofs=displayCollection('buildings',sources.buildings,true,true).features.filter(f=>f.properties?.displayStatus==='APPROXIMATE_DISPLAY_ONLY');
  for(let i=0;i<roofs.length;i++)for(const other of roofs.slice(i+1)){
    const first=roofs[i]!;if(!roofGroupFor(String(first.id))&&!roofGroupFor(String(other.id)))continue;
    const overlap=intersect(featureCollection([first as any,other as any]));
    assert.ok(!overlap||area(overlap)<0.01,`${first.id} overlaps ${other.id}`);
  }
});
