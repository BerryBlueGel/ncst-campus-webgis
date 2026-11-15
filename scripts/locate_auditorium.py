import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


CAMPUS_ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = CAMPUS_ROOT / "output" / "campus_cropped.glb"
BUILDINGS_PATH = CAMPUS_ROOT / "output" / "geojson" / "buildings.geojson"
REPORT_PATH = CAMPUS_ROOT / "diagnostics" / "auditorium_locator_report.json"

LON = 118.592041
LAT = 39.207201
ORIGIN_E = 635986.7561034276
ORIGIN_N = 4339716.120350528


def lonlat_to_utm50(lon: float, lat: float) -> tuple[float, float]:
    """WGS84 经纬度转 UTM 50N，避免依赖额外 Python 包。"""
    a = 6378137.0
    f = 1.0 / 298.257223563
    k0 = 0.9996
    e2 = f * (2.0 - f)
    ep2 = e2 / (1.0 - e2)
    phi = math.radians(lat)
    lam = math.radians(lon)
    lam0 = math.radians(117.0)
    sin_phi = math.sin(phi)
    cos_phi = math.cos(phi)
    tan_phi = math.tan(phi)
    n = a / math.sqrt(1.0 - e2 * sin_phi * sin_phi)
    t = tan_phi * tan_phi
    c = ep2 * cos_phi * cos_phi
    aa = cos_phi * (lam - lam0)
    m = a * (
        (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * phi
        - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * math.sin(2 * phi)
        + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * math.sin(4 * phi)
        - (35 * e2**3 / 3072) * math.sin(6 * phi)
    )
    easting = 500000.0 + k0 * n * (
        aa
        + (1 - t + c) * aa**3 / 6
        + (5 - 18 * t + t * t + 72 * c - 58 * ep2) * aa**5 / 120
    )
    northing = k0 * (
        m
        + n
        * tan_phi
        * (
            aa * aa / 2
            + (5 - t + 9 * c + 4 * c * c) * aa**4 / 24
            + (61 - 58 * t + t * t + 600 * c - 330 * ep2) * aa**6 / 720
        )
    )
    return easting, northing


def rings_from_geometry(geometry: dict) -> list[list[list[float]]]:
    if geometry.get("type") == "Polygon":
        return geometry.get("coordinates", [])[:1]
    if geometry.get("type") == "MultiPolygon":
        return [polygon[0] for polygon in geometry.get("coordinates", []) if polygon]
    return []


def point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][:2]
        xj, yj = ring[j][:2]
        crosses = (yi > y) != (yj > y)
        if crosses:
            edge_x = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < edge_x:
                inside = not inside
        j = i
    return inside


def ring_summary(ring: list[list[float]]) -> dict:
    xs = [coord[0] for coord in ring]
    ys = [coord[1] for coord in ring]
    area2 = 0.0
    cx6a = 0.0
    cy6a = 0.0
    for i in range(len(ring) - 1):
        cross = xs[i] * ys[i + 1] - xs[i + 1] * ys[i]
        area2 += cross
        cx6a += (xs[i] + xs[i + 1]) * cross
        cy6a += (ys[i] + ys[i + 1]) * cross
    if abs(area2) > 1e-9:
        centroid = [cx6a / (3.0 * area2), cy6a / (3.0 * area2)]
    else:
        centroid = [sum(xs) / len(xs), sum(ys) / len(ys)]
    return {
        "bounds": [min(xs), min(ys), max(xs), max(ys)],
        "centroid": centroid,
        "areaSquareMeters": abs(area2) / 2.0,
    }


def world_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners))),
        Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners))),
    )


def ancestry(obj: bpy.types.Object) -> list[str]:
    names = []
    current = obj
    while current is not None:
        names.append(current.name)
        current = current.parent
    return names


def main() -> None:
    easting, northing = lonlat_to_utm50(LON, LAT)
    local_x = float(os.environ.get("AUD_LOCAL_X", easting - ORIGIN_E))
    local_north = float(os.environ.get("AUD_LOCAL_NORTH", northing - ORIGIN_N))
    if "AUD_LOCAL_X" in os.environ or "AUD_LOCAL_NORTH" in os.environ:
        easting = ORIGIN_E + local_x
        northing = ORIGIN_N + local_north

    with BUILDINGS_PATH.open("r", encoding="utf-8") as handle:
        buildings = json.load(handle)

    geo_candidates = []
    for index, feature in enumerate(buildings.get("features", [])):
        for ring in rings_from_geometry(feature.get("geometry") or {}):
            summary = ring_summary(ring)
            cx, cy = summary["centroid"]
            distance = math.hypot(cx - easting, cy - northing)
            geo_candidates.append(
                {
                    "featureIndex": index,
                    "containsMapPoint": point_in_ring(easting, northing, ring),
                    "centroidDistanceMeters": distance,
                    "geometry": summary,
                    "properties": feature.get("properties", {}),
                }
            )
    geo_candidates.sort(key=lambda item: (not item["containsMapPoint"], item["centroidDistanceMeters"]))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(MODEL_PATH))
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB 导入失败: {result}")

    model_candidates = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or "TPX_Buildings" not in obj.name:
            continue
        bounds_min, bounds_max = world_bounds(obj)
        cx = (bounds_min.x + bounds_max.x) / 2.0
        cz = (bounds_min.z + bounds_max.z) / 2.0
        planar_distance = math.hypot(cx - local_x, cz - local_north)
        contains = bounds_min.x <= local_x <= bounds_max.x and bounds_min.z <= local_north <= bounds_max.z
        model_candidates.append(
            {
                "name": obj.name,
                "mesh": obj.data.name if obj.data else None,
                "ancestry": ancestry(obj),
                "containsMapPointInXZBounds": contains,
                "planarDistanceMeters": planar_distance,
                "worldBoundsBlender": [list(bounds_min), list(bounds_max)],
                "worldCenterBlender": [cx, (bounds_min.y + bounds_max.y) / 2.0, cz],
                "dimensionsWorld": [
                    bounds_max.x - bounds_min.x,
                    bounds_max.y - bounds_min.y,
                    bounds_max.z - bounds_min.z,
                ],
                "vertices": len(obj.data.vertices) if obj.data else 0,
                "polygons": len(obj.data.polygons) if obj.data else 0,
            }
        )
    model_candidates.sort(key=lambda item: (not item["containsMapPointInXZBounds"], item["planarDistanceMeters"]))

    report = {
        "target": "华北理工大学曹妃甸校区会堂（小鸟巢）",
        "mapCoordinateWgs84": [LON, LAT],
        "utmCoordinateEpsg32650": [easting, northing],
        "campusLocalCoordinate": [local_x, local_north],
        "blenderExpectedPlanarCoordinate": [local_x, local_north],
        "geoJsonCandidates": geo_candidates[:10],
        "modelCandidates": model_candidates[:20],
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with REPORT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
