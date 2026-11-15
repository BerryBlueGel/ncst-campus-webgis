import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_refined_v004.glb"
SOURCE = ROOT / "output" / "campus_refined_v003.glb"
BLEND = ROOT / "blender" / "campus_refined_v004_validation.blend"
REPORT = ROOT / "output" / "campus_refined_v004_validation.json"
PREVIEWS = ROOT / "output" / "previews" / "campus_refined_v004"

EXPECTED_SOURCE_HASH = "D6360C33C9604EAA8E1546AE370B40ED58540AE54E17C01FFB62410C6504A786"
EXPECTED_ROOT = Vector((992.5923964337298, 0.752911376953125, 362.7571699554929))
POSITION_TOLERANCE = 0.0001


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.images,
    ):
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

    refined_buildings = bpy.data.objects.get("REFINED_BUILDINGS")
    landmarks = bpy.data.objects.get("REFINED_LANDMARKS")
    sculpture_group = bpy.data.objects.get("FusionSculpture")
    sculpture = bpy.data.objects.get("FUS_Root")
    auditorium = bpy.data.objects.get("AUDITORIUM_REFINED_ROOT")
    south_gate = bpy.data.objects.get("SOUTH_GATE_REFINED_ROOT")
    library = bpy.data.objects.get("LIBRARY_REFINED_ROOT")
    required = (
        refined_buildings,
        landmarks,
        sculpture_group,
        sculpture,
        auditorium,
        south_gate,
        library,
    )
    if any(obj is None for obj in required):
        raise RuntimeError("v004 缺少精修建筑、REFINED_LANDMARKS 或融合雕塑层级")
    if not has_ancestor(sculpture_group, landmarks):
        raise RuntimeError("FusionSculpture 未挂接到 REFINED_LANDMARKS")
    if not has_ancestor(sculpture, sculpture_group):
        raise RuntimeError("FUS_Root 未挂接到 FusionSculpture")
    if not all(has_ancestor(obj, refined_buildings) for obj in (auditorium, south_gate, library)):
        raise RuntimeError("原有精修建筑层级发生变化")

    expected_names = {
        "FUS_Base",
        "FUS_LandscapeRing",
        "FUS_Ribbon_01_WarmFront",
        "FUS_Ribbon_02_DarkOuterRight",
        "FUS_Ribbon_03_DarkOuterLeft",
        "FUS_Ribbon_04_DarkInner",
        "FUS_Ribbon_05_WarmInner",
    }
    sculpture_descendants = list(descendant_objects(sculpture))
    sculpture_meshes = [obj for obj in sculpture_descendants if obj.type == "MESH"]
    sculpture_mesh_names = {obj.name for obj in sculpture_meshes}
    if sculpture_mesh_names != expected_names:
        raise RuntimeError(f"融合雕塑 Mesh 节点异常: {sorted(sculpture_mesh_names)}")
    if any(obj.name.startswith("FUS_Guide_") for obj in bpy.context.scene.objects):
        raise RuntimeError("v004 错误包含融合雕塑导向曲线")

    root_location = sculpture.matrix_world.translation
    root_error = (root_location - EXPECTED_ROOT).length
    if root_error > POSITION_TOLERANCE:
        raise RuntimeError(f"融合雕塑平面或高度定位漂移: {root_error}m")
    minimum, maximum = world_bounds(sculpture_meshes)
    dimensions = maximum - minimum
    triangles = sum(
        len(poly.vertices) - 2 for obj in sculpture_meshes for poly in obj.data.polygons
    )
    if triangles > 8000:
        raise RuntimeError(f"融合雕塑三角形超预算: {triangles}")
    if not (13.5 <= dimensions.y <= 14.7 and 10.0 <= dimensions.x <= 10.8):
        raise RuntimeError(f"融合雕塑整体尺寸异常: {tuple(dimensions)}")
    if sha256(SOURCE) != EXPECTED_SOURCE_HASH:
        raise RuntimeError("campus_refined_v003.glb 哈希已变化")

    decal = bpy.data.objects.get("SG_Nameplate_Decal")
    texture_images = [image for image in bpy.data.images if "south_gate_nameplate" in image.name]
    if decal is None or not texture_images:
        raise RuntimeError("南门校名贴图在 v004 中缺失")

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
    context_tokens = (
        "TPX_Ground",
        "TPX_Roads",
        "TPX_GreenAreas",
        "TPX_Trees",
        "LIB_",
    )
    for obj in scene.objects:
        is_context = any(token in obj.name for token in context_tokens)
        obj.hide_render = not (obj in sculpture_meshes or is_context)

    camera_data = bpy.data.cameras.new("Campus_Refined_v004_Camera")
    camera = bpy.data.objects.new("Campus_Refined_v004_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.clip_start = 0.1
    camera.data.clip_end = 5000.0
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    target = Vector((EXPECTED_ROOT.x, EXPECTED_ROOT.y - 6.5, EXPECTED_ROOT.z))

    camera.data.type = "PERSP"
    camera.data.lens = 62.0
    camera.location = (EXPECTED_ROOT.x, EXPECTED_ROOT.y - 7.0, EXPECTED_ROOT.z - 33.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "fusion_south.png", (1000, 1200))

    camera.data.lens = 62.0
    camera.location = (EXPECTED_ROOT.x + 25.0, EXPECTED_ROOT.y - 10.0, EXPECTED_ROOT.z - 31.0)
    point_camera(camera, target)
    render(scene, camera, PREVIEWS / "fusion_southeast.png", (1200, 900))

    camera.data.lens = 68.0
    camera.location = (EXPECTED_ROOT.x + 28.0, EXPECTED_ROOT.y - 18.0, EXPECTED_ROOT.z - 105.0)
    point_camera(camera, Vector((EXPECTED_ROOT.x, EXPECTED_ROOT.y - 5.0, EXPECTED_ROOT.z + 7.0)))
    render(scene, camera, PREVIEWS / "fusion_library_axis_mid.png", (1400, 900))

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
            "refinedLandmarksPresent": True,
            "fusionSculpturePresent": True,
            "fusionHierarchyValid": True,
            "fusionGuideCurvesExcluded": True,
            "fusionPlanarLocationPreserved": True,
            "southGateNameplateTextureLoaded": True,
            "sourceV003Unmodified": True,
        },
        "fusionSculpture": {
            "placementStatus": sculpture.get("placement_status"),
            "rootWorldLocation": list(root_location),
            "rootPositionErrorMeters": root_error,
            "boundsBlender": [list(minimum), list(maximum)],
            "dimensionsMeters": list(dimensions),
            "meshCount": len(sculpture_meshes),
            "triangleCountAfterGlbRoundTrip": triangles,
            "meshNames": sorted(sculpture_mesh_names),
        },
        "validationBlend": str(BLEND),
        "previews": [
            str(PREVIEWS / "fusion_south.png"),
            str(PREVIEWS / "fusion_southeast.png"),
            str(PREVIEWS / "fusion_library_axis_mid.png"),
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
