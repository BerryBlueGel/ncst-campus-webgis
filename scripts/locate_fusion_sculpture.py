import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_refined_v003.glb"
OUTPUT = ROOT / "reference" / "sculptures" / "fusion_ground_probe.json"

# Manually selected from the circular landmark node at the south end of
# 博学广场 in the georeferenced campus plan. This is a plan-derived candidate,
# not a surveyed coordinate.
ANCHOR_X = 992.5923964337298
ANCHOR_Z = 362.7571699554929


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def raycast_object_world(obj, origin_world, direction_world, max_distance=2000.0):
    inverse = obj.matrix_world.inverted()
    origin_local = inverse @ origin_world
    direction_local = (inverse.to_3x3() @ direction_world).normalized()
    hit, location, normal, face_index = obj.ray_cast(
        origin_local, direction_local, distance=max_distance
    )
    if not hit:
        return None
    world_location = obj.matrix_world @ location
    return {
        "object": obj.name,
        "faceIndex": face_index,
        "world": list(world_location),
        "distance": (world_location - origin_world).length,
    }


def ground_raycast(x, z):
    origin = Vector((x, -500.0, z))
    direction = Vector((0.0, 1.0, 0.0))
    hits = []
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and "TPX_Ground" in obj.name:
            hit = raycast_object_world(obj, origin, direction)
            if hit:
                hits.append(hit)
    if not hits:
        return None
    return min(hits, key=lambda item: item["distance"])


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(MODEL))

    samples = {
        "center": (ANCHOR_X, ANCHOR_Z),
        "west": (ANCHOR_X - 3.0, ANCHOR_Z),
        "east": (ANCHOR_X + 3.0, ANCHOR_Z),
        "south": (ANCHOR_X, ANCHOR_Z - 3.0),
        "north": (ANCHOR_X, ANCHOR_Z + 3.0),
    }
    hits = {name: ground_raycast(x, z) for name, (x, z) in samples.items()}
    valid_y = [hit["world"][1] for hit in hits.values() if hit]

    report = {
        "status": "passed" if len(valid_y) == len(samples) else "partial",
        "baseModel": str(MODEL),
        "baseModelSha256": sha256(MODEL),
        "candidateAnchorBlenderXZ": [ANCHOR_X, ANCHOR_Z],
        "method": "five world-space raycasts against TPX_Ground triangles",
        "samples": hits,
        "groundYMean": sum(valid_y) / len(valid_y) if valid_y else None,
        "groundYSpread": max(valid_y) - min(valid_y) if valid_y else None,
        "note": "Candidate X/Z is derived from the georeferenced campus plan and must be visually checked against the four user photographs before integration.",
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
