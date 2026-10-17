import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLayerManager} from '../src/gis/layers/LayerManager';

test('detaching a 3D map restores effective 2D visibility without changing user choices',()=>{
  const manager=createLayerManager();
  manager.hide('roads');manager.setOpacity('buildings',0.6);
  manager.setCampus3DActive(true);
  assert.equal(manager.getLayer('buildings')!.visible,false);
  manager.detach();
  assert.equal(manager.getLayer('buildings')!.visible,true);
  assert.equal(manager.getLayer('roads')!.visible,false);
  assert.equal(manager.getLayer('buildings')!.opacity,0.6);
  assert.equal(manager.getLayer('waterways')!.visible,true);
});

test('3D overlay overrides belong to one map, not the next 3D session',()=>{
  const manager=createLayerManager();
  manager.setCampus3DActive(true);manager.show('buildings');
  assert.equal(manager.getLayer('buildings')!.visible,true);
  manager.detach();manager.setCampus3DActive(true);
  assert.equal(manager.getLayer('buildings')!.visible,false);
  manager.setCampus3DActive(false);
  assert.equal(manager.getLayer('buildings')!.visible,true);
});

test('repeated 3D-to-analysis map replacement renders loaded GIS layers and retains manual hides',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>new Response(readFileSync(`public${url}`,'utf8'));
  const fakeMap=()=>{
    const layers=new Map<string,any>(),sources=new Map<string,any>();
    return {layers,sources,
      addSource:(id:string,source:any)=>sources.set(id,source),
      addLayer:(layer:any)=>layers.set(layer.id,{...layer,layout:{},paint:{...layer.paint}}),
      getLayer:(id:string)=>layers.get(id),getSource:(id:string)=>sources.get(id),
      setLayoutProperty:(id:string,key:string,value:any)=>layers.get(id).layout[key]=value,
      setPaintProperty:(id:string,key:string,value:any)=>layers.get(id).paint[key]=value,
      removeLayer:(id:string)=>layers.delete(id),removeSource:(id:string)=>sources.delete(id),
      once:()=>{},off:()=>{},
    };
  };
  const manager=createLayerManager();manager.hide('sports');
  try {
    for(let i=0;i<10;i++){
      const three=fakeMap();await manager.load(three as any);
      manager.setCampus3DActive(true);
      assert.equal(three.layers.get('buildings-fill').layout.visibility,'none');
      manager.detach();assert.equal(three.layers.size,0);assert.equal(three.sources.size,0);
      const analysis=fakeMap();await manager.load(analysis as any);
      for(const id of ['buildings-fill','roads-line','waterways-fill','green-areas-fill'])
        assert.equal(analysis.layers.get(id).layout.visibility,'visible',`${id} on cycle ${i}`);
      assert.equal(analysis.layers.get('sports-fill').layout.visibility,'none');
      assert.equal(manager.getLayers().filter(layer=>layer.loaded).length,8);
      manager.detach();assert.equal(analysis.layers.size,0);assert.equal(analysis.sources.size,0);
    }
  }finally{manager.detach();globalThis.fetch=originalFetch;}
});
