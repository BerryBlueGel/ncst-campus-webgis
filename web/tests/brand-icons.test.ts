import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('brand assets retain transparent PNG sizes and all six ICO resolutions',()=>{
  for(const size of [32,128,180]){
    const png=readFileSync(`public/branding/berrybluegel-v1-${size}.png`);
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
    assert.equal(png[25],6,'RGBA color type retains alpha');
  }
  const ico=readFileSync('public/branding/berrybluegel-v1.ico');
  assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),6);
  assert.deepEqual(Array.from({length:6},(_,i)=>ico[6+i*16]||256),[16,32,48,64,128,256]);
  assert.deepEqual(readFileSync('public/favicon.ico'),ico);
});
test('HTML declares real versioned icons instead of an empty data favicon',()=>{
  const html=readFileSync('index.html','utf8');
  assert.ok(!html.includes('href="data:,"'));
  for(const file of ['berrybluegel-v1.ico','berrybluegel-v1-32.png','berrybluegel-v1-180.png'])
    assert.ok(html.includes(`/branding/${file}`));
  const source=JSON.parse(readFileSync('public/branding/source.json','utf8'));
  assert.equal(source.sourceSha256,'4fd016a586c49d96bde3f2a73a8f488529fcaf91d3fbb1b7d562309153ac7223');
});
