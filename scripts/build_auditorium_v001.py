import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_cropped.glb"
BLEND_OUTPUT = ROOT / "blender" / "auditorium_working_v001.blend"
REPORT_OUTPUT = ROOT / "blender" / "auditorium_v001_report.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "auditorium_v001"

SOURCE_OBJECT = "TPX_Buildings_14.001"
SOURCE_GEOJSON_ID = "buildings:29c44087930555db18c9"

# 来自本地 GeoTIFF 总平面图与 GLB footprint 的共同定位。
CENTER_X = 981.0433
CENTER_Z = 1212.0


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


def create_material(name, color, metallic=0.0, roughness=0.7):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = color
    material.metallic = metallic
    material.roughness = roughness
    return material


def link_mesh_object(name, vertices, faces, collection, material, color, parent):
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    obj.color = color
    obj.data.materials.append(material)
    obj["auditorium_blockout"] = True
    return obj


def elliptical_cylinder(name, rx, rz, base_y, height, collection, material, color,
                        parent, offset_x=0.0, offset_z=0.0, segments=64):
    vertices = []
    for y in (base_y, base_y - height):
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            vertices.append((offset_x + rx * math.cos(angle), y, offset_z + rz * math.sin(angle)))
    faces = []
    faces.append(tuple(range(segments - 1, -1, -1)))
    faces.append(tuple(range(segments, 2 * segments)))
    for i in range(segments):
        nxt = (i + 1) % segments
        faces.append((i, nxt, segments + nxt, segments + i))
    return link_mesh_object(name, vertices, faces, collection, material, color, parent)


def box(name, x_min, x_max, z_min, z_max, base_y, height,
        collection, material, color, parent):
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
    return link_mesh_object(name, vertices, faces, collection, material, color, parent)


def ramp(name, x_min, x_max, z_south, z_north, south_top_y, north_top_y,
         collection, material, color, parent):
    base_y = 0.0
    vertices = [
        (x_min, base_y, z_south), (x_max, base_y, z_south),
        (x_max, base_y, z_north), (x_min, base_y, z_north),
        (x_min, south_top_y, z_south), (x_max, south_top_y, z_south),
        (x_max, north_top_y, z_north), (x_min, north_top_y, z_north),
    ]
    faces = [
        (0, 3, 2, 1), (4, 5, 6, 7),
        (0, 1, 5, 4), (1, 2, 6, 5),
        (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    return link_mesh_object(name, vertices, faces, collection, material, color, parent)


def point_camera(camera, target, world_up=Vector((0.0, -1.0, 0.0))):
    forward = (target - camera.location).normalized()
    right = forward.cross(world_up).normalized()
    corrected_up = right.cross(forward).normalized()
    rotation = Matrix((right, corrected_up, -forward)).transposed()
    camera.rotation_euler = rotation.to_euler()


def render_preview(scene, camera, filepath, resolution=(1200, 900)):
    scene.camera = camera
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(filepath)
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(MODEL))
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB 导入失败: {result}")

    source = bpy.data.objects.get(SOURCE_OBJECT)
    if source is None:
        raise RuntimeError(f"找不到会堂源对象: {SOURCE_OBJECT}")
    source["role"] = "auditorium_position_reference"
    source["geojson_id"] = SOURCE_GEOJSON_ID
    source.display_type = "WIRE"
    source.color = (1.0, 0.15, 0.02, 1.0)
    source.hide_render = True

    refined_root_collection = get_or_create_collection("REFINED_BUILDINGS")
    auditorium_collection = get_or_create_collection("Auditorium", refined_root_collection)
    source_collection = get_or_create_collection("SOURCE_REFERENCE")
    if source.name not in source_collection.objects:
        source_collection.objects.link(source)

    root = bpy.data.objects.new("AUDITORIUM_REFINED_ROOT", None)
    auditorium_collection.objects.link(root)
    root.location = (CENTER_X, 0.0, CENTER_Z)
    root["status"] = "blockout_v001"
    root["source_object"] = SOURCE_OBJECT
    root["source_geojson_id"] = SOURCE_GEOJSON_ID
    root["vertical_axis_note"] = "GIS height maps to Blender -Y"
    root["height_estimate_note"] = "Approximate from photographs; calibrate when drawings or measured height become available"

    stone_color = (0.78, 0.78, 0.75, 1.0)
    white_color = (0.92, 0.92, 0.90, 1.0)
    glass_color = (0.06, 0.12, 0.16, 1.0)
    roof_color = (0.30, 0.32, 0.34, 1.0)
    stone = create_material("MAT_Auditorium_Blockout_Stone", stone_color)
    white = create_material("MAT_Auditorium_Blockout_White", white_color, metallic=0.05, roughness=0.5)
    glass = create_material("MAT_Auditorium_Blockout_Glass", glass_color, metallic=0.15, roughness=0.25)
    roof = create_material("MAT_Auditorium_Blockout_Roof", roof_color, metallic=0.1, roughness=0.6)

    objects = []
    objects.append(elliptical_cylinder("AUD_Base_Platform", 44.5, 49.0, 0.0, 0.8,
                                       auditorium_collection, stone, stone_color, root))
    objects.append(elliptical_cylinder("AUD_Base_Upper", 41.0, 45.0, -0.8, 0.6,
                                       auditorium_collection, stone, stone_color, root))
    objects.append(elliptical_cylinder("AUD_GlassBand", 36.5, 40.0, -1.4, 4.2,
                                       auditorium_collection, glass, glass_color, root))
    objects.append(elliptical_cylinder("AUD_Drum_Lower", 35.0, 38.5, -5.6, 7.8,
                                       auditorium_collection, white, white_color, root))
    objects.append(elliptical_cylinder("AUD_Drum_Upper", 31.0, 34.5, -13.4, 5.5,
                                       auditorium_collection, white, white_color, root,
                                       offset_x=1.5, offset_z=1.0))
    objects.append(elliptical_cylinder("AUD_Roof_Main", 32.0, 35.5, -18.9, 0.6,
                                       auditorium_collection, roof, roof_color, root,
                                       offset_x=1.5, offset_z=1.0))
    objects.append(box("AUD_Entrance_Canopy", -25.0, 25.0, -49.0, -38.0, -1.4, 3.6,
                       auditorium_collection, white, white_color, root))

    stair_count = 12
    step_depth = 2.5
    for index in range(stair_count):
        z_min = -79.0 + index * step_depth
        z_max = z_min + step_depth + 0.12
        height = 0.12 * (index + 1)
        objects.append(box(
            f"AUD_Stairs_{index + 1:02d}", -27.0, 27.0, z_min, z_max, 0.0, height,
            auditorium_collection, stone, stone_color, root,
        ))

    objects.append(ramp("AUD_Ramp_L", -37.0, -29.0, -79.0, -44.0, -0.05, -1.4,
                        auditorium_collection, stone, stone_color, root))
    objects.append(ramp("AUD_Ramp_R", 29.0, 37.0, -79.0, -44.0, -0.05, -1.4,
                        auditorium_collection, stone, stone_color, root))

    for obj in objects:
        obj["lod_stage"] = "LOD1_blockout"
        obj["provisional_geometry"] = True

    scene = bpy.context.scene
    scene["auditorium_status"] = "v001 blockout; source preserved"
    scene["auditorium_center_local_xz"] = [CENTER_X, CENTER_Z]
    scene["auditorium_estimated_height_m"] = 19.5
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)
    scene.render.film_transparent = False

    # 预览时只显示地面、水面和新会堂；正式 blend 中所有校园对象仍保留。
    refined_names = {obj.name for obj in objects} | {root.name}
    visibility = {}
    for obj in scene.objects:
        visibility[obj.name] = obj.hide_render
        keep = obj.name in refined_names or "TPX_Ground" in obj.name or "TPX_Waterways" in obj.name
        obj.hide_render = not keep
        if "TPX_Ground" in obj.name:
            obj.color = (0.32, 0.34, 0.34, 1.0)
        elif "TPX_Waterways" in obj.name:
            obj.color = (0.05, 0.30, 0.48, 1.0)

    camera_data = bpy.data.cameras.new("AUD_Preview_Camera")
    camera = bpy.data.objects.new("AUD_Preview_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.clip_start = 0.1
    camera.data.clip_end = 2000.0
    camera.hide_render = False
    target = Vector((CENTER_X, -8.0, CENTER_Z))

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 185.0
    camera.location = (CENTER_X, -260.0, CENTER_Z)
    camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    render_preview(scene, camera, PREVIEW_DIR / "top.png", (1000, 1000))

    camera.data.type = "PERSP"
    camera.data.lens = 55.0
    camera.location = (CENTER_X, -42.0, CENTER_Z - 195.0)
    point_camera(camera, target)
    render_preview(scene, camera, PREVIEW_DIR / "south.png", (1200, 900))

    camera.location = (CENTER_X + 145.0, -95.0, CENTER_Z - 175.0)
    point_camera(camera, target)
    render_preview(scene, camera, PREVIEW_DIR / "southeast_oblique.png", (1200, 900))

    for obj in scene.objects:
        if obj.name in visibility:
            obj.hide_render = visibility[obj.name]
    camera.hide_render = True

    BLEND_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUTPUT), check_existing=False)

    report = {
        "status": "created",
        "phase": "Auditorium blockout v001",
        "sourceModel": str(MODEL),
        "sourceModelModified": False,
        "sourceObject": SOURCE_OBJECT,
        "sourceGeoJsonId": SOURCE_GEOJSON_ID,
        "sourceArea": "Area_02",
        "sourceWorldBoundsBlender": [
            [938.4873657226562, -6.054492950439453, 1120.0242919921875],
            [1023.5991821289062, -0.05449295789003372, 1257.521484375],
        ],
        "sourceDimensionsMeters": [85.11181640625, 6.0, 137.4971923828125],
        "refinedRootWorldLocation": [CENTER_X, 0.0, CENTER_Z],
        "coordinateConvention": {
            "east": "Blender +X",
            "north": "Blender +Z",
            "height": "Blender -Y",
        },
        "estimatedOverallHeightMeters": 19.5,
        "heightConfidence": "provisional; inferred from photographs",
        "newObjects": [obj.name for obj in objects],
        "excludedFromV001": [
            "diamond facade lattice",
            "detailed window mullions",
            "interior",
            "railings and small fixtures",
            "roof equipment",
        ],
        "blendOutput": str(BLEND_OUTPUT),
        "previews": [
            str(PREVIEW_DIR / "top.png"),
            str(PREVIEW_DIR / "south.png"),
            str(PREVIEW_DIR / "southeast_oblique.png"),
        ],
    }
    with REPORT_OUTPUT.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
