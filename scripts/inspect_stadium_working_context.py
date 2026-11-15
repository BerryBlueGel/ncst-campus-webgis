import json
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "stadiums_working_v001.blend"
OUTPUT = ROOT / "blender" / "stadiums_v001_context_diagnostic.json"


def raycast_object_world(obj, origin_world, direction_world, max_distance=2000.0):
    inverse = obj.matrix_world.inverted()
    origin_local = inverse @ origin_world
    direction_local = (inverse.to_3x3() @ direction_world).normalized()
    try:
        hit, location, normal, face_index = obj.ray_cast(origin_local, direction_local, distance=max_distance)
    except RuntimeError:
        return None
    if not hit:
        return None
    world = obj.matrix_world @ location
    return {"object": obj.name, "world": list(world), "distance": (world - origin_world).length}


def source_hits(x, z):
    origin = Vector((x, -500.0, z))
    direction = Vector((0.0, 1.0, 0.0))
    hits = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("ST_"):
            continue
        hit = raycast_object_world(obj, origin, direction)
        if hit:
            hits.append(hit)
    return sorted(hits, key=lambda item: item["distance"])[:12]


def bbox_contains_xz(obj, x, z, margin=1.0):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        min(point.x for point in corners) - margin <= x <= max(point.x for point in corners) + margin
        and min(point.z for point in corners) - margin <= z <= max(point.z for point in corners) + margin
    )


bpy.ops.wm.open_mainfile(filepath=str(BLEND))
points = {
    "east01_center": (1752.896, 904.499),
    "east01_north": (1752.896, 986.0),
    "east01_south": (1752.896, 823.0),
    "east02_center": (1749.759, 1197.105),
    "west01_center": (163.466, 688.631),
    "west02_center": (139.8, 1024.177),
    "east01_stand_center": (1671.5875, 897.121),
}
payload = {"sourceHits": {name: source_hits(*point) for name, point in points.items()}}
stand_x, stand_z = points["east01_stand_center"]
payload["east01StandOverlaps"] = []
for obj in bpy.context.scene.objects:
    if obj.type == "MESH" and not obj.name.startswith("ST_") and bbox_contains_xz(obj, stand_x, stand_z):
        payload["east01StandOverlaps"].append(obj.name)
payload["east01StandOverlaps"].sort()
OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(payload, ensure_ascii=False, indent=2))
