import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_refined_v002.glb"
SOURCE = ROOT / "output" / "campus_refined_v001.glb"
BLEND = ROOT / "blender" / "campus_refined_v002_validation.blend"
REPORT = ROOT / "output" / "campus_refined_v002_validation.json"
PREVIEWS = ROOT / "output" / "previews" / "campus_refined_v002"

EXPECTED_ROOT = Vector((981.0433, -0.10288492838541667, 58.7847176175565))
EXPECTED_SOURCE_HASH = "84F9B63C2CB5C05F98649C2BC22399D682639EB7D99A0D9A5E4CA839DD299E7B"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.images):
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
        if obj.type == "MESH":
            points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
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

    auditorium = bpy.data.objects.get("AUDITORIUM_REFINED_ROOT")
    south_gate = bpy.data.objects.get("SOUTH_GATE_REFINED_ROOT")
    refined_group = bpy.data.objects.get("REFINED_BUILDINGS")
    if auditorium is None or south_gate is None or refined_group is None:
        raise RuntimeError("v002 缺少精修会堂、南门或 REFINED_BUILDINGS")

    gate_objects = [obj for obj in bpy.context.scene.objects if obj == south_gate or has_ancestor(obj, south_gate)]
    gate_meshes = [obj for obj in gate_objects if obj.type == "MESH"]
    if len(gate_meshes) != 35:
        raise RuntimeError(f"南门 Mesh 数量异常: {len(gate_meshes)}")
    if not has_ancestor(south_gate, refined_group):
        raise RuntimeError("南门未挂接在 REFINED_BUILDINGS 下")

    minimum, maximum = world_bounds(gate_meshes)
    dimensions = maximum - minimum
    root_location = south_gate.matrix_world.translation
    root_error = (root_location - EXPECTED_ROOT).length
    triangles = sum(len(poly.vertices) - 2 for obj in gate_meshes for poly in obj.data.polygons)
    if root_error > 0.001:
        raise RuntimeError(f"南门 GIS 定位漂移: {root_error}m")
    if dimensions.x < 80.0 or dimensions.y < 24.0 or dimensions.z < 18.0:
        raise RuntimeError(f"南门尺寸异常: {tuple(dimensions)}")
    if sha256(SOURCE) != EXPECTED_SOURCE_HASH:
        raise RuntimeError("campus_refined_v001.glb 哈希已变化")

    decal = bpy.data.objects.get("SG_Nameplate_Decal")
    if decal is None or not decal.data.materials:
        raise RuntimeError("南门校名贴图对象或材质缺失")
    texture_images = [image for image in bpy.data.images if "south_gate_nameplate" in image.name]
    if not texture_images:
        raise RuntimeError("南门校名贴图未随 GLB 载入")

    # 再检查南门范围内没有旧 TPX_Buildings 粗模。
    conflict_names = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or "TPX_Buildings" not in obj.name:
            continue
        low, high = world_bounds([obj])
        if low.x <= 1024.0433 and high.x >= 938.0433 and low.z <= 69.7847 and high.z >= 49.7847:
            conflict_names.append(obj.name)
    if conflict_names:
        raise RuntimeError(f"南门范围仍有旧建筑粗模: {conflict_names}")

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)

    visibility = {obj.name: obj.hide_render for obj in scene.objects}
    for obj in scene.objects:
        keep = (
            obj in gate_objects
            or "TPX_Ground" in obj.name
            or "TPX_Roads" in obj.name
            or "TPX_GreenAreas" in obj.name
        )
        obj.hide_render = not keep

    camera_data = bpy.data.cameras.new("Campus_Refined_v002_Camera")
    camera = bpy.data.objects.new("Campus_Refined_v002_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.clip_start = 0.1
    camera.data.clip_end = 5000.0
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    target = Vector((981.0433, -9.0, 58.7847))

    camera.data.type = "PERSP"
    camera.data.lens = 54.0
    camera.location = (981.0433, -12.0, -61.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "south_gate_south.png")

    camera.location = (1069.0, -34.0, -35.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "south_gate_southeast.png")

    camera.data.lens = 72.0
    camera.location = (1151.0, -95.0, -206.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "south_gate_mid_distance.png")

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
        "checks": {
            "blender45Readback": True,
            "auditoriumPresent": True,
            "southGatePresent": True,
            "southGateUnderRefinedBuildings": True,
            "oldSouthGateConflictAbsent": True,
            "gisLocationPreserved": True,
            "nameplateTextureLoaded": True,
            "sourceV001Unmodified": True,
        },
        "southGate": {
            "rootWorldLocation": list(root_location),
            "rootPositionErrorMeters": root_error,
            "boundsBlender": [list(minimum), list(maximum)],
            "dimensionsMeters": list(dimensions),
            "meshCount": len(gate_meshes),
            "triangleCountAfterGlbRoundTrip": triangles,
            "textureImages": [image.name for image in texture_images],
        },
        "validationBlend": str(BLEND),
        "previews": [
            str(PREVIEWS / "south_gate_south.png"),
            str(PREVIEWS / "south_gate_southeast.png"),
            str(PREVIEWS / "south_gate_mid_distance.png"),
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
