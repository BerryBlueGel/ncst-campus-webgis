import hashlib
import json
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "library_working_v001_1.blend"
SOURCE = ROOT / "output" / "campus_refined_v002.glb"
OUTPUT = ROOT / "blender" / "library_v001_1_validation.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "library_v001_1"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def main():
    required = [
        "LIBRARY_REFINED_ROOT", "LIB_Podium_Complex", "LIB_MainTower",
        "LIB_Wing_West", "LIB_Wing_East", "LIB_Wing_West_South",
        "LIB_Wing_East_South", "LIB_Entrance_Glass", "TPX_Buildings_47",
        "TPX_Buildings_48",
    ]
    missing = [name for name in required if bpy.data.objects.get(name) is None]
    blockout = [obj for obj in bpy.data.objects if obj.get("library_blockout")]
    triangles = 0
    for obj in blockout:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)

    root = bpy.data.objects.get("LIBRARY_REFINED_ROOT")
    previews = [
        "source47_top.png", "source48_top.png", "source47_48_combined_top.png",
        "top.png", "south.png", "southeast_oblique.png", "campus_mid_distance.png",
    ]
    source_hash = sha256(SOURCE)
    expected_hash = "F43A4DCA2F2D22C84951910384A182B128D84AE4AD43728902E9A4C074069E8B"
    preview_status = {
        name: {
            "exists": (PREVIEW_DIR / name).exists(),
            "bytes": (PREVIEW_DIR / name).stat().st_size if (PREVIEW_DIR / name).exists() else 0,
        }
        for name in previews
    }
    checks = {
        "requiredObjects": not missing,
        "mainHeight": root is not None and abs(root.get("main_height_meters", 0.0) - 41.35) < 1e-6,
        "largeMassFlag": root is not None and "368m-wide" in root.get("volume_correction", ""),
        "source47Preserved": bpy.data.objects.get("TPX_Buildings_47") is not None and bpy.data.objects["TPX_Buildings_47"].hide_render,
        "source48Preserved": bpy.data.objects.get("TPX_Buildings_48") is not None and bpy.data.objects["TPX_Buildings_48"].hide_render,
        "sourceHash": source_hash == expected_hash,
        "previews": all(item["exists"] and item["bytes"] > 10000 for item in preview_status.values()),
    }
    report = {
        "status": "pass" if all(checks.values()) else "fail",
        "blend": str(BLEND),
        "blenderVersion": bpy.app.version_string,
        "checks": checks,
        "checksPassed": sum(bool(value) for value in checks.values()),
        "checksTotal": len(checks),
        "missingRequiredObjects": missing,
        "blockout": {
            "meshCount": len([obj for obj in blockout if obj.type == "MESH"]),
            "triangleCount": triangles,
            "xBraceCount": len([obj for obj in blockout if obj.name.startswith("LIB_XBrace_")]),
        },
        "sourceCampusSha256": source_hash,
        "previews": preview_status,
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
