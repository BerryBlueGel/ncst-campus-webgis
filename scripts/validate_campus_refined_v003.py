import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_refined_v003.glb"
SOURCE = ROOT / "output" / "campus_refined_v002.glb"
BLEND = ROOT / "blender" / "campus_refined_v003_validation.blend"
REPORT = ROOT / "output" / "campus_refined_v003_validation.json"
PREVIEWS = ROOT / "output" / "previews" / "campus_refined_v003"

EXPECTED_ROOT = Vector((989.3003234863281, -0.14453125, 556.8445434570312))
EXPECTED_SOURCE_HASH = "F43A4DCA2F2D22C84951910384A182B128D84AE4AD43728902E9A4C074069E8B"


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


def descendant_objects(root):
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        yield obj
        stack.extend(obj.children)


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

    refined_group = bpy.data.objects.get("REFINED_BUILDINGS")
    auditorium = bpy.data.objects.get("AUDITORIUM_REFINED_ROOT")
    south_gate = bpy.data.objects.get("SOUTH_GATE_REFINED_ROOT")
    library = bpy.data.objects.get("LIBRARY_REFINED_ROOT")
    if any(obj is None for obj in (refined_group, auditorium, south_gate, library)):
        raise RuntimeError("v003 缺少 REFINED_BUILDINGS、会堂、南门或图书馆")
    if not all(has_ancestor(obj, refined_group) for obj in (auditorium, south_gate, library)):
        raise RuntimeError("精修建筑未全部挂接在 REFINED_BUILDINGS 下")
    area_01 = bpy.data.objects.get("Area_01")
    if area_01 is None:
        raise RuntimeError("导入场景缺少 Area_01")
    old_library_under_area_01 = [
        obj.name for obj in descendant_objects(area_01)
        if obj.name in ("TPX_Buildings_47", "TPX_Buildings_48")
    ]
    if old_library_under_area_01:
        raise RuntimeError(f"Area_01 旧图书馆47/48仍在导入场景中: {old_library_under_area_01}")

    library_objects = [
        obj for obj in bpy.context.scene.objects
        if obj == library or has_ancestor(obj, library)
    ]
    library_meshes = [obj for obj in library_objects if obj.type == "MESH"]
    if len(library_meshes) != 72:
        raise RuntimeError(f"图书馆 Mesh 数量异常: {len(library_meshes)}")
    minimum, maximum = world_bounds(library_meshes)
    dimensions = maximum - minimum
    root_location = library.matrix_world.translation
    root_error = (root_location - EXPECTED_ROOT).length
    triangles = sum(len(poly.vertices) - 2 for obj in library_meshes for poly in obj.data.polygons)
    if root_error > 0.001:
        raise RuntimeError(f"图书馆 GIS 定位漂移: {root_error}m")
    if dimensions.x < 360.0 or dimensions.y < 41.0 or dimensions.z < 138.0:
        raise RuntimeError(f"图书馆整体尺寸异常: {tuple(dimensions)}")
    if sha256(SOURCE) != EXPECTED_SOURCE_HASH:
        raise RuntimeError("campus_refined_v002.glb 哈希已变化")

    decal = bpy.data.objects.get("SG_Nameplate_Decal")
    texture_images = [image for image in bpy.data.images if "south_gate_nameplate" in image.name]
    if decal is None or not texture_images:
        raise RuntimeError("南门校名贴图在 v003 中缺失")

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
        context = any(token in obj.name for token in ("TPX_Ground", "TPX_Roads", "TPX_Waterways"))
        obj.hide_render = not (obj in library_objects or context)

    camera_data = bpy.data.cameras.new("Campus_Refined_v003_Camera")
    camera = bpy.data.objects.new("Campus_Refined_v003_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.clip_start = 0.1
    camera.data.clip_end = 5000.0
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    target = Vector((989.3003, -16.0, 526.8445))

    camera.data.type = "PERSP"
    camera.data.lens = 62.0
    camera.location = (989.3003, -50.0, 136.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "library_south.png")

    camera.location = (1329.0, -150.0, 192.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "library_southeast.png")

    camera.data.lens = 72.0
    camera.location = (1639.0, -270.0, -203.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "library_mid_distance.png")

    for obj in scene.objects:
        if obj.name in visibility:
            obj.hide_render = visibility[obj.name]
    camera.hide_render = True
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), check_existing=False)

    report = {
        "status": "passed",
        "model": str(MODEL),
        "modelSha256": sha256(MODEL),
        "modelBytes": MODEL.stat().st_size,
        "sourceModel": str(SOURCE),
        "sourceSha256": sha256(SOURCE),
        "checks": {
            "blender45Readback": True,
            "auditoriumPresent": True,
            "southGatePresent": True,
            "libraryPresent": True,
            "allUnderRefinedBuildings": True,
            "oldLibrary47And48Absent": True,
            "libraryGisLocationPreserved": True,
            "southGateNameplateTextureLoaded": True,
            "sourceV002Unmodified": True,
        },
        "library": {
            "rootWorldLocation": list(root_location),
            "rootPositionErrorMeters": root_error,
            "boundsBlender": [list(minimum), list(maximum)],
            "dimensionsMeters": list(dimensions),
            "meshCount": len(library_meshes),
            "triangleCountAfterGlbRoundTrip": triangles,
        },
        "validationBlend": str(BLEND),
        "previews": [
            str(PREVIEWS / "library_south.png"),
            str(PREVIEWS / "library_southeast.png"),
            str(PREVIEWS / "library_mid_distance.png"),
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
