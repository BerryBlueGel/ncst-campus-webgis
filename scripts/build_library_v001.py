import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_refined_v002.glb"
BLEND_OUTPUT = ROOT / "blender" / "library_working_v001.blend"
REPORT_OUTPUT = ROOT / "blender" / "library_v001_report.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "library_v001"

SOURCE_MAIN = "TPX_Buildings_48"
SOURCE_LOW = "TPX_Buildings_47"
CENTER_X = 989.3003234863281
CENTER_Z = 556.8445434570312
MAIN_HEIGHT = 41.35


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def get_or_create_collection(name, parent=None):
    collection = bpy.data.collections.get(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
    if parent is None:
        if collection.name not in bpy.context.scene.collection.children:
            bpy.context.scene.collection.children.link(collection)
    elif collection.name not in parent.children:
        parent.children.link(collection)
    return collection


def material(name, color, metallic=0.0, roughness=0.65):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.metallic = metallic
    mat.roughness = roughness
    return mat


def mesh_object(name, vertices, faces, collection, mat, color, parent):
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    obj.color = color
    obj.data.materials.append(mat)
    obj["library_blockout"] = True
    obj["lod_stage"] = "LOD1_blockout"
    return obj


def box(name, x_min, x_max, z_min, z_max, base_y, height,
        collection, mat, color, parent):
    top_y = base_y - height
    vertices = [
        (x_min, base_y, z_min), (x_max, base_y, z_min),
        (x_max, base_y, z_max), (x_min, base_y, z_max),
        (x_min, top_y, z_min), (x_max, top_y, z_min),
        (x_max, top_y, z_max), (x_min, top_y, z_max),
    ]
    faces = [
        (0, 3, 2, 1), (4, 5, 6, 7),
        (0, 1, 5, 4), (1, 2, 6, 5),
        (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    return mesh_object(name, vertices, faces, collection, mat, color, parent)


def beam(name, start, end, width, depth, collection, mat, color, parent):
    midpoint = (Vector(start) + Vector(end)) * 0.5
    direction = Vector(end) - Vector(start)
    length = direction.length
    bpy.ops.mesh.primitive_cube_add(size=2.0, location=midpoint)
    obj = bpy.context.object
    obj.name = name
    for coll in list(obj.users_collection):
        coll.objects.unlink(obj)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = midpoint
    obj.rotation_euler = (0.0, 0.0, math.atan2(direction.y, direction.x))
    obj.scale = (length / 2.0, width / 2.0, depth / 2.0)
    obj.color = color
    obj.data.materials.append(mat)
    obj["library_blockout"] = True
    obj["lod_stage"] = "LOD1_blockout"
    return obj


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
    source_hash_before = sha256(MODEL)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(MODEL))
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB 导入失败: {result}")

    source_main = bpy.data.objects.get(SOURCE_MAIN)
    source_low = bpy.data.objects.get(SOURCE_LOW)
    if source_main is None or source_low is None:
        raise RuntimeError(f"缺少图书馆源对象: {SOURCE_MAIN}, {SOURCE_LOW}")

    for obj, role, color in (
        (source_main, "central_main_reference", (1.0, 0.22, 0.03, 1.0)),
        (source_low, "low_complex_reference", (0.08, 0.72, 0.24, 1.0)),
    ):
        obj["role"] = role
        obj.display_type = "WIRE"
        obj.color = color
        obj.hide_render = True

    refined_collection = get_or_create_collection("REFINED_BUILDINGS")
    library_collection = get_or_create_collection("Library", refined_collection)
    source_collection = get_or_create_collection("SOURCE_REFERENCE")
    for obj in (source_main, source_low):
        if obj.name not in source_collection.objects:
            source_collection.objects.link(obj)

    samples = {
        "center": (CENTER_X, CENTER_Z),
        "west": (CENTER_X - 70.0, CENTER_Z),
        "east": (CENTER_X + 70.0, CENTER_Z),
        "south": (CENTER_X, CENTER_Z - 28.0),
        "north": (CENTER_X, CENTER_Z + 28.0),
    }
    raycasts = {name: ground_raycast(x, z) for name, (x, z) in samples.items()}
    valid_heights = [hit["world"][1] for hit in raycasts.values() if hit]
    base_y = sum(valid_heights) / len(valid_heights) if valid_heights else 0.2986510396
    height_spread = max(valid_heights) - min(valid_heights) if valid_heights else None

    root = bpy.data.objects.new("LIBRARY_REFINED_ROOT", None)
    library_collection.objects.link(root)
    root.location = (CENTER_X, base_y, CENTER_Z)
    root["status"] = "blockout_v001"
    root["source_main"] = SOURCE_MAIN
    root["source_low_complex"] = SOURCE_LOW
    root["vertical_axis_note"] = "GIS height maps to Blender -Y"
    root["main_height_meters"] = MAIN_HEIGHT
    root["source_relationship"] = (
        "TPX_Buildings_48 is the central high block; TPX_Buildings_47 is a much "
        "larger low connected footprint. Both are preserved as source references."
    )

    beige_c = (0.78, 0.68, 0.52, 1.0)
    glass_c = (0.05, 0.20, 0.31, 1.0)
    orange_c = (0.72, 0.27, 0.08, 1.0)
    red_c = (0.46, 0.09, 0.045, 1.0)
    white_c = (0.92, 0.93, 0.91, 1.0)
    roof_c = (0.26, 0.29, 0.31, 1.0)
    stone_c = (0.62, 0.61, 0.56, 1.0)

    beige = material("MAT_Library_BeigeFrame", beige_c, roughness=0.62)
    glass = material("MAT_Library_BlueGlass", glass_c, metallic=0.10, roughness=0.25)
    orange = material("MAT_Library_OrangeBox", orange_c, roughness=0.55)
    red = material("MAT_Library_RedBase", red_c, roughness=0.65)
    white = material("MAT_Library_WhiteBrace", white_c, metallic=0.03, roughness=0.48)
    roof = material("MAT_Library_Roof", roof_c, metallic=0.08, roughness=0.65)
    stone = material("MAT_Library_Stairs", stone_c, roughness=0.82)

    objects = []
    # 整体基座与中央八层主楼。南为 local -Z，竖直向上为 local -Y。
    objects.append(box("LIB_Podium", -86.0, 86.0, -34.0, 31.0, 0.0, 5.5,
                       library_collection, red, red_c, root))
    objects.append(box("LIB_MainTower", -68.0, 68.0, -4.0, 30.0, -5.5, 35.85,
                       library_collection, glass, glass_c, root))
    objects.append(box("LIB_Wing_West", -86.0, -50.0, -26.0, 22.0, -5.5, 11.0,
                       library_collection, orange, orange_c, root))
    objects.append(box("LIB_Wing_East", 50.0, 86.0, -26.0, 22.0, -5.5, 11.0,
                       library_collection, orange, orange_c, root))
    objects.append(box("LIB_Entrance_Glass", -33.0, 33.0, -28.0, -4.1, -5.5, 12.5,
                       library_collection, glass, glass_c, root))
    objects.append(box("LIB_Entrance_Canopy", -39.0, 39.0, -32.0, -25.5, -17.5, 1.0,
                       library_collection, white, white_c, root))
    objects.append(box("LIB_Roof_Main", -69.0, 69.0, -5.0, 31.0, -41.35, 0.8,
                       library_collection, roof, roof_c, root))
    objects.append(box("LIB_Roof_West", -87.0, -49.0, -27.0, 23.0, -16.5, 0.55,
                       library_collection, roof, roof_c, root))
    objects.append(box("LIB_Roof_East", 49.0, 87.0, -27.0, 23.0, -16.5, 0.55,
                       library_collection, roof, roof_c, root))

    # 中央入口台阶，八级宽台阶足以表达远中景体量。
    stair_count = 8
    for index in range(stair_count):
        z_min = -34.0 + index * 1.15
        z_max = z_min + 1.25
        height = 0.22 * (index + 1)
        objects.append(box(
            f"LIB_Stairs_Center_{index + 1:02d}", -31.0, 31.0, z_min, z_max,
            0.0, height, library_collection, stone, stone_c, root,
        ))

    # 主楼南立面浅米框架：低密度重复，避免逐窗建模。
    facade_z0, facade_z1 = -4.75, -4.15
    for idx, x in enumerate([i for i in range(-64, 65, 8)], start=1):
        objects.append(box(
            f"LIB_Facade_Grid_V_{idx:02d}", x - 0.32, x + 0.32,
            facade_z0, facade_z1, -5.5, 35.0,
            library_collection, beige, beige_c, root,
        ))
    for idx, height in enumerate((10.0, 14.5, 19.0, 23.5, 28.0, 32.5, 37.0), start=1):
        objects.append(box(
            f"LIB_Facade_Grid_H_{idx:02d}", -68.5, 68.5,
            facade_z0 - 0.02, facade_z1 + 0.02, -height, 0.48,
            library_collection, beige, beige_c, root,
        ))

    # 入口上方五组白色 X 形带，是南立面的主要识别特征。
    x_band_min, x_band_max = -36.0, 36.0
    bay_count = 6
    bay_width = (x_band_max - x_band_min) / bay_count
    y_low, y_high = -19.0, -28.0
    brace_z = -5.15
    for idx in range(bay_count):
        x0 = x_band_min + idx * bay_width
        x1 = x0 + bay_width
        objects.append(beam(
            f"LIB_XBrace_A_{idx + 1:02d}", (x0, y_low, brace_z), (x1, y_high, brace_z),
            0.8, 0.55, library_collection, white, white_c, root,
        ))
        objects.append(beam(
            f"LIB_XBrace_B_{idx + 1:02d}", (x0, y_high, brace_z), (x1, y_low, brace_z),
            0.8, 0.55, library_collection, white, white_c, root,
        ))

    # 两侧橙色悬挑盒体与深色玻璃凹口。
    objects.append(box("LIB_Cantilever_West", -84.0, -48.0, -29.0, -16.0, -10.5, 7.0,
                       library_collection, orange, orange_c, root))
    objects.append(box("LIB_Cantilever_East", 48.0, 84.0, -29.0, -16.0, -10.5, 7.0,
                       library_collection, orange, orange_c, root))
    objects.append(box("LIB_GlassRecess_West", -80.0, -54.0, -29.4, -28.8, -6.2, 8.0,
                       library_collection, glass, glass_c, root))
    objects.append(box("LIB_GlassRecess_East", 54.0, 80.0, -29.4, -28.8, -6.2, 8.0,
                       library_collection, glass, glass_c, root))

    for obj in objects:
        obj["provisional_geometry"] = True

    scene = bpy.context.scene
    scene["library_status"] = "v001 low-detail white blockout; source campus preserved"
    scene["library_center_local_xz"] = [CENTER_X, CENTER_Z]
    scene["library_main_height_m"] = MAIN_HEIGHT
    scene["library_source_overlap_conclusion"] = root["source_relationship"]
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)

    refined_names = {obj.name for obj in objects} | {root.name}
    visibility = {}
    for obj in scene.objects:
        visibility[obj.name] = obj.hide_render
        context = any(token in obj.name for token in ("TPX_Ground", "TPX_Roads", "TPX_Waterways"))
        obj.hide_render = not (obj.name in refined_names or context)
        if "TPX_Ground" in obj.name:
            obj.color = (0.30, 0.32, 0.33, 1.0)
        elif "TPX_Roads" in obj.name:
            obj.color = (0.16, 0.17, 0.18, 1.0)
        elif "TPX_Waterways" in obj.name:
            obj.color = (0.05, 0.30, 0.48, 1.0)

    camera_data = bpy.data.cameras.new("LIB_Preview_Camera")
    camera = bpy.data.objects.new("LIB_Preview_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.clip_start = 0.1
    camera.data.clip_end = 3000.0
    camera.hide_render = False
    target = Vector((CENTER_X, base_y - 17.0, CENTER_Z))
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 225.0
    camera.location = (CENTER_X, base_y - 300.0, CENTER_Z)
    camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    render(scene, camera, PREVIEW_DIR / "top.png", (1100, 900))

    camera.data.type = "PERSP"
    camera.data.lens = 58.0
    camera.location = (CENTER_X, base_y - 32.0, CENTER_Z - 235.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "south.png")

    camera.location = (CENTER_X + 185.0, base_y - 92.0, CENTER_Z - 205.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "southeast_oblique.png")

    camera.location = (CENTER_X + 340.0, base_y - 165.0, CENTER_Z - 430.0)
    camera.data.lens = 72.0
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "campus_mid_distance.png")

    for obj in scene.objects:
        if obj.name in visibility:
            obj.hide_render = visibility[obj.name]
    camera.hide_render = True

    BLEND_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUTPUT), check_existing=False)

    triangle_count = sum(
        len(obj.data.loop_triangles) if obj.data.loop_triangles else 0
        for obj in objects if obj.type == "MESH"
    )
    # loop_triangles is lazy; calculate after save for a reliable count.
    triangle_count = 0
    for obj in objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            triangle_count += len(obj.data.loop_triangles)

    source_hash_after = sha256(MODEL)
    report = {
        "status": "created",
        "phase": "Library White Blockout v001",
        "inputModel": str(MODEL),
        "outputBlend": str(BLEND_OUTPUT),
        "sourceCampusModified": source_hash_before != source_hash_after,
        "sourceCampusSha256Before": source_hash_before,
        "sourceCampusSha256After": source_hash_after,
        "target": {
            "centerLocalXZ": [CENTER_X, CENTER_Z],
            "rootWorldXYZ": list(root.location),
            "mainHeightMeters": MAIN_HEIGHT,
            "sourceObjects": [SOURCE_MAIN, SOURCE_LOW],
            "relationship": root["source_relationship"],
        },
        "grounding": {
            "method": "five world-space raycasts against TPX_Ground triangles",
            "baseY": base_y,
            "heightSpreadMeters": height_spread,
            "samples": raycasts,
        },
        "model": {
            "meshObjectCount": len([obj for obj in objects if obj.type == "MESH"]),
            "triangleCount": triangle_count,
            "materialCount": 7,
            "scope": "low-detail exterior blockout for WebGIS mid-distance recognition",
        },
        "implemented": [
            "41.35m central eight-floor mass",
            "lower east and west wings",
            "south entrance and broad stairs",
            "beige low-density facade grid and blue glass",
            "white X-brace band",
            "orange cantilever boxes and red podium",
        ],
        "deferred": [
            "fine windows and terracotta panels",
            "interior",
            "roof equipment",
            "detailed north facade",
            "final replacement decision for source objects 47 and 48",
        ],
        "previews": {
            "top": str(PREVIEW_DIR / "top.png"),
            "south": str(PREVIEW_DIR / "south.png"),
            "southeastOblique": str(PREVIEW_DIR / "southeast_oblique.png"),
            "campusMidDistance": str(PREVIEW_DIR / "campus_mid_distance.png"),
        },
    }
    REPORT_OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
