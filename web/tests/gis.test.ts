import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { CAMPUS_LAYERS } from "../src/gis/layers/CampusLayerRegistry";
import { LayerManager } from "../src/gis/layers/LayerManager";
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const hash = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
test("eight layers, unique layer/source/style IDs and globally unique feature IDs", () => {
  assert.equal(CAMPUS_LAYERS.length, 8);
  for (const values of [
    CAMPUS_LAYERS.map((l) => l.id),
    CAMPUS_LAYERS.map((l) => l.sourceId),
    CAMPUS_LAYERS.flatMap((l) => l.style.map((s) => s.id)),
  ])
    assert.equal(new Set(values).size, values.length);
  const ids = new Set();
  for (const layer of CAMPUS_LAYERS) {
    const fc = read("public" + layer.url);
    assert.equal(fc.type, "FeatureCollection");
    assert.ok(fc.features.length);
    for (const f of fc.features) {
      assert.ok(f.id);
      assert.ok(!ids.has(f.id));
      ids.add(f.id);
      assert.ok(layer.geometryType.includes(f.geometry.type));
      const visit = (a: any[]): void => {
        if (typeof a[0] === "number") {
          assert.ok(a.every(Number.isFinite));
          assert.ok(a[0] > 118.56 && a[0] < 118.62);
          assert.ok(a[1] > 39.19 && a[1] < 39.23);
        } else a.forEach(visit);
      };
      visit(f.geometry.coordinates);
      const polygons =
        f.geometry.type === "Polygon"
          ? [f.geometry.coordinates]
          : f.geometry.type === "MultiPolygon"
            ? f.geometry.coordinates
            : [];
      for (const polygon of polygons)
        for (const ring of polygon) {
          assert.ok(ring.length >= 4);
          assert.deepEqual(ring[0], ring.at(-1));
        }
    }
  }
});
test("four sports and four refined landmarks exist; corrected axis ordering", () => {
  const sports = read("public/data/sports.geojson").features;
  for (const id of [
    "stadium-east-01",
    "stadium-east-02",
    "stadium-west-01",
    "stadium-west-02",
  ])
    assert.ok(sports.some((f: any) => f.id === id));
  const landmarks = read("public/data/landmarks.geojson").features;
  for (const id of ["library", "south-gate", "auditorium", "fusion-sculpture"])
    assert.ok(landmarks.some((f: any) => f.id === id && f.properties.refined));
  const north = (id: string) =>
    landmarks.find((f: any) => f.id === id).properties.localNorth;
  assert.ok(
    north("south-gate") < north("fusion-sculpture") &&
      north("fusion-sculpture") < north("library"),
  );
});
test("preparation reproducible and source hashes unchanged", () => {
  const before = CAMPUS_LAYERS.map((l) => hash("public" + l.url));
  execFileSync(process.execPath, [
    "node_modules/tsx/dist/cli.mjs",
    "scripts/prepare-gis-data.ts",
  ]);
  assert.deepEqual(
    CAMPUS_LAYERS.map((l) => hash("public" + l.url)),
    before,
  );
  const summary = read("docs/phase2/preparation-summary.json");
  for (const [file, digest] of Object.entries(summary.sources))
    assert.equal(hash("../" + file), digest);
});
test("manager applies visibility, opacity, reload and removal to map", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(readFileSync("public/data/buildings.geojson", "utf8"));
  const layers = new Map<string, any>(),
    sources = new Map<string, any>();
  const map: any = {
    addSource: (id: string, s: any) => sources.set(id, s),
    addLayer: (l: any) =>
      layers.set(l.id, { ...l, layout: {}, paint: { ...l.paint } }),
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    setLayoutProperty: (id: string, k: string, v: any) =>
      (layers.get(id).layout[k] = v),
    setPaintProperty: (id: string, k: string, v: any) =>
      (layers.get(id).paint[k] = v),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    once: () => {},
    off: () => {},
  };
  const manager = new LayerManager();
  manager.register(CAMPUS_LAYERS.find((l) => l.id === "buildings")!);
  try {
    await manager.load(map);
    manager.hide("buildings");
    assert.equal(layers.get("buildings-fill").layout.visibility, "none");
    manager.show("buildings");
    assert.equal(layers.get("buildings-fill").layout.visibility, "visible");
    manager.setOpacity("buildings", 0.4);
    assert.equal(layers.get("buildings-fill").paint["fill-opacity"], 0.4);
    await manager.load(map);
    assert.equal(layers.size, CAMPUS_LAYERS.find((l)=>l.id==='buildings')!.style.length,'reload retains one fill and one source-review outline, without duplicates');
    manager.remove("buildings");
    assert.equal(layers.size, 0);
    assert.equal(sources.size, 0);
    assert.equal(manager.getState("buildings"), undefined);
  } finally {
    manager.detach();
    globalThis.fetch = original;
  }
});
