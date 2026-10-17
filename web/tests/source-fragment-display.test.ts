import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {area,featureCollection,intersect} from '@turf/turf';
import type {FeatureCollection,Polygon,MultiPolygon,Feature} from 'geojson';
import {CAMPUS_PLAN_DISPOSITIONS,EARLIER_OWNERSHIP_GAPS,suppressedInPlanPreview} from '../src/gis/features/CampusPlanDispositions';
import {displayCollection} from '../src/gis/layers/CampusDisplayGeometry';
import {planDisplayId,roofGroupGeometry} from '../src/gis/layers/CampusPlanRoofGroups';
import {createLayerManager} from '../src/gis/layers/LayerManager';
import {CAMPUS_LAYERS} from '../src/gis/layers/CampusLayerRegistry';
import {SOURCE_FRAGMENT_LAYER,SOURCE_FRAGMENT_ROLE,isUnverifiedSourceFragment,sourceFragmentOpacity,sourceFragmentPickEnabled,UNRESOLVED_DISPLAY_FRAGMENT_IDS} from '../src/gis/layers/SourceFragmentDisplay';

const read=(name:string)=>JSON.parse(readFileSync(`public/data/${name}.geojson`,'utf8')) as FeatureCollection;
const dispositions=[...CAMPUS_PLAN_DISPOSITIONS,...EARLIER_OWNERSHIP_GAPS];
const unresolved=dispositions.filter(row=>row.status==='OWNER_OR_ROOF_SCOPE_UNCERTAIN');
const retained=dispositions.filter(row=>row.status==='RETAIN_ROOF_FRAGMENT');
const fragment067='buildings:b910aecdb252a70a2f2b';
const bambooNorth='buildings:7612d4df140331fe641e';

/** Interpret only the deliberately small opacity expression under test. */
function opacityValue(expression:unknown,state:{selected?:boolean;hover?:boolean}):number|boolean {
  if(!Array.isArray(expression))return expression as number|boolean;
  if(expression[0]==='feature-state')return state[expression[1] as keyof typeof state] as boolean;
  if(expression[0]==='boolean')return typeof opacityValue(expression[1],state)==='boolean'
    ?opacityValue(expression[1],state):opacityValue(expression[2],state);
  if(expression[0]==='case') {
    for(let index=1;index<expression.length-1;index+=2)
      if(opacityValue(expression[index],state))return opacityValue(expression[index+1],state);
    return opacityValue(expression.at(-1),state);
  }
  throw Error(`Unexpected opacity operator ${expression[0]}`);
}

test('only the twelve unresolved originals are review fragments, not the five retained roofs',()=>{
  const source=read('buildings');
  assert.equal(source.features.length,166);
  assert.equal(unresolved.length,12);
  assert.equal(retained.length,5);
  assert.equal(source.features.filter(item=>isUnverifiedSourceFragment(String(item.id))).length,12);
  for(const row of unresolved)assert.equal(isUnverifiedSourceFragment(row.id),true);
  for(const row of retained)assert.equal(isUnverifiedSourceFragment(row.id),false);
  assert.equal(isUnverifiedSourceFragment(bambooNorth),false);
  assert.equal(isUnverifiedSourceFragment('unknown-id'),false);
});

test('review opacity hides unselected fragments, restores references, and clears selected-only visibility',()=>{
  const hidden=sourceFragmentOpacity(false,0.7),review=sourceFragmentOpacity(true,0.7);
  assert.equal(opacityValue(hidden,{}),0);
  assert.equal(opacityValue(hidden,{selected:false,hover:false}),0);
  assert.equal(opacityValue(hidden,{hover:true}),0,'hidden references must not reappear on hover');
  assert.equal(opacityValue(hidden,{selected:true}),0.7,'a deep-link selection remains inspectable');
  assert.equal(opacityValue(hidden,{selected:false}),0,'clearing selection hides the temporary outline');
  assert.equal(opacityValue(review,{selected:true}),0.7);
  assert.equal(opacityValue(review,{hover:true}),0.7);
  assert.ok(Math.abs(Number(opacityValue(review,{}))-0.56)<1e-12);
  assert.equal(sourceFragmentPickEnabled(false,null),false);
  assert.equal(sourceFragmentPickEnabled(false,fragment067),true);
  assert.equal(sourceFragmentPickEnabled(false,bambooNorth),false);
  assert.equal(sourceFragmentPickEnabled(false,retained[0]!.id),false);
  assert.equal(sourceFragmentPickEnabled(true,null),true);
});

test('original 067 is disjoint in GIS but intersects the corrected north-roof display',()=>{
  const source=read('buildings'),before=JSON.stringify(source);
  const preview=displayCollection('buildings',source,true,true);
  const small=source.features.find(item=>item.id===fragment067)! as Feature<Polygon|MultiPolygon>;
  const oldMain=source.features.find(item=>item.id===bambooNorth)! as Feature<Polygon|MultiPolygon>;
  const newMain=preview.features.find(item=>item.id===bambooNorth)! as Feature<Polygon|MultiPolygon>;
  assert.equal(intersect(featureCollection([small,oldMain])),null);
  const mixedOverlap=intersect(featureCollection([small,newMain]));
  assert.ok(mixedOverlap,'reproduce the screenshot before interpreting display roles');
  const fraction=area(mixedOverlap)/area(small);
  assert.ok(fraction>0.05&&fraction<0.07,`expected approximately 5.89% overlap, got ${fraction}`);
  assert.equal(preview.features.find(item=>item.id===fragment067),undefined,'067 is a display member, authority geometry remains independent');
  assert.equal(JSON.stringify(source),before,'display registration may not rewrite the source collection');
  for(const row of [...unresolved,...retained])
    if(planDisplayId(row.id)!==row.id||suppressedInPlanPreview(row.id))assert.equal(preview.features.find(item=>item.id===row.id),undefined,'registered roof now represented by a display group, not a source ownership merge');
    else if(roofGroupGeometry(row.id))assert.deepEqual(preview.features.find(item=>item.id===row.id)!.geometry,roofGroupGeometry(row.id));
    else assert.equal(preview.features.find(item=>item.id===row.id)!.geometry,
      source.features.find(item=>item.id===row.id)!.geometry,'no roof assignment, absorption or cutting');
});

test('layer manager retains 166 source records and toggles review outlines without changing geometry or 3D visibility',async()=>{
  const originalFetch=globalThis.fetch;
  const datasets=new Map<string,FeatureCollection>();
  globalThis.fetch=async url=>{
    const name=String(url).replace('/data/','').replace('.geojson','');
    const data=read(name);datasets.set(name,data);return new Response(JSON.stringify(data));
  };
  const layers=new Map<string,any>(),sources=new Map<string,any>();
  const map:any={
    addSource:(id:string,s:any)=>sources.set(id,{...s,setData:(data:any)=>{sources.get(id).data=data;}}),
    addLayer:(layer:any)=>layers.set(layer.id,{...layer,layout:{},paint:{...layer.paint}}),
    getLayer:(id:string)=>layers.get(id),getSource:(id:string)=>sources.get(id),
    setLayoutProperty:(id:string,key:string,value:any)=>{layers.get(id).layout[key]=value;},
    setPaintProperty:(id:string,key:string,value:any)=>{layers.get(id).paint[key]=value;},
    removeLayer:(id:string)=>{layers.delete(id);},removeSource:(id:string)=>{sources.delete(id);},
    once:()=>{},off:()=>{},
  };
  const manager=createLayerManager();
  try {
    await manager.load(map);
    assert.equal(manager.getSourceFragmentReview(),false);
    assert.equal(manager.getLayer('buildings')!.count,166,'analytical/source counts are not filtered presentation counts');
    const display=sources.get('campus-buildings').data as FeatureCollection;
    const before=JSON.stringify(display),authorityBefore=JSON.stringify(datasets.get('buildings'));
    assert.equal(display.features.filter(item=>item.properties?.displayRole===SOURCE_FRAGMENT_ROLE).length,2);
    assert.equal(UNRESOLVED_DISPLAY_FRAGMENT_IDS.length,2);
    for(const row of unresolved.filter(r=>UNRESOLVED_DISPLAY_FRAGMENT_IDS.includes(r.id))) {
      const shown=display.features.find(item=>item.id===row.id)!;
      assert.equal(shown.properties!.__sourceId,row.id);
      assert.equal(shown.properties!.displayRole,SOURCE_FRAGMENT_ROLE);
      assert.deepEqual(shown.geometry,datasets.get('buildings')!.features.find(item=>item.id===row.id)!.geometry);
    }
    for(const row of retained)assert.equal(display.features.find(item=>item.id===row.id)?.properties?.displayRole,undefined);
    const fill=CAMPUS_LAYERS.find(item=>item.id==='buildings')!.style.find(item=>item.id==='buildings-fill') as any;
    assert.deepEqual(fill.filter,['all',['==',['geometry-type'],'Polygon'],['!=',['get','displayRole'],SOURCE_FRAGMENT_ROLE]]);
    assert.equal(layers.get(SOURCE_FRAGMENT_LAYER).type,'line');
    assert.deepEqual(layers.get(SOURCE_FRAGMENT_LAYER).paint['line-dasharray'],[2,2]);
    assert.equal(opacityValue(layers.get(SOURCE_FRAGMENT_LAYER).paint['line-opacity'],{}),0);
    manager.setSourceFragmentReview(true);
    assert.equal(manager.getSourceFragmentReview(),true);
    assert.equal(opacityValue(layers.get(SOURCE_FRAGMENT_LAYER).paint['line-opacity'],{}),0.8);
    manager.setOpacity('buildings',0.5);
    assert.equal(opacityValue(layers.get(SOURCE_FRAGMENT_LAYER).paint['line-opacity'],{}),0.4);
    manager.setCampus3DActive(true);
    assert.equal(layers.get('buildings-fill').layout.visibility,'none');
    assert.equal(layers.get(SOURCE_FRAGMENT_LAYER).layout.visibility,'none');
    manager.setCampus3DActive(false);
    assert.equal(layers.get(SOURCE_FRAGMENT_LAYER).layout.visibility,'visible');
    assert.equal(manager.getSourceFragmentReview(),true,'3D round trips must retain the review preference');
    manager.setSourceFragmentReview(false);
    assert.equal(opacityValue(layers.get(SOURCE_FRAGMENT_LAYER).paint['line-opacity'],{}),0);
    assert.equal(opacityValue(layers.get(SOURCE_FRAGMENT_LAYER).paint['line-opacity'],{selected:true}),0.5);
    assert.equal(opacityValue(layers.get(SOURCE_FRAGMENT_LAYER).paint['line-opacity'],{selected:false}),0);
    assert.equal(JSON.stringify(sources.get('campus-buildings').data),before,'review changes paint, not geometry or IDs');
    assert.equal(JSON.stringify(datasets.get('buildings')),authorityBefore);
    manager.setTeachingPlanPreview(false);
    const originals=sources.get('campus-buildings').data as FeatureCollection;
    assert.equal(originals.features.length,166);
    assert.equal(originals.features.some(item=>item.properties?.displayRole===SOURCE_FRAGMENT_ROLE),false);
    assert.deepEqual(originals.features.find(item=>item.id===fragment067)!.geometry,
      datasets.get('buildings')!.features.find(item=>item.id===fragment067)!.geometry);
    manager.setTeachingPlanPreview(true);
    assert.equal((sources.get('campus-buildings').data as FeatureCollection).features.filter(item=>item.properties?.displayRole===SOURCE_FRAGMENT_ROLE).length,2);
    assert.equal(manager.getLayer('buildings')!.count,166);
  } finally {globalThis.fetch=originalFetch;manager.detach();}
  assert.equal(layers.size,0);assert.equal(sources.size,0);
});
