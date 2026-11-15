import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "output" / "campus_refined_v001.glb"
OUTPUT = ROOT / "blender" / "south_gate_working_v001.blend"
REPORT = ROOT / "blender" / "south_gate_v001_report.json"
REFERENCE = ROOT / "reference" / "south_gate" / "south_gate_reference.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "south_gate_v001"

ANCHOR_X = 981.0433
BOUNDARY_Z = 48.7847176175565
NORTH_OFFSET = 10.0
ROOT_Z = BOUNDARY_Z + NORTH_OFFSET


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def ensure_collection(name, parent=None):
    collection = bpy.data.collections.get(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
        if parent is None:
            bpy.context.scene.collection.children.link(collection)
        else:
            parent.children.link(collection)
    return collection


def ensure_material(name, color, metallic=0.0, roughness=0.65):
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.metallic = metallic
    material.roughness = roughness
    return material


def create_box(name, x_min, x_max, z_min, z_max, bottom_y, height,
               collection, material, color, parent):
    top_y = bottom_y - height
    vertices = [
        (x_min, bottom_y, z_min), (x_max, bottom_y, z_min),
        (x_max, bottom_y, z_max), (x_min, bottom_y, z_max),
        (x_min, top_y, z_min), (x_max, top_y, z_min),
        (x_max, top_y, z_max), (x_min, top_y, z_max),
    ]
    faces = [
        (0, 3, 2, 1), (4, 5, 6, 7),
        (0, 1, 5, 4), (1, 2, 6, 5),
        (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    obj.color = color
    obj.data.materials.append(material)
    obj["south_gate_blockout"] = True
    obj["provisional_geometry"] = True
    return obj


def create_cylinder(name, radius, depth, location, collection, material,
                    color, parent, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=(math.radians(90.0), 0.0, 0.0),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    for source_collection in list(obj.users_collection):
        source_collection.objects.unlink(obj)
    collection.objects.link(obj)
    obj.parent = parent
    obj.color = color
    obj.data.materials.append(material)
    obj["south_gate_blockout"] = True
    return obj


def ground_height_near(x, z, search_radius=90.0):
    best = None
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or "TPX_Ground" not in obj.name:
            continue
        matrix = obj.matrix_world
        for vertex in obj.data.vertices:
            world = matrix @ vertex.co
            dx = world.x - x
            dz = world.z - z
            distance_sq = dx * dx + dz * dz
            if distance_sq <= search_radius * search_radius:
                candidate = (distance_sq, world.y, obj.name, world.x, world.z)
                if best is None or candidate[0] < best[0]:
                    best = candidate
    if best is None:
        return 0.0, {"method": "fallback_zero", "reason": "no nearby TPX_Ground vertex"}
    return best[1], {
        "method": "nearest_world_space_ground_vertex",
        "distanceMeters": math.sqrt(best[0]),
        "object": best[2],
        "sampleWorld": [best[3], best[1], best[4]],
    }


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


def triangle_count(objects):
    total = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def main():
    if not SOURCE.exists():
        raise RuntimeError(f"缺少基础模型: {SOURCE}")
    source_hash_before = sha256(SOURCE)
    reference = json.loads(REFERENCE.read_text(encoding="utf-8"))
    missing_inputs = [
        path for path in reference["localInputs"].values()
        if not Path(path).exists()
    ]
    if missing_inputs:
        raise RuntimeError(f"南门定位所依赖的本地文件缺失: {missing_inputs}")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)

    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    scene = bpy.context.scene
    base_y, ground_sample = ground_height_near(ANCHOR_X, ROOT_Z)

    refined = ensure_collection("REFINED_BUILDINGS")
    south_gate = ensure_collection("SouthGate", refined)
    root = bpy.data.objects.new("SOUTH_GATE_REFINED_ROOT", None)
    south_gate.objects.link(root)
    root.location = (ANCHOR_X, base_y, ROOT_Z)
    root["asset"] = "NCST Caofeidian South Gate"
    root["status"] = "recognizable_webgis_v001"
    root["placement_method"] = "ceremonial axis boundary anchor plus 10m north setback"
    root["boundary_anchor_local_xy"] = [ANCHOR_X, BOUNDARY_Z]
    root["north_setback_meters"] = NORTH_OFFSET
    root["geometry_accuracy"] = "provisional photo-based blockout"

    stone = ensure_material("MAT_SouthGate_Stone", (0.72, 0.73, 0.72, 1.0), 0.05, 0.72)
    stone_light = ensure_material("MAT_SouthGate_StoneLight", (0.88, 0.88, 0.84, 1.0), 0.03, 0.78)
    dark = ensure_material("MAT_SouthGate_Dark", (0.055, 0.075, 0.08, 1.0), 0.2, 0.42)
    plaque = ensure_material("MAT_SouthGate_Plaque", (0.91, 0.91, 0.87, 1.0), 0.05, 0.65)
    metal = ensure_material("MAT_SouthGate_Metal", (0.25, 0.28, 0.29, 1.0), 0.55, 0.34)
    paving = ensure_material("MAT_SouthGate_Paving", (0.48, 0.49, 0.48, 1.0), 0.0, 0.9)

    created = []
    # 入口铺装和浅基座，跨越主轴但保持低复杂度。
    created.append(create_box("SG_Base_Plaza", -42.0, 42.0, -9.0, 11.0, 0.20, 0.35,
                              south_gate, paving, (0.48, 0.49, 0.48, 1.0), root))

    # 双侧高塔柱。南面为 -Z；高度沿 Blender -Y。
    tower_specs = [(-26.0, -18.0, "L"), (18.0, 26.0, "R")]
    for x_min, x_max, suffix in tower_specs:
        created.append(create_box(f"SG_Tower_{suffix}", x_min, x_max, -4.3, 4.3, 0.0, 24.0,
                                  south_gate, stone, (0.72, 0.73, 0.72, 1.0), root))
        # 面向南侧的深色竖向凹槽。
        recess_x_min = x_min + 1.25 if suffix == "L" else x_max - 3.05
        recess_x_max = recess_x_min + 1.8
        created.append(create_box(f"SG_Recess_{suffix}", recess_x_min, recess_x_max, -4.48, -4.27,
                                  -2.0, 19.6, south_gate, dark,
                                  (0.055, 0.075, 0.08, 1.0), root))
        # 少量水平挑出的石材分带，表达照片里的叠层，不逐块建石材。
        for index in range(5):
            lower = -3.0 - index * 4.0
            created.append(create_box(
                f"SG_StoneBand_{suffix}_{index + 1:02d}",
                x_min - 0.28, x_max + 0.28, -4.62, -4.34,
                lower, 0.48, south_gate, stone_light,
                (0.88, 0.88, 0.84, 1.0), root,
            ))

    # 横向门洞顶梁：保留较大净空，形成门楼主轮廓。
    created.append(create_box("SG_Beam_Main", -18.0, 18.0, -3.75, 3.75, -8.0, 3.4,
                              south_gate, stone_light, (0.88, 0.88, 0.84, 1.0), root))
    created.append(create_box("SG_Beam_DarkInset", -14.5, 14.5, -3.96, -3.73, -8.55, 2.0,
                              south_gate, dark, (0.055, 0.075, 0.08, 1.0), root))

    # 竖排校名牌先使用独立低面数面板；文字贴图留到下一版，避免错误字体或高面数文字。
    created.append(create_box("SG_Nameplate_R", 21.0, 24.2, -4.66, -4.43, -4.2, 13.8,
                              south_gate, plaque, (0.91, 0.91, 0.87, 1.0), root))
    root["nameplate_note"] = "v001 panel only; final vertical university name should use a transparent decal"

    # 简化伸缩门与侧向短墙。
    created.append(create_box("SG_Gate_Leaves", -15.8, 15.8, -1.0, -0.55, -0.35, 2.2,
                              south_gate, metal, (0.25, 0.28, 0.29, 1.0), root))
    for x in range(-15, 16, 3):
        created.append(create_box(f"SG_GateBar_{x:+03d}", x - 0.09, x + 0.09, -1.18, -0.40,
                                  -0.35, 2.2, south_gate, metal,
                                  (0.25, 0.28, 0.29, 1.0), root))
    created.append(create_box("SG_Fence_Ext_L", -43.0, -26.0, -1.8, 0.5, 0.0, 2.4,
                              south_gate, stone, (0.72, 0.73, 0.72, 1.0), root))
    created.append(create_box("SG_Fence_Ext_R", 26.0, 43.0, -1.8, 0.5, 0.0, 2.4,
                              south_gate, stone, (0.72, 0.73, 0.72, 1.0), root))

    # 低面数顶部标志杆，增强高塔柱的远景识别但不做灯具/监控细节。
    for x, suffix in [(-22.0, "L"), (22.0, "R")]:
        created.append(create_cylinder(
            f"SG_TopMarker_{suffix}", 0.24, 2.6,
            (x, -25.3, 0.0), south_gate, metal,
            (0.25, 0.28, 0.29, 1.0), root, vertices=8,
        ))

    scene["south_gate_status"] = "v001 recognizable WebGIS blockout"
    scene["south_gate_reference_files"] = json.dumps(reference["localInputs"], ensure_ascii=False)
    scene["gis_crs"] = "EPSG:32650"
    scene["coordinate_axes"] = "Blender X=east, Z=north, -Y=up"

    # 预览只保留周边地面/道路/绿地和新南门，避免整个校园遮挡主角。
    visibility = {}
    gate_names = {obj.name for obj in created} | {root.name}
    for obj in scene.objects:
        visibility[obj.name] = obj.hide_render
        keep_context = any(token in obj.name for token in ("TPX_Ground", "TPX_Roads", "TPX_GreenAreas"))
        obj.hide_render = not (obj.name in gate_names or keep_context)
        if "TPX_Ground" in obj.name:
            obj.color = (0.31, 0.33, 0.33, 1.0)
        elif "TPX_Roads" in obj.name:
            obj.color = (0.19, 0.21, 0.22, 1.0)
        elif "TPX_GreenAreas" in obj.name:
            obj.color = (0.12, 0.25, 0.14, 1.0)

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)

    camera_data = bpy.data.cameras.new("SG_Preview_Camera")
    camera = bpy.data.objects.new("SG_Preview_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.clip_start = 0.1
    camera.data.clip_end = 2500.0
    camera.hide_render = False
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    target = Vector((ANCHOR_X, base_y - 9.0, ROOT_Z))

    camera.data.type = "PERSP"
    camera.data.lens = 54.0
    camera.location = (ANCHOR_X, base_y - 12.0, ROOT_Z - 120.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "south.png")

    camera.location = (ANCHOR_X + 88.0, base_y - 34.0, ROOT_Z - 94.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "southeast_oblique.png")

    camera.location = (ANCHOR_X, base_y - 28.0, ROOT_Z + 140.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "campus_interior.png")

    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 125.0
    camera.location = (ANCHOR_X, base_y - 170.0, ROOT_Z)
    point_camera(camera, Vector((ANCHOR_X, base_y, ROOT_Z)), Vector((0.0, 0.0, 1.0)))
    context_objects = [
        obj for obj in scene.objects
        if any(token in obj.name for token in ("TPX_Ground", "TPX_Roads", "TPX_GreenAreas"))
    ]
    for obj in context_objects:
        obj.hide_render = True
    render(scene, camera, PREVIEW_DIR / "top.png", (1000, 1000))
    for obj in context_objects:
        obj.hide_render = False

    for obj in scene.objects:
        if obj.name in visibility:
            obj.hide_render = visibility[obj.name]
    camera.hide_render = True

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT), check_existing=False)

    source_hash_after = sha256(SOURCE)
    bounds = {
        "localX": [-43.0, 43.0],
        "localZ": [-9.0, 11.0],
        "heightMeters": 26.6,
        "worldX": [ANCHOR_X - 43.0, ANCHOR_X + 43.0],
        "worldZ": [ROOT_Z - 9.0, ROOT_Z + 11.0],
    }
    report = {
        "status": "created",
        "phase": "South Gate recognizable WebGIS v001",
        "inputModel": str(SOURCE),
        "outputBlend": str(OUTPUT),
        "sourceModelModified": source_hash_before != source_hash_after,
        "sourceSha256Before": source_hash_before,
        "sourceSha256After": source_hash_after,
        "referenceFilesUsed": reference["localInputs"],
        "placement": {
            "boundaryAnchorLocalXY": [ANCHOR_X, BOUNDARY_Z],
            "rootBlenderWorldXYZ": [ANCHOR_X, base_y, ROOT_Z],
            "northSetbackMeters": NORTH_OFFSET,
            "groundSample": ground_sample,
            "axes": {"east": "+X", "north": "+Z", "up": "-Y"},
        },
        "geometry": {
            "bounds": bounds,
            "meshObjects": len([obj for obj in created if obj.type == "MESH"]),
            "triangles": triangle_count(created),
            "features": [
                "paired 24m marker pylons",
                "light stone panel bands",
                "dark vertical recesses",
                "horizontal portal beam",
                "vertical nameplate panel for later decal",
                "simplified retractable gate and short side walls",
            ],
        },
        "notModeled": [
            "final university name decal", "guard rooms", "cameras", "lighting fixtures",
            "detailed stone joints", "accurate mechanical retractable gate", "landscape details",
        ],
        "previews": [
            str(PREVIEW_DIR / "south.png"),
            str(PREVIEW_DIR / "southeast_oblique.png"),
            str(PREVIEW_DIR / "campus_interior.png"),
            str(PREVIEW_DIR / "top.png"),
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
