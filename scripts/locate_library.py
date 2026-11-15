import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


CAMPUS_ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = CAMPUS_ROOT / "output" / "campus_refined_v002.glb"
BUILDINGS_PATH = CAMPUS_ROOT / "output" / "geojson" / "buildings.geojson"
REPORT_PATH = CAMPUS_ROOT / "reference" / "library" / "library_locator_report.json"

ORIGIN_E = 635986.7561034276
ORIGIN_N = 4339716.120350528
TARGET_LOCAL_X = 989.30029296875
TARGET_LOCAL_NORTH = 556.8445434570312


def rings_from_geometry(geometry):
    kind = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if kind == "Polygon":
        return coords[:1]
    if kind == "MultiPolygon":
        return [polygon[0] for polygon in coords if polygon]
    return []


def ring_summary(ring):
    xs = [float(coord[0]) for coord in ring]
    ys = [float(coord[1]) for coord in ring]
    area2 = cx6a = cy6a = 0.0
    for index in range(len(ring) - 1):
        cross = xs[index] * ys[index + 1] - xs[index + 1] * ys[index]
        area2 += cross
        cx6a += (xs[index] + xs[index + 1]) * cross
        cy6a += (ys[index] + ys[index + 1]) * cross
    if abs(area2) > 1e-9:
        centroid = [cx6a / (3.0 * area2), cy6a / (3.0 * area2)]
    else:
        centroid = [sum(xs) / len(xs), sum(ys) / len(ys)]
    return {
        "boundsUtm": [min(xs), min(ys), max(xs), max(ys)],
        "centroidUtm": centroid,
        "areaSquareMeters": abs(area2) / 2.0,
    }


def point_in_ring(x, y, ring):
    inside = False
    previous = len(ring) - 1
    for current in range(len(ring)):
        x1, y1 = ring[current][:2]
        x2, y2 = ring[previous][:2]
        if (y1 > y) != (y2 > y):
            if x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                inside = not inside
        previous = current
    return inside


def world_bounds(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    low = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    high = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    return low, high


def ancestry(obj):
    result = []
    current = obj
    while current is not None:
        result.append(current.name)
        current = current.parent
    return result


def main():
    target_utm = [ORIGIN_E + TARGET_LOCAL_X, ORIGIN_N + TARGET_LOCAL_NORTH]

    with BUILDINGS_PATH.open("r", encoding="utf-8") as handle:
        buildings = json.load(handle)

    geo_candidates = []
    for feature_index, feature in enumerate(buildings.get("features", [])):
        for ring in rings_from_geometry(feature.get("geometry") or {}):
            summary = ring_summary(ring)
            cx, cy = summary["centroidUtm"]
            geo_candidates.append(
                {
                    "featureIndex": feature_index,
                    "containsTarget": point_in_ring(target_utm[0], target_utm[1], ring),
                    "centroidDistanceMeters": math.hypot(cx - target_utm[0], cy - target_utm[1]),
                    "geometry": summary,
                    "properties": feature.get("properties", {}),
                }
            )
    geo_candidates.sort(key=lambda item: (not item["containsTarget"], item["centroidDistanceMeters"]))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(MODEL_PATH))
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB import failed: {result}")

    target = bpy.data.objects.get("TPX_Buildings_48")
    if target is None:
        raise RuntimeError("TPX_Buildings_48 was not found")
    low, high = world_bounds(target)
    center = [(low.x + high.x) / 2.0, (low.y + high.y) / 2.0, (low.z + high.z) / 2.0]
    dimensions = [high.x - low.x, high.y - low.y, high.z - low.z]

    report = {
        "target": "华北理工大学曹妃甸校区图书馆",
        "status": "confirmed by campus plan, georeferenced imagery, GIS footprint, and public facade photographs",
        "model": str(MODEL_PATH),
        "object": {
            "name": target.name,
            "mesh": target.data.name if target.data else None,
            "ancestry": ancestry(target),
            "worldBoundsBlender": [list(low), list(high)],
            "worldCenterBlender": center,
            "dimensionsMeters": dimensions,
            "bboxFootprintAreaSquareMeters": dimensions[0] * dimensions[2],
            "vertexCount": len(target.data.vertices) if target.data else 0,
            "polygonCount": len(target.data.polygons) if target.data else 0,
        },
        "campusLocalCoordinate": [center[0], center[2]],
        "utmCoordinateEpsg32650": [ORIGIN_E + center[0], ORIGIN_N + center[2]],
        "coordinateTransform": {
            "originEasting": ORIGIN_E,
            "originNorthing": ORIGIN_N,
            "blenderX": "GIS east",
            "blenderZ": "GIS north",
            "blenderNegativeY": "GIS up",
        },
        "nearestGeoJsonCandidates": geo_candidates[:10],
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
