import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from integrate_library_v001_2 import (  # noqa: E402
    count_primitive_modes,
    count_triangles,
    reachable_nodes,
    read_glb,
    remap_material_texture_indices,
    sha256,
    write_glb,
)


SOURCE = ROOT / "output" / "campus_refined_v003.glb"
SCULPTURE = ROOT / "blender" / "fusion_sculpture_v001.glb"
OUTPUT = ROOT / "output" / "campus_refined_v004.glb"
REPORT = ROOT / "output" / "fusion_sculpture_integration_report.json"
EXPECTED_SOURCE_HASH = "D6360C33C9604EAA8E1546AE370B40ED58540AE54E17C01FFB62410C6504A786"


def append_addon(base, addon, base_binary, addon_binary):
    if len(base.get("buffers", [])) != 1 or len(addon.get("buffers", [])) != 1:
        raise RuntimeError("当前合并器仅支持每个 GLB 一个内嵌 buffer")

    offsets = {
        "accessors": len(base.get("accessors", [])),
        "bufferViews": len(base.get("bufferViews", [])),
        "materials": len(base.get("materials", [])),
        "meshes": len(base.get("meshes", [])),
        "nodes": len(base.get("nodes", [])),
        "textures": len(base.get("textures", [])),
        "images": len(base.get("images", [])),
        "samplers": len(base.get("samplers", [])),
        "cameras": len(base.get("cameras", [])),
        "skins": len(base.get("skins", [])),
    }
    binary_offset = (len(base_binary) + 3) & ~3
    combined_binary = base_binary + b"\x00" * (binary_offset - len(base_binary)) + addon_binary

    for view in copy.deepcopy(addon.get("bufferViews", [])):
        view["buffer"] = 0
        view["byteOffset"] = view.get("byteOffset", 0) + binary_offset
        base.setdefault("bufferViews", []).append(view)
    for accessor in copy.deepcopy(addon.get("accessors", [])):
        if "bufferView" in accessor:
            accessor["bufferView"] += offsets["bufferViews"]
        sparse = accessor.get("sparse")
        if sparse:
            sparse["indices"]["bufferView"] += offsets["bufferViews"]
            sparse["values"]["bufferView"] += offsets["bufferViews"]
        base.setdefault("accessors", []).append(accessor)
    for sampler in copy.deepcopy(addon.get("samplers", [])):
        base.setdefault("samplers", []).append(sampler)
    for image in copy.deepcopy(addon.get("images", [])):
        if "bufferView" in image:
            image["bufferView"] += offsets["bufferViews"]
        base.setdefault("images", []).append(image)
    for texture in copy.deepcopy(addon.get("textures", [])):
        if "sampler" in texture:
            texture["sampler"] += offsets["samplers"]
        if "source" in texture:
            texture["source"] += offsets["images"]
        base.setdefault("textures", []).append(texture)
    for material in copy.deepcopy(addon.get("materials", [])):
        remap_material_texture_indices(material, offsets["textures"])
        base.setdefault("materials", []).append(material)
    for mesh in copy.deepcopy(addon.get("meshes", [])):
        for primitive in mesh.get("primitives", []):
            if "indices" in primitive:
                primitive["indices"] += offsets["accessors"]
            primitive["attributes"] = {
                semantic: accessor + offsets["accessors"]
                for semantic, accessor in primitive.get("attributes", {}).items()
            }
            if "material" in primitive:
                primitive["material"] += offsets["materials"]
            for target in primitive.get("targets", []):
                for semantic in list(target):
                    target[semantic] += offsets["accessors"]
        base.setdefault("meshes", []).append(mesh)
    for camera in copy.deepcopy(addon.get("cameras", [])):
        base.setdefault("cameras", []).append(camera)
    for skin in copy.deepcopy(addon.get("skins", [])):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] += offsets["accessors"]
        if "skeleton" in skin:
            skin["skeleton"] += offsets["nodes"]
        skin["joints"] = [joint + offsets["nodes"] for joint in skin.get("joints", [])]
        base.setdefault("skins", []).append(skin)
    for node in copy.deepcopy(addon.get("nodes", [])):
        if "mesh" in node:
            node["mesh"] += offsets["meshes"]
        if "camera" in node:
            node["camera"] += offsets["cameras"]
        if "skin" in node:
            node["skin"] += offsets["skins"]
        if "children" in node:
            node["children"] = [child + offsets["nodes"] for child in node["children"]]
        base.setdefault("nodes", []).append(node)
    for animation in copy.deepcopy(addon.get("animations", [])):
        for sampler in animation.get("samplers", []):
            sampler["input"] += offsets["accessors"]
            sampler["output"] += offsets["accessors"]
        for channel in animation.get("channels", []):
            target = channel.get("target", {})
            if "node" in target:
                target["node"] += offsets["nodes"]
        base.setdefault("animations", []).append(animation)

    addon_scene_index = addon.get("scene", 0)
    addon_roots = [
        node + offsets["nodes"]
        for node in addon["scenes"][addon_scene_index].get("nodes", [])
    ]
    sculpture_group = len(base["nodes"])
    base["nodes"].append({"name": "FusionSculpture", "children": addon_roots})

    reachable_before = reachable_nodes(base)
    landmark_candidates = [
        index for index, node in enumerate(base.get("nodes", []))
        if node.get("name") == "REFINED_LANDMARKS" and index in reachable_before
    ]
    if len(landmark_candidates) > 1:
        raise RuntimeError(f"可达 REFINED_LANDMARKS 数量异常: {landmark_candidates}")
    if landmark_candidates:
        landmarks_group = landmark_candidates[0]
    else:
        landmarks_group = len(base["nodes"])
        base["nodes"].append({"name": "REFINED_LANDMARKS", "children": []})
        scene_index = base.get("scene", 0)
        base["scenes"][scene_index].setdefault("nodes", []).append(landmarks_group)
    base["nodes"][landmarks_group].setdefault("children", []).append(sculpture_group)

    base.setdefault("buffers", [{"byteLength": 0}])
    base["buffers"][0]["byteLength"] = len(combined_binary)
    base["extensionsUsed"] = sorted(
        set(base.get("extensionsUsed", [])) | set(addon.get("extensionsUsed", []))
    )
    if not base["extensionsUsed"]:
        base.pop("extensionsUsed", None)
    base["extensionsRequired"] = sorted(
        set(base.get("extensionsRequired", [])) | set(addon.get("extensionsRequired", []))
    )
    if not base["extensionsRequired"]:
        base.pop("extensionsRequired", None)

    base["asset"]["generator"] = "Campus direct-GLB integration (source-preserving)"
    extras = base.setdefault("extras", {})
    previous = copy.deepcopy(extras.get("campusRefinement"))
    history = extras.setdefault("campusRefinementHistory", [])
    if previous and previous not in history:
        history.append(previous)
    current = {
        "version": "v004",
        "asset": "Fusion Sculpture",
        "placementStatus": "USER_CONFIRMED_VIEWPORT_CROSSHAIR_LOCATION",
        "refinedRoot": "REFINED_LANDMARKS/FusionSculpture/FUS_Root",
    }
    history.append(current)
    extras["campusRefinement"] = current
    return combined_binary, offsets, landmarks_group, sculpture_group


def main():
    source_hash_before = sha256(SOURCE)
    if source_hash_before != EXPECTED_SOURCE_HASH:
        raise RuntimeError(f"v003 输入哈希异常: {source_hash_before}")

    base, base_binary = read_glb(SOURCE)
    addon, addon_binary = read_glb(SCULPTURE)
    source_counts = {
        "nodes": len(base.get("nodes", [])),
        "meshes": len(base.get("meshes", [])),
        "materials": len(base.get("materials", [])),
        "triangles": count_triangles(base),
        "primitiveModes": count_primitive_modes(base),
    }
    addon_counts = {
        "nodes": len(addon.get("nodes", [])),
        "meshes": len(addon.get("meshes", [])),
        "materials": len(addon.get("materials", [])),
        "triangles": count_triangles(addon),
        "primitiveModes": count_primitive_modes(addon),
    }

    base_names = {node.get("name") for node in base.get("nodes", [])}
    for required in (
        "AUDITORIUM_REFINED_ROOT",
        "SOUTH_GATE_REFINED_ROOT",
        "LIBRARY_REFINED_ROOT",
        "REFINED_BUILDINGS",
    ):
        if required not in base_names:
            raise RuntimeError(f"输入 v003 缺少 {required}")
    if "FUS_Root" in base_names or "FusionSculpture" in base_names:
        raise RuntimeError("输入 v003 已存在融合雕塑节点，拒绝重复合并")

    addon_names = {node.get("name") for node in addon.get("nodes", [])}
    expected_addon = {
        "FUS_Root",
        "FUS_Base",
        "FUS_LandscapeRing",
        "FUS_Ribbon_01_WarmFront",
        "FUS_Ribbon_02_DarkOuterRight",
        "FUS_Ribbon_03_DarkOuterLeft",
        "FUS_Ribbon_04_DarkInner",
        "FUS_Ribbon_05_WarmInner",
    }
    if not expected_addon.issubset(addon_names):
        raise RuntimeError(f"雕塑独立 GLB 节点缺失: {sorted(expected_addon - addon_names)}")
    if any(name.startswith("FUS_Guide_") for name in addon_names):
        raise RuntimeError("雕塑独立 GLB 错误包含导向曲线")

    combined_binary, offsets, landmarks_group, sculpture_group = append_addon(
        base, addon, base_binary, addon_binary
    )
    write_glb(OUTPUT, base, combined_binary)

    output_document, _ = read_glb(OUTPUT)
    reachable = reachable_nodes(output_document)
    reachable_names = {
        node.get("name")
        for index, node in enumerate(output_document.get("nodes", []))
        if index in reachable
    }
    for required in (
        "AUDITORIUM_REFINED_ROOT",
        "SOUTH_GATE_REFINED_ROOT",
        "LIBRARY_REFINED_ROOT",
        "REFINED_BUILDINGS",
        "REFINED_LANDMARKS",
        "FusionSculpture",
        "FUS_Root",
    ):
        if required not in reachable_names:
            raise RuntimeError(f"合并后不可达: {required}")

    output_counts = {
        "nodes": len(output_document.get("nodes", [])),
        "reachableNodes": len(reachable),
        "meshes": len(output_document.get("meshes", [])),
        "materials": len(output_document.get("materials", [])),
        "triangles": count_triangles(output_document),
        "primitiveModes": count_primitive_modes(output_document),
    }
    if output_counts["primitiveModes"].get("1", 0) != source_counts["primitiveModes"].get("1", 0):
        raise RuntimeError("原模型 LINE primitive 数量发生变化")
    if sha256(SOURCE) != source_hash_before:
        raise RuntimeError("campus_refined_v003.glb 在集成过程中被修改")

    report = {
        "status": "created_and_structurally_validated",
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE),
        "sourceSha256": source_hash_before,
        "sculptureAsset": str(SCULPTURE),
        "sculptureSha256": sha256(SCULPTURE),
        "output": str(OUTPUT),
        "outputBytes": OUTPUT.stat().st_size,
        "outputSha256": sha256(OUTPUT),
        "refinedAssets": {
            "auditoriumReachable": True,
            "southGateReachable": True,
            "libraryReachable": True,
            "fusionSculptureReachable": True,
            "fusionSculptureSceneRoot": "REFINED_LANDMARKS/FusionSculpture/FUS_Root",
        },
        "sourceCounts": source_counts,
        "sculptureCounts": addon_counts,
        "outputCounts": output_counts,
        "preservationChecks": {
            "sourceFileUnmodified": True,
            "linePrimitiveCountPreserved": True,
            "otherCampusAssetsCopiedWithoutBlenderReexport": True,
            "auditoriumPreserved": True,
            "southGatePreserved": True,
            "libraryPreserved": True,
        },
        "placement": {
            "status": "USER_CONFIRMED_VIEWPORT_CROSSHAIR_LOCATION",
            "lockedBlenderXZ": [992.5923964337298, 362.7571699554929],
            "workingRootY": 0.752911376953125,
        },
        "indexOffsets": offsets,
        "landmarksNodeIndex": landmarks_group,
        "sculptureGroupNodeIndex": sculpture_group,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
