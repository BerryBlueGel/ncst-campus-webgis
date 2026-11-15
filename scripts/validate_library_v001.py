import hashlib
import json
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "library_working_v001.blend"
SOURCE = ROOT / "output" / "campus_refined_v002.glb"
OUTPUT = ROOT / "blender" / "library_v001_validation.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "library_v001"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def main():
    required = [
        "LIBRARY_REFINED_ROOT", "LIB_Podium", "LIB_MainTower",
        "LIB_Wing_West", "LIB_Wing_East", "LIB_Entrance_Glass",
        "LIB_Roof_Main", "TPX_Buildings_48", "TPX_Buildings_47",
    ]
    missing = [name for name in required if bpy.data.objects.get(name) is None]
    library_objects = [obj for obj in bpy.data.objects if obj.get("library_blockout")]
    triangle_count = 0
    for obj in library_objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            triangle_count += len(obj.data.loop_triangles)

    root = bpy.data.objects.get("LIBRARY_REFINED_ROOT")
    source_main = bpy.data.objects.get("TPX_Buildings_48")
    source_low = bpy.data.objects.get("TPX_Buildings_47")
    previews = {
        name: PREVIEW_DIR / name
        for name in ("top.png", "south.png", "southeast_oblique.png", "campus_mid_distance.png")
    }
    result = {
        "status": "pass" if not missing else "fail",
        "blend": str(BLEND),
        "blenderVersion": bpy.app.version_string,
        "missingRequiredObjects": missing,
        "root": {
            "location": list(root.location) if root else None,
            "mainHeightMeters": root.get("main_height_meters") if root else None,
        },
        "sourceReferences": {
            "mainExists": source_main is not None,
            "mainHiddenFromRender": source_main.hide_render if source_main else None,
            "lowComplexExists": source_low is not None,
            "lowComplexHiddenFromRender": source_low.hide_render if source_low else None,
        },
        "blockout": {
            "meshCount": len([obj for obj in library_objects if obj.type == "MESH"]),
            "triangleCount": triangle_count,
            "xBraceCount": len([obj for obj in library_objects if obj.name.startswith("LIB_XBrace_")]),
            "facadeGridCount": len([obj for obj in library_objects if obj.name.startswith("LIB_Facade_Grid_")]),
        },
        "sourceCampus": {
            "path": str(SOURCE),
            "sha256": sha256(SOURCE),
            "expectedSha256": "F43A4DCA2F2D22C84951910384A182B128D84AE4AD43728902E9A4C074069E8B",
        },
        "previews": {
            name: {"path": str(path), "exists": path.exists(), "bytes": path.stat().st_size if path.exists() else 0}
            for name, path in previews.items()
        },
    }
    checks = [
        not missing,
        root is not None and abs(root.get("main_height_meters", 0.0) - 41.35) < 1e-6,
        source_main is not None and source_main.hide_render,
        source_low is not None and source_low.hide_render,
        result["sourceCampus"]["sha256"] == result["sourceCampus"]["expectedSha256"],
        all(item["exists"] and item["bytes"] > 10000 for item in result["previews"].values()),
    ]
    result["checksPassed"] = sum(bool(item) for item in checks)
    result["checksTotal"] = len(checks)
    result["status"] = "pass" if all(checks) else "fail"
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
