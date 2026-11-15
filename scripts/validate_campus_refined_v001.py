import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_refined_v001.glb"
SOURCE = ROOT / "output" / "campus_cropped.glb"
BLEND = ROOT / "blender" / "campus_refined_v001_validation.blend"
REPORT = ROOT / "output" / "campus_refined_v001_validation.json"
PREVIEWS = ROOT / "output" / "previews" / "campus_refined_v001"

EXPECTED_SOURCE_HASH = "4033DBB8B8341B83A64A81B232CCA953870C3CDE70F9BC5659B6B09039B92018"
EXPECTED_ROOT = Vector((981.0433, 0.0, 1212.0))


def sha256(path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest().upper()
    return digest


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def has_ancestor(obj, ancestor):
    current = obj.parent
    while current is not None:
        if current == ancestor:
            return True
        current = current.parent
    return False


def world_bounds(objects):
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        raise RuntimeError("精修会堂没有可计算包围盒的 Mesh")
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


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
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(MODEL))

    area02 = bpy.data.objects.get("Area_02")
    refined_root = bpy.data.objects.get("AUDITORIUM_REFINED_ROOT")
    if area02 is None or refined_root is None:
        raise RuntimeError("最终 GLB 缺少 Area_02 或精修会堂根节点")

    old_candidates = [
        obj.name for obj in bpy.context.scene.objects
        if obj.name.startswith("TPX_Buildings_14") and has_ancestor(obj, area02)
    ]
    refined_objects = [
        obj for obj in bpy.context.scene.objects
        if obj == refined_root or has_ancestor(obj, refined_root)
    ]
    refined_meshes = [obj for obj in refined_objects if obj.type == "MESH"]
    if old_candidates:
        raise RuntimeError(f"Area_02 中仍存在原始会堂: {old_candidates}")
    if len(refined_meshes) != 25:
        raise RuntimeError(f"精修会堂 Mesh 数量异常: {len(refined_meshes)}")

    minimum, maximum = world_bounds(refined_meshes)
    dimensions = maximum - minimum
    root_location = refined_root.matrix_world.translation
    root_error = (root_location - EXPECTED_ROOT).length
    triangles = sum(len(poly.vertices) - 2 for obj in refined_meshes for poly in obj.data.polygons)
    if root_error > 0.001:
        raise RuntimeError(f"精修会堂 GIS 定位漂移: {root_error}m")
    if dimensions.x < 80.0 or dimensions.z < 120.0 or dimensions.y < 18.0:
        raise RuntimeError(f"精修会堂尺寸异常: {tuple(dimensions)}")
    if sha256(SOURCE) != EXPECTED_SOURCE_HASH:
        raise RuntimeError("原始 campus_cropped.glb 哈希已变化")

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)

    visibility = {obj.name: obj.hide_render for obj in scene.objects}
    for obj in scene.objects:
        keep = (
            obj in refined_objects
            or "TPX_Ground" in obj.name
            or "TPX_Waterways" in obj.name
            or "TPX_Roads" in obj.name
            or "TPX_GreenAreas" in obj.name
        )
        obj.hide_render = not keep

    camera_data = bpy.data.cameras.new("Campus_Refined_Validation_Camera")
    camera = bpy.data.objects.new("Campus_Refined_Validation_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.clip_start = 0.1
    camera.data.clip_end = 5000.0
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    target = Vector((981.0433, -8.0, 1212.0))

    camera.data.type = "PERSP"
    camera.data.lens = 55.0
    camera.location = (981.0433, -42.0, 1017.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "south.png")

    camera.location = (1126.0, -95.0, 1037.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "southeast_oblique.png")

    camera.data.lens = 70.0
    camera.location = (701.0, -150.0, 852.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "campus_mid_distance.png")

    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 185.0
    camera.location = (981.0433, -260.0, 1212.0)
    camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    render(scene, camera, PREVIEWS / "top.png", (1000, 1000))

    for obj in scene.objects:
        if obj.name in visibility:
            obj.hide_render = visibility[obj.name]
    camera.hide_render = True
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), check_existing=False)

    report = {
        "status": "passed",
        "model": str(MODEL),
        "modelSha256": sha256(MODEL),
        "sourceModel": str(SOURCE),
        "sourceSha256": sha256(SOURCE),
        "sourceBuildingReachableInArea02": False,
        "refinedRootWorldLocation": list(root_location),
        "refinedRootPositionErrorMeters": root_error,
        "refinedBoundsBlender": [list(minimum), list(maximum)],
        "refinedDimensionsMeters": list(dimensions),
        "refinedMeshCount": len(refined_meshes),
        "refinedTriangleCountAfterGlbRoundTrip": triangles,
        "checks": {
            "blender45Readback": True,
            "sourceBuildingExcluded": True,
            "refinedBuildingPresent": True,
            "gisLocationPreserved": True,
            "sourceCampusGlbUnmodified": True,
        },
        "validationBlend": str(BLEND),
        "previews": [
            str(PREVIEWS / "south.png"),
            str(PREVIEWS / "southeast_oblique.png"),
            str(PREVIEWS / "campus_mid_distance.png"),
            str(PREVIEWS / "top.png"),
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
