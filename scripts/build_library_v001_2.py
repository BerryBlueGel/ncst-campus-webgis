import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_library_v001 as base
import build_library_v001_1 as large


INPUT = ROOT / "blender" / "library_working_v001_1.blend"
OUTPUT = ROOT / "blender" / "library_working_v001_2.blend"
SOURCE = ROOT / "output" / "campus_refined_v002.glb"
REPORT = ROOT / "blender" / "library_v001_2_report.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "library_v001_2"

CENTER_X = 989.3003234863281
CENTER_Z = 556.8445434570312


def delete_objects(names):
    for name in names:
        obj = bpy.data.objects.get(name)
        if obj is not None:
            bpy.data.objects.remove(obj, do_unlink=True)


def tag(obj):
    obj["library_blockout"] = True
    obj["lod_stage"] = "LOD1_blockout"
    obj["provisional_geometry"] = True
    obj["volume_revision"] = "v001.2 light architectural refinement"
    return obj


def main():
    if Path(bpy.data.filepath).resolve() != INPUT.resolve():
        raise RuntimeError(f"必须从 v001.1 打开执行，当前: {bpy.data.filepath}")

    source_hash_before = base.sha256(SOURCE)
    collection = bpy.data.collections.get("Library")
    root = bpy.data.objects.get("LIBRARY_REFINED_ROOT")
    source_main = bpy.data.objects.get("TPX_Buildings_48")
    if collection is None or root is None or source_main is None:
        raise RuntimeError("v001.1 缺少 Library Collection、根节点或源主楼")

    beige = bpy.data.materials["MAT_Library_BeigeFrame"]
    glass = bpy.data.materials["MAT_Library_BlueGlass"]
    orange = bpy.data.materials["MAT_Library_OrangeBox"]
    red = bpy.data.materials["MAT_Library_RedBase"]
    white = bpy.data.materials["MAT_Library_WhiteBrace"]
    roof = bpy.data.materials["MAT_Library_Roof"]
    stone = bpy.data.materials["MAT_Library_Stairs"]

    beige_c = tuple(beige.diffuse_color)
    glass_c = tuple(glass.diffuse_color)
    orange_c = tuple(orange.diffuse_color)
    red_c = tuple(red.diffuse_color)
    white_c = tuple(white.diffuse_color)
    roof_c = tuple(roof.diffuse_color)
    stone_c = tuple(stone.diffuse_color)

    # 删除v001.1中最“盒子化”的翼楼和厚屋顶，重新建立轻微不对称的退台体量。
    delete_objects([
        "LIB_Wing_West", "LIB_Wing_East", "LIB_Wing_West_South", "LIB_Wing_East_South",
        "LIB_Roof_West", "LIB_Roof_East", "LIB_Roof_Main",
        "LIB_Entrance_Glass", "LIB_Entrance_Canopy",
        "LIB_WingGlass_West", "LIB_WingGlass_East",
    ])

    revised = []
    revised.append(tag(base.box(
        "LIB_Wing_West", -179.0, -53.0, -74.0, 13.0, -6.0, 12.0,
        collection, orange, orange_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_Wing_East", 53.0, 179.0, -79.0, 8.0, -6.0, 12.0,
        collection, orange, orange_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_Wing_West_South", -151.0, -24.0, -105.0, -70.0, -6.0, 7.2,
        collection, orange, orange_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_Wing_East_South", 24.0, 143.0, -105.0, -67.0, -6.0, 8.2,
        collection, orange, orange_c, root,
    )))
    # 两翼上层退台，打破整齐长盒子轮廓。
    revised.append(tag(base.box(
        "LIB_Wing_West_Upper", -164.0, -66.0, -62.0, 4.0, -18.0, 2.4,
        collection, beige, beige_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_Wing_East_Upper", 70.0, 164.0, -65.0, 0.0, -18.0, 2.4,
        collection, beige, beige_c, root,
    )))
    # 深色玻璃带通过不同长度表达东西翼的层次差异。
    revised.append(tag(base.box(
        "LIB_WingGlass_West", -169.0, -63.0, -74.5, -73.9, -8.2, 7.0,
        collection, glass, glass_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_WingGlass_East", 64.0, 171.0, -79.5, -78.9, -8.2, 7.0,
        collection, glass, glass_c, root,
    )))

    # 中央入口加深并以门框、平台和前伸薄檐强化主入口中心性。
    revised.append(tag(base.box(
        "LIB_Entrance_Glass", -50.0, 50.0, -72.0, -35.3, -6.0, 13.5,
        collection, glass, glass_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_Entrance_Frame_L", -54.0, -49.0, -73.0, -34.8, -6.0, 15.5,
        collection, beige, beige_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_Entrance_Frame_R", 49.0, 54.0, -73.0, -34.8, -6.0, 15.5,
        collection, beige, beige_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_Entrance_Frame_Top", -54.0, 54.0, -73.0, -34.8, -21.0, 2.0,
        collection, beige, beige_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_Entrance_Canopy", -64.0, 64.0, -82.0, -69.0, -19.2, 0.45,
        collection, white, white_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_Entrance_Landing", -57.0, 57.0, -84.0, -72.0, 0.0, 1.9,
        collection, stone, stone_c, root,
    )))

    # 屋顶改为薄檐和退台：中央屋顶沿源48真实平面形状，避免纯矩形厚盖板。
    roof_main = large.source_mesh_as_prism(
        source_main, "LIB_Roof_Main", 0.38,
        collection, roof, roof_c, root,
    )
    roof_main.location.y = -41.35
    revised.append(tag(roof_main))
    revised.append(tag(base.box(
        "LIB_Roof_West", -174.0, -57.0, -70.0, 10.0, -20.4, 0.32,
        collection, roof, roof_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_Roof_East", 58.0, 174.0, -75.0, 5.0, -20.4, 0.32,
        collection, roof, roof_c, root,
    )))

    # 主楼顶部与X形带上下收口，增强立面结构感而不增加窗户细节。
    revised.append(tag(base.box(
        "LIB_MainTower_TopBand", -85.0, 85.0, -35.78, -35.08, -39.7, 0.72,
        collection, beige, beige_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_XBrace_Rail_Top", -50.0, 50.0, -36.20, -35.95, -28.9, 0.42,
        collection, white, white_c, root,
    )))
    revised.append(tag(base.box(
        "LIB_XBrace_Rail_Bottom", -50.0, 50.0, -36.20, -35.95, -17.8, 0.42,
        collection, white, white_c, root,
    )))

    root["status"] = "blockout_v001_2_light_refinement"
    root["v001_2_changes"] = (
        "thinner source-shaped main roof, stepped asymmetric wings, stronger south portal, "
        "clean X-brace rails; overall 368m complex and 41.35m main height unchanged"
    )
    scene = bpy.context.scene
    scene["library_status"] = "v001.2 light refinement; not integrated into campus GLB"
    scene["library_v001_2_scope"] = root["v001_2_changes"]
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)

    library_objects = [obj for obj in scene.objects if obj.get("library_blockout")]
    include_names = {obj.name for obj in library_objects} | {root.name}
    visibility = large.set_preview_visibility(scene, include_names, "MATERIAL")
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    camera = bpy.data.objects.get("LIB_Preview_Camera")
    if camera is None:
        camera_data = bpy.data.cameras.new("LIB_Preview_Camera")
        camera = bpy.data.objects.new("LIB_Preview_Camera", camera_data)
        scene.collection.objects.link(camera)
    camera.hide_render = False
    camera.data.clip_start = 0.1
    camera.data.clip_end = 3500.0
    target = Vector((CENTER_X, root.location.y - 16.0, CENTER_Z - 30.0))

    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 470.0
    camera.location = (CENTER_X, root.location.y - 420.0, CENTER_Z - 30.0)
    camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    base.render(scene, camera, PREVIEW_DIR / "top.png", (1200, 900))

    camera.data.type = "PERSP"
    camera.data.lens = 62.0
    camera.location = (CENTER_X, root.location.y - 50.0, CENTER_Z - 420.0)
    base.point_camera(camera, target)
    base.render(scene, camera, PREVIEW_DIR / "south.png")

    camera.location = (CENTER_X + 340.0, root.location.y - 150.0, CENTER_Z - 365.0)
    base.point_camera(camera, target)
    base.render(scene, camera, PREVIEW_DIR / "southeast_oblique.png")

    camera.data.lens = 72.0
    camera.location = (CENTER_X + 650.0, root.location.y - 270.0, CENTER_Z - 760.0)
    base.point_camera(camera, target)
    base.render(scene, camera, PREVIEW_DIR / "campus_mid_distance.png")

    large.restore_visibility(scene, visibility)
    camera.hide_render = True
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT), check_existing=False)

    meshes = [obj for obj in bpy.data.objects if obj.get("library_blockout") and obj.type == "MESH"]
    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)

    source_hash_after = base.sha256(SOURCE)
    report = {
        "status": "created",
        "phase": "Library v001.2 light architectural refinement",
        "inputBlend": str(INPUT),
        "outputBlend": str(OUTPUT),
        "previousVersionsPreserved": [
            str(ROOT / "blender" / "library_working_v001.blend"),
            str(INPUT),
        ],
        "sourceCampusModified": source_hash_before != source_hash_after,
        "sourceCampusSha256Before": source_hash_before,
        "sourceCampusSha256After": source_hash_after,
        "preserved": {
            "complexWidthMeters": 368.6267,
            "complexDepthMeters": 140.9793,
            "mainHeightMeters": 41.35,
            "gisRootWorldXYZ": list(root.location),
        },
        "changes": [
            "main roof replaced by a thin cap following TPX_Buildings_48 plan",
            "east and west wings given restrained asymmetric setbacks",
            "south entrance strengthened with portal frame, landing and thin canopy",
            "X-brace band given clean top and bottom termination rails",
            "no fine windows, panels, interiors or roof equipment added",
        ],
        "model": {
            "meshObjectCount": len(meshes),
            "triangleCount": triangles,
            "materialCount": 7,
        },
        "previews": {name: str(PREVIEW_DIR / name) for name in (
            "top.png", "south.png", "southeast_oblique.png", "campus_mid_distance.png",
        )},
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
