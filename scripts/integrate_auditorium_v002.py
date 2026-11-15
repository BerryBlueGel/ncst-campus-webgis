import copy
import hashlib
import json
import struct
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "output" / "campus_cropped.glb"
AUDITORIUM = ROOT / "blender" / "auditorium_v002.glb"
OUTPUT = ROOT / "output" / "campus_refined_v001.glb"
REPORT = ROOT / "output" / "campus_refined_v001_report.json"

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


def descendants(document, root_index):
    stack = [(root_index, [document["nodes"][root_index].get("name", f"node_{root_index}")])]
    while stack:
        index, path = stack.pop()
        yield index, path
        for child in reversed(document["nodes"][index].get("children", [])):
            child_name = document["nodes"][child].get("name", f"node_{child}")
            stack.append((child, path + [child_name]))


def locate_source_node(document):
    area_roots = [
        index for index, node in enumerate(document.get("nodes", []))
        if node.get("name") == "Area_02"
    ]
    if len(area_roots) != 1:
        raise RuntimeError(f"Area_02 节点数量异常: {area_roots}")
    candidates = []
    for index, path in descendants(document, area_roots[0]):
        if document["nodes"][index].get("name", "").startswith("TPX_Buildings_14"):
            candidates.append((index, path))
    if len(candidates) != 1:
        raise RuntimeError(f"Area_02 原会堂候选数量异常: {candidates}")
    return candidates[0]


def detach_node(document, target_index):
    parents = []
    for parent_index, node in enumerate(document.get("nodes", [])):
        children = node.get("children", [])
        if target_index in children:
            node["children"] = [child for child in children if child != target_index]
            parents.append(parent_index)
    for scene_index, scene in enumerate(document.get("scenes", [])):
        roots = scene.get("nodes", [])
        if target_index in roots:
            scene["nodes"] = [node for node in roots if node != target_index]
            parents.append(f"scene:{scene_index}")
    if not parents:
        raise RuntimeError("原会堂节点没有挂接在场景树中")
    return parents


def remap_texture_info(value, texture_offset):
    if isinstance(value, dict):
        if "index" in value and any(key in value for key in ("texCoord", "extensions", "scale", "strength")):
            value["index"] += texture_offset
        for child in value.values():
            remap_texture_info(child, texture_offset)
    elif isinstance(value, list):
        for child in value:
            remap_texture_info(child, texture_offset)


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
        remap_texture_info(material, offsets["textures"])
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
    auditorium_group = len(base["nodes"])
    base["nodes"].append({"name": "Auditorium", "children": addon_roots})
    refined_group = len(base["nodes"])
    base["nodes"].append({"name": "REFINED_BUILDINGS", "children": [auditorium_group]})
    base_scene_index = base.get("scene", 0)
    base["scenes"][base_scene_index].setdefault("nodes", []).append(refined_group)

    base.setdefault("buffers", [{"byteLength": 0}])
    base["buffers"][0]["byteLength"] = len(combined_binary)
    base["extensionsUsed"] = sorted(set(base.get("extensionsUsed", [])) | set(addon.get("extensionsUsed", [])))
    if not base["extensionsUsed"]:
        base.pop("extensionsUsed", None)
    base["extensionsRequired"] = sorted(set(base.get("extensionsRequired", [])) | set(addon.get("extensionsRequired", [])))
    if not base["extensionsRequired"]:
        base.pop("extensionsRequired", None)
    base["asset"]["generator"] = "Campus direct-GLB integration (source-preserving)"
    base.setdefault("extras", {})["campusRefinement"] = {
        "version": "v001",
        "building": "NCST Auditorium",
        "sourceBuildingDetached": "Area_02/TPX_Buildings_14",
        "refinedRoot": "REFINED_BUILDINGS/Auditorium",
    }
    return combined_binary, offsets, refined_group


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


def main():
    source_hash_before = sha256(SOURCE)
    base, base_binary = read_glb(SOURCE)
    addon, addon_binary = read_glb(AUDITORIUM)
    source_counts = {
        "nodes": len(base.get("nodes", [])),
        "meshes": len(base.get("meshes", [])),
        "materials": len(base.get("materials", [])),
        "accessors": len(base.get("accessors", [])),
        "bufferViews": len(base.get("bufferViews", [])),
        "primitiveModes": count_primitive_modes(base),
    }
    addon_counts = {
        "nodes": len(addon.get("nodes", [])),
        "meshes": len(addon.get("meshes", [])),
        "materials": len(addon.get("materials", [])),
        "primitiveModes": count_primitive_modes(addon),
    }

    target_index, target_path = locate_source_node(base)
    detached_from = detach_node(base, target_index)
    combined_binary, offsets, refined_group = append_addon(base, addon, base_binary, addon_binary)
    write_glb(OUTPUT, base, combined_binary)

    output_document, _ = read_glb(OUTPUT)
    reachable = reachable_nodes(output_document)
    output_counts = {
        "nodes": len(output_document.get("nodes", [])),
        "reachableNodes": len(reachable),
        "meshes": len(output_document.get("meshes", [])),
        "materials": len(output_document.get("materials", [])),
        "accessors": len(output_document.get("accessors", [])),
        "bufferViews": len(output_document.get("bufferViews", [])),
        "primitiveModes": count_primitive_modes(output_document),
    }

    if target_index in reachable:
        raise RuntimeError("原会堂节点仍可从场景访问")
    if refined_group not in reachable:
        raise RuntimeError("精修会堂根节点未挂接到场景")
    if output_counts["primitiveModes"].get("1", 0) != source_counts["primitiveModes"].get("1", 0):
        raise RuntimeError("原模型 LINE primitive 数量发生变化")
    if sha256(SOURCE) != source_hash_before:
        raise RuntimeError("原始 campus_cropped.glb 在集成过程中被修改")

    report = {
        "status": "created_and_structurally_validated",
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE),
        "sourceSha256": source_hash_before,
        "auditoriumAsset": str(AUDITORIUM),
        "auditoriumSha256": sha256(AUDITORIUM),
        "output": str(OUTPUT),
        "outputSha256": sha256(OUTPUT),
        "sourceBuilding": {
            "nodeIndex": target_index,
            "path": "/".join(target_path),
            "detachedFrom": detached_from,
            "reachableAfterIntegration": False,
            "note": "Source node and mesh payload remain orphaned for index stability but are not part of the exported scene tree.",
        },
        "refinedBuilding": {
            "sceneRoot": "REFINED_BUILDINGS/Auditorium/AUDITORIUM_REFINED_ROOT",
            "reachable": True,
        },
        "sourceCounts": source_counts,
        "auditoriumCounts": addon_counts,
        "outputCounts": output_counts,
        "preservationChecks": {
            "sourceFileUnmodified": True,
            "linePrimitiveCountPreserved": True,
            "otherCampusAssetsCopiedWithoutBlenderReexport": True,
        },
        "indexOffsets": offsets,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
