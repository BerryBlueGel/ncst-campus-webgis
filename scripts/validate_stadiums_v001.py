import hashlib
import json
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "stadiums_working_v001.blend"
BASE = ROOT / "output" / "campus_refined_v004.glb"
V005 = ROOT / "output" / "campus_refined_v005.glb"
REPORT = ROOT / "blender" / "stadiums_v001_validation.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "stadiums_v001"
EXPECTED_HASH = "A6157BA3DDB2B5ED916BF095FE413C04870BFA347A662A7EF4BDF4FD4F053D9F"
EXPECTED = {
    "ST_EAST_01": (1752.896, 904.499, 180.0, 99.6, 105.8, 69.0, 359.51),
    "ST_EAST_02": (1749.759, 1197.105, 179.7, 99.6, 105.4, 69.6, 359.22),
    "ST_WEST_01": (163.466, 688.631, 178.0, 102.4, 103.3, 70.8, 358.51),
    "ST_WEST_02": (139.800, 1024.177, 176.9, 102.3, 103.9, 69.4, 357.33),
}
REQUIRED_PREVIEWS = {
    "stadiums_all_top.png",
    "whole_campus_sports_view.png",
    "east_01_top.png",
    "east_02_top.png",
    "west_01_top.png",
    "west_02_top.png",
    "st_east_01_top.png",
    "st_east_02_top.png",
    "st_west_01_top.png",
    "st_west_02_top.png",
    "east_01_oblique.png",
    "east_01_mid.png",
    "east_stadiums_campus_view.png",
    "west_stadiums_campus_view.png",
}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def descendants(root):
    stack = list(root.children)
    result = []
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


bpy.ops.wm.open_mainfile(filepath=str(BLEND))
sports_root = bpy.data.objects.get("REFINED_SPORTS")
stadium_roots = {stadium_id: bpy.data.objects.get(f"{stadium_id}_Root") for stadium_id in EXPECTED}
all_descendants = descendants(sports_root) if sports_root else []
meshes = [obj for obj in all_descendants if obj.type == "MESH"]
triangle_count = sum(triangles(obj) for obj in meshes)
material_names = sorted({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material})

position_checks = {}
parameter_checks = {}
for stadium_id, values in EXPECTED.items():
    root = stadium_roots[stadium_id]
    x, z, track_length, track_width, pitch_length, pitch_width, orientation = values
    position_checks[stadium_id] = bool(root and abs(root.location.x - x) <= 0.0001 and abs(root.location.z - z) <= 0.0001)
    parameter_checks[stadium_id] = bool(
        root
        and abs(root.get("track_length_m", 0.0) - track_length) <= 0.001
        and abs(root.get("track_width_m", 0.0) - track_width) <= 0.001
        and abs(root.get("pitch_length_m", 0.0) - pitch_length) <= 0.001
        and abs(root.get("pitch_width_m", 0.0) - pitch_width) <= 0.001
        and abs(root.get("orientation_degrees", 0.0) - orientation) <= 0.001
    )

stand_objects = [obj.name for obj in all_descendants if "_Stand_" in obj.name]
other_stand_objects = [name for name in stand_objects if not name.startswith("ST_EAST_01_")]
preview_paths = {path.name: path for path in PREVIEW_DIR.glob("*.png")}
level_bases = [bpy.data.objects.get(f"{stadium_id}_LevelBase") for stadium_id in EXPECTED]
old_east01_stand = bpy.data.objects.get("TPX_Buildings_1.001")
positioned_roots = [obj for obj in all_descendants if obj.type == "EMPTY"]

checks = {
    "blend_opens": True,
    "refined_sports_root_exists": sports_root is not None,
    "four_stadium_roots_exist": all(root is not None for root in stadium_roots.values()),
    "all_positions_match": all(position_checks.values()),
    "all_parameters_match": all(parameter_checks.values()),
    "east01_track_exists": bpy.data.objects.get("ST_EAST_01_Track_Surface") is not None,
    "east02_track_exists": bpy.data.objects.get("ST_EAST_02_Track_Surface") is not None,
    "west01_track_exists": bpy.data.objects.get("ST_WEST_01_Track_Surface") is not None,
    "west02_track_exists": bpy.data.objects.get("ST_WEST_02_Track_Surface") is not None,
    "east01_roofed_stand_exists": bpy.data.objects.get("ST_EAST_01_Stand_Roof") is not None,
    "other_large_stands_absent": len(other_stand_objects) == 0,
    "four_leveling_bases_exist": all(obj is not None for obj in level_bases),
    "source_east01_stand_hidden_from_working_render": bool(old_east01_stand and old_east01_stand.hide_render),
    "all_sports_roots_within_campus_extent": all(
        -100.0 <= obj.matrix_world.translation.x <= 2100.0
        and -100.0 <= obj.matrix_world.translation.z <= 2100.0
        for obj in positioned_roots
    ),
    "triangle_budget_under_12000": triangle_count <= 12000,
    "shared_material_budget_under_12": len(material_names) <= 12,
    "all_required_previews_exist": REQUIRED_PREVIEWS.issubset(preview_paths) and all(preview_paths[name].stat().st_size > 0 for name in REQUIRED_PREVIEWS),
    "base_v004_hash_unchanged": sha256(BASE) == EXPECTED_HASH,
    "v005_not_created": not V005.exists(),
}

payload = {
    "status": "passed" if all(checks.values()) else "failed",
    "checksPassed": sum(1 for value in checks.values() if value),
    "checksTotal": len(checks),
    "checks": checks,
    "positionChecks": position_checks,
    "parameterChecks": parameter_checks,
    "meshCount": len(meshes),
    "triangleCount": triangle_count,
    "materialCount": len(material_names),
    "materials": material_names,
    "standObjects": sorted(stand_objects),
    "baseModelSha256": sha256(BASE),
    "integrationStatus": "NOT_INTEGRATED_NO_V005_CREATED",
    "previews": sorted(str(path) for path in preview_paths.values()),
}
REPORT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(payload, ensure_ascii=False, indent=2))
if not all(checks.values()):
    raise SystemExit(1)
