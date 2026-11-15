import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
V001 = ROOT / "blender" / "south_gate_working_v001.blend"
V001_1 = ROOT / "blender" / "south_gate_working_v001_1.blend"
SOURCE = ROOT / "output" / "campus_refined_v001.glb"
DECAL = ROOT / "reference" / "south_gate" / "south_gate_nameplate.png"
REPORT = ROOT / "blender" / "south_gate_v001_1_report.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "south_gate_v001_1"

ANCHOR_X = 981.0433
ROOT_Z = 58.7847176175565


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
    hit, location, normal, face_index = obj.ray_cast(origin_local, direction_local, distance=max_distance)
    if not hit:
        return None
    world_location = obj.matrix_world @ location
    distance = (world_location - origin_world).length
    return {
        "object": obj.name,
        "faceIndex": face_index,
        "world": list(world_location),
        "distance": distance,
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
        raise RuntimeError(f"Ground raycast 未命中: X={x}, Z={z}")
    return min(hits, key=lambda item: item["distance"])


def create_decal_plane(collection, parent, image_path):
    name = "SG_Nameplate_Decal"
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    width = 2.50
    height = 12.50
    vertices = [
        (-width / 2, -height / 2, 0.0),
        (width / 2, -height / 2, 0.0),
        (width / 2, height / 2, 0.0),
        (-width / 2, height / 2, 0.0),
    ]
    mesh.from_pydata(vertices, [], [(0, 3, 2, 1)])
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    uv_by_vertex = {
        0: (0.0, 1.0),
        1: (1.0, 1.0),
        2: (1.0, 0.0),
        3: (0.0, 0.0),
    }
    for loop in mesh.loops:
        uv_layer.data[loop.index].uv = uv_by_vertex[loop.vertex_index]

    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = (22.60, -11.05, -4.695)
    obj["decal_text"] = "华北理工大学"
    obj["decal_source"] = str(image_path)
    obj["south_gate_blockout"] = True

    material = bpy.data.materials.get("MAT_SouthGate_NameplateDecal")
    if material is None:
        material = bpy.data.materials.new("MAT_SouthGate_NameplateDecal")
    material.use_nodes = True
    material.diffuse_color = (0.08, 0.15, 0.20, 1.0)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    image = bpy.data.images.load(str(image_path), check_existing=True)
    image.pack()
    texture.image = image
    shader.inputs["Roughness"].default_value = 0.55
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    try:
        material.surface_render_method = "DITHERED"
    except Exception:
        pass
    obj.data.materials.append(material)
    return obj


def point_camera(camera, target, world_up=Vector((0.0, -1.0, 0.0))):
    forward = (target - camera.location).normalized()
    right = forward.cross(world_up).normalized()
    corrected_up = right.cross(forward).normalized()
    camera.rotation_euler = Matrix((right, corrected_up, -forward)).transposed().to_euler()


def render(scene, camera, path, resolution=(1200, 900)):
    scene.camera = camera
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    if Path(bpy.data.filepath).resolve() != V001.resolve():
        raise RuntimeError(f"必须从南门 v001 打开执行，当前文件: {bpy.data.filepath}")
    if not DECAL.exists():
        raise RuntimeError(f"缺少校名贴图: {DECAL}")

    source_hash_before = sha256(SOURCE)
    root = bpy.data.objects.get("SOUTH_GATE_REFINED_ROOT")
    collection = bpy.data.collections.get("SouthGate")
    if root is None or collection is None:
        raise RuntimeError("v001 缺少南门根节点或 Collection")

    sample_positions = {
        "leftTower": (ANCHOR_X - 22.0, ROOT_Z),
        "portalCenter": (ANCHOR_X, ROOT_Z),
        "rightTower": (ANCHOR_X + 22.0, ROOT_Z),
    }
    raycasts = {
        key: ground_raycast(x, z)
        for key, (x, z) in sample_positions.items()
    }
    heights = [hit["world"][1] for hit in raycasts.values()]
    height_spread = max(heights) - min(heights)
    if height_spread <= 0.10:
        corrected_y = sum(heights) / len(heights)
        ground_policy = "kept horizontal at mean of three raycast hits"
    else:
        corrected_y = raycasts["portalCenter"]["world"][1]
        ground_policy = "kept horizontal at center raycast because spread exceeded 0.10m"
    previous_y = root.location.y
    root.location.y = corrected_y
    root["grounding_method"] = "three world-space raycasts against TPX_Ground triangles"
    root["grounding_samples"] = json.dumps(raycasts, ensure_ascii=False)
    root["grounding_height_spread_meters"] = height_spread
    root["grounding_policy"] = ground_policy

    old_decal = bpy.data.objects.get("SG_Nameplate_Decal")
    if old_decal:
        bpy.data.objects.remove(old_decal, do_unlink=True)
    decal_obj = create_decal_plane(collection, root, DECAL)

    scene = bpy.context.scene
    scene["south_gate_status"] = "v001.1 grounded and labeled"
    scene["south_gate_grounding"] = ground_policy
    scene["south_gate_nameplate"] = "transparent packed PNG decal"

    visibility = {}
    gate_names = {
        obj.name for obj in collection.all_objects
        if obj.name.startswith("SG_") or obj.name == root.name
    }
    for obj in scene.objects:
        visibility[obj.name] = obj.hide_render
        context = any(token in obj.name for token in ("TPX_Ground", "TPX_Roads", "TPX_GreenAreas"))
        obj.hide_render = not (obj.name in gate_names or context)
        if "TPX_Ground" in obj.name:
            obj.color = (0.31, 0.33, 0.33, 1.0)
        elif "TPX_Roads" in obj.name:
            obj.color = (0.19, 0.21, 0.22, 1.0)
        elif "TPX_GreenAreas" in obj.name:
            obj.color = (0.12, 0.25, 0.14, 1.0)

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)

    camera = bpy.data.objects.get("SG_Preview_Camera")
    if camera is None:
        camera_data = bpy.data.cameras.new("SG_Preview_Camera")
        camera = bpy.data.objects.new("SG_Preview_Camera", camera_data)
        scene.collection.objects.link(camera)
    camera.hide_render = False
    camera.data.type = "PERSP"
    camera.data.clip_start = 0.1
    camera.data.clip_end = 2500.0
    camera.data.lens = 54.0
    target = Vector((ANCHOR_X, corrected_y - 9.0, ROOT_Z))
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    camera.location = (ANCHOR_X, corrected_y - 12.0, ROOT_Z - 120.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "south.png")

    camera.location = (ANCHOR_X + 88.0, corrected_y - 34.0, ROOT_Z - 94.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "southeast_oblique.png")

    camera.location = (ANCHOR_X, corrected_y - 28.0, ROOT_Z + 140.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "campus_interior.png")

    camera.data.lens = 72.0
    camera.location = (ANCHOR_X + 170.0, corrected_y - 95.0, ROOT_Z - 265.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "mid_distance.png")

    for obj in scene.objects:
        if obj.name in visibility:
            obj.hide_render = visibility[obj.name]
    camera.hide_render = True

    bpy.ops.wm.save_as_mainfile(filepath=str(V001_1), check_existing=False)
    source_hash_after = sha256(SOURCE)
    report = {
        "status": "created",
        "phase": "South Gate v001.1 grounding and label pass",
        "inputBlend": str(V001),
        "outputBlend": str(V001_1),
        "v001Preserved": True,
        "sourceCampusModified": source_hash_before != source_hash_after,
        "sourceCampusSha256Before": source_hash_before,
        "sourceCampusSha256After": source_hash_after,
        "grounding": {
            "previousRootY": previous_y,
            "correctedRootY": corrected_y,
            "samples": raycasts,
            "heightSpreadMeters": height_spread,
            "policy": ground_policy,
        },
        "nameplate": {
            "object": decal_obj.name,
            "text": "华北理工大学",
            "asset": str(DECAL),
            "assetPackedIntoBlend": True,
            "geometry": "single 2-triangle decal plane",
            "side": "right tower south face only",
        },
        "previews": [
            str(PREVIEW_DIR / "south.png"),
            str(PREVIEW_DIR / "southeast_oblique.png"),
            str(PREVIEW_DIR / "campus_interior.png"),
            str(PREVIEW_DIR / "mid_distance.png"),
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
