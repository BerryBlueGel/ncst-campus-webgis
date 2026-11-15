import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_library_v001 as base


MODEL = ROOT / "output" / "campus_refined_v002.glb"
BLEND_OUTPUT = ROOT / "blender" / "library_working_v001_1.blend"
REPORT_OUTPUT = ROOT / "blender" / "library_v001_1_report.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "library_v001_1"

SOURCE_MAIN = "TPX_Buildings_48"
SOURCE_LOW = "TPX_Buildings_47"
CENTER_X = 989.3003234863281
CENTER_Z = 556.8445434570312
MAIN_HEIGHT = 41.35


def source_mesh_as_prism(source, name, height, collection, mat, color, parent):
    world_vertices = [source.matrix_world @ vertex.co for vertex in source.data.vertices]
    old_base = max(vertex.y for vertex in world_vertices)
    old_top = min(vertex.y for vertex in world_vertices)
    old_height = old_base - old_top
    vertices = []
    for vertex in world_vertices:
        ratio = (old_base - vertex.y) / old_height if old_height else 0.0
        vertices.append((
            vertex.x - CENTER_X,
            -height * ratio,
            vertex.z - CENTER_Z,
        ))
    faces = [tuple(poly.vertices) for poly in source.data.polygons]
    obj = base.mesh_object(name, vertices, faces, collection, mat, color, parent)
    obj["derived_from_source"] = source.name
    obj["source_world_height"] = old_height
    obj["revised_height"] = height
    return obj


def prepare_source_reference(obj, role, color):
    obj["role"] = role
    obj.display_type = "WIRE"
    obj.color = color
    obj.hide_render = True


def set_preview_visibility(scene, include_names, mode):
    visibility = {obj.name: obj.hide_render for obj in scene.objects}
    for obj in scene.objects:
        ground = "TPX_Ground" in obj.name
        roads = "TPX_Roads" in obj.name
        water = "TPX_Waterways" in obj.name
        obj.hide_render = not (obj.name in include_names or ground or roads or water)
        if ground:
            obj.color = (0.30, 0.32, 0.33, 1.0)
        elif roads:
            obj.color = (0.16, 0.17, 0.18, 1.0)
        elif water:
            obj.color = (0.05, 0.30, 0.48, 1.0)
    scene.display.shading.color_type = mode
    return visibility


def restore_visibility(scene, visibility):
    for obj in scene.objects:
        if obj.name in visibility:
            obj.hide_render = visibility[obj.name]


def main():
    source_hash_before = base.sha256(MODEL)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(MODEL))
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB 导入失败: {result}")

    source_main = bpy.data.objects.get(SOURCE_MAIN)
    source_low = bpy.data.objects.get(SOURCE_LOW)
    if source_main is None or source_low is None:
        raise RuntimeError("缺少 TPX_Buildings_47 或 TPX_Buildings_48")
    prepare_source_reference(source_main, "library_central_main_reference", (1.0, 0.24, 0.03, 1.0))
    prepare_source_reference(source_low, "library_large_low_complex_reference", (0.05, 0.70, 0.22, 1.0))

    refined_collection = base.get_or_create_collection("REFINED_BUILDINGS")
    library_collection = base.get_or_create_collection("Library", refined_collection)
    source_collection = base.get_or_create_collection("SOURCE_REFERENCE")
    for obj in (source_main, source_low):
        if obj.name not in source_collection.objects:
            source_collection.objects.link(obj)

    center_hit = base.ground_raycast(CENTER_X, CENTER_Z)
    if center_hit is None:
        raise RuntimeError("图书馆中心 Ground 射线未命中")
    base_y = center_hit["world"][1]

    sample_points = {
        "center": (CENTER_X, CENTER_Z),
        "west": (CENTER_X - 170.0, CENTER_Z - 30.0),
        "east": (CENTER_X + 170.0, CENTER_Z - 30.0),
        "southWest": (CENTER_X - 120.0, CENTER_Z - 95.0),
        "southCenter": (CENTER_X, CENTER_Z - 95.0),
        "southEast": (CENTER_X + 120.0, CENTER_Z - 95.0),
        "northWest": (CENTER_X - 120.0, CENTER_Z + 25.0),
        "northEast": (CENTER_X + 120.0, CENTER_Z + 25.0),
    }
    raycasts = {name: base.ground_raycast(x, z) for name, (x, z) in sample_points.items()}
    valid_heights = [hit["world"][1] for hit in raycasts.values() if hit]
    spread = max(valid_heights) - min(valid_heights) if valid_heights else None

    root = bpy.data.objects.new("LIBRARY_REFINED_ROOT", None)
    library_collection.objects.link(root)
    root.location = (CENTER_X, base_y, CENTER_Z)
    root["status"] = "blockout_v001_1_large_integrated_mass"
    root["main_height_meters"] = MAIN_HEIGHT
    root["source_main"] = SOURCE_MAIN
    root["source_low_complex"] = SOURCE_LOW
    root["vertical_axis_note"] = "GIS height maps to Blender -Y"
    root["volume_correction"] = (
        "v001.1 treats TPX_Buildings_47 and 48 as one 368m-wide continuous "
        "library complex, rather than a tower with two small detached boxes."
    )

    beige_c = (0.79, 0.69, 0.53, 1.0)
    glass_c = (0.045, 0.18, 0.29, 1.0)
    orange_c = (0.74, 0.28, 0.08, 1.0)
    red_c = (0.48, 0.085, 0.04, 1.0)
    white_c = (0.93, 0.94, 0.92, 1.0)
    roof_c = (0.25, 0.28, 0.30, 1.0)
    stone_c = (0.62, 0.61, 0.56, 1.0)

    beige = base.material("MAT_Library_BeigeFrame", beige_c, roughness=0.62)
    glass = base.material("MAT_Library_BlueGlass", glass_c, metallic=0.10, roughness=0.25)
    orange = base.material("MAT_Library_OrangeBox", orange_c, roughness=0.55)
    red = base.material("MAT_Library_RedBase", red_c, roughness=0.65)
    white = base.material("MAT_Library_WhiteBrace", white_c, metallic=0.03, roughness=0.48)
    roof = base.material("MAT_Library_Roof", roof_c, metallic=0.08, roughness=0.65)
    stone = base.material("MAT_Library_Stairs", stone_c, roughness=0.82)

    objects = []
    # 直接采用源对象47的完整平面形状，建立连续的6米低层基座。
    objects.append(source_mesh_as_prism(
        source_low, "LIB_Podium_Complex", 6.0,
        library_collection, red, red_c, root,
    ))
    # 直接采用源对象48的高层平面形状，只校正为工程资料中的41.35米。
    objects.append(source_mesh_as_prism(
        source_main, "LIB_MainTower", MAIN_HEIGHT,
        library_collection, glass, glass_c, root,
    ))

    # 两座大裙楼覆盖47号对象的东西主体范围，并通过连续基座与主楼相连。
    objects.append(base.box(
        "LIB_Wing_West", -179.0, -52.0, -78.0, 14.0, -6.0, 12.5,
        library_collection, orange, orange_c, root,
    ))
    objects.append(base.box(
        "LIB_Wing_East", 52.0, 179.0, -78.0, 14.0, -6.0, 12.5,
        library_collection, orange, orange_c, root,
    ))
    # 南侧两座大体量继续向入口广场展开，形成品字形整体，而非小附属盒子。
    objects.append(base.box(
        "LIB_Wing_West_South", -139.0, -25.0, -105.0, -66.0, -6.0, 7.5,
        library_collection, orange, orange_c, root,
    ))
    objects.append(base.box(
        "LIB_Wing_East_South", 25.0, 139.0, -105.0, -66.0, -6.0, 7.5,
        library_collection, orange, orange_c, root,
    ))
    objects.append(base.box(
        "LIB_Entrance_Glass", -52.0, 52.0, -70.0, -35.0, -6.0, 13.0,
        library_collection, glass, glass_c, root,
    ))
    objects.append(base.box(
        "LIB_Entrance_Canopy", -62.0, 62.0, -75.0, -67.0, -18.0, 1.1,
        library_collection, white, white_c, root,
    ))

    # 大尺度入口台阶，占据中央入口横向约100米。
    stair_count = 10
    for index in range(stair_count):
        z_min = -106.0 + index * 3.55
        z_max = z_min + 3.65
        height = 0.20 * (index + 1)
        objects.append(base.box(
            f"LIB_Stairs_Center_{index + 1:02d}", -50.0, 50.0,
            z_min, z_max, 0.0, height,
            library_collection, stone, stone_c, root,
        ))

    # 中央高层南立面的框架与X形带。
    facade_z0, facade_z1 = -35.75, -35.15
    for idx, x in enumerate(range(-80, 81, 10), start=1):
        objects.append(base.box(
            f"LIB_Facade_Grid_V_{idx:02d}", x - 0.36, x + 0.36,
            facade_z0, facade_z1, -6.0, 34.5,
            library_collection, beige, beige_c, root,
        ))
    for idx, height in enumerate((10.0, 14.5, 19.0, 23.5, 28.0, 32.5, 37.0), start=1):
        objects.append(base.box(
            f"LIB_Facade_Grid_H_{idx:02d}", -85.0, 85.0,
            facade_z0 - 0.02, facade_z1 + 0.02, -height, 0.52,
            library_collection, beige, beige_c, root,
        ))

    bay_count = 8
    x_min, x_max = -48.0, 48.0
    bay_width = (x_max - x_min) / bay_count
    y_low, y_high = -18.0, -28.5
    brace_z = -36.10
    for idx in range(bay_count):
        x0 = x_min + idx * bay_width
        x1 = x0 + bay_width
        objects.append(base.beam(
            f"LIB_XBrace_A_{idx + 1:02d}", (x0, y_low, brace_z), (x1, y_high, brace_z),
            0.82, 0.58, library_collection, white, white_c, root,
        ))
        objects.append(base.beam(
            f"LIB_XBrace_B_{idx + 1:02d}", (x0, y_high, brace_z), (x1, y_low, brace_z),
            0.82, 0.58, library_collection, white, white_c, root,
        ))

    # 裙楼只补一条玻璃带和屋顶，保持低模但让整体不成为纯色巨盒。
    objects.append(base.box(
        "LIB_WingGlass_West", -170.0, -61.0, -78.5, -77.9, -8.0, 7.5,
        library_collection, glass, glass_c, root,
    ))
    objects.append(base.box(
        "LIB_WingGlass_East", 61.0, 170.0, -78.5, -77.9, -8.0, 7.5,
        library_collection, glass, glass_c, root,
    ))
    objects.append(base.box(
        "LIB_Roof_West", -180.0, -51.0, -79.0, 15.0, -18.5, 0.7,
        library_collection, roof, roof_c, root,
    ))
    objects.append(base.box(
        "LIB_Roof_East", 51.0, 180.0, -79.0, 15.0, -18.5, 0.7,
        library_collection, roof, roof_c, root,
    ))
    objects.append(base.box(
        "LIB_Roof_Main", -87.0, 87.0, -36.0, 36.0, -41.35, 0.85,
        library_collection, roof, roof_c, root,
    ))

    for obj in objects:
        obj["provisional_geometry"] = True
        obj["volume_revision"] = "v001.1 large continuous complex"

    scene = bpy.context.scene
    scene["library_status"] = "v001.1 large integrated mass; source campus preserved"
    scene["library_main_height_m"] = MAIN_HEIGHT
    scene["library_complex_width_m"] = 368.6267
    scene["library_complex_depth_m"] = 140.9793
    scene["library_volume_correction"] = root["volume_correction"]
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    camera_data = bpy.data.cameras.new("LIB_Preview_Camera")
    camera = bpy.data.objects.new("LIB_Preview_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.clip_start = 0.1
    camera.data.clip_end = 3500.0
    camera.hide_render = False

    # 先输出47、48和二者叠加的俯视证据。
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 470.0
    camera.location = (CENTER_X, base_y - 420.0, CENTER_Z - 30.0)
    camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    for filename, names in (
        ("source47_top.png", {source_low.name}),
        ("source48_top.png", {source_main.name}),
        ("source47_48_combined_top.png", {source_low.name, source_main.name}),
    ):
        visibility = set_preview_visibility(scene, names, "OBJECT")
        source_low.hide_render = source_low.name not in names
        source_main.hide_render = source_main.name not in names
        base.render(scene, camera, PREVIEW_DIR / filename, (1200, 900))
        restore_visibility(scene, visibility)

    model_names = {obj.name for obj in objects} | {root.name}
    visibility = set_preview_visibility(scene, model_names, "MATERIAL")
    target = Vector((CENTER_X, base_y - 16.0, CENTER_Z - 28.0))

    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 470.0
    camera.location = (CENTER_X, base_y - 420.0, CENTER_Z - 30.0)
    camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    base.render(scene, camera, PREVIEW_DIR / "top.png", (1200, 900))

    camera.data.type = "PERSP"
    camera.data.lens = 62.0
    camera.location = (CENTER_X, base_y - 48.0, CENTER_Z - 410.0)
    base.point_camera(camera, target)
    base.render(scene, camera, PREVIEW_DIR / "south.png")

    camera.location = (CENTER_X + 330.0, base_y - 145.0, CENTER_Z - 350.0)
    base.point_camera(camera, target)
    base.render(scene, camera, PREVIEW_DIR / "southeast_oblique.png")

    camera.data.lens = 70.0
    camera.location = (CENTER_X + 620.0, base_y - 260.0, CENTER_Z - 720.0)
    base.point_camera(camera, target)
    base.render(scene, camera, PREVIEW_DIR / "campus_mid_distance.png")

    restore_visibility(scene, visibility)
    source_main.hide_render = True
    source_low.hide_render = True
    camera.hide_render = True

    BLEND_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUTPUT), check_existing=False)

    triangle_count = 0
    for obj in objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            triangle_count += len(obj.data.loop_triangles)

    source_hash_after = base.sha256(MODEL)
    report = {
        "status": "created",
        "phase": "Library v001.1 large integrated mass correction",
        "inputModel": str(MODEL),
        "previousBlendPreserved": str(ROOT / "blender" / "library_working_v001.blend"),
        "outputBlend": str(BLEND_OUTPUT),
        "sourceCampusModified": source_hash_before != source_hash_after,
        "sourceCampusSha256Before": source_hash_before,
        "sourceCampusSha256After": source_hash_after,
        "target": {
            "rootWorldXYZ": list(root.location),
            "mainHeightMeters": MAIN_HEIGHT,
            "sourceMainSizeMeters": [172.7101, 70.4944, 24.0],
            "sourceComplexSizeMeters": [368.6267, 140.9793, 6.0],
            "interpretation": root["volume_correction"],
        },
        "grounding": {
            "method": "center raycast for level base; eight points recorded for terrain spread",
            "baseY": base_y,
            "heightSpreadMeters": spread,
            "samples": raycasts,
        },
        "model": {
            "meshObjectCount": len([obj for obj in objects if obj.type == "MESH"]),
            "triangleCount": triangle_count,
            "materialCount": 7,
        },
        "implemented": [
            "exact TPX_Buildings_47 footprint reused as continuous low podium",
            "exact TPX_Buildings_48 plan reused and raised to 41.35m",
            "large west and east wings spanning nearly the full 368m complex",
            "100m-wide south entrance stairs",
            "blue glass, beige grid, white X-brace, orange wings and red podium",
        ],
        "deferred": [
            "fine windows and terracotta panels",
            "interior and roof equipment",
            "final integration and source-object exclusion decision",
        ],
        "previews": {name: str(PREVIEW_DIR / name) for name in (
            "source47_top.png", "source48_top.png", "source47_48_combined_top.png",
            "top.png", "south.png", "southeast_oblique.png", "campus_mid_distance.png",
        )},
    }
    REPORT_OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
