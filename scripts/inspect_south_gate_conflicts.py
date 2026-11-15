import json
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "south_gate_working_v001_1.blend"
OUTPUT = ROOT / "blender" / "south_gate_conflict_candidates.json"

GATE_X = (938.0433, 1024.0433)
GATE_Z = (49.7847176175565, 69.78471761755651)


def world_bounds(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "x": [min(point.x for point in corners), max(point.x for point in corners)],
        "y": [min(point.y for point in corners), max(point.y for point in corners)],
        "z": [min(point.z for point in corners), max(point.z for point in corners)],
    }


def overlaps(a, b):
    return a[0] <= b[1] and b[0] <= a[1]


def main():
    if Path(bpy.data.filepath).resolve() != BLEND.resolve():
        raise RuntimeError(f"打开的不是南门工作文件: {bpy.data.filepath}")
    candidates = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or "TPX_Buildings" not in obj.name:
            continue
        bounds = world_bounds(obj)
        if overlaps(bounds["x"], GATE_X) and overlaps(bounds["z"], GATE_Z):
            candidates.append({
                "name": obj.name,
                "parent": obj.parent.name if obj.parent else None,
                "bounds": bounds,
                "dimensions": list(obj.dimensions),
            })
    result = {
        "gateFootprintWorldXZ": {"x": GATE_X, "z": GATE_Z},
        "buildingConflictCandidates": candidates,
        "candidateCount": len(candidates),
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
