import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { FeatureCollection, Position } from 'geojson';
import { coordinates } from '../src/gis/coordinate/CampusCoordinateService';
import { STAT_LAYERS, calculateStaticStats, collectionArea, projectedArea, projectedLength, validateStats, layerFocus } from '../src/gis/stats/CampusStats';
const data = Object.fromEntries(STAT_LAYERS.map(({ key }) => [key, JSON.parse(readFileSync(`public/data/${key}.geojson`, 'utf8')) as FeatureCollection]));
const position = (x: number, y: number): Position => coordinates.localToWgs84([x, y]);
const ring = (x: number, y: number, size: number) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]].map(([east, north]) => position(east!, north!));
test('projected polygon area subtracts holes and supports multipolygons', () => {
  assert.ok(Math.abs(projectedArea({ type: 'Polygon', coordinates: [ring(0, 0, 100), ring(10, 10, 20)] }) - 9600) < .001);
  assert.ok(Math.abs(projectedArea({ type: 'MultiPolygon', coordinates: [[ring(0, 0, 100)], [ring(200, 0, 50)]] }) - 12500) < .001);
  assert.equal(projectedArea(null), 0);
});
test('projected multiline length uses meters, not angular coordinates', () => {
  assert.ok(Math.abs(projectedLength({ type: 'MultiLineString', coordinates: [[position(0, 0), position(30, 40)], [position(0, 0), position(0, 20)]] }) - 70) < .001);
});
test('static counts match the versioned GIS inventory without double-counting stadiums', () => {
  const stats = calculateStaticStats(data);
  assert.equal(stats.totalFeatures, 449); assert.equal(stats.buildingCount, 166); assert.equal(stats.sportsCount, 4);
  assert.equal(stats.layers.find(layer => layer.layer === 'sports')?.featureCount, 8);
  assert.ok(collectionArea(data.campus_boundary!) > 2e6);
});
test('projected static metric sums agree with the recorded PostGIS baseline', () => {
  const stats = calculateStaticStats(data);
  assert.ok(Math.abs(stats.roadLengthMeters - 40726.10911736044) < .01);
  assert.ok(Math.abs(stats.greenAreaSquareMeters - 145427.05213722237) < .01);
  assert.ok(Math.abs(stats.waterAreaSquareMeters - 92963.49109145148) < .01);
});
test('API validation rejects missing, negative, non-finite and malformed counts', () => {
  const valid = calculateStaticStats(data);
  assert.equal(validateStats(valid), valid);
  for (const value of [null, {}, { ...valid, sportsCount: -1 }, { ...valid, roadLengthMeters: NaN }, { ...valid, layers: [{ layer: 'roads', featureCount: .5 }] }]) assert.throws(() => validateStats(value));
});
test('dashboard layer focus preserves boundary, restores all, and ignores bad URLs', () => {
  const focus = layerFocus('buildings')!;
  assert.equal(focus.buildings, true); assert.equal(focus['campus-boundary'], true);
  assert.equal(focus.roads, false);
  assert.ok(Object.values(layerFocus('all')!).every(Boolean));
  assert.equal(layerFocus('unknown'), null); assert.equal(layerFocus(['buildings']), null);
});
