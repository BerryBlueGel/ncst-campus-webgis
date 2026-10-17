import { test } from 'node:test';
import assert from 'node:assert/strict';
import { point,polygon } from '@turf/turf';
import { coordinates } from '../src/gis/coordinate/CampusCoordinateService';
import { coordinatePick,planarDistanceXY,planarAreaXY,measureDistance,measureArea,makeBuffer,pointInside,
  nearestFeature,queryBBox,polygonIntersection,featuresInside } from '../src/gis/analysis/AnalysisGeometry';
import { AnalysisManager } from '../src/gis/analysis/AnalysisManager';
import { analysisFeatures } from '../src/gis/analysis/render/AnalysisLayerRenderer';
import { StaticFeatureRepository,type FeatureSources } from '../src/gis/repositories/StaticFeatureRepository';
import { featureGeometry } from '../src/gis/analysis/FeatureGeometryAdapter';
const origin:[number,number]=[118.6,39.2];
const near:[number,number]=[118.601,39.201];
const far:[number,number]=[118.61,39.21];
const square=polygon([[[118.6,39.2],[118.601,39.2],[118.601,39.201],[118.6,39.201],[118.6,39.2]]]);
const overlap=polygon([[[118.6005,39.2005],[118.602,39.2005],[118.602,39.202],[118.6005,39.202],[118.6005,39.2005]]]);
const apart=polygon([[[119,40],[119.01,40],[119.01,40.01],[119,40.01],[119,40]]]);
const sources:FeatureSources={buildings:{type:'FeatureCollection',features:[{...square,id:'building-1',properties:{height:10}}]},
  sports:{type:'FeatureCollection',features:[{...square,id:'track-1',properties:{kind:'track_envelope',parentId:'stadium-east-01',name:'东区一号体育场'}}]},
  landmarks:{type:'FeatureCollection',features:[{...point(near),id:'library',properties:{name:'图书馆'}},{...point(far),id:'fusion-sculpture',properties:{name:'融合雕塑'}}]},
  pois:{type:'FeatureCollection',features:[{...point(near),id:'poi-1',properties:{featureId:'library'}}]}};
const repository=()=>new StaticFeatureRepository(sources);
test('coordinate pick returns WGS84, UTM and local from common service',()=>{const p=coordinatePick(origin);assert.deepEqual(p.wgs84,origin);assert.deepEqual(p.utm,coordinates.wgs84ToUtm(origin));assert.deepEqual(p.local,coordinates.wgs84ToLocal(origin));});
test('100m planar segment',()=>assert.equal(planarDistanceXY([[0,0],[100,0]]),100));
test('100m square planar area',()=>assert.equal(planarAreaXY([[0,0],[100,0],[100,100],[0,100]]),10000));
test('Turf geodesic distance valid',()=>{const r=measureDistance([origin,near]);assert.ok(r.turfMeters>100&&r.turfMeters<200);assert.ok(r.differenceMeters<1);});
test('Turf area valid and UTM close',()=>{const r=measureArea(square.geometry.coordinates[0] as [number,number][]);assert.ok(r.turfSquareMeters>9000);assert.ok(r.relativeDifferencePercent<1);});
test('buffer forms valid polygon',()=>assert.equal(makeBuffer(point(origin),100).geometry.type,'Polygon'));
test('point in polygon true',()=>assert.equal(pointInside([118.6005,39.2005],square),true));
test('point in polygon false',()=>assert.equal(pointInside(far,square),false));
test('nearest uses representative point and returns business feature',()=>{const r=nearestFeature(origin,repository().getAll(),'landmark');assert.equal(r.feature.id,'library');});
test('bbox returns contained business features',()=>{const r=queryBBox([118.599,39.199],[118.602,39.202],repository().getAll());assert.ok(r.features.some(f=>f.id==='library'));});
test('intersection overlap has area',()=>{const r=polygonIntersection(square,overlap);assert.equal(r.intersects,true);assert.ok(r.turfSquareMeters>0);});
test('intersection disjoint is empty',()=>assert.equal(polygonIntersection(square,apart).intersects,false));
test('invalid buffer radius is rejected',()=>{assert.throws(()=>makeBuffer(point(origin),0));assert.throws(()=>makeBuffer(point(origin),NaN));});
test('polygon requires three vertices',()=>assert.throws(()=>measureArea([origin,near])));
test('invalid coordinates are rejected',()=>assert.throws(()=>coordinatePick([NaN,39.2])));
test('analysis manager activates one tool, clears old result',()=>{const m=new AnalysisManager(repository(),()=>null);m.activateTool('coordinate');m.addPoint(origin);assert.ok(m.getResult());m.activateTool('distance');assert.equal(m.getState().activeTool,'distance');assert.equal(m.getResult(),null);});
test('analysis manager cancels session',()=>{const m=new AnalysisManager(repository(),()=>null);m.activateTool('distance');m.addPoint(origin);m.cancel();assert.equal(m.isInteracting(),false);assert.equal(m.getState().points.length,0);});
test('analysis interaction priority flag only while active',()=>{const m=new AnalysisManager(repository(),()=>null);assert.equal(m.isInteracting(),false);m.activateTool('area');assert.equal(m.isInteracting(),true);m.cancel();assert.equal(m.isInteracting(),false);});
test('selected feature buffer preserves selection and returns business IDs',()=>{let selected='library';const m=new AnalysisManager(repository(),()=>selected);m.setRadius(300);m.bufferSelected();assert.equal(selected,'library');assert.equal(m.getState().status,'ready');assert.ok(m.getState().resultFeatures.some(f=>f.id==='library'));});
test('undo removes last vertex safely',()=>{const m=new AnalysisManager(repository(),()=>null);m.activateTool('distance');m.undo();m.addPoint(origin);m.addPoint(near);m.undo();assert.equal(m.getState().points.length,1);});
test('feature adapter accepts unified selected feature',()=>assert.equal(featureGeometry(repository().getById('library')!).geometry.type,'Point'));
test('buffer nearby uses representative point',()=>{const result=featuresInside(makeBuffer(point(near),200),repository().getAll());assert.ok(result.some(f=>f.id==='library'));});
test('one GeoJSON result source contains measurement vertices',()=>{const m=new AnalysisManager(repository(),()=>null);m.activateTool('distance');m.addPoint(origin);m.addPoint(near);assert.ok(analysisFeatures(m.getState()).features.length>=3);});
test('Phase 5 landmark and stadium IDs remain resolvable',()=>{const r=repository();assert.ok(r.getById('library'));assert.ok(r.getById('fusion-sculpture'));assert.ok(r.getById('stadium-east-01'));});
