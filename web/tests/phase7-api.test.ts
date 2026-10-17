import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AxiosAdapter,AxiosResponse} from 'axios';
import {httpClient} from '../src/api/httpClient';
import {ApiFeatureRepository} from '../src/gis/repositories/ApiFeatureRepository';

const entry=(id:string)=>({
  id,name:id,type:'地标',category:'landmark' as const,
  geometry:{type:'Point' as const,coordinates:[118.586,39.2]},centroid:[118.586,39.2] as [number,number],
  description:'',properties:{},modelBinding:'TEST_ROOT',refined:true,
  aliases:[id],keywords:['地标'],gisBindings:[{source:'campus-landmarks',id}],
});
function adapter(data:unknown,status=200):AxiosAdapter {
  return async config=>({data,status,statusText:status===200?'OK':'ERROR',
    headers:{},config} as AxiosResponse);
}
test('API repository preserves stable IDs and GIS bindings',async()=>{
  const old=httpClient.defaults.adapter;
  try{
    httpClient.defaults.adapter=adapter({features:[entry('library'),entry('south-gate')]});
    const repository=new ApiFeatureRepository();
    await repository.load();
    assert.equal(repository.getById('library')?.modelBinding,'TEST_ROOT');
    assert.equal(repository.resolveGis('campus-landmarks','south-gate'),'south-gate');
    assert.deepEqual(repository.getByType('landmark').map(x=>x.id),['library','south-gate']);
  }finally{httpClient.defaults.adapter=old;}
});
test('API repository fails loudly when backend is unavailable',async()=>{
  const old=httpClient.defaults.adapter;
  try{
    httpClient.defaults.adapter=async()=>{throw new Error('Backend unavailable');};
    const repository=new ApiFeatureRepository();
    await assert.rejects(repository.load(),/Backend unavailable/);
    assert.equal(repository.getAll().length,0);
  }finally{httpClient.defaults.adapter=old;}
});
