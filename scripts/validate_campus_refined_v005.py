import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_refined_v005.glb"
SOURCE = ROOT / "output" / "campus_refined_v004.glb"
STADIUM_REPORT = ROOT / "blender" / "stadiums_v001_report.json"
BLEND = ROOT / "blender" / "campus_refined_v005_validation.blend"
REPORT = ROOT / "output" / "campus_refined_v005_validation.json"
PREVIEWS = ROOT / "output" / "previews" / "campus_refined_v005"

EXPECTED_SOURCE_HASH = "A6157BA3DDB2B5ED916BF095FE413C04870BFA347A662A7EF4BDF4FD4F053D9F"
POSITION_TOLERANCE = 0.001
STADIUM_ROOTS = (
    "ST_EAST_01_Root",
    "ST_EAST_02_Root",
    "ST_WEST_01_Root",
    "ST_WEST_02_Root",
)
ROOT_BY_ID = {
    "ST_EAST_01": "ST_EAST_01_Root",
    "ST_EAST_02": "ST_EAST_02_Root",
    "ST_WEST_01": "ST_WEST_01_Root",
    "ST_WEST_02": "ST_WEST_02_Root",
}


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


def descendants(root):
    stack = list(root.children)
    result = []
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def has_ancestor(obj, ancestor):
    current = obj.parent
    while current is not None:
        if current == ancestor:
            return True
        current = current.parent
    return False


def triangle_count(meshes):
    total = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def world_bounds(objects):
    points = []
    for obj in objects:
        if obj.type == "MESH":
            points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def point_camera(camera, target):
    forward = (target - camera.location).normalized()
    physical_up = Vector((0.0, -1.0, 0.0))
    up_hint = Vector((0.0, 0.0, 1.0)) if abs(forward.dot(physical_up)) > 0.95 else physical_up
    right = forward.cross(up_hint).normalized()
    corrected_up = right.cross(forward).normalized()
    camera.rotation_euler = Matrix((right, corrected_up, -forward)).transposed().to_euler()


def create_camera(name, location, target, lens=52.0, ortho_scale=None):
    data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    data.clip_start = 5.0
    data.clip_end = 5000.0
    if ortho_scale is None:
        data.type = "PERSP"
        data.lens = lens
    else:
        data.type = "ORTHO"
        data.ortho_scale = ortho_scale
    point_camera(obj, Vector(target))
    return obj


def render(scene, camera, path, resolution):
    scene.camera = camera
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    if sha256(SOURCE) != EXPECTED_SOURCE_HASH:
        raise RuntimeError("campus_refined_v004.glb 哈希已变化")
    expected_report = json.loads(STADIUM_REPORT.read_text(encoding="utf-8"))

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(MODEL))

    refined_buildings = bpy.data.objects.get("REFINED_BUILDINGS")
    refined_landmarks = bpy.data.objects.get("REFINED_LANDMARKS")
    refined_sports = bpy.data.objects.get("REFINED_SPORTS")
    auditorium = bpy.data.objects.get("AUDITORIUM_REFINED_ROOT")
    south_gate = bpy.data.objects.get("SOUTH_GATE_REFINED_ROOT")
    library = bpy.data.objects.get("LIBRARY_REFINED_ROOT")
    fusion = bpy.data.objects.get("FUS_Root")
    required = (
        refined_buildings,
        refined_landmarks,
        refined_sports,
        auditorium,
        south_gate,
        library,
        fusion,
    )
    if any(obj is None for obj in required):
        raise RuntimeError("v005 缺少既有精修资产或 REFINED_SPORTS")
    if not all(has_ancestor(obj, refined_buildings) for obj in (auditorium, south_gate, library)):
        raise RuntimeError("原有精修建筑层级发生变化")
    if not has_ancestor(fusion, refined_landmarks):
        raise RuntimeError("融合雕塑层级发生变化")

    stadium_roots = {name: bpy.data.objects.get(name) for name in STADIUM_ROOTS}
    if any(root is None or root.parent != refined_sports for root in stadium_roots.values()):
        raise RuntimeError("四场未正确挂接到 REFINED_SPORTS")
    sports_descendants = descendants(refined_sports)
    sports_meshes = [obj for obj in sports_descendants if obj.type == "MESH"]
    sports_triangles = triangle_count(sports_meshes)
    sports_materials = sorted({
        slot.material.name
        for obj in sports_meshes
        for slot in obj.material_slots
        if slot.material
    })
    sports_material_colors = {
        name: [float(value) for value in bpy.data.materials[name].diffuse_color]
        for name in sports_materials
    }
    if len(sports_meshes) != 310 or sports_triangles != 6494:
        raise RuntimeError(
            f"体育场 GLB 回读几何数量异常: meshes={len(sports_meshes)} triangles={sports_triangles}"
        )
    if len(sports_materials) != 10:
        raise RuntimeError(f"体育场共享材质数量异常: {len(sports_materials)}")
    track_color = sports_material_colors["ST_Track_Red"]
    pitch_color = sports_material_colors["ST_Pitch_Green"]
    if not (track_color[0] > track_color[1] * 3.0 and pitch_color[1] > pitch_color[0] * 2.0):
        raise RuntimeError("体育场红色跑道或绿色球场材质未正确写入 GLB")

    position_errors = {}
    for stadium_id, root_name in ROOT_BY_ID.items():
        root = stadium_roots[root_name]
        expected = Vector(expected_report["stadiums"][stadium_id]["rootWorldLocation"])
        error = (root.matrix_world.translation - expected).length
        position_errors[stadium_id] = error
        if error > POSITION_TOLERANCE:
            raise RuntimeError(f"{stadium_id} 定位漂移: {error}m")
        if bpy.data.objects.get(f"{stadium_id}_LevelBase") is None:
            raise RuntimeError(f"{stadium_id} 缺少找平基座")

    east01 = stadium_roots["ST_EAST_01_Root"]
    east01_names = {obj.name for obj in descendants(east01)}
    if "ST_EAST_01_Stand_Roof" not in east01_names:
        raise RuntimeError("东一缺少西侧带顶棚主看台")
    for root_name in STADIUM_ROOTS[1:]:
        if any("_Stand_" in obj.name for obj in descendants(stadium_roots[root_name])):
            raise RuntimeError(f"{root_name} 意外包含大型看台")

    decal = bpy.data.objects.get("SG_Nameplate_Decal")
    texture_images = [image for image in bpy.data.images if "south_gate_nameplate" in image.name]
    if decal is None or not texture_images:
        raise RuntimeError("南门校名贴图在 v005 中缺失")

    minimum, maximum = world_bounds(sports_meshes)
    all_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    all_triangles = triangle_count(all_meshes)
    all_materials = sorted({
        slot.material.name
        for obj in all_meshes
        for slot in obj.material_slots
        if slot.material
    })

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)
    PREVIEWS.mkdir(parents=True, exist_ok=True)

    cameras = [
        ("Campus_v005_AllTop", (970.0, -2200.0, 1010.0), (970.0, 0.0, 1010.0), None, 2150.0, "campus_all_top.png", (1500, 1500)),
        ("Campus_v005_EastTop", (1750.0, -650.0, 1050.0), (1750.0, 0.0, 1050.0), None, 850.0, "east_stadiums_top.png", (1200, 1400)),
        ("Campus_v005_WestTop", (150.0, -650.0, 860.0), (150.0, 0.0, 860.0), None, 850.0, "west_stadiums_top.png", (1200, 1400)),
        ("Campus_v005_East01Mid", (2050.0, -180.0, 515.0), (1752.896, -2.0, 904.499), 62.0, None, "east_01_mid.png", (1400, 900)),
        ("Campus_v005_AllOblique", (2650.0, -1850.0, -650.0), (970.0, 0.0, 980.0), 58.0, None, "campus_all_oblique.png", (1600, 1000)),
    ]
    camera_objects = []
    for name, location, target, lens, ortho_scale, filename, resolution in cameras:
        camera = create_camera(name, location, target, lens or 52.0, ortho_scale)
        camera_objects.append(camera)
        render(scene, camera, PREVIEWS / filename, resolution)
    for camera in camera_objects:
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
            "fusionSculpturePresent": True,
            "refinedSportsPresent": True,
            "fourStadiumRootsPresent": True,
            "fourStadiumLocationsPreserved": True,
            "east01RoofedWestStandPresent": True,
            "otherThreeLargeStandsAbsent": True,
            "fourLevelingBasesPresent": True,
            "southGateNameplateTextureLoaded": True,
            "sourceV004Unmodified": True,
        },
        "stadiums": {
            "meshCount": len(sports_meshes),
            "triangleCountAfterGlbRoundTrip": sports_triangles,
            "materialCount": len(sports_materials),
            "materials": sports_materials,
            "materialBaseColors": sports_material_colors,
            "positionErrorsMeters": position_errors,
            "boundsBlender": [list(minimum), list(maximum)],
        },
        "wholeModel": {
            "meshObjectCountAfterBlenderImport": len(all_meshes),
            "triangleCountAfterBlenderImport": all_triangles,
            "materialCountAfterBlenderImport": len(all_materials),
        },
        "validationBlend": str(BLEND),
        "previews": [str(PREVIEWS / item[5]) for item in cameras],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
