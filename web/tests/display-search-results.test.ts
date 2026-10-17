import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StaticFeatureRepository,type FeatureSources} from '../src/gis/repositories/StaticFeatureRepository';
import {displaySearchResults} from '../src/gis/interaction/DisplaySearchResults';
const sources=Object.fromEntries(['buildings','sports','landmarks','pois'].map(n=>[n,JSON.parse(readFileSync(`public/data/${n}.geojson`,'utf8'))])) as unknown as FeatureSources;
const repo=new StaticFeatureRepository(sources);
test('A4 name search presents one compound, not four indistinguishable options',()=>{
  const matches=repo.search('A区4号楼');assert.equal(matches.length,4);
  const result=displaySearchResults(matches,'A区4号楼',true,id=>repo.getById(id));
  assert.equal(result.length,1);assert.equal(result[0]!.id,'buildings:2d7a6c32c34801f6495e');assert.equal(result[0]!.name,'A区4号楼');
  assert.equal(matches.length,4);assert.equal(repo.getAll().filter(f=>matches.some(m=>m.id===f.id)).length,4);
});
test('raw display and explicit source numbers retain independently searchable records',()=>{
  const matches=repo.search('A区4号楼');
  assert.equal(displaySearchResults(matches,'A区4号楼',false,id=>repo.getById(id)).length,4);
  const raw=repo.search('建筑 104');const displayed=displaySearchResults(raw,'建筑 104',true,id=>repo.getById(id));
  assert.ok(displayed.some(f=>f.id==='buildings:73c56e34242855f03fa1'));
  assert.equal(displayed[0],raw[0]);
});
test('deduplication occurs before the eight-result cap and preserves independent roofs',()=>{
  const duplicates=repo.search('A区4号楼');const extras=repo.getAll().filter(f=>f.category==='landmark');
  const result=displaySearchResults([...duplicates,...duplicates,...extras],'楼',true,id=>repo.getById(id));
  assert.equal(result.length,1+extras.length);assert.equal(new Set(result.map(f=>f.id)).size,result.length);
});
test('a meaningful API name is not overwritten by an older schematic group title',()=>{
  const matches=repo.search('A区4号楼');const original=repo.getById('buildings:2d7a6c32c34801f6495e')!;
  const official={...original,name:'科研创新中心',properties:{...original.properties,mapLabel:'A区4号楼'}};
  const result=displaySearchResults(matches,'A区4号楼',true,id=>id===official.id?official:repo.getById(id));
  assert.equal(result.length,1);assert.equal(result[0]!.name,'科研创新中心');assert.equal(official.name,'科研创新中心');
});
