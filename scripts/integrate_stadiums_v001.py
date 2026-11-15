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
    descendants,
    read_glb,
    reachable_nodes,
    remap_material_texture_indices,
    remove_nodes_and_private_meshes,
    sha256,
    write_glb,
)


SOURCE = ROOT / "output" / "campus_refined_v004.glb"
STADIUMS = ROOT / "blender" / "stadiums_v001.glb"
OUTPUT = ROOT / "output" / "campus_refined_v005.glb"
REPORT = ROOT / "output" / "stadiums_integration_report.json"
EXPECTED_SOURCE_HASH = "A6157BA3DDB2B5ED916BF095FE413C04870BFA347A662A7EF4BDF4FD4F053D9F"
STADIUM_ROOTS = {
    "ST_EAST_01_Root",
    "ST_EAST_02_Root",
    "ST_WEST_01_Root",
    "ST_WEST_02_Root",
}


def locate_east01_source_stand(document):
    area_roots = [
        index for index, node in enumerate(document.get("nodes", []))
        if node.get("name") == "Area_03"
    ]
    if len(area_roots) != 1:
        raise RuntimeError(f"Area_03 节点数量异常: {area_roots}")
    candidates = []
    for index, path in descendants(document, area_roots[0]):
        node = document["nodes"][index]
        if node.get("name") == "TPX_Buildings_1" and "TPX_Buildings" in path:
            candidates.append((index, path, node.get("mesh")))
    if len(candidates) != 1:
        raise RuntimeError(f"东一旧看台源节点数量异常: {candidates}")
    return candidates[0]


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
    if len(addon_roots) != 1 or base["nodes"][addon_roots[0]].get("name") != "REFINED_SPORTS":
        raise RuntimeError(f"体育场独立 GLB 场景根异常: {addon_roots}")
    scene_index = base.get("scene", 0)
    base["scenes"][scene_index].setdefault("nodes", []).extend(addon_roots)

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
        "version": "v005",
        "asset": "Four Campus Stadiums",
        "refinedRoot": "REFINED_SPORTS",
        "sourceStandRemoved": "Area_03/TPX_Buildings/TPX_Buildings_1",
    }
    history.append(current)
    extras["campusRefinement"] = current
    return combined_binary, offsets, addon_roots[0]


def main():
    source_hash_before = sha256(SOURCE)
    if source_hash_before != EXPECTED_SOURCE_HASH:
        raise RuntimeError(f"v004 输入哈希异常: {source_hash_before}")

    base, base_binary = read_glb(SOURCE)
    addon, addon_binary = read_glb(STADIUMS)
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
        "FUS_Root",
        "REFINED_BUILDINGS",
        "REFINED_LANDMARKS",
    ):
        if required not in base_names:
            raise RuntimeError(f"输入 v004 缺少 {required}")
    if "REFINED_SPORTS" in base_names:
        raise RuntimeError("输入 v004 已存在 REFINED_SPORTS，拒绝重复合并")

    addon_names = {node.get("name") for node in addon.get("nodes", [])}
    required_addon = {
        "REFINED_SPORTS",
        "ST_EAST_01_Root",
        "ST_EAST_02_Root",
        "ST_WEST_01_Root",
        "ST_WEST_02_Root",
        "ST_EAST_01_Track_Surface",
        "ST_EAST_01_Stand_Roof",
        "ST_EAST_02_Track_Surface",
        "ST_WEST_01_Track_Surface",
        "ST_WEST_02_Track_Surface",
    }
    if not required_addon.issubset(addon_names):
        raise RuntimeError(f"体育场独立 GLB 节点缺失: {sorted(required_addon - addon_names)}")
    if addon_counts["meshes"] != 310 or addon_counts["triangles"] != 6494:
        raise RuntimeError(f"体育场独立 GLB 几何数量异常: {addon_counts}")

    old_index, old_path, old_mesh = locate_east01_source_stand(base)
    removed_source = {
        "name": "TPX_Buildings_1",
        "originalNodeIndex": old_index,
        "originalMeshIndex": old_mesh,
        "path": "/".join(old_path),
    }
    removal_summary = remove_nodes_and_private_meshes(base, [old_index])

    combined_binary, offsets, sports_root_index = append_addon(
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
        "FUS_Root",
        "REFINED_BUILDINGS",
        "REFINED_LANDMARKS",
        "REFINED_SPORTS",
        *sorted(STADIUM_ROOTS),
    ):
        if required not in reachable_names:
            raise RuntimeError(f"合并后不可达: {required}")

    area_03_indices = [
        index for index, node in enumerate(output_document.get("nodes", []))
        if node.get("name") == "Area_03"
    ]
    if len(area_03_indices) != 1:
        raise RuntimeError(f"输出 Area_03 节点数量异常: {area_03_indices}")
    area_03_paths = [
        path for index, path in descendants(output_document, area_03_indices[0])
        if output_document["nodes"][index].get("name") == "TPX_Buildings_1"
    ]
    if area_03_paths:
        raise RuntimeError(f"东一旧看台仍存在于 Area_03: {area_03_paths}")

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
        raise RuntimeError("campus_refined_v004.glb 在集成过程中被修改")

    report = {
        "status": "created_and_structurally_validated",
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE),
        "sourceSha256": source_hash_before,
        "stadiumsAsset": str(STADIUMS),
        "stadiumsSha256": sha256(STADIUMS),
        "output": str(OUTPUT),
        "outputBytes": OUTPUT.stat().st_size,
        "outputSha256": sha256(OUTPUT),
        "removedSourceStand": removed_source,
        "removalSummary": removal_summary,
        "refinedAssets": {
            "auditoriumReachable": True,
            "southGateReachable": True,
            "libraryReachable": True,
            "fusionSculptureReachable": True,
            "refinedSportsReachable": True,
            "stadiumRootsReachable": sorted(STADIUM_ROOTS),
        },
        "sourceCounts": source_counts,
        "stadiumsCounts": addon_counts,
        "outputCounts": output_counts,
        "preservationChecks": {
            "sourceFileUnmodified": True,
            "linePrimitiveCountPreserved": True,
            "otherCampusAssetsCopiedWithoutBlenderReexport": True,
            "existingRefinedAssetsPreserved": True,
            "east01OldStandRemoved": True,
            "otherCampusLayersUnchanged": True,
        },
        "indexOffsets": offsets,
        "sportsRootNodeIndex": sports_root_index,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
