import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { FeatureCollection, Geometry } from "geojson";
import {
  coordinates,
  CAMPUS_ORIGIN,
} from "../src/gis/coordinate/CampusCoordinateService";

const root = resolve(import.meta.dirname, "../.."),
  out = resolve(root, "web/public/data"),
  docs = resolve(root, "web/docs/phase2");
mkdirSync(out, { recursive: true });
mkdirSync(docs, { recursive: true });
const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
const sources: Record<string, string> = {};
function read(p: string) {
  const bytes = readFileSync(resolve(root, p));
  sources[p] = hash(bytes);
  return JSON.parse(bytes.toString());
}
const summary: Record<string, unknown>[] = [];
function transform(g: Geometry, local = false): Geometry {
  if (g.type === "GeometryCollection")
    return { ...g, geometries: g.geometries.map((x) => transform(x, local)) };
  const walk = (a: any): any =>
    typeof a[0] === "number"
      ? coordinates.utmToWgs84(
          local ? coordinates.localToUtm([a[0], a[1]]) : [a[0], a[1]],
        )
      : a.map(walk);
  return { ...g, coordinates: walk(g.coordinates) } as Geometry;
}
function canonical(a: any): string {
  return a === null || typeof a !== "object"
    ? JSON.stringify(a)
    : Array.isArray(a)
      ? `[${a.map(canonical).join(",")}]`
      : `{${Object.keys(a)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(a[k]))
          .join(",")}}`;
}
function convert(
  fc: FeatureCollection,
  prefix: string,
  local = false,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      id:
        f.id ??
        `${prefix}-${hash(canonical({ geometry: f.geometry, properties: f.properties })).slice(0, 20)}`,
      geometry: transform(f.geometry, local),
    })),
  };
}
function write(name: string, data: FeatureCollection, source: string) {
  const ids = data.features.map((f) => String(f.id));
  if (new Set(ids).size !== ids.length) throw Error("Duplicate IDs: " + name);
  const text = JSON.stringify(data);
  writeFileSync(resolve(out, name + ".geojson"), text + "\n");
  summary.push({
    layer: name,
    file: name + ".geojson",
    source,
    crs: "EPSG:4326 (RFC7946)",
    featureCount: data.features.length,
    geometryTypes: [...new Set(data.features.map((f) => f.geometry.type))],
    bytes: Buffer.byteLength(text + "\n"),
    sha256: hash(text + "\n"),
  });
}
const inventory: string[] = [];
for (const name of ["buildings", "roads", "waterways", "green_areas"]) {
  const path = `output/geojson/${name}.geojson`,
    data = read(path) as FeatureCollection & { crs: any };
  if (!JSON.stringify(data.crs).includes("32650"))
    throw Error("Unknown CRS " + path);
  write(name, convert(data, name), path);
  inventory.push(
    `| ${path} | EPSG:32650 | ${[...new Set(data.features.map((f) => f.geometry.type))]} | ${data.features.length} | ${[...new Set(data.features.flatMap((f) => Object.keys(f.properties ?? {})))].join(", ")} | ${name} | SHA-256 verified |`,
  );
}
const boundaryPath = "output/debug/campus_boundary_local.geojson",
  boundary = read(boundaryPath);
if (
  JSON.stringify(boundary.metadata.originEPSG32650) !==
  JSON.stringify(CAMPUS_ORIGIN)
)
  throw Error("Boundary origin mismatch");
const browserBoundary = convert(boundary, "boundary", true);
write("campus_boundary", browserBoundary, boundaryPath);
inventory.push(
  `| ${boundaryPath} | Local East/North relative to EPSG:32650 origin | Polygon | 1 | fid, name | campus-boundary | SHA-256 verified |`,
);
const sportsPath = "reference/stadiums/stadium_measurements.geojson",
  measurements = read(sportsPath) as FeatureCollection;
const stadiumPath = "reference/stadiums/stadium_inventory.json",
  stadiums = read(stadiumPath).stadiums;
const sportId = (s: string) =>
  s.toLowerCase().replace("st_", "stadium-").replaceAll("_", "-");
const sports: FeatureCollection = {
  type: "FeatureCollection",
  features: measurements.features
    .filter((f) =>
      ["track_envelope", "football_pitch"].includes(f.properties!.kind),
    )
    .map((f) => {
      const s = stadiums.find((s: any) => s.id === f.properties!.stadiumId);
      const id = sportId(s.id);
      return {
        ...f,
        id: f.properties!.kind === "track_envelope" ? id : id + "-pitch",
        properties: {
          ...f.properties,
          name: s.officialName ?? s.planLabel,
          orientation: s.orientationDegrees,
          trackLength: s.track.outerLengthMeters,
          trackWidth: s.track.outerWidthMeters,
          standStatus: s.stand ?? s.modelingParameters.enableStand,
          nameStatus: s.nameStatus,
          parentId: id,
        },
        geometry: transform(f.geometry),
      };
    }),
};
write("sports", sports, sportsPath + " + " + stadiumPath);
inventory.push(
  `| ${sportsPath} | EPSG:32650 | Polygon | ${measurements.features.length} | stadiumId, kind, source, status | sports: 4 track + 4 pitch polygons | SHA-256 verified |`,
);
const libraryPath = "blender/library_v001_2_report.json",
  gatePath = "blender/south_gate_v001_1_report.json",
  audPath = "blender/auditorium_v001_report.json",
  fusionPath = "output/fusion_sculpture_integration_report.json";
const library = read(libraryPath).preserved.gisRootWorldXYZ,
  gate = read(gatePath).grounding.samples.portalCenter.world,
  aud = read(audPath).refinedRootWorldLocation,
  fusion = read(fusionPath).placement.lockedBlenderXZ;
const controls = [
  {
    id: "library",
    name: "图书馆",
    local: [library[0], library[2]],
    source: libraryPath,
  },
  {
    id: "south-gate",
    name: "南门",
    local: [gate[0], gate[2]],
    source: gatePath,
  },
  { id: "auditorium", name: "会堂", local: [aud[0], aud[2]], source: audPath },
  {
    id: "fusion-sculpture",
    name: "融合雕塑",
    local: fusion,
    source: fusionPath,
  },
];
const points = (items: any[], refined: boolean): FeatureCollection => ({
  type: "FeatureCollection",
  features: items.map((s) => {
    const ll = coordinates.localToWgs84(s.local);
    return {
      type: "Feature",
      id: s.id,
      geometry: { type: "Point", coordinates: ll },
      properties: {
        id: s.id,
        name: s.name,
        type: refined ? "landmark" : "sports",
        localX: s.local[0],
        localNorth: s.local[1],
        longitude: ll[0],
        latitude: ll[1],
        refined,
        source: s.source,
      },
    };
  }),
});
const landmarks = points(controls, true);
write(
  "landmarks",
  landmarks,
  "Refined placement reports (not old POI estimates)",
);
const sportsPoints = points(
  stadiums.map((s: any) => ({
    id: sportId(s.id),
    name: s.officialName ?? s.planLabel,
    local: s.centerLocalXZ,
    source: stadiumPath,
  })),
  false,
);
const pois: FeatureCollection = {
  type: "FeatureCollection",
  features: [...landmarks.features, ...sportsPoints.features].map((f) => ({
    ...f,
    id: "poi-" + f.id,
    properties: { ...f.properties, featureId: f.id },
  })),
};
write("pois", pois, "Derived from verified landmark and stadium placements");
writeFileSync(
  resolve(out, "pois.json"),
  JSON.stringify(
    pois.features.map((f) => ({
      id: f.properties!.featureId,
      name: f.properties!.name,
      coordinates: (f.geometry as any).coordinates,
      type: f.properties!.type,
    })),
    null,
    2,
  ),
);
const checks = [
  ...controls,
  ...stadiums.map((s: any) => ({
    id: sportId(s.id),
    local: s.centerLocalXZ,
    source: stadiumPath,
    referenceUTM: s.centerUTM,
  })),
].map((s) => {
  const local = s.local as [number, number],
    utm = coordinates.localToUtm(local),
    ll = coordinates.utmToWgs84(utm),
    back = coordinates.wgs84ToUtm(ll),
    backLocal = coordinates.wgs84ToLocal(ll);
  return {
    ...s,
    utm,
    wgs84: ll,
    utmRoundTripError: Math.hypot(back[0] - utm[0], back[1] - utm[1]),
    localError: Math.hypot(backLocal[0] - local[0], backLocal[1] - local[1]),
  };
});
if (checks.some((c) => c.utmRoundTripError > 0.001 || c.localError > 0.001))
  throw Error("Coordinate error: rendering prohibited");
if (!(gate[2] < fusion[1] && fusion[1] < library[2]))
  throw Error("South gate / Fusion / Library order invalid");
for (const [p, before] of Object.entries(sources))
  if (hash(readFileSync(resolve(root, p))) !== before)
    throw Error("Source modified " + p);
writeFileSync(
  resolve(docs, "preparation-summary.json"),
  JSON.stringify(
    {
      sources,
      outputs: summary,
      coordinateChecks: checks,
      maxUTMError: Math.max(...checks.map((c) => c.utmRoundTripError)),
      maxLocalError: Math.max(...checks.map((c) => c.localError)),
      sourceUnchanged: true,
      notes: [
        "Boundary is local coordinates: add authoritative UTM origin before conversion.",
        "Sports are schematic measurements, not survey-grade.",
        "All original building footprints retained; no replacement by GLB geometry.",
      ],
    },
    null,
    2,
  ),
);
writeFileSync(
  resolve(docs, "GIS_SOURCE_INVENTORY.md"),
  "# GIS Source Inventory\n\nOriginal files remain unchanged; hashes in preparation-summary.json. No GLB loaded into the browser.\n\n| Source | CRS | Geometry | Count | Properties | Target | Integrity |\n|---|---|---|---|---|---|---|\n" +
    inventory.join("\n") +
    "\n\nLandmarks derive from " +
    controls.map((c) => c.source).join(", ") +
    ". Stadium names/status derive from " +
    stadiumPath +
    ".\n\nBoundary is NOT already UTM despite its source CRS metadata: its actual coordinates are local East/North. Conversion first adds the documented origin. Preserve this distinction. Existing IDs retained; missing IDs are SHA-256 of canonical geometry + properties, never array indexes. Geometry edits without source IDs therefore produce a new identity.\n",
);
console.log(
  JSON.stringify(
    {
      outputs: summary,
      maxError: Math.max(...checks.map((c) => c.localError)),
    },
    null,
    2,
  ),
);
