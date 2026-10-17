import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {area,booleanValid,booleanPointInPolygon,feature} from '@turf/turf';
import {PLAN_ROOF_GROUPS,roofGroupGeometry,planDisplayId} from '../src/gis/layers/CampusPlanRoofGroups';
import {displayCollection,featureForDisplayCamera} from '../src/gis/layers/CampusDisplayGeometry';
import {globalRasterToLocal} from '../src/gis/features/CampusRemainingPlan';
import {coordinates} from '../src/gis/coordinate/CampusCoordinateService';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {MapFeatureHighlighter} from '../src/gis/interaction/MapFeatureHighlighter';
import {campusIdentityPresentation} from '../src/gis/features/CampusBuildingIdentity';
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(n=>[n,JSON.parse(readFileSync(`public/data/${n}.geojson`,'utf8'))])) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources);

test('twenty registered schematic groups remove separate pickable fragments without mutating 166 authority records',()=>{
  assert.equal(PLAN_ROOF_GROUPS.length,20);
  const before=JSON.stringify(sources),display=displayCollection('buildings',sources.buildings,true,true);
  for(const g of PLAN_ROOF_GROUPS){
    const body=display.features.find(f=>f.id===g.root)!;
    assert.ok(booleanValid(body));assert.deepEqual(body.geometry,roofGroupGeometry(g.root));
    assert.equal(body.properties?.displayGroupStatus,'SCHEMATIC_PRESENTATION_NOT_SOURCE_OWNERSHIP');
    for(const member of g.members){
      assert.equal(display.features.find(f=>f.id===member),undefined);
      assert.equal(planDisplayId(member),g.root);
      assert.ok(repo.getById(member));assert.equal(repo.getById(member)!.properties.parentId,undefined);
      const camera=featureForDisplayCamera(repo.getById(member)!,true);
      assert.deepEqual(camera.bounds,featureForDisplayCamera(repo.getById(g.root)!,true).bounds);
      assert.equal(camera.id,member);assert.equal(camera.geometry,repo.getById(member)!.geometry);
    }
  }
  const restored=displayCollection('buildings',sources.buildings,false);
  assert.equal(restored.features.length,166);
  for(const g of PLAN_ROOF_GROUPS)for(const id of [g.root,...g.members])
    assert.equal(restored.features.find(f=>f.id===id)!.geometry,repo.getById(id)!.geometry);
  assert.equal(JSON.stringify(sources),before);
});

test('north roof has registered west return; south end cap stays disconnected, with no invented courtyard bridge',()=>{
  const north=feature(roofGroupGeometry(PLAN_ROOF_GROUPS[0].root)!);
  const south=feature(roofGroupGeometry(PLAN_ROOF_GROUPS[1].root)!);
  const point=(p:[number,number])=>coordinates.localToWgs84(globalRasterToLocal(p));
  assert.equal(booleanPointInPolygon(point([1915,3834]),north),true,'white west return in registered plan');
  assert.equal(booleanPointInPolygon(point([1970,3840]),north),false,'courtyard is not filled');
  assert.equal(south.geometry.type,'MultiPolygon');
  assert.equal(booleanPointInPolygon(point([1945,4198]),south),false,'gap between end roof and bar remains');
  assert.ok(area(south)>0);assert.ok(area(north)>0);
});

test('legacy fragment selection highlights displayed group, then clears old bindings when original GIS is restored',()=>{
  const states=new Map<string,any>();let preview=true;
  const map:any={getSource:()=>true,setFeatureState:(b:any,s:any)=>states.set(b.id,{...states.get(b.id),...s})};
  const h=new MapFeatureHighlighter(map,repo,()=>preview),g=PLAN_ROOF_GROUPS[0],member=g.members[0];
  h.update(member,null);assert.equal(states.get(g.root).selected,true);
  assert.equal(states.has(member),false);
  preview=false;h.update(member,null,true);
  assert.equal(states.get(g.root).selected,false);assert.equal(states.get(member).selected,true);
  preview=true;h.update(member,null,true);
  assert.equal(states.get(member).selected,false);assert.equal(states.get(g.root).selected,true);
  h.clear();assert.equal(states.get(g.root).selected,false);
});

test('map names replace modeling terminology but original technical labels and source numbers remain searchable',()=>{
  for(const [label,name] of [['建筑 099','体育馆'],['建筑 078','教师公寓'],['建筑 058','校医院'],['建筑 106','行政楼'],['建筑 047','兰园1号楼北楼']] as const){
    const f=repo.getAll().find(f=>f.properties.sourceLabel===label)!;
    assert.equal(f.name,name);assert.ok(repo.search(label).some(r=>r.id===f.id));
    assert.equal(f.geometry,sources.buildings.features.find(r=>r.id===f.id)!.geometry);
  }
  const renamed=repo.getAll().filter(f=>f.properties.mapLabel);
  assert.ok(renamed.length>=40);
  assert.ok(renamed.every(f=>!/(源主体|源组合|源屋面|不规则屋面|回折|斜向翼楼|屋面端部)/.test(f.name)));
  const gym=repo.getById('buildings:4cc99ac5023567a62382')!;
  assert.equal(gym.properties.planLabel,'体育馆不规则屋面');
  assert.ok(repo.search('体育馆不规则屋面').some(r=>r.id===gym.id));
  assert.equal(campusIdentityPresentation({...gym,name:'体育馆不规则屋面'}).name,'体育馆','cached generated title is upgraded');
  assert.equal(campusIdentityPresentation({...gym,name:'独立核实的正式名称'}).name,'独立核实的正式名称','meaningful API name is preserved');
});
