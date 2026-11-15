import {test} from 'node:test';import assert from 'node:assert/strict';
import {Object3D,Line,Mesh,BufferGeometry,Float32BufferAttribute} from '../web/node_modules/three/build/three.module.js';
import {hideDiagnosticContours,reviewLineCounts} from '../reference/buildings/other_areas_detail_v001/review-presentation.mjs';
function named(Type,name){const o=new Type();o.name=name;return o;}
test('direct diagnostic contour is hidden without deleting it',()=>{
 const root=new Object3D(),line=named(Line,'TPX_Contours_0');root.add(line);
 assert.equal(hideDiagnosticContours(root),1);assert.equal(line.visible,false);assert.equal(root.children[0],line);
});
test('ancestor contour groups are recognized',()=>{
 const root=new Object3D(),group=named(Object3D,'TPX_Contours_4'),line=named(Line,'unnamed');root.add(group);group.add(line);
 assert.equal(hideDiagnosticContours(root),1);assert.equal(line.visible,false);assert.equal(group.visible,true);
});
test('road and unrelated building outline lines stay visible',()=>{
 const root=new Object3D();for(const name of ['TPX_Roads_0','BuildingEdge_2'])root.add(named(Line,name));
 assert.equal(hideDiagnosticContours(root),0);assert.ok(root.children.every(o=>o.visible));
});
test('mesh objects are not hidden even when contour-named',()=>{
 const root=new Object3D(),mesh=named(Mesh,'TPX_Contours_1');root.add(mesh);
 assert.equal(hideDiagnosticContours(root),0);assert.equal(mesh.visible,true);
});
test('similar but non-matching names and existing visibility stay unchanged',()=>{
 const root=new Object3D();for(const name of ['TPX_ContoursFake','Other_TPX_Contours_1'])root.add(named(Line,name));
 const road=named(Line,'TPX_Roads_2');road.visible=false;root.add(road);
 assert.equal(hideDiagnosticContours(root),0);assert.equal(road.visible,false);assert.equal(root.children[0].visible,true);
});
test('geometry buffers, transforms and hierarchy survive repeated application',()=>{
 const root=new Object3D(),g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([1,2,3,4,5,6],3));
 const line=new Line(g);line.name='TPX_Contours_1';line.position.set(8,9,10);root.add(line);
 const before=Array.from(g.attributes.position.array);hideDiagnosticContours(root);hideDiagnosticContours(root);
 assert.deepEqual(Array.from(g.attributes.position.array),before);assert.deepEqual(line.position.toArray(),[8,9,10]);assert.equal(line.parent,root);
});
test('diagnostics distinguish hidden contour lines from visible roads',()=>{
 const root=new Object3D();root.add(named(Line,'TPX_Contours_0'),named(Line,'TPX_Roads_0'));
 hideDiagnosticContours(root);assert.deepEqual(reviewLineCounts(root),{lines:2,contourLines:1,hiddenContourLines:1,visibleContourLines:0,roadLines:1,visibleRoadLines:1});
});
