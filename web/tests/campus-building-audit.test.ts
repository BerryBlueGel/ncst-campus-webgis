import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditCampusBuildingGeometry} from '../src/gis/features/CampusBuildingGeometryAudit';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';

test('all source buildings receive non-mutating triage without fabricated names or unions',()=>{
  const source=JSON.parse(readFileSync('public/data/buildings.geojson','utf8')),before=JSON.stringify(source);
  const report=auditCampusBuildingGeometry(source);
  assert.equal(report.summary.count,166);assert.deepEqual(report.summary.duplicateIds,[]);
  assert.equal(report.summary.teachingDisplayCount,8);assert.equal(report.summary.independentTeachingParts,3);
  assert.equal(report.summary.otherSourceFootprints,155);assert.equal(report.records.length,source.features.length);
  assert.ok(report.records.filter(r=>r.stage==='SOURCE_ROUGH_UNREVIEWED').every(r=>r.knownName===null));
  assert.equal(JSON.stringify(source),before);
  assert.ok(report.pairs.every(p=>p.kind.includes('REVIEW')||p.kind.includes('UNVERIFIED')));
});
test('known refined landmark references are not queued as new anonymous buildings',()=>{
  const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(name=>[name,JSON.parse(readFileSync(`public/data/${name}.geojson`,'utf8'))])) as unknown as FeatureSources;
  const repo=new StaticFeatureRepository(sources),replaced=new Map<string,string>();
  for(const f of sources.buildings.features){const id=repo.resolveGis('campus-buildings',String(f.id));
    if(id&&id!==String(f.id)&&repo.getById(id)?.refined)replaced.set(String(f.id),id);
  }
  assert.equal(replaced.size,3);
  const report=auditCampusBuildingGeometry(sources.buildings,replaced);
  assert.equal(report.summary.refinedSourceReferences,3);assert.equal(report.summary.otherSourceFootprints,152);
  assert.ok(report.records.filter(r=>r.stage==='REFINED_LANDMARK_SOURCE_REFERENCE').every(r=>['library','auditorium'].includes(r.refinedReplacementId!)));
});
