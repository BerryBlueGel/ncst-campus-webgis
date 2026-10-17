import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Group,Mesh,BoxGeometry,MeshStandardMaterial} from 'three';
import type {FeatureCollection} from 'geojson';
import {StaticFeatureRepository} from '../src/gis/repositories/StaticFeatureRepository';
import {SelectionManager} from '../src/gis/interaction/SelectionManager';
import {readSelected,selectedQuery,selectedQueryWhileLoading} from '../src/gis/interaction/SelectedUrlState';
import {ModelNodeIndex} from '../src/gis/three/ModelNodeIndex';
import {ThreeFeatureHighlighter} from '../src/gis/three/ThreeFeatureHighlighter';

function fixture(){
  const get=(name:string)=>JSON.parse(readFileSync(`public/data/${name}.geojson`,'utf8')) as FeatureCollection;
  return new StaticFeatureRepository({buildings:get('buildings'),sports:get('sports'),landmarks:get('landmarks'),pois:get('pois')});
}
const repository=fixture();
test('all business IDs are unique; Phase 2 IDs are preserved',()=>{
  const all=repository.getAll(),ids=all.map(f=>f.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ['library','south-gate','auditorium','fusion-sculpture','stadium-east-01','stadium-east-02','stadium-west-01','stadium-west-02'])assert.ok(repository.getById(id));
  assert.ok(ids.some(id=>id.startsWith('buildings:')));
});
test('repository lookup and filtered ID retrieval',()=>{
  assert.equal(repository.getById('library')?.name,'图书馆');
  assert.deepEqual(repository.getByIds(['library','missing']).map(f=>f.id),['library']);
  assert.equal(repository.getByType('stadium').length,4);
  assert.equal(repository.getById('library')?.gisBindings.some(b=>b.source==='campus-buildings'),true);
});
test('search exact alias partial and category',()=>{
  assert.equal(repository.search('图书馆')[0]?.id,'library');
  assert.equal(repository.search('library')[0]?.id,'library');
  assert.equal(repository.search('South Gate')[0]?.id,'south-gate');
  assert.equal(repository.search('会堂')[0]?.id,'auditorium');
  assert.equal(repository.search('大会堂')[0]?.id,'auditorium');
  assert.ok(repository.search('图书馆').some(feature=>feature.id.startsWith('buildings:')));
  assert.ok(repository.search('建筑 035').some(feature=>feature.id.startsWith('buildings:')));
  assert.equal(repository.search('融合')[0]?.id,'fusion-sculpture');
  assert.ok(repository.search('体育场').length>=4);
});
test('GIS source IDs resolve to common business ID',()=>{
  assert.equal(repository.resolveGis('campus-sports','stadium-east-01-pitch'),'stadium-east-01');
  assert.equal(repository.resolveGis('campus-poi','poi-library'),'library');
  assert.equal(repository.resolveGis('campus-buildings','missing'),undefined);
});
test('SelectionManager select hover clear and invalid ID',()=>{
  const selection=new SelectionManager(repository);let notifications=0;
  selection.onChange(()=>notifications++);selection.select('library');selection.hover('south-gate');
  assert.equal(selection.getSelected(),'library');assert.equal(selection.getHovered(),'south-gate');
  selection.hover('missing');assert.equal(selection.getHovered(),null);
  selection.clear();assert.equal(selection.getSelected(),null);assert.ok(notifications>=4);
});
test('URL selected serialize and restore with invalid ignored',()=>{
  assert.deepEqual(selectedQuery('library'),{selected:'library'});
  assert.deepEqual(selectedQuery(null),{selected:undefined});
  assert.deepEqual(selectedQueryWhileLoading(null,false,'library'),{selected:'library'});
  assert.deepEqual(selectedQueryWhileLoading(null,true,'library'),{selected:undefined});
  assert.equal(readSelected(new URLSearchParams('selected=library'),id=>!!repository.getById(id)),'library');
  assert.equal(readSelected(new URLSearchParams('selected=bad'),id=>!!repository.getById(id)),null);
});
test('ModelNodeIndex resolves a child to nearest mapped ancestor, absent gracefully',()=>{
  const index=new ModelNodeIndex(),root=new Group(),child=new Group(),mesh=new Mesh(new BoxGeometry(),new MeshStandardMaterial());
  root.name='LIBRARY_REFINED_ROOT';child.name='window';root.add(child);child.add(mesh);index.addBinding('library',root);
  assert.deepEqual(index.get('library'),[root]);assert.equal(index.pickableObjects.length,1);
  assert.equal(index.resolveFeatureId(mesh),'library');assert.equal(index.resolveFeatureId(new Group()),null);
  assert.equal(index.get('missing'),undefined);
});
test('Three highlight restores original material after hover/selection',()=>{
  const index=new ModelNodeIndex(),root=new Group(),original=new MeshStandardMaterial({color:'#555555'}),mesh=new Mesh(new BoxGeometry(),original);
  root.add(mesh);index.addBinding('library',root);const highlight=new ThreeFeatureHighlighter(index);
  highlight.set(null,'library');assert.notEqual(mesh.material,original);
  highlight.set('library',null);assert.notEqual(mesh.material,original);
  highlight.set(null,null);assert.equal(mesh.material,original);
  highlight.set('missing',null);assert.equal(mesh.material,original);
  highlight.dispose();mesh.geometry.dispose();original.dispose();
});
