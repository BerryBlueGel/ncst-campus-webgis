import json
from pathlib import Path

import bpy
from bpy_extras import view3d_utils
from mathutils import Vector


OUTPUT_PATH = (Path(__file__).resolve().parents[1] / 'reference/sculptures/fusion_crosshair_target.json')


def find_view3d():
    for area in bpy.context.screen.areas:
        if area.type != "VIEW_3D":
            continue
        region = next((r for r in area.regions if r.type == "WINDOW"), None)
        if region is not None:
            return area, region, area.spaces.active.region_3d
    raise RuntimeError("No VIEW_3D area is available in the current Blender window")


def ground_objects():
    candidates = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        if "ground" in name or "tpx_ground" in name:
            candidates.append(obj)
    if not candidates:
        raise RuntimeError("No Ground mesh objects were found")
    return candidates


area, region, region_3d = find_view3d()
center = (region.width * 0.5, region.height * 0.5)
origin = view3d_utils.region_2d_to_origin_3d(region, region_3d, center)
direction = view3d_utils.region_2d_to_vector_3d(region, region_3d, center).normalized()

best = None
for obj in ground_objects():
    inv = obj.matrix_world.inverted()
    local_origin = inv @ origin
    local_direction = (inv.to_3x3() @ direction).normalized()
    hit, local_location, local_normal, face_index = obj.ray_cast(
        local_origin, local_direction, distance=100000.0
    )
    if not hit:
        continue
    world_location = obj.matrix_world @ local_location
    distance = (world_location - origin).dot(direction)
    if distance <= 0:
        continue
    if best is None or distance < best["distance"]:
        best = {
            "object": obj.name,
            "location": [float(v) for v in world_location],
            "normal": [
                float(v)
                for v in (obj.matrix_world.to_3x3() @ local_normal).normalized()
            ],
            "face_index": int(face_index),
            "distance": float(distance),
        }

if best is None:
    raise RuntimeError("The viewport-center ray did not hit any Ground mesh")

payload = {
    "status": "USER_CONFIRMED_VIEWPORT_CROSSHAIR_LOCATION",
    "viewport_area": {"width": area.width, "height": area.height},
    "viewport_region": {"width": region.width, "height": region.height},
    "ray_origin": [float(v) for v in origin],
    "ray_direction": [float(v) for v in direction],
    "ground_hit": best,
    "target_blender": {
        "x": best["location"][0],
        "y_ground": best["location"][1],
        "z": best["location"][2],
    },
    "note": "Captured from the center crosshair of the user's active Blender 3D viewport.",
}

OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"FUSION_CROSSHAIR_TARGET={OUTPUT_PATH}")
print(json.dumps(payload["target_blender"], ensure_ascii=False))
