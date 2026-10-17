import {test} from 'node:test';
import assert from 'node:assert/strict';
import {featureFocusViewport} from '../src/gis/map/FeatureFocusViewport';

test('mobile target is centered in the visible map above the actual bottom sheet',()=>{
  const map={left:0,right:390,top:154,bottom:803};
  const sheet={left:0,right:390,top:443,bottom:803};
  const before=JSON.stringify([map,sheet]);
  const result=featureFocusViewport(map,sheet,true);
  assert.equal(result.occluded,true);
  assert.deepEqual(result.padding,{top:20,bottom:380,left:20,right:20});
  const target=map.top+(map.bottom-map.top)/2+result.offset[1];
  assert.ok(target>map.top+20&&target<sheet.top-20);
  assert.equal(JSON.stringify([map,sheet]),before);
});
test('hidden or desktop side panels do not introduce a phantom bottom exclusion',()=>{
  const map={left:242,right:1000,top:136,bottom:700};
  const side={left:1000,right:1280,top:136,bottom:700};
  assert.deepEqual(featureFocusViewport(map,side,false),{padding:{top:160,bottom:45,left:45,right:45},offset:[0,57.5],occluded:false});
  assert.equal(featureFocusViewport(map,{left:0,right:0,top:0,bottom:0},true).occluded,false);
  assert.deepEqual(featureFocusViewport(map,null,true).padding,{top:20,bottom:20,left:20,right:20});
});
test('short and resizing viewports always retain a valid nonzero fitting region',()=>{
  for(const height of [1,40,120,180,340,649]){
    const {padding}=featureFocusViewport({left:0,right:320,top:0,bottom:height},{left:0,right:320,top:Math.max(0,height-360),bottom:height},true);
    assert.ok(padding.top+padding.bottom<height);
    assert.ok(padding.left+padding.right<320);
    assert.ok(Object.values(padding).every(value=>Number.isFinite(value)&&value>=0));
  }
});
test('sheet size is measured afresh; closing it restores symmetric focus without a stored padding state',()=>{
  const map={left:0,right:390,top:154,bottom:803};
  assert.equal(featureFocusViewport(map,{left:0,right:390,top:543,bottom:803},true).padding.bottom,280);
  assert.deepEqual(featureFocusViewport(map,null,true).offset,[0,0]);
});
