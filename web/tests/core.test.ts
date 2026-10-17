import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coordinates,
  CAMPUS_ORIGIN,
} from "../src/gis/coordinate/CampusCoordinateService";
import {
  readCamera,
  DEFAULT_CAMERA,
  cameraQuery,
} from "../src/gis/map/MapConfig";
import { createLayerManager } from "../src/gis/layers/LayerManager";
test("local origin maps to authoritative UTM origin", () =>
  assert.deepEqual(coordinates.localToUtm([0, 0]), CAMPUS_ORIGIN));
test("UTM zone 50 central meridian reference", () => {
  const [x, y] = coordinates.wgs84ToUtm([117, 0]);
  assert.ok(Math.abs(x - 500000) < 0.001);
  assert.ok(Math.abs(y) < 0.001);
});
test("campus coordinate roundtrip below millimetre", () => {
  for (const p of [
    [0, 0],
    [1752.896, 904.499],
    [139.8, 1024.177],
  ] as [number, number][]) {
    const q = coordinates.wgs84ToLocal(coordinates.localToWgs84(p));
    assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.001);
  }
});
test("camera restores valid inputs and rejects invalid ones", () => {
  const state = readCamera(
    new URLSearchParams("lng=NaN&lat=91&zoom=17&pitch=55&bearing=30"),
  );
  assert.equal(state.lng, DEFAULT_CAMERA.lng);
  assert.equal(state.lat, DEFAULT_CAMERA.lat);
  assert.equal(state.pitch, 55);
  assert.equal(state.zoom, 17);
  assert.equal(cameraQuery(state).bearing, "30.00");
});
test("metadata does not leak mutable references", () => {
  const manager = createLayerManager();
  const layer = manager.getLayer("buildings")!;
  layer.visible = false;
  assert.equal(manager.getLayer("buildings")?.visible, true);
  manager.setVisibility("buildings", false);
  assert.equal(manager.getLayer("buildings")?.visible, false);
  assert.throws(() => manager.setOpacity("buildings", 2));
});
