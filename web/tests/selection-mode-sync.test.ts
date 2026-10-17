import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectedQueryWithMode, threeModeAfterRouteUpdate } from '../src/gis/interaction/SelectedUrlState';

describe('selection and live 3D mode URL synchronization',()=>{
  it('writes live 3D mode when selection changes before the camera settles',()=>{
    assert.deepEqual({...{mode:'2d',zoom:'17'},...selectedQueryWithMode('part',true)},
      {mode:'3d',zoom:'17',selected:'part'});
  });
  it('does not undo a local toggle from an unchanged URL mode',()=>{
    assert.equal(threeModeAfterRouteUpdate('2d','2d',true),true);
    assert.equal(threeModeAfterRouteUpdate('3d','3d',false),false);
  });
  it('honors an actual mode change from browser navigation',()=>{
    assert.equal(threeModeAfterRouteUpdate('2d','3d',true),false);
    assert.equal(threeModeAfterRouteUpdate('3d','2d',false),true);
    assert.equal(threeModeAfterRouteUpdate(undefined,'3d',true),false);
  });
  it('clears selection without losing the live mode',()=>{
    assert.deepEqual(selectedQueryWithMode(null,true),{selected:undefined,mode:'3d'});
    assert.deepEqual(selectedQueryWithMode(null,false),{selected:undefined,mode:'2d'});
  });
});
