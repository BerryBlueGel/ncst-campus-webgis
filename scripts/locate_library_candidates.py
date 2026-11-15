import json
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_refined_v002.glb"
OUTPUT = ROOT / "reference" / "library" / "library_candidates.json"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def bounds(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return low, high


def ancestor_path(obj):
    path = [obj.name]
    current = obj.parent
    while current:
        path.append(current.name)
        current = current.parent
    return list(reversed(path))


def main():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(MODEL))
    candidates = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.name.startswith("TPX_Buildings"):
            continue
        low, high = bounds(obj)
        center = (low + high) * 0.5
        dimensions = high - low
        footprint_area = dimensions.x * dimensions.z
        if 820.0 <= center.x <= 1120.0 and 420.0 <= center.z <= 650.0 and footprint_area >= 500.0:
            candidates.append({
                "name": obj.name,
                "path": ancestor_path(obj),
                "centerBlenderXZ": [center.x, center.z],
                "boundsBlender": [list(low), list(high)],
                "dimensionsMeters": [dimensions.x, dimensions.y, dimensions.z],
                "bboxFootprintAreaSquareMeters": footprint_area,
                "vertexCount": len(obj.data.vertices),
                "polygonCount": len(obj.data.polygons),
            })
    candidates.sort(key=lambda item: item["bboxFootprintAreaSquareMeters"], reverse=True)
    result = {"searchWindowLocalXZ": [[820.0, 420.0], [1120.0, 650.0]], "candidates": candidates}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
