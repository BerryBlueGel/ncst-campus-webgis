import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ref} from 'vue';
import {createTeachingPreviewState} from '../src/gis/features/TeachingPreviewState';
import {TEACHING_BUILDINGS} from '../src/gis/features/TeachingBuildingPresentation';

const main=TEACHING_BUILDINGS[2]!.id,part=TEACHING_BUILDINGS[2]!.nearbyParts![0]!;
test('source-fragment inspection temporarily shows raw geometry and restores preview on main return',()=>{
  const selected=ref<string|null>(main),state=createTeachingPreviewState(selected);
  for(let i=0;i<10;i++){
    assert.equal(state.effective.value,true);
    selected.value=part;
    assert.equal(state.effective.value,false);assert.equal(state.inspectingPart.value,true);
    assert.equal(state.preferred.value,true);
    selected.value=main;assert.equal(state.inspectingPart.value,false);
  }
  assert.equal(state.effective.value,true);
});
test('a deliberate raw-model preference is never overridden on leaving a source fragment',()=>{
  const selected=ref<string|null>(main),state=createTeachingPreviewState(selected);
  state.effective.value=false;selected.value=part;selected.value=main;
  assert.equal(state.effective.value,false);selected.value=null;
  assert.equal(state.effective.value,false);
});
test('clearing selection or selecting a different feature restores the saved choice',()=>{
  const selected=ref<string|null>(part),state=createTeachingPreviewState(selected);
  assert.equal(state.effective.value,false);selected.value=null;assert.equal(state.effective.value,true);
  selected.value=part;selected.value='library';assert.equal(state.effective.value,true);
});
test('inspection blocks ineffective toggle writes rather than silently changing the saved choice',()=>{
  const selected=ref<string|null>(part),state=createTeachingPreviewState(selected);
  state.effective.value=false;state.effective.value=true;
  assert.equal(state.effective.value,false);assert.equal(state.preferred.value,true);
  selected.value=main;assert.equal(state.effective.value,true);
});
