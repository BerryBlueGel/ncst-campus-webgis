import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyAnalysisText} from '../src/gis/analysis/AnalysisClipboard';
test('analysis copy reports success only after the actual write resolves',async()=>{
  let copied='';
  assert.equal(await copyAnalysisText('100 m 缓冲区',async text=>{copied=text;}),'已复制结果');
  assert.equal(copied,'100 m 缓冲区');
});
test('denied or unavailable clipboard produces a useful notice without rejection',async()=>{
  for(const write of [async()=>{throw Error('NotAllowedError');},()=>{throw TypeError('clipboard unavailable');}])
    assert.match(await copyAnalysisText('result',write),/复制失败.*权限/);
});
