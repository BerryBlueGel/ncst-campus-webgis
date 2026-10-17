import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TEACHING_BUILDINGS,teachingRelatedIds} from '../src/gis/features/TeachingBuildingPresentation';
import {TEACHING_PLAN_GEOMETRIES,TEACHING_PLAN_PROVENANCE,TEACHING_PLAN_CONNECTIONS,legacyFittedTeachingGeometry,registeredTeachingGeometry} from '../src/gis/features/TeachingPlanGeometry';
import {TEACHING_BUILDING_SOURCES,teachingBuildingAudit} from '../src/gis/features/TeachingBuildingAudit';
import {CAMPUS_ORIGIN} from '../src/gis/coordinate/CampusCoordinateService';
import {displayProperties} from '../src/gis/interaction/FeatureDisplayConfig';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(k=>[k,JSON.parse(readFileSync(`public/data/${k}.geojson`,'utf8'))])) as unknown as FeatureSources;

test('eight evidence records retain plan identities and never imply measured heights or individual official confirmation',()=>{
  for(const ref of TEACHING_BUILDINGS){
    const audit=teachingBuildingAudit(ref.id)!;
    assert.equal(audit.id,ref.id);assert.equal(audit.name,ref.name);assert.equal(audit.selectedIsNearbyPart,false);
    assert.equal(audit.geometryStatus,'APPROXIMATE_DISPLAY_ONLY');
    assert.equal(audit.heightStatus,'SOURCE_ROUGH_MODEL_NOT_SURVEYED');
    assert.ok(audit.unresolved.includes('逐栋实际高度及屋面高差'));
    assert.deepEqual(audit.sources,TEACHING_BUILDING_SOURCES);
    assert.ok(audit.sources.every(s=>s.scope==='GROUP_LAYOUT_NOT_INDIVIDUAL_AS_BUILT'||s.scope==='PROJECT_DESIGN_ATTRIBUTION_ONLY'));
  }
  assert.equal(teachingBuildingAudit('library'),null);
});
test('wall correction uses paired trace vertices, separate from envelope fitting and world accuracy',()=>{
  const p=TEACHING_PLAN_PROVENANCE;
  for(const plan of TEACHING_PLAN_GEOMETRIES){
    const audit=teachingBuildingAudit(plan.id)!;
    const distances=plan.trace.flatMap((r,ri)=>r.map((v,vi)=>{
      const x=p.tiePoint[0]+(p.cropOrigin[0]+v[0])*p.pixelScale-CAMPUS_ORIGIN[0];
      const y=p.tiePoint[1]-(p.cropOrigin[1]+v[1])*p.pixelScale-CAMPUS_ORIGIN[1];
      const fit=plan.geometry.coordinates[ri]![vi]!;
      return Math.hypot(x-fit[0]!,y-fit[1]!);
    }));
    assert.equal(audit.regularization.maxDisplacementMeters,Math.max(...distances));
    assert.ok(audit.regularization.maxDisplacementMeters<1.6);
    assert.equal(audit.maxFitAdjustmentMeters,0);
    assert.equal(audit.scaleEast,1);assert.equal(audit.scaleNorth,1);
    assert.equal(audit.tracedCourtyardCount,plan.geometry.coordinates.length-1);
  }
});
test('v002 preserves a shared metric scale for every pair of traced vertices, including buildings and courtyards',()=>{
  assert.equal(TEACHING_PLAN_PROVENANCE.fit,'SHARED_RASTER_GEOREFERENCE_NO_BUILDING_FIT');
  const points=TEACHING_PLAN_GEOMETRIES.flatMap((p,index)=>p.trace.flatMap((ring,ri)=>ring.map((pixel,pi)=>({pixel,local:registeredTeachingGeometry(index).coordinates[ri]![pi]!}))));
  for(let i=1;i<points.length;i++){
    const a=points[i-1]!,b=points[i]!;
    const distance=Math.hypot(a.local[0]!-b.local[0]!,a.local[1]!-b.local[1]!);
    const expected=Math.hypot(a.pixel[0]-b.pixel[0],a.pixel[1]-b.pixel[1])*TEACHING_PLAN_PROVENANCE.pixelScale;
    assert.ok(Math.abs(distance-expected)<1e-8);
  }
  for(const c of TEACHING_PLAN_CONNECTIONS){
    const ring=c.geometry.coordinates[0]!;
    const expectedWidth=17*TEACHING_PLAN_PROVENANCE.pixelScale;
    assert.ok(Math.abs(ring[1]![0]!-ring[0]![0]!-expectedWidth)<1e-8);
    assert.ok(Math.abs(ring[2]![0]!-ring[3]![0]!-expectedWidth)<1e-8);
  }
});
test('historical fitting remains auditable, but current geometry never reuses its anisotropic deformation',()=>{
  for(const [i,plan] of TEACHING_PLAN_GEOMETRIES.entries()){
    const historical=legacyFittedTeachingGeometry(i);
    const distances=registeredTeachingGeometry(i).coordinates.flatMap((ring,ri)=>ring.slice(0,-1).map((p,pi)=>{
      const q=historical.coordinates[ri]![pi]!;return Math.hypot(p[0]!-q[0]!,p[1]!-q[1]!);
    }));
    const audit=teachingBuildingAudit(plan.id)!;
    assert.equal(audit.historicalV001.maxFitAdjustmentMeters,Math.max(...distances));
    assert.ok(audit.historicalV001.maxFitAdjustmentMeters>0);
    assert.notDeepEqual(plan.geometry,historical);
  }
  assert.ok(Math.abs(teachingBuildingAudit(TEACHING_BUILDINGS[2]!.id)!.historicalV001.scaleEast-0.8886129979766411)<1e-10);
});
test('nearby parts use contextual evidence but keep their independent business identities',()=>{
  const repo=new StaticFeatureRepository(sources),before=JSON.stringify(repo.getAll());
  for(const ref of TEACHING_BUILDINGS)for(const id of teachingRelatedIds(ref.id)){
    const audit=teachingBuildingAudit(id)!;
    assert.equal(audit.id,ref.id);assert.equal(audit.selectedIsNearbyPart,true);
    assert.notEqual(repo.getById(id)!.id,ref.id);
    assert.ok(audit.unresolved.includes('附近独立分块的归属'));
  }
  assert.equal(JSON.stringify(repo.getAll()),before);
});
test('all source heights without quality metadata are visibly unverified; supplied survey status is preserved',()=>{
  const repo=new StaticFeatureRepository(sources);
  const ordinary=repo.getAll().find(f=>f.category==='building'&&!teachingBuildingAudit(f.id))!;
  const rows=displayProperties(ordinary);assert.ok(rows.some(r=>r.label==='高度（来源未核实）'));
  const surveyed={...ordinary,properties:{...ordinary.properties,height:22.3,heightStatus:'SURVEYED'}};
  assert.ok(displayProperties(surveyed).some(r=>r.label==='高度'&&r.value==='22.3 m'));
  const modified=structuredClone(sources);
  modified.buildings.features.find(f=>f.id===ordinary.id)!.properties!.heightStatus='SURVEYED';
  assert.equal(new StaticFeatureRepository(modified).getById(ordinary.id)!.properties.heightStatus,'SURVEYED');
  assert.equal(ordinary.properties.heightStatus,undefined);
});
