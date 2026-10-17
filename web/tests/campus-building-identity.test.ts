import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {ApiFeatureRepository} from '../src/gis/repositories/ApiFeatureRepository';
import {httpClient} from '../src/api/httpClient';
import {campusIdentityPresentation,nearbyIdentityIds,PLAN_NAME_STATUS} from '../src/gis/features/CampusBuildingIdentity';
import {CAMPUS_PLAN_DISPOSITIONS,EARLIER_OWNERSHIP_GAPS} from '../src/gis/features/CampusPlanDispositions';
import {campusMapName} from '../src/gis/features/CampusMapNames';
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(k=>[k,JSON.parse(readFileSync(`public/data/${k}.geojson`,'utf8'))])) as unknown as FeatureSources;
const before=JSON.stringify(sources),repo=new StaticFeatureRepository(sources);

test('reviewed plan names are primary presentation names, source IDs and source names stay searchable',()=>{
  const named=repo.getAll().filter(f=>typeof f.properties.planLabel==='string');
  assert.equal(named.length,116);
  for(const f of named){
    assert.equal(f.name,campusMapName(f.properties.sourceLabel,String(f.properties.planLabel)));
    assert.equal(f.properties.displayNameStatus,PLAN_NAME_STATUS);
    assert.ok(repo.search(String(f.properties.sourceLabel)).some(result=>result.id===f.id));
    assert.deepEqual(campusIdentityPresentation(f),f,'repeat decoration is stable');
    const source=sources.buildings.features.find(s=>String(s.id)===f.id)!;
    assert.equal(f.geometry,source.geometry);assert.equal(f.properties.height,source.properties?.height);
  }
  assert.equal(JSON.stringify(sources),before);
});

test('twelve uncertain fragments and five retained roofs have explanatory identities, never an inferred parent',()=>{
  const rows=[...CAMPUS_PLAN_DISPOSITIONS,...EARLIER_OWNERSHIP_GAPS];
  for(const status of ['OWNER_OR_ROOF_SCOPE_UNCERTAIN','RETAIN_ROOF_FRAGMENT']){
    const filtered=rows.filter(r=>r.status===status);
    assert.equal(filtered.length,status==='RETAIN_ROOF_FRAGMENT'?5:12);
    for(const row of filtered){const f=repo.getById(row.id)!;
      assert.ok(f.aliases.includes(row.sourceLabel));assert.ok(f.properties.fragmentNote);
      assert.equal(f.properties.sourceLabel,row.sourceLabel);
      assert.equal(f.id,row.id);assert.equal(f.category,'building');
      assert.equal(f.properties.parentId,undefined);
      const source=sources.buildings.features.find(s=>String(s.id)===f.id)!;
      assert.equal(f.geometry,source.geometry);assert.equal(f.properties.height,source.properties?.height);
      assert.ok(nearbyIdentityIds(f,repo.getAll()).every(id=>id!==f.id));
    }
  }
});

test('existing meaningful API name and surveyed metadata are not replaced by a plan reference',()=>{
  const sample=repo.getById('buildings:0660f20273968efd90e8')!;
  const authoritative={...sample,name:'后端正式保留名称',properties:{...sample.properties,height:22,heightStatus:'SURVEYED'}};
  const decorated=campusIdentityPresentation(authoritative);
  assert.equal(decorated.name,authoritative.name);assert.equal(decorated.geometry,authoritative.geometry);
  assert.equal(decorated.properties.height,22);assert.equal(decorated.properties.heightStatus,'SURVEYED');
  for(const id of ['library','auditorium','south-gate','fusion-sculpture']){
    const f=repo.getById(id)!;assert.equal(campusIdentityPresentation(f),f);
  }
});

test('API and static naming agree; remote search aliases retain IDs and do not swallow backend failures',async()=>{
  const records=repo.getAll().map(f=>({...f,name:String(f.properties.sourceName??f.name)})),snapshot=JSON.stringify(records),adapter=httpClient.defaults.adapter;
  httpClient.defaults.adapter=async config=>({data:config.url==='/search'?[]:{features:records},status:200,statusText:'OK',headers:{},config});
  try{const api=new ApiFeatureRepository();await api.load();
    const id='buildings:0660f20273968efd90e8';assert.equal(api.getById(id)!.name,'竹园4号楼北楼');
    assert.ok((await api.searchRemote('竹园4号楼北楼')).some(f=>f.id===id));
    assert.ok((await api.searchRemote('建筑 081')).some(f=>f.id===id));
    assert.equal(JSON.stringify(records),snapshot);
    httpClient.defaults.adapter=async()=>{throw Error('Backend unavailable');};
    await assert.rejects(api.searchRemote('竹园'),/Backend unavailable/);
  }finally{httpClient.defaults.adapter=adapter;}
});
