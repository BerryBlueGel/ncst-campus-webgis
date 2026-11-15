import json
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
V001 = ROOT / "blender" / "auditorium_working_v001.blend"
V002 = ROOT / "blender" / "auditorium_working_v002.blend"
REPORT = ROOT / "blender" / "auditorium_v002_report.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "auditorium_v002"

CENTER_X = 981.0433
CENTER_Z = 1212.0


def auditorium_collection():
    collection = bpy.data.collections.get("Auditorium")
    if collection is None:
        raise RuntimeError("v001 中缺少 Auditorium Collection")
    return collection


def create_box(name, x_min, x_max, z_min, z_max, base_y, height,
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
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    obj.color = color
    obj.data.materials.append(material)
    obj["auditorium_blockout"] = True
    obj["provisional_geometry"] = True
    return obj


def taper_top_ring(obj_name, factor_x, factor_z):
    obj = bpy.data.objects.get(obj_name)
    if obj is None or obj.type != "MESH":
        raise RuntimeError(f"找不到待收分对象: {obj_name}")
    min_y = min(vertex.co.y for vertex in obj.data.vertices)
    for vertex in obj.data.vertices:
        if abs(vertex.co.y - min_y) < 1e-5:
            vertex.co.x *= factor_x
            vertex.co.z *= factor_z
    obj.data.update()
    obj["v002_taper"] = [factor_x, factor_z]


def create_lattice(name, rx, rz, y_bottom, y_top, line_count, twist_radians,
                   collection, parent, material, color):
    curve = bpy.data.curves.new(f"{name}_Curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = 0.18
    curve.bevel_resolution = 0
    curve.resolution_u = 1
    curve.use_fill_caps = True

    samples = 13
    for direction in (-1.0, 1.0):
        for line_index in range(line_count):
            theta0 = 2.0 * 3.141592653589793 * line_index / line_count
            spline = curve.splines.new("POLY")
            spline.points.add(samples - 1)
            for sample_index in range(samples):
                u = sample_index / (samples - 1)
                theta = theta0 + direction * twist_radians * u
                x = rx * __import__("math").cos(theta)
                z = rz * __import__("math").sin(theta)
                y = y_bottom + (y_top - y_bottom) * u
                spline.points[sample_index].co = (x, y, z, 1.0)

    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.parent = parent
    obj.color = color
    obj.data.materials.append(material)
    obj["lattice_lines"] = line_count * 2
    obj["lattice_samples_per_line"] = samples
    obj["lattice_role"] = "low_poly_webgis_recognition_feature"

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    return obj


def point_camera(camera, target, world_up=Vector((0.0, -1.0, 0.0))):
    forward = (target - camera.location).normalized()
    right = forward.cross(world_up).normalized()
    corrected_up = right.cross(forward).normalized()
    rotation = Matrix((right, corrected_up, -forward)).transposed()
    camera.rotation_euler = rotation.to_euler()


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
        raise RuntimeError(f"必须从 v001 打开执行，当前文件: {bpy.data.filepath}")

    collection = auditorium_collection()
    root = bpy.data.objects.get("AUDITORIUM_REFINED_ROOT")
    if root is None:
        raise RuntimeError("v001 中缺少 AUDITORIUM_REFINED_ROOT")

    stone = bpy.data.materials.get("MAT_Auditorium_Blockout_Stone")
    white = bpy.data.materials.get("MAT_Auditorium_Blockout_White")
    if stone is None or white is None:
        raise RuntimeError("v001 材质不完整")
    lattice_material = bpy.data.materials.get("MAT_Auditorium_Lattice")
    if lattice_material is None:
        lattice_material = bpy.data.materials.new("MAT_Auditorium_Lattice")
    lattice_material.diffuse_color = (0.96, 0.96, 0.93, 1.0)
    lattice_material.metallic = 0.45
    lattice_material.roughness = 0.35

    # 主体仅做克制收分，保持 v001 总体定位与尺寸。
    taper_top_ring("AUD_Drum_Lower", 0.965, 0.965)
    taper_top_ring("AUD_Drum_Upper", 0.945, 0.945)

    canopy = bpy.data.objects.get("AUD_Entrance_Canopy")
    if canopy:
        canopy.scale.x = 1.18
        canopy["v002_widened_entrance"] = True

    wing_left = create_box(
        "AUD_Wing_L", -43.0, -25.0, -55.0, -34.0, 0.0, 2.6,
        collection, stone, (0.78, 0.78, 0.75, 1.0), root,
    )
    wing_right = create_box(
        "AUD_Wing_R", 25.0, 43.0, -55.0, -34.0, 0.0, 2.6,
        collection, stone, (0.78, 0.78, 0.75, 1.0), root,
    )

    lower_lattice = create_lattice(
        "AUD_Lattice_Lower", 35.55, 39.05, -5.45, -13.25,
        24, 0.78, collection, root, lattice_material,
        (0.96, 0.96, 0.93, 1.0),
    )
    upper_lattice = create_lattice(
        "AUD_Lattice_Upper", 31.55, 35.05, -13.25, -18.75,
        20, 0.72, collection, root, lattice_material,
        (0.96, 0.96, 0.93, 1.0),
    )
    lower_lattice.location.x = 0.0
    lower_lattice.location.z = 0.0
    upper_lattice.location.x = 1.5
    upper_lattice.location.z = 1.0

    root["status"] = "recognizable_webgis_v002"
    root["v002_scope"] = "coarse resemblance for 50-300m viewing distance"

    scene = bpy.context.scene
    scene["auditorium_status"] = "v002 recognizable WebGIS asset"
    scene["auditorium_detail_policy"] = "coarse silhouette and lattice; no BIM detail"

    visibility = {}
    refined = {
        obj.name for obj in collection.all_objects
        if obj.name.startswith("AUD_") or obj.name == "AUDITORIUM_REFINED_ROOT"
    }
    for obj in scene.objects:
        visibility[obj.name] = obj.hide_render
        keep = obj.name in refined or "TPX_Ground" in obj.name or "TPX_Waterways" in obj.name
        obj.hide_render = not keep
        if "TPX_Ground" in obj.name:
            obj.color = (0.32, 0.34, 0.34, 1.0)
        elif "TPX_Waterways" in obj.name:
            obj.color = (0.05, 0.30, 0.48, 1.0)

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)

    camera = bpy.data.objects.get("AUD_Preview_Camera")
    if camera is None:
        camera_data = bpy.data.cameras.new("AUD_Preview_Camera")
        camera = bpy.data.objects.new("AUD_Preview_Camera", camera_data)
        scene.collection.objects.link(camera)
    camera.data.clip_start = 0.1
    camera.data.clip_end = 2500.0
    camera.hide_render = False
    target = Vector((CENTER_X, -8.0, CENTER_Z))
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 185.0
    camera.location = (CENTER_X, -260.0, CENTER_Z)
    camera.rotation_euler = (__import__("math").radians(90.0), 0.0, 0.0)
    render(scene, camera, PREVIEW_DIR / "top.png", (1000, 1000))

    camera.data.type = "PERSP"
    camera.data.lens = 55.0
    camera.location = (CENTER_X, -42.0, CENTER_Z - 195.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "south.png")

    camera.location = (CENTER_X + 145.0, -95.0, CENTER_Z - 175.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "southeast_oblique.png")

    camera.data.lens = 70.0
    camera.location = (CENTER_X - 280.0, -150.0, CENTER_Z - 360.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEW_DIR / "campus_mid_distance.png")

    for obj in scene.objects:
        if obj.name in visibility:
            obj.hide_render = visibility[obj.name]
    camera.hide_render = True

    bpy.ops.wm.save_as_mainfile(filepath=str(V002), check_existing=False)

    report = {
        "status": "created",
        "phase": "Auditorium recognizable WebGIS v002",
        "input": str(V001),
        "output": str(V002),
        "v001Preserved": True,
        "sourceCampusGlbModified": False,
        "changes": [
            "lower drum top tapered to 96.5%",
            "upper drum top tapered to 94.5%",
            "entrance canopy widened to 118%",
            "added simple left and right entrance wings",
            "added low-poly crossed elliptical lattice to both drums",
        ],
        "lattice": {
            "lowerCrossedLines": 48,
            "upperCrossedLines": 40,
            "bevelRadiusMeters": 0.18,
            "objects": [lower_lattice.name, upper_lattice.name],
        },
        "newObjects": [wing_left.name, wing_right.name, lower_lattice.name, upper_lattice.name],
        "intendedViewingDistanceMeters": [50, 300],
        "notModeled": [
            "interior", "detailed windows", "railings", "roof equipment",
            "small fixtures", "high precision rear facade",
        ],
        "previews": [
            str(PREVIEW_DIR / "south.png"),
            str(PREVIEW_DIR / "southeast_oblique.png"),
            str(PREVIEW_DIR / "campus_mid_distance.png"),
            str(PREVIEW_DIR / "top.png"),
        ],
    }
    with REPORT.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
