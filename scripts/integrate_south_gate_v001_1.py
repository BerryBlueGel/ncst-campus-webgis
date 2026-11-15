import copy
import hashlib
import json
import struct
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "output" / "campus_refined_v001.glb"
SOUTH_GATE = ROOT / "blender" / "south_gate_v001_1.glb"
CONFLICT_REPORT = ROOT / "blender" / "south_gate_conflict_candidates.json"
OUTPUT = ROOT / "output" / "campus_refined_v002.glb"
REPORT = ROOT / "output" / "south_gate_integration_report.json"

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def read_glb(path):
    data = path.read_bytes()
    magic, version, declared_length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or declared_length != len(data):
        raise RuntimeError(f"无效 GLB: {path}")
    offset = 12
    chunks = {}
    while offset < len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunks[chunk_type] = data[offset:offset + length]
        offset += length
    if JSON_CHUNK not in chunks or BIN_CHUNK not in chunks:
        raise RuntimeError(f"GLB 缺少 JSON/BIN chunk: {path}")
    document = json.loads(chunks[JSON_CHUNK].decode("utf-8").rstrip(" \t\r\n\x00"))
    return document, chunks[BIN_CHUNK]


def write_glb(path, document, binary):
    json_bytes = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    binary += b"\x00" * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    payload = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    payload += struct.pack("<II", len(json_bytes), JSON_CHUNK)
    payload += json_bytes
    payload += struct.pack("<II", len(binary), BIN_CHUNK)
    payload += binary
    path.write_bytes(payload)


def count_primitive_modes(document):
    counts = {}
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            mode = primitive.get("mode", 4)
            counts[str(mode)] = counts.get(str(mode), 0) + 1
    return counts


def reachable_nodes(document):
    scene_index = document.get("scene", 0)
    roots = document["scenes"][scene_index].get("nodes", [])
    seen = set()
    stack = list(roots)
    while stack:
        index = stack.pop()
        if index in seen:
            continue
        seen.add(index)
        stack.extend(document["nodes"][index].get("children", []))
    return seen


def remap_material_texture_indices(value, texture_offset, parent_key=None):
    if isinstance(value, dict):
        if parent_key and parent_key.lower().endswith("texture") and "index" in value:
            value["index"] += texture_offset
        for key, child in value.items():
            remap_material_texture_indices(child, texture_offset, key)
    elif isinstance(value, list):
        for child in value:
            remap_material_texture_indices(child, texture_offset, parent_key)


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
    addon_roots = [node + offsets["nodes"] for node in addon["scenes"][addon_scene_index].get("nodes", [])]
    south_gate_group = len(base["nodes"])
    base["nodes"].append({"name": "SouthGate", "children": addon_roots})

    reachable_before = reachable_nodes(base)
    refined_candidates = [
        index for index, node in enumerate(base.get("nodes", []))
        if node.get("name") == "REFINED_BUILDINGS" and index in reachable_before
    ]
    if len(refined_candidates) != 1:
        raise RuntimeError(f"现有 REFINED_BUILDINGS 可达节点数量异常: {refined_candidates}")
    refined_group = refined_candidates[0]
    base["nodes"][refined_group].setdefault("children", []).append(south_gate_group)

    base.setdefault("buffers", [{"byteLength": 0}])
    base["buffers"][0]["byteLength"] = len(combined_binary)
    base["extensionsUsed"] = sorted(set(base.get("extensionsUsed", [])) | set(addon.get("extensionsUsed", [])))
    if not base["extensionsUsed"]:
        base.pop("extensionsUsed", None)
    base["extensionsRequired"] = sorted(set(base.get("extensionsRequired", [])) | set(addon.get("extensionsRequired", [])))
    if not base["extensionsRequired"]:
        base.pop("extensionsRequired", None)
    base["asset"]["generator"] = "Campus direct-GLB integration (source-preserving)"
    extras = base.setdefault("extras", {})
    previous = copy.deepcopy(extras.get("campusRefinement"))
    history = extras.setdefault("campusRefinementHistory", [])
    if previous and previous not in history:
        history.append(previous)
    current = {
        "version": "v002",
        "asset": "NCST South Gate",
        "conflictingSourceBuildingDetached": False,
        "refinedRoot": "REFINED_BUILDINGS/SouthGate/SOUTH_GATE_REFINED_ROOT",
    }
    history.append(current)
    extras["campusRefinement"] = current
    return combined_binary, offsets, refined_group, south_gate_group


def main():
    conflict = json.loads(CONFLICT_REPORT.read_text(encoding="utf-8"))
    if conflict["candidateCount"] != 0:
        raise RuntimeError(f"南门范围仍有待人工确认的旧建筑: {conflict['buildingConflictCandidates']}")
    source_hash_before = sha256(SOURCE)
    base, base_binary = read_glb(SOURCE)
    addon, addon_binary = read_glb(SOUTH_GATE)
    source_counts = {
        "nodes": len(base.get("nodes", [])),
        "meshes": len(base.get("meshes", [])),
        "materials": len(base.get("materials", [])),
        "images": len(base.get("images", [])),
        "textures": len(base.get("textures", [])),
        "primitiveModes": count_primitive_modes(base),
    }
    addon_counts = {
        "nodes": len(addon.get("nodes", [])),
        "meshes": len(addon.get("meshes", [])),
        "materials": len(addon.get("materials", [])),
        "images": len(addon.get("images", [])),
        "textures": len(addon.get("textures", [])),
        "primitiveModes": count_primitive_modes(addon),
    }
    if addon_counts["images"] < 1 or addon_counts["textures"] < 1:
        raise RuntimeError("南门独立 GLB 未包含校名贴图")
    if not any(node.get("name") == "AUDITORIUM_REFINED_ROOT" for node in base.get("nodes", [])):
        raise RuntimeError("输入 campus_refined_v001.glb 缺少精修会堂")

    combined_binary, offsets, refined_group, south_gate_group = append_addon(
        base, addon, base_binary, addon_binary
    )
    write_glb(OUTPUT, base, combined_binary)

    output_document, _ = read_glb(OUTPUT)
    reachable = reachable_nodes(output_document)
    if refined_group not in reachable or south_gate_group not in reachable:
        raise RuntimeError("南门未正确挂接到正式校园场景")
    if not any(
        node.get("name") == "AUDITORIUM_REFINED_ROOT" and index in reachable
        for index, node in enumerate(output_document.get("nodes", []))
    ):
        raise RuntimeError("会堂在南门集成后不可达")
    if not any(
        node.get("name") == "SOUTH_GATE_REFINED_ROOT" and index in reachable
        for index, node in enumerate(output_document.get("nodes", []))
    ):
        raise RuntimeError("南门根节点在输出场景中不可达")
    output_counts = {
        "nodes": len(output_document.get("nodes", [])),
        "reachableNodes": len(reachable),
        "meshes": len(output_document.get("meshes", [])),
        "materials": len(output_document.get("materials", [])),
        "images": len(output_document.get("images", [])),
        "textures": len(output_document.get("textures", [])),
        "primitiveModes": count_primitive_modes(output_document),
    }
    if output_counts["primitiveModes"].get("1", 0) != source_counts["primitiveModes"].get("1", 0):
        raise RuntimeError("原模型 LINE primitive 数量发生变化")
    if sha256(SOURCE) != source_hash_before:
        raise RuntimeError("campus_refined_v001.glb 在集成过程中被修改")

    report = {
        "status": "created_and_structurally_validated",
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE),
        "sourceSha256": source_hash_before,
        "southGateAsset": str(SOUTH_GATE),
        "southGateSha256": sha256(SOUTH_GATE),
        "output": str(OUTPUT),
        "outputSha256": sha256(OUTPUT),
        "oldSouthGateConflict": {
            "buildingCandidates": [],
            "objectsDetached": [],
            "reason": "No TPX_Buildings geometry overlaps the verified south gate footprint.",
        },
        "refinedAssets": {
            "auditoriumStillReachable": True,
            "southGateSceneRoot": "REFINED_BUILDINGS/SouthGate/SOUTH_GATE_REFINED_ROOT",
            "southGateReachable": True,
            "nameplateTextureEmbedded": True,
        },
        "sourceCounts": source_counts,
        "southGateCounts": addon_counts,
        "outputCounts": output_counts,
        "preservationChecks": {
            "sourceFileUnmodified": True,
            "linePrimitiveCountPreserved": True,
            "otherCampusAssetsCopiedWithoutBlenderReexport": True,
            "auditoriumPreserved": True,
        },
        "indexOffsets": offsets,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
