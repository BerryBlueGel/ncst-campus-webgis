import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_refined_v003.glb"
BLEND_OUTPUT = ROOT / "blender" / "fusion_sculpture_working_v001.blend"
REPORT_OUTPUT = ROOT / "blender" / "fusion_sculpture_v001_report.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "fusion_sculpture_v001"

ROOT_X = 992.5923964337298
ROOT_Z = 362.7571699554929
PLACEMENT_STATUS = "USER_CONFIRMED_VIEWPORT_CROSSHAIR_LOCATION"
PLANAR_POSITION_LOCKED = True


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
        if collection.name not in bpy.context.scene.collection.children:
            bpy.context.scene.collection.children.link(collection)
    elif collection.name not in parent.children:
        parent.children.link(collection)
    return collection


def link_object(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def make_material(name, base_color, metallic=0.0, roughness=0.55):
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name)
    material.diffuse_color = (*base_color, 1.0)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        nodes.clear()
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        output = nodes.new("ShaderNodeOutputMaterial")
        material.node_tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return material


def raycast_object_world(obj, origin_world, direction_world, max_distance=2000.0):
    inverse = obj.matrix_world.inverted()
    origin_local = inverse @ origin_world
    direction_local = (inverse.to_3x3() @ direction_world).normalized()
    hit, location, normal, face_index = obj.ray_cast(
        origin_local, direction_local, distance=max_distance
    )
    if not hit:
        return None
    world_location = obj.matrix_world @ location
    return {
        "object": obj.name,
        "faceIndex": face_index,
        "world": list(world_location),
        "distance": (world_location - origin_world).length,
    }


def ground_raycast(x, z):
    origin = Vector((x, -500.0, z))
    direction = Vector((0.0, 1.0, 0.0))
    hits = []
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and "TPX_Ground" in obj.name:
            hit = raycast_object_world(obj, origin, direction)
            if hit:
                hits.append(hit)
    if not hits:
        raise RuntimeError(f"Ground raycast missed at X={x}, Z={z}")
    return min(hits, key=lambda item: item["distance"])


def mesh_object(name, vertices, faces, collection, material, parent=None):
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    if parent:
        obj.parent = parent
    obj.data.materials.append(material)
    return obj


def cylinder_y(name, radius, height, y_bottom, segments, collection, material, parent):
    # Local -Y is up. y_bottom is the lower/embedded surface, top is y_bottom-height.
    y_top = y_bottom - height
    vertices = []
    for y in (y_bottom, y_top):
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            vertices.append((radius * math.cos(angle), y, radius * math.sin(angle)))
    faces = []
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple(range(segments, segments * 2)))
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, j, segments + j, segments + i))
    return mesh_object(name, vertices, faces, collection, material, parent)


def catmull_rom(p0, p1, p2, p3, t):
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    )


def sample_controls(controls, widths, tilts, samples_per_segment=7):
    points = [Vector(p) for p in controls]
    padded = [points[0]] + points + [points[-1]]
    samples = []
    for segment in range(len(points) - 1):
        for step in range(samples_per_segment):
            t = step / samples_per_segment
            point = catmull_rom(
                padded[segment], padded[segment + 1], padded[segment + 2],
                padded[segment + 3], t
            )
            width = widths[segment] * (1.0 - t) + widths[segment + 1] * t
            tilt = tilts[segment] * (1.0 - t) + tilts[segment + 1] * t
            samples.append((point, width, tilt))
    samples.append((points[-1], widths[-1], tilts[-1]))
    return samples


def build_ribbon(name, controls, widths, tilts_deg, thickness, collection, material, parent):
    tilts = [math.radians(value) for value in tilts_deg]
    samples = sample_controls(controls, widths, tilts)
    vertices = []

    for index, (center, width, tilt) in enumerate(samples):
        if index == 0:
            tangent = (samples[1][0] - center).normalized()
        elif index == len(samples) - 1:
            tangent = (center - samples[index - 1][0]).normalized()
        else:
            tangent = (samples[index + 1][0] - samples[index - 1][0]).normalized()

        planar = Vector((-tangent.y, tangent.x, 0.0))
        if planar.length < 1e-6:
            planar = Vector((1.0, 0.0, 0.0))
        width_axis = planar.normalized()
        depth_axis = tangent.cross(width_axis).normalized()
        width_axis = (
            width_axis * math.cos(tilt) + depth_axis * math.sin(tilt)
        ).normalized()
        depth_axis = tangent.cross(width_axis).normalized()

        half_width = width * 0.5
        half_thickness = thickness * 0.5
        vertices.extend([
            tuple(center + width_axis * half_width + depth_axis * half_thickness),
            tuple(center - width_axis * half_width + depth_axis * half_thickness),
            tuple(center - width_axis * half_width - depth_axis * half_thickness),
            tuple(center + width_axis * half_width - depth_axis * half_thickness),
        ])

    faces = []
    for index in range(len(samples) - 1):
        a = index * 4
        b = (index + 1) * 4
        faces.extend([
            (a + 0, b + 0, b + 1, a + 1),
            (a + 1, b + 1, b + 2, a + 2),
            (a + 2, b + 2, b + 3, a + 3),
            (a + 3, b + 3, b + 0, a + 0),
        ])
    faces.append((3, 2, 1, 0))
    end = (len(samples) - 1) * 4
    faces.append((end + 0, end + 1, end + 2, end + 3))

    obj = mesh_object(name, vertices, faces, collection, material, parent)
    obj["fusion_sculpture"] = True
    obj["source_geometry"] = "provisional photo-derived ribbon path"
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def build_guide(name, controls, collection, material, parent):
    curve = bpy.data.curves.new(f"{name}_Curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 10
    curve.bevel_depth = 0.035
    curve.bevel_resolution = 0
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(controls) - 1)
    for point, coordinate in zip(spline.bezier_points, controls):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(material)
    obj["fusion_sculpture_guide"] = True
    return obj


def point_camera(camera, target, world_up=Vector((0.0, -1.0, 0.0))):
    forward = (target - camera.location).normalized()
    right = forward.cross(world_up).normalized()
    corrected_up = right.cross(forward).normalized()
    camera.rotation_euler = Matrix((right, corrected_up, -forward)).transposed().to_euler()


def create_camera(name, location, target, lens=55.0, ortho_scale=None):
    data = bpy.data.cameras.new(name)
    camera = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = location
    if ortho_scale is not None:
        data.type = "ORTHO"
        data.ortho_scale = ortho_scale
    else:
        data.lens = lens
    point_camera(camera, Vector(target))
    return camera


def render(scene, camera, path, resolution=(1200, 900)):
    scene.camera = camera
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def set_render_visibility(objects, visible):
    for obj in objects:
        obj.hide_render = not visible


def main():
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(MODEL))

    samples = {
        "center": (ROOT_X, ROOT_Z),
        "west": (ROOT_X - 4.5, ROOT_Z),
        "east": (ROOT_X + 4.5, ROOT_Z),
        "south": (ROOT_X, ROOT_Z - 4.5),
        "north": (ROOT_X, ROOT_Z + 4.5),
    }
    raycasts = {name: ground_raycast(x, z) for name, (x, z) in samples.items()}
    ground_values = [hit["world"][1] for hit in raycasts.values()]
    ground_y = sum(ground_values) / len(ground_values)
    ground_spread = max(ground_values) - min(ground_values)

    landmarks = ensure_collection("REFINED_LANDMARKS")
    fusion = ensure_collection("FusionSculpture", landmarks)
    guides_collection = ensure_collection("FusionSculpture_GUIDES", fusion)
    solids_collection = ensure_collection("FusionSculpture_SOLIDS", fusion)

    root = bpy.data.objects.new("FUS_Root", None)
    fusion.objects.link(root)
    root.location = (ROOT_X, ground_y, ROOT_Z)
    root["placement_status"] = PLACEMENT_STATUS
    root["planar_position_locked"] = PLANAR_POSITION_LOCKED
    root["position_is_surveyed"] = False
    root["vertical_axis"] = "Blender -Y"
    root["dimensions_status"] = "PROVISIONAL_PHOTO_DERIVED"
    root["ground_raycast_spread_m"] = ground_spread

    bronze_dark = make_material("MAT_FUS_Bronze_Dark", (0.105, 0.045, 0.025), 0.78, 0.28)
    bronze_warm = make_material("MAT_FUS_Bronze_Warm", (0.42, 0.19, 0.065), 0.72, 0.25)
    base_stone = make_material("MAT_FUS_Base_Stone", (0.72, 0.72, 0.68), 0.05, 0.7)
    landscape_green = make_material("MAT_FUS_Landscape", (0.12, 0.24, 0.08), 0.0, 0.9)
    guide_material = make_material("MAT_FUS_Guide", (0.025, 0.025, 0.025), 0.0, 0.8)

    landscape = cylinder_y(
        "FUS_LandscapeRing", 5.2, 0.10, 0.025, 40,
        solids_collection, landscape_green, root
    )
    landscape["fusion_sculpture"] = True
    base = cylinder_y(
        "FUS_Base", 3.65, 0.46, 0.025, 24,
        solids_collection, base_stone, root
    )
    base["fusion_sculpture"] = True

    # Local coordinates: X east-west, -Y up, Z depth. Broad faces are aligned
    # to the north-south ceremonial axis. Values are intentionally asymmetric.
    ribbons = [
        {
            "name": "FUS_Ribbon_01_WarmFront",
            "material": bronze_warm,
            "controls_up": [
                (-2.55, 0.46, -0.30), (-2.00, 2.2, -0.50), (-1.30, 4.2, -0.42),
                (-0.35, 6.2, -0.30), (1.05, 8.2, -0.16), (1.25, 9.9, 0.02),
                (0.55, 11.2, 0.16), (-0.10, 12.8, 0.25),
            ],
            "widths": [0.95, 0.92, 0.82, 0.72, 0.58, 0.45, 0.27, 0.035],
            "tilts": [-8, 8, 28, 48, 67, 82, 100, 112],
            "thickness": 0.14,
        },
        {
            "name": "FUS_Ribbon_02_DarkOuterRight",
            "material": bronze_dark,
            "controls_up": [
                (2.55, 0.46, 0.28), (2.00, 2.5, 0.42), (1.70, 4.5, 0.38),
                (1.65, 6.4, 0.32), (1.05, 8.3, 0.24), (0.18, 9.8, 0.12),
                (-0.62, 11.1, 0.00), (-0.95, 13.4, -0.12),
            ],
            "widths": [0.92, 0.88, 0.80, 0.68, 0.56, 0.42, 0.26, 0.035],
            "tilts": [12, -2, -22, -43, -62, -78, -96, -108],
            "thickness": 0.14,
        },
        {
            "name": "FUS_Ribbon_03_DarkOuterLeft",
            "material": bronze_dark,
            "controls_up": [
                (-1.85, 0.46, 0.45), (-1.38, 2.0, 0.52), (-1.72, 4.0, 0.48),
                (-1.62, 5.9, 0.39), (-1.05, 7.9, 0.22), (-0.20, 9.5, 0.02),
                (0.62, 10.9, -0.16), (0.88, 12.4, -0.24), (0.70, 14.0, -0.30),
            ],
            "widths": [0.86, 0.82, 0.74, 0.64, 0.54, 0.43, 0.31, 0.18, 0.035],
            "tilts": [22, 35, 54, 72, 90, 108, 126, 139, 150],
            "thickness": 0.13,
        },
        {
            "name": "FUS_Ribbon_04_DarkInner",
            "material": bronze_dark,
            "controls_up": [
                (-0.85, 0.46, -0.58), (-0.18, 2.3, -0.53), (0.66, 4.0, -0.44),
                (0.92, 5.9, -0.32), (0.60, 7.5, -0.16), (-0.05, 8.9, 0.02),
                (-0.58, 10.3, 0.17), (-0.38, 11.8, 0.27), (0.02, 13.15, 0.34),
            ],
            "widths": [0.74, 0.70, 0.61, 0.53, 0.46, 0.37, 0.28, 0.16, 0.03],
            "tilts": [-18, -2, 19, 41, 64, 86, 108, 128, 143],
            "thickness": 0.12,
        },
        {
            "name": "FUS_Ribbon_05_WarmInner",
            "material": bronze_warm,
            "controls_up": [
                (0.92, 0.46, 0.60), (0.28, 2.2, 0.54), (-0.56, 3.9, 0.45),
                (-0.92, 5.7, 0.33), (-0.66, 7.3, 0.17), (-0.02, 8.7, -0.01),
                (0.48, 10.0, -0.17), (0.38, 11.4, -0.27), (0.14, 12.75, -0.34),
            ],
            "widths": [0.76, 0.72, 0.63, 0.55, 0.47, 0.38, 0.28, 0.16, 0.03],
            "tilts": [18, 1, -20, -43, -66, -88, -110, -130, -145],
            "thickness": 0.12,
        },
    ]

    guide_objects = []
    ribbon_objects = []
    max_height = 0.0
    min_x = float("inf")
    max_x = float("-inf")
    for index, spec in enumerate(ribbons, start=1):
        controls = [(x, -height, z) for x, height, z in spec["controls_up"]]
        max_height = max(max_height, max(height for _, height, _ in spec["controls_up"]))
        min_x = min(min_x, min(x for x, _, _ in spec["controls_up"]))
        max_x = max(max_x, max(x for x, _, _ in spec["controls_up"]))
        guide = build_guide(
            f"FUS_Guide_{index:02d}", controls, guides_collection,
            guide_material, root
        )
        guide_objects.append(guide)
        ribbon = build_ribbon(
            spec["name"], controls, spec["widths"], spec["tilts"],
            spec["thickness"], solids_collection, spec["material"], root
        )
        ribbon_objects.append(ribbon)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("FusionPreviewWorld")
    scene.world.color = (0.05, 0.065, 0.085)
    scene.render.resolution_percentage = 100

    sun_data = bpy.data.lights.new("FUS_Sun", "SUN")
    sun_data.energy = 2.4
    sun_data.angle = math.radians(20)
    sun = bpy.data.objects.new("FUS_Sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(28), math.radians(-18), math.radians(-35))

    area_data = bpy.data.lights.new("FUS_Fill", "AREA")
    area_data.energy = 900.0
    area_data.shape = "DISK"
    area_data.size = 10.0
    area = bpy.data.objects.new("FUS_Fill", area_data)
    scene.collection.objects.link(area)
    area.location = (ROOT_X - 12.0, ground_y - 12.0, ROOT_Z - 16.0)
    point_camera(area, Vector((ROOT_X, ground_y - 6.5, ROOT_Z)))

    target = (ROOT_X, ground_y - 6.7, ROOT_Z)
    cameras = {
        "south": create_camera(
            "FUS_Camera_South", (ROOT_X, ground_y - 6.2, ROOT_Z - 32.0), target, 58.0
        ),
        "north": create_camera(
            "FUS_Camera_North", (ROOT_X, ground_y - 6.2, ROOT_Z + 32.0), target, 58.0
        ),
        "southeast": create_camera(
            "FUS_Camera_Southeast", (ROOT_X + 24.0, ground_y - 8.5, ROOT_Z - 29.0), target, 60.0
        ),
        "southwest": create_camera(
            "FUS_Camera_Southwest", (ROOT_X - 24.0, ground_y - 8.5, ROOT_Z - 29.0), target, 60.0
        ),
        "top": create_camera(
            "FUS_Camera_Top", (ROOT_X, ground_y - 55.0, ROOT_Z),
            (ROOT_X, ground_y, ROOT_Z), 50.0, 18.0
        ),
        "library_mid": create_camera(
            "FUS_Camera_LibraryMid", (ROOT_X + 25.0, ground_y - 12.0, ROOT_Z - 80.0),
            (ROOT_X, ground_y - 5.5, ROOT_Z + 8.0), 62.0
        ),
        "south_gate_mid": create_camera(
            "FUS_Camera_SouthGateMid", (ROOT_X - 20.0, ground_y - 11.0, ROOT_Z + 75.0),
            (ROOT_X, ground_y - 5.5, ROOT_Z - 8.0), 62.0
        ),
    }

    imported_objects = [
        obj for obj in scene.objects
        if not obj.name.startswith("FUS_") and obj.type not in {"CAMERA", "LIGHT"}
    ]
    solid_objects = ribbon_objects + [base, landscape]

    # Skeleton preview: isolate editable guides and plinth.
    set_render_visibility(imported_objects, False)
    set_render_visibility(ribbon_objects, False)
    set_render_visibility([base, landscape], True)
    set_render_visibility(guide_objects, True)
    render(scene, cameras["south"], PREVIEW_DIR / "front_curve_preview.png", (1000, 1200))

    # Solid close-up previews remain isolated so the ribbon silhouette is clear.
    set_render_visibility(guide_objects, False)
    set_render_visibility(solid_objects, True)
    render(scene, cameras["south"], PREVIEW_DIR / "south.png", (1000, 1200))
    render(scene, cameras["north"], PREVIEW_DIR / "north.png", (1000, 1200))
    render(scene, cameras["southeast"], PREVIEW_DIR / "southeast_oblique.png", (1200, 1000))
    render(scene, cameras["southwest"], PREVIEW_DIR / "southwest_oblique.png", (1200, 1000))
    render(scene, cameras["top"], PREVIEW_DIR / "top.png", (1000, 1000))

    # Context previews show the refined campus, including the library and south gate.
    set_render_visibility(imported_objects, True)
    render(scene, cameras["library_mid"], PREVIEW_DIR / "library_direction_mid.png", (1400, 900))
    render(scene, cameras["south_gate_mid"], PREVIEW_DIR / "south_gate_direction_mid.png", (1400, 900))

    # Save the working file with solids visible and guides hidden but editable.
    for guide in guide_objects:
        guide.hide_render = True
        guide.hide_set(True)
    for obj in solid_objects + imported_objects:
        obj.hide_render = False

    triangle_count = sum(len(obj.data.loop_triangles) for obj in ribbon_objects)
    # loop_triangles is lazy until calculated.
    triangle_count = 0
    for obj in solid_objects:
        obj.data.calc_loop_triangles()
        triangle_count += len(obj.data.loop_triangles)

    material_names = sorted({
        slot.material.name
        for obj in solid_objects
        for slot in obj.material_slots
        if slot.material
    })

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUTPUT))

    report = {
        "status": "created_not_integrated",
        "baseModel": str(MODEL),
        "baseModelSha256": sha256(MODEL),
        "baseModelModified": False,
        "outputBlend": str(BLEND_OUTPUT),
        "placement": {
            "status": PLACEMENT_STATUS,
            "planarPositionLocked": True,
            "positionIsSurveyed": False,
            "rootBlenderXYZ": [ROOT_X, ground_y, ROOT_Z],
            "axisMapping": {"east": "+X", "north": "+Z", "height": "-Y"},
            "groundRaycasts": raycasts,
            "groundYMean": ground_y,
            "groundYSpreadMeters": ground_spread,
            "groundPolicy": "level plinth at five-point mean; underside embedded 0.025m",
        },
        "geometry": {
            "ribbonCount": len(ribbon_objects),
            "editableGuideCount": len(guide_objects),
            "provisionalHeightMeters": max_height,
            "provisionalMaximumWidthMeters": max_x - min_x,
            "dimensionStatus": "PROVISIONAL_PHOTO_DERIVED",
            "solidMeshCount": len(solid_objects),
            "triangleCount": triangle_count,
            "materialCount": len(material_names),
            "materials": material_names,
        },
        "recognitionFeatures": [
            "outward-splayed base",
            "large central almond-shaped void",
            "asymmetric upper crossing",
            "five pointed tips",
            "flattened ribbons rather than round tubes",
        ],
        "deferred": [
            "official dimensions",
            "fine patina textures",
            "individual shrubs and small lights",
            "integration into campus_refined_v004.glb",
        ],
        "previews": {path.stem: str(path) for path in PREVIEW_DIR.glob("*.png")},
    }
    REPORT_OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
