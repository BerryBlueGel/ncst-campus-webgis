import hashlib
import json
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "south_gate_working_v001_1.blend"
SOURCE = ROOT / "output" / "campus_refined_v001.glb"
REPORT = ROOT / "blender" / "south_gate_v001_1_validation.json"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def main():
    if Path(bpy.data.filepath).resolve() != BLEND.resolve():
        raise RuntimeError(f"打开的不是待验证文件: {bpy.data.filepath}")
    required = [
        "SOUTH_GATE_REFINED_ROOT", "SG_Tower_L", "SG_Tower_R", "SG_Beam_Main",
        "SG_Nameplate_R", "SG_Nameplate_Decal", "SG_Gate_Leaves", "SG_Base_Plaza",
    ]
    missing = [name for name in required if bpy.data.objects.get(name) is None]
    root = bpy.data.objects.get("SOUTH_GATE_REFINED_ROOT")
    decal = bpy.data.objects.get("SG_Nameplate_Decal")
    gate_objects = [obj for obj in bpy.context.scene.objects if obj.get("south_gate_blockout")]
    triangles = 0
    for obj in gate_objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
    packed_images = [image.name for image in bpy.data.images if image.packed_file]
    result = {
        "status": "passed" if not missing and packed_images else "failed",
        "blendOpened": True,
        "missingRequiredObjects": missing,
        "rootLocation": list(root.location) if root else None,
        "groundingMethod": root.get("grounding_method") if root else None,
        "heightSpreadMeters": root.get("grounding_height_spread_meters") if root else None,
        "nameplateText": decal.get("decal_text") if decal else None,
        "packedImages": packed_images,
        "gateMeshObjects": len([obj for obj in gate_objects if obj.type == "MESH"]),
        "gateTriangles": triangles,
        "sourceCampusSha256": sha256(SOURCE),
        "sourceCampusBytes": SOURCE.stat().st_size,
        "blendBytes": BLEND.stat().st_size,
        "collectionsPresent": {
            "REFINED_BUILDINGS": bpy.data.collections.get("REFINED_BUILDINGS") is not None,
            "SouthGate": bpy.data.collections.get("SouthGate") is not None,
        },
    }
    REPORT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["status"] != "passed":
        raise RuntimeError("南门 v001.1 校验失败")


if __name__ == "__main__":
    main()
