import hashlib
import json
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "fusion_sculpture_working_v001.blend"
BASE = ROOT / "output" / "campus_refined_v003.glb"
REPORT = ROOT / "blender" / "fusion_sculpture_v001_validation.json"
EXPECTED_X = 992.5923964337298
EXPECTED_Z = 362.7571699554929
PLANAR_TOLERANCE_METERS = 0.00005


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


bpy.ops.wm.open_mainfile(filepath=str(BLEND))

root = bpy.data.objects.get("FUS_Root")
guides = sorted(obj.name for obj in bpy.data.objects if obj.name.startswith("FUS_Guide_"))
ribbons = sorted(obj.name for obj in bpy.data.objects if obj.name.startswith("FUS_Ribbon_"))
solid_names = ribbons + ["FUS_Base", "FUS_LandscapeRing"]
solid_objects = [bpy.data.objects.get(name) for name in solid_names]

checks = {
    "blend_opens": True,
    "root_exists": root is not None,
    "planar_location_exact": bool(
        root
        and abs(root.location.x - EXPECTED_X) <= PLANAR_TOLERANCE_METERS
        and abs(root.location.z - EXPECTED_Z) <= PLANAR_TOLERANCE_METERS
    ),
    "placement_status": bool(
        root and root.get("placement_status") == "USER_CONFIRMED_VIEWPORT_CROSSHAIR_LOCATION"
    ),
    "planar_position_locked": bool(root and root.get("planar_position_locked") is True),
    "five_editable_guides": len(guides) == 5,
    "five_ribbon_meshes": len(ribbons) == 5,
    "base_and_landscape_exist": all(obj is not None for obj in solid_objects[-2:]),
    "triangle_budget_under_8000": sum(
        triangles(obj) for obj in solid_objects if obj and obj.type == "MESH"
    )
    <= 8000,
    "source_v003_hash_unchanged": sha256(BASE)
    == "D6360C33C9604EAA8E1546AE370B40ED58540AE54E17C01FFB62410C6504A786",
}

payload = {
    "status": "passed" if all(checks.values()) else "failed",
    "checksPassed": sum(1 for value in checks.values() if value),
    "checksTotal": len(checks),
    "checks": checks,
    "rootBlenderXYZ": list(root.location) if root else None,
    "planarPositionErrorMeters": {
        "x": abs(root.location.x - EXPECTED_X) if root else None,
        "z": abs(root.location.z - EXPECTED_Z) if root else None,
        "tolerance": PLANAR_TOLERANCE_METERS,
    },
    "guideObjects": guides,
    "ribbonObjects": ribbons,
    "triangleCount": sum(
        triangles(obj) for obj in solid_objects if obj and obj.type == "MESH"
    ),
    "baseModelSha256": sha256(BASE),
    "integrationStatus": "NOT_INTEGRATED_NO_V004_CREATED",
}

REPORT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(payload, ensure_ascii=False))
if not all(checks.values()):
    raise SystemExit(1)
