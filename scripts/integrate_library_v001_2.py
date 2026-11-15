import copy
import hashlib
import json
import struct
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "output" / "campus_refined_v002.glb"
LIBRARY = ROOT / "blender" / "library_v001_2.glb"
OUTPUT = ROOT / "output" / "campus_refined_v003.glb"
REPORT = ROOT / "output" / "library_integration_report.json"

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


def count_triangles(document):
    total = 0
    accessors = document.get("accessors", [])
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            mode = primitive.get("mode", 4)
            if "indices" in primitive:
                count = accessors[primitive["indices"]].get("count", 0)
            else:
                position = primitive.get("attributes", {}).get("POSITION")
                count = accessors[position].get("count", 0) if position is not None else 0
            if mode == 4:
                total += count // 3
            elif mode in (5, 6):
                total += max(0, count - 2)
    return total


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


def descendants(document, root_index):
    stack = [(root_index, [document["nodes"][root_index].get("name", f"node_{root_index}")])]
    while stack:
        index, path = stack.pop()
        yield index, path
        for child in reversed(document["nodes"][index].get("children", [])):
            child_name = document["nodes"][child].get("name", f"node_{child}")
            stack.append((child, path + [child_name]))


def locate_library_sources(document):
    area_roots = [
        index for index, node in enumerate(document.get("nodes", []))
        if node.get("name") == "Area_01"
    ]
    if len(area_roots) != 1:
        raise RuntimeError(f"Area_01 节点数量异常: {area_roots}")
    found = {}
    for index, path in descendants(document, area_roots[0]):
        name = document["nodes"][index].get("name", "")
        if name in ("TPX_Buildings_47", "TPX_Buildings_48"):
            found[name] = (index, path)
    if set(found) != {"TPX_Buildings_47", "TPX_Buildings_48"}:
        raise RuntimeError(f"图书馆源节点异常: {found}")
    return found


def remove_nodes_and_private_meshes(document, target_indices):
    """Physically remove source nodes so importers cannot resurrect orphan nodes."""
    target_indices = set(target_indices)
    nodes = document.get("nodes", [])
    removed_meshes = {
        nodes[index]["mesh"] for index in target_indices if "mesh" in nodes[index]
    }
    for mesh_index in removed_meshes:
        users = [
            index for index, node in enumerate(nodes)
            if index not in target_indices and node.get("mesh") == mesh_index
        ]
        if users:
            raise RuntimeError(f"待删除 mesh {mesh_index} 仍被其他节点引用: {users}")

    node_map = {}
    compact_nodes = []
    for old_index, node in enumerate(nodes):
        if old_index in target_indices:
            continue
        node_map[old_index] = len(compact_nodes)
        compact_nodes.append(node)
    for node in compact_nodes:
        if "children" in node:
            node["children"] = [
                node_map[child] for child in node["children"] if child in node_map
            ]
    for scene in document.get("scenes", []):
        scene["nodes"] = [node_map[index] for index in scene.get("nodes", []) if index in node_map]
    for skin in document.get("skins", []):
        if "skeleton" in skin:
            skin["skeleton"] = node_map[skin["skeleton"]]
        skin["joints"] = [node_map[index] for index in skin.get("joints", [])]
    for animation in document.get("animations", []):
        for channel in animation.get("channels", []):
            target = channel.get("target", {})
            if "node" in target:
                target["node"] = node_map[target["node"]]
    document["nodes"] = compact_nodes

    meshes = document.get("meshes", [])
    mesh_map = {}
    compact_meshes = []
    for old_index, mesh in enumerate(meshes):
        if old_index in removed_meshes:
            continue
        mesh_map[old_index] = len(compact_meshes)
        compact_meshes.append(mesh)
    for node in compact_nodes:
        if "mesh" in node:
            node["mesh"] = mesh_map[node["mesh"]]
    document["meshes"] = compact_meshes
    return {
        "removedNodeIndices": sorted(target_indices),
        "removedMeshIndices": sorted(removed_meshes),
        "removedNodes": len(target_indices),
        "removedMeshes": len(removed_meshes),
    }


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
    library_group = len(base["nodes"])
    base["nodes"].append({"name": "Library", "children": addon_roots})

    reachable_before = reachable_nodes(base)
    refined_candidates = [
        index for index, node in enumerate(base.get("nodes", []))
        if node.get("name") == "REFINED_BUILDINGS" and index in reachable_before
    ]
    if len(refined_candidates) != 1:
        raise RuntimeError(f"可达 REFINED_BUILDINGS 数量异常: {refined_candidates}")
    refined_group = refined_candidates[0]
    base["nodes"][refined_group].setdefault("children", []).append(library_group)

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
        "version": "v003",
        "asset": "NCST Library",
        "removedSourceBuildings": [
            "Area_01/TPX_Buildings_47",
            "Area_01/TPX_Buildings_48",
        ],
        "refinedRoot": "REFINED_BUILDINGS/Library/LIBRARY_REFINED_ROOT",
    }
    history.append(current)
    extras["campusRefinement"] = current
    return combined_binary, offsets, refined_group, library_group


def main():
    source_hash_before = sha256(SOURCE)
    base, base_binary = read_glb(SOURCE)
    addon, addon_binary = read_glb(LIBRARY)
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
    node_names = {node.get("name") for node in base.get("nodes", [])}
    for required in ("AUDITORIUM_REFINED_ROOT", "SOUTH_GATE_REFINED_ROOT", "REFINED_BUILDINGS"):
        if required not in node_names:
            raise RuntimeError(f"输入 v002 缺少 {required}")
    addon_names = {node.get("name") for node in addon.get("nodes", [])}
    if "LIBRARY_REFINED_ROOT" not in addon_names:
        raise RuntimeError("独立图书馆 GLB 缺少 LIBRARY_REFINED_ROOT")

    sources = locate_library_sources(base)
    removed = {
        name: {"originalNodeIndex": index, "path": "/".join(path)}
        for name, (index, path) in sources.items()
    }
    removal_summary = remove_nodes_and_private_meshes(
        base, [index for index, _path in sources.values()]
    )

    combined_binary, offsets, refined_group, library_group = append_addon(
        base, addon, base_binary, addon_binary
    )
    write_glb(OUTPUT, base, combined_binary)

    output_document, _ = read_glb(OUTPUT)
    reachable = reachable_nodes(output_document)
    area_01_indices = [
        index for index, node in enumerate(output_document.get("nodes", []))
        if node.get("name") == "Area_01"
    ]
    if len(area_01_indices) != 1:
        raise RuntimeError(f"输出 Area_01 节点数量异常: {area_01_indices}")
    area_01_names = {
        output_document["nodes"][index].get("name")
        for index, _path in descendants(output_document, area_01_indices[0])
    }
    for name, info in removed.items():
        if name in area_01_names:
            raise RuntimeError(f"Area_01 旧图书馆源节点仍存在于 GLB: {name}")
        info["presentUnderArea01AfterIntegration"] = False
    required_reachable = {
        node.get("name") for index, node in enumerate(output_document.get("nodes", []))
        if index in reachable
    }
    for required in ("AUDITORIUM_REFINED_ROOT", "SOUTH_GATE_REFINED_ROOT", "LIBRARY_REFINED_ROOT", "REFINED_BUILDINGS"):
        if required not in required_reachable:
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
        raise RuntimeError("campus_refined_v002.glb 在集成过程中被修改")

    report = {
        "status": "created_and_structurally_validated",
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE),
        "sourceSha256": source_hash_before,
        "libraryAsset": str(LIBRARY),
        "librarySha256": sha256(LIBRARY),
        "output": str(OUTPUT),
        "outputBytes": OUTPUT.stat().st_size,
        "outputSha256": sha256(OUTPUT),
        "removedSourceBuildings": removed,
        "removalSummary": removal_summary,
        "refinedAssets": {
            "auditoriumReachable": True,
            "southGateReachable": True,
            "libraryReachable": True,
            "librarySceneRoot": "REFINED_BUILDINGS/Library/LIBRARY_REFINED_ROOT",
        },
        "sourceCounts": source_counts,
        "libraryCounts": addon_counts,
        "outputCounts": output_counts,
        "preservationChecks": {
            "sourceFileUnmodified": True,
            "linePrimitiveCountPreserved": True,
            "otherCampusAssetsCopiedWithoutBlenderReexport": True,
            "auditoriumPreserved": True,
            "southGatePreserved": True,
        },
        "indexOffsets": offsets,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
