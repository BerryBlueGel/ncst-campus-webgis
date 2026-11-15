import hashlib
import json
import math
import re
import shutil
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "output" / "campus_refined_v004.glb"
INVENTORY = ROOT / "reference" / "stadiums" / "stadium_inventory.json"
BLEND_OUTPUT = ROOT / "blender" / "stadiums_working_v001.blend"
REPORT_OUTPUT = ROOT / "blender" / "stadiums_v001_report.json"
PREVIEW_DIR = ROOT / "blender" / "previews" / "stadiums_v001"

EXPECTED_BASE_HASH = "A6157BA3DDB2B5ED916BF095FE413C04870BFA347A662A7EF4BDF4FD4F053D9F"
STADIUM_IDS = ("ST_EAST_01", "ST_EAST_02", "ST_WEST_01", "ST_WEST_02")
TRACK_SEGMENTS_PER_CAP = 32
VISUAL_LANE_GUIDES = 6


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def material(name, color, roughness=0.8, metallic=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = next(
        (node for node in mat.node_tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled"),
        None,
    )
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    mat.use_backface_culling = False
    return mat


def mesh_object(name, vertices, faces, collection, mat=None, parent=None):
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def empty(name, collection, parent=None, location=(0.0, 0.0, 0.0)):
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 5.0
    obj.location = location
    if parent:
        obj.parent = parent
    return obj


def rotate_xz(x, z, angle_degrees):
    angle = math.radians(angle_degrees)
    c = math.cos(angle)
    s = math.sin(angle)
    return c * x + s * z, -s * x + c * z


def stadium_loop(length, width, straight_length, segments_per_cap=TRACK_SEGMENTS_PER_CAP):
    half_straight = straight_length / 2.0
    cap_depth = max(0.5, (length - straight_length) / 2.0)
    radius_x = width / 2.0
    points = []
    for index in range(segments_per_cap + 1):
        angle = math.pi * index / segments_per_cap
        points.append((radius_x * math.cos(angle), half_straight + cap_depth * math.sin(angle)))
    for index in range(segments_per_cap + 1):
        angle = math.pi + math.pi * index / segments_per_cap
        points.append((radius_x * math.cos(angle), -half_straight + cap_depth * math.sin(angle)))
    return points


def blend_loops(outer, inner, fraction):
    return [
        (
            outer[index][0] * (1.0 - fraction) + inner[index][0] * fraction,
            outer[index][1] * (1.0 - fraction) + inner[index][1] * fraction,
        )
        for index in range(len(outer))
    ]


def loop_world_vertices(loop, y, angle_degrees):
    vertices = []
    for x, z in loop:
        rx, rz = rotate_xz(x, z, angle_degrees)
        vertices.append((rx, y, rz))
    return vertices


def create_ring(name, outer, inner, y, angle_degrees, collection, mat, parent):
    vertices = loop_world_vertices(outer, y, angle_degrees)
    vertices.extend(loop_world_vertices(inner, y, angle_degrees))
    count = len(outer)
    faces = []
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    return mesh_object(name, vertices, faces, collection, mat, parent)


def create_filled_loop(name, loop, y, angle_degrees, collection, mat, parent):
    vertices = [(0.0, y, 0.0)] + loop_world_vertices(loop, y, angle_degrees)
    faces = []
    count = len(loop)
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((0, 1 + index, 1 + nxt))
    return mesh_object(name, vertices, faces, collection, mat, parent)


def create_extruded_loop(name, loop, top_y, bottom_y, angle_degrees, collection, mat, parent):
    top = loop_world_vertices(loop, top_y, angle_degrees)
    bottom = loop_world_vertices(loop, bottom_y, angle_degrees)
    vertices = top + bottom
    count = len(loop)
    faces = []
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    faces.append(tuple(range(count)))
    faces.append(tuple(range(count * 2 - 1, count - 1, -1)))
    return mesh_object(name, vertices, faces, collection, mat, parent)


def oriented_rect_vertices(cx, cz, width, length, y, angle_degrees):
    points = [
        (-width / 2.0, -length / 2.0),
        (width / 2.0, -length / 2.0),
        (width / 2.0, length / 2.0),
        (-width / 2.0, length / 2.0),
    ]
    result = []
    for x, z in points:
        rx, rz = rotate_xz(x, z, angle_degrees)
        result.append((cx + rx, y, cz + rz))
    return result


def create_rect(name, cx, cz, width, length, y, angle_degrees, collection, mat, parent):
    return mesh_object(
        name,
        oriented_rect_vertices(cx, cz, width, length, y, angle_degrees),
        [(0, 1, 2, 3)],
        collection,
        mat,
        parent,
    )


def create_box(name, cx, cz, width, length, top_y, bottom_y, angle_degrees, collection, mat, parent):
    top = oriented_rect_vertices(cx, cz, width, length, top_y, angle_degrees)
    bottom = oriented_rect_vertices(cx, cz, width, length, bottom_y, angle_degrees)
    vertices = top + bottom
    faces = [
        (0, 1, 2, 3),
        (7, 6, 5, 4),
        (0, 4, 5, 1),
        (1, 5, 6, 2),
        (2, 6, 7, 3),
        (3, 7, 4, 0),
    ]
    return mesh_object(name, vertices, faces, collection, mat, parent)


def create_circle_ring(name, cx, cz, radius, width, y, angle_degrees, collection, mat, parent, segments=48):
    outer = []
    inner = []
    for index in range(segments):
        angle = 2.0 * math.pi * index / segments
        outer.append((cx + (radius + width / 2.0) * math.cos(angle), cz + (radius + width / 2.0) * math.sin(angle)))
        inner.append((cx + (radius - width / 2.0) * math.cos(angle), cz + (radius - width / 2.0) * math.sin(angle)))
    return create_ring(name, outer, inner, y, angle_degrees, collection, mat, parent)


def rectangle_outline(prefix, width, length, line_width, y, angle, collection, mat, parent):
    objects = []
    objects.append(create_rect(f"{prefix}_North", 0.0, length / 2.0, width, line_width, y, angle, collection, mat, parent))
    objects.append(create_rect(f"{prefix}_South", 0.0, -length / 2.0, width, line_width, y, angle, collection, mat, parent))
    objects.append(create_rect(f"{prefix}_East", width / 2.0, 0.0, line_width, length, y, angle, collection, mat, parent))
    objects.append(create_rect(f"{prefix}_West", -width / 2.0, 0.0, line_width, length, y, angle, collection, mat, parent))
    return objects


def penalty_box(prefix, side_sign, pitch_length, y, angle, collection, mat, parent):
    depth = 16.5
    width = 40.32
    line = 0.11
    goal_z = side_sign * pitch_length / 2.0
    inner_z = goal_z - side_sign * depth
    objects = [
        create_rect(f"{prefix}_Line", 0.0, inner_z, width, line, y, angle, collection, mat, parent),
        create_rect(f"{prefix}_Left", -width / 2.0, (goal_z + inner_z) / 2.0, line, depth, y, angle, collection, mat, parent),
        create_rect(f"{prefix}_Right", width / 2.0, (goal_z + inner_z) / 2.0, line, depth, y, angle, collection, mat, parent),
    ]
    return objects


def raycast_object_world(obj, origin_world, direction_world, max_distance=2000.0):
    inverse = obj.matrix_world.inverted()
    origin_local = inverse @ origin_world
    direction_local = (inverse.to_3x3() @ direction_world).normalized()
    try:
        hit, location, normal, face_index = obj.ray_cast(origin_local, direction_local, distance=max_distance)
    except RuntimeError:
        return None
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


def terrain_surface_raycast(x, z):
    origin = Vector((x, -500.0, z))
    direction = Vector((0.0, 1.0, 0.0))
    hits = []
    tokens = ("TPX_Ground", "TPX_GreenAreas", "TPX_Roads")
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and any(token in obj.name for token in tokens):
            hit = raycast_object_world(obj, origin, direction)
            if hit:
                hits.append(hit)
    if not hits:
        raise RuntimeError(f"Terrain surface raycast missed at X={x}, Z={z}")
    return min(hits, key=lambda item: item["distance"])


def probe_stadium_ground(stadium):
    center_x, center_z = stadium["centerLocalXZ"]
    half_length = stadium["track"]["outerLengthMeters"] * 0.46
    half_width = stadium["track"]["outerWidthMeters"] * 0.46
    angle = stadium["orientationDegrees"]
    offsets = {
        "center": (0.0, 0.0),
        "north": (0.0, half_length),
        "south": (0.0, -half_length),
        "east": (half_width, 0.0),
        "west": (-half_width, 0.0),
    }
    probes = {}
    for label, (dx, dz) in offsets.items():
        rx, rz = rotate_xz(dx, dz, angle)
        probes[label] = ground_raycast(center_x + rx, center_z + rz)
    ground_values = [probe["world"][1] for probe in probes.values()]

    surface_samples = {}
    sample_index = 0
    for x_fraction in (-0.46, 0.0, 0.46):
        for z_fraction in (-0.46, -0.23, 0.0, 0.23, 0.46):
            dx = stadium["track"]["outerWidthMeters"] * x_fraction
            dz = stadium["track"]["outerLengthMeters"] * z_fraction
            rx, rz = rotate_xz(dx, dz, angle)
            surface_samples[f"grid_{sample_index:02d}"] = terrain_surface_raycast(center_x + rx, center_z + rz)
            sample_index += 1
    surface_values = [sample["world"][1] for sample in surface_samples.values()]
    leveling_origin_y = min(surface_values) - 0.18
    level_base_bottom_local_y = max(surface_values) - leveling_origin_y + 0.10
    return {
        "groundProbes": probes,
        "groundYMean": sum(ground_values) / len(ground_values),
        "groundYSpreadMeters": max(ground_values) - min(ground_values),
        "surfaceSamples": surface_samples,
        "surfaceYSpreadMeters": max(surface_values) - min(surface_values),
        "levelingOriginY": leveling_origin_y,
        "levelBaseBottomLocalY": level_base_bottom_local_y,
    }


def parse_layout(text, count):
    if not text:
        return 1, max(1, int(count or 1))
    row_match = re.match(r"(\d+) rows? x (\d+)", text)
    if row_match:
        return int(row_match.group(1)), int(row_match.group(2))
    column_match = re.match(r"(\d+) columns? x (\d+)", text)
    if column_match:
        return int(column_match.group(2)), int(column_match.group(1))
    return 1, max(1, int(count or 1))


def create_auxiliary_group(stadium_id, court, sports_root, collection, materials):
    points = court["geometryLocalEN"]
    xs = [float(point[0]) for point in points]
    zs = [float(point[1]) for point in points]
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    center_x = (min_x + max_x) / 2.0
    center_z = (min_z + max_z) / 2.0
    width = max_x - min_x
    length = max_z - min_z
    sample_points = {
        "center": (center_x, center_z),
        "nw": (min_x, max_z),
        "ne": (max_x, max_z),
        "sw": (min_x, min_z),
        "se": (max_x, min_z),
    }
    hits = {label: terrain_surface_raycast(x, z) for label, (x, z) in sample_points.items()}
    values = [hit["world"][1] for hit in hits.values()]
    ground_y = min(values) - 0.10
    bottom_local_y = max(values) - ground_y + 0.06
    root = empty(
        f"{court['id']}_Root",
        collection,
        sports_root,
        (
            center_x - sports_root.location.x,
            ground_y - sports_root.location.y,
            center_z - sports_root.location.z,
        ),
    )
    root["source_status"] = court.get("confidence", "UNKNOWN")
    root["facility_type"] = court.get("type", "unknown")
    root["count_approx"] = int(court.get("countApprox") or 0)
    root["crosses_road"] = bool(court.get("crossesRoad"))
    root["geometry_status"] = "ILLUSTRATIVE_PLAN_APPROXIMATE"

    mat_key = court.get("type", "")
    if mat_key == "basketball":
        surface_mat = materials["court_basketball"]
    elif mat_key == "tennis_like":
        surface_mat = materials["court_tennis"]
    else:
        surface_mat = materials["court_volleyball"]
    objects = [
        create_box(
            f"{court['id']}_LevelBase",
            0.0,
            0.0,
            width,
            length,
            -0.018,
            bottom_local_y,
            0.0,
            collection,
            materials["concrete"],
            root,
        ),
        create_rect(
            f"{court['id']}_Surface",
            0.0,
            0.0,
            width,
            length,
            -0.035,
            0.0,
            collection,
            surface_mat,
            root,
        )
    ]

    rows, columns = parse_layout(court.get("layout"), court.get("countApprox"))
    line_y = -0.055
    line_width = 0.10
    for column in range(1, columns):
        x = -width / 2.0 + width * column / columns
        objects.append(create_rect(f"{court['id']}_GridV_{column:02d}", x, 0.0, line_width, length, line_y, 0.0, collection, materials["line"], root))
    for row in range(1, rows):
        z = -length / 2.0 + length * row / rows
        objects.append(create_rect(f"{court['id']}_GridH_{row:02d}", 0.0, z, width, line_width, line_y, 0.0, collection, materials["line"], root))
    objects.extend(rectangle_outline(f"{court['id']}_Border", width, length, line_width, line_y, 0.0, collection, materials["line"], root))
    return root, objects, {
        "terrainSurfaceRaycasts": hits,
        "surfaceYSpreadMeters": max(values) - min(values),
        "rows": rows,
        "columns": columns,
    }


def create_goal(prefix, pitch_length, side_sign, angle, root, collection, materials):
    goal_width = 7.32
    goal_height = 2.44
    thickness = 0.13
    z = side_sign * pitch_length / 2.0
    objects = []
    for x_index, x in enumerate((-goal_width / 2.0, goal_width / 2.0), 1):
        objects.append(create_box(f"{prefix}_Post_{x_index}", x, z, thickness, thickness, -goal_height, -0.02, angle, collection, materials["metal"], root))
    objects.append(create_box(f"{prefix}_Crossbar", 0.0, z, goal_width + thickness, thickness, -goal_height - thickness, -goal_height, angle, collection, materials["metal"], root))
    return objects


def create_stand(stadium, sports_root, collection, materials):
    stand = stadium["stand"]
    points = stand["geometryLocalEN"]
    xs = [float(point[0]) for point in points]
    zs = [float(point[1]) for point in points]
    center_x = (min(xs) + max(xs)) / 2.0
    center_z = (min(zs) + max(zs)) / 2.0
    width = max(xs) - min(xs)
    length = max(zs) - min(zs)
    hit = terrain_surface_raycast(center_x, center_z)
    ground_y = hit["world"][1] - 0.10
    root = empty(
        "ST_EAST_01_Stand_Root",
        collection,
        sports_root,
        (
            center_x - sports_root.location.x,
            ground_y - sports_root.location.y,
            center_z - sports_root.location.z,
        ),
    )
    root["evidence"] = "LOCAL_PLAN_AND_BUILDING_FOOTPRINT"
    root["height_status"] = "PROVISIONAL"
    root["roof_confirmed_on_plan"] = True
    root["rostrum_status"] = "PROVISIONAL_SIMPLIFIED"

    objects = []
    tier_count = 5
    tier_depth = width * 0.78 / tier_count
    east_edge = width / 2.0 - width * 0.06
    for index in range(tier_count):
        tier_center_x = east_edge - tier_depth * (index + 0.5)
        height = 0.55 + 0.52 * index
        objects.append(create_box(f"ST_EAST_01_Stand_Tier_{index + 1:02d}", tier_center_x, 0.0, tier_depth * 1.02, length * 0.95, -height, 0.05, 0.0, collection, materials["concrete"], root))

    roof_height = 8.2
    roof_width = width * 0.72
    roof_length = length * 0.93
    roof_center_x = -width * 0.10
    objects.append(create_box("ST_EAST_01_Stand_Roof", roof_center_x, 0.0, roof_width, roof_length, -roof_height - 0.30, -roof_height, 0.0, collection, materials["roof"], root))
    for index in range(8):
        z = -roof_length * 0.44 + roof_length * 0.88 * index / 7.0
        objects.append(create_box(f"ST_EAST_01_Stand_Column_{index + 1:02d}", -width * 0.38, z, 0.25, 0.25, -roof_height, 0.02, 0.0, collection, materials["metal"], root))
    objects.append(create_box("ST_EAST_01_Stand_Rostrum_Provisional", width * 0.33, 0.0, width * 0.18, min(34.0, length * 0.24), -1.45, -0.02, 0.0, collection, materials["concrete"], root))
    return root, objects, hit


def create_stadium(stadium, sports_root, collection, materials):
    stadium_id = stadium["id"]
    center_x, center_z = stadium["centerLocalXZ"]
    ground = probe_stadium_ground(stadium)
    ground_y = ground["levelingOriginY"]
    root = empty(f"{stadium_id}_Root", collection, sports_root, (center_x, ground_y, center_z))
    root["source_id"] = stadium_id
    root["official_name"] = stadium.get("officialName") or ""
    root["name_status"] = stadium.get("nameStatus") or ""
    root["center_local_x"] = center_x
    root["center_local_z"] = center_z
    root["orientation_degrees"] = float(stadium["orientationDegrees"])
    root["track_length_m"] = float(stadium["track"]["outerLengthMeters"])
    root["track_width_m"] = float(stadium["track"]["outerWidthMeters"])
    root["pitch_length_m"] = float(stadium["footballPitch"]["lengthMeters"])
    root["pitch_width_m"] = float(stadium["footballPitch"]["widthMeters"])
    root["ground_y_mean"] = ground["groundYMean"]
    root["ground_y_spread_m"] = ground["groundYSpreadMeters"]
    root["surface_y_spread_m"] = ground["surfaceYSpreadMeters"]
    root["leveling_origin_y"] = ground_y
    root["axis_mapping"] = "X=east, Z=north, -Y=up"
    root["integration_status"] = "NOT_INTEGRATED"

    track_length = float(stadium["track"]["outerLengthMeters"])
    track_width = float(stadium["track"]["outerWidthMeters"])
    straight = float(stadium["track"]["straightLengthMeters"])
    infield_length = float(stadium["infield"]["lengthMeters"])
    infield_width = float(stadium["infield"]["widthMeters"])
    inner_straight = max(20.0, straight - (track_length - infield_length))
    angle = float(stadium["orientationDegrees"])

    outer_loop = stadium_loop(track_length, track_width, straight)
    inner_loop = stadium_loop(infield_length, infield_width, inner_straight)
    objects = []
    objects.append(create_extruded_loop(f"{stadium_id}_LevelBase", outer_loop, -0.018, ground["levelBaseBottomLocalY"], angle, collection, materials["concrete"], root))
    objects.append(create_ring(f"{stadium_id}_Track_Surface", outer_loop, inner_loop, -0.045, angle, collection, materials["track"], root))
    objects.append(create_filled_loop(f"{stadium_id}_Infield", inner_loop, -0.055, angle, collection, materials["grass"], root))

    average_track_width = max(1.0, ((track_width - infield_width) + (track_length - infield_length)) / 4.0)
    line_fraction_half_width = min(0.012, 0.055 / average_track_width)
    for index in range(1, VISUAL_LANE_GUIDES + 1):
        fraction = index / (VISUAL_LANE_GUIDES + 1)
        outer_fraction = max(0.0, fraction - line_fraction_half_width)
        inner_fraction = min(1.0, fraction + line_fraction_half_width)
        line_outer = blend_loops(outer_loop, inner_loop, outer_fraction)
        line_inner = blend_loops(outer_loop, inner_loop, inner_fraction)
        objects.append(create_ring(f"{stadium_id}_LaneGuide_{index:02d}", line_outer, line_inner, -0.062, angle, collection, materials["line"], root))
    root["visual_lane_guides"] = VISUAL_LANE_GUIDES
    root["lane_count_status"] = "UNCONFIRMED_VISUAL_GUIDES_ONLY"

    pitch_length = float(stadium["footballPitch"]["lengthMeters"])
    pitch_width = float(stadium["footballPitch"]["widthMeters"])
    objects.append(create_rect(f"{stadium_id}_FootballPitch", 0.0, 0.0, pitch_width, pitch_length, -0.070, angle, collection, materials["pitch"], root))
    objects.extend(rectangle_outline(f"{stadium_id}_FootballLine", pitch_width, pitch_length, 0.11, -0.082, angle, collection, materials["line"], root))
    objects.append(create_rect(f"{stadium_id}_FootballCenterLine", 0.0, 0.0, pitch_width, 0.11, -0.082, angle, collection, materials["line"], root))
    objects.append(create_circle_ring(f"{stadium_id}_FootballCenterCircle", 0.0, 0.0, 9.15, 0.11, -0.082, angle, collection, materials["line"], root))
    objects.extend(penalty_box(f"{stadium_id}_Penalty_North", 1.0, pitch_length, -0.082, angle, collection, materials["line"], root))
    objects.extend(penalty_box(f"{stadium_id}_Penalty_South", -1.0, pitch_length, -0.082, angle, collection, materials["line"], root))
    objects.extend(create_goal(f"{stadium_id}_Goal_North", pitch_length, 1.0, angle, root, collection, materials))
    objects.extend(create_goal(f"{stadium_id}_Goal_South", pitch_length, -1.0, angle, root, collection, materials))

    aux_reports = []
    aux_objects = []
    for court in stadium.get("auxiliaryCourts", []):
        court_root, court_objects, court_report = create_auxiliary_group(stadium_id, court, root, collection, materials)
        aux_objects.extend([court_root] + court_objects)
        aux_reports.append({"id": court["id"], **court_report})

    stand_report = None
    stand_objects = []
    if stadium_id == "ST_EAST_01" and stadium.get("stand", {}).get("present") is True:
        stand_root, stand_meshes, stand_hit = create_stand(stadium, root, collection, materials)
        stand_objects = [stand_root] + stand_meshes
        stand_report = {"enabled": True, "groundRaycast": stand_hit, "meshCount": len(stand_meshes)}
    else:
        root["main_stand_status"] = "UNCERTAIN_NOT_MODELED"

    return {
        "root": root,
        "objects": objects + aux_objects + stand_objects,
        "groundRaycasts": ground["groundProbes"],
        "groundYMean": ground["groundYMean"],
        "groundYSpreadMeters": ground["groundYSpreadMeters"],
        "terrainSurfaceRaycasts": ground["surfaceSamples"],
        "surfaceYSpreadMeters": ground["surfaceYSpreadMeters"],
        "levelingOriginY": ground["levelingOriginY"],
        "levelBaseBottomLocalY": ground["levelBaseBottomLocalY"],
        "auxiliaryGroups": aux_reports,
        "stand": stand_report,
    }


def point_camera(camera, target):
    forward = (target - camera.location).normalized()
    physical_up = Vector((0.0, -1.0, 0.0))
    if abs(forward.dot(physical_up)) > 0.95:
        up_hint = Vector((0.0, 0.0, 1.0))
    else:
        up_hint = physical_up
    right = forward.cross(up_hint).normalized()
    corrected_up = right.cross(forward).normalized()
    camera.rotation_euler = Matrix((right, corrected_up, -forward)).transposed().to_euler()


def camera(name, collection, location, target, lens=52.0, ortho_scale=None):
    data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    # These are validation cameras hundreds of metres from a kilometre-scale
    # scene. A larger near plane prevents Workbench depth banding between the
    # deliberately close track, lane-line, pitch, and marking surfaces.
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


def render(scene, camera_obj, path, resolution):
    scene.camera = camera_obj
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def object_triangles(obj):
    if obj.type != "MESH":
        return 0
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def main():
    if sha256(MODEL) != EXPECTED_BASE_HASH:
        raise RuntimeError("campus_refined_v004.glb hash does not match the approved stable baseline")
    inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
    stadiums = {item["id"]: item for item in inventory["stadiums"]}
    missing = sorted(set(STADIUM_IDS) - set(stadiums))
    if missing:
        raise RuntimeError(f"Missing stadiums in inventory: {missing}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(MODEL))
    scene = bpy.context.scene
    collection = bpy.data.collections.new("STADIUM_REFINEMENT_WORKING")
    scene.collection.children.link(collection)
    sports_root = empty("REFINED_SPORTS", collection)
    sports_root["status"] = "WORKING_V001_NOT_INTEGRATED"
    sports_root["source_inventory"] = str(INVENTORY)
    sports_root["base_model_sha256"] = EXPECTED_BASE_HASH

    materials = {
        "track": material("ST_Track_Red", (0.46, 0.075, 0.045), 0.92),
        "grass": material("ST_Grass", (0.16, 0.34, 0.12), 0.96),
        "pitch": material("ST_Pitch_Green", (0.11, 0.43, 0.18), 0.96),
        "line": material("ST_Line_White", (0.94, 0.94, 0.90), 0.72),
        "concrete": material("ST_Concrete", (0.52, 0.54, 0.55), 0.90),
        "roof": material("ST_Roof", (0.82, 0.84, 0.84), 0.76),
        "metal": material("ST_Metal", (0.14, 0.16, 0.18), 0.60, 0.30),
        "court_basketball": material("ST_Court_Basketball", (0.49, 0.38, 0.20), 0.95),
        "court_tennis": material("ST_Court_Tennis", (0.18, 0.34, 0.24), 0.95),
        "court_volleyball": material("ST_Court_Volleyball", (0.28, 0.35, 0.42), 0.95),
    }

    build_results = {}
    for stadium_id in STADIUM_IDS:
        build_results[stadium_id] = create_stadium(stadiums[stadium_id], sports_root, collection, materials)

    old_east01_stand = bpy.data.objects.get("TPX_Buildings_1.001")
    if old_east01_stand:
        old_east01_stand.hide_render = True
        old_east01_stand.display_type = "WIRE"
        old_east01_stand["reference_status"] = "SOURCE_STAND_HIDDEN_FROM_WORKING_RENDER"

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "MATERIAL"
    # The campus spans about two kilometres; Workbench shadows produce severe
    # precision banding at this scale and can look like geometry overlap.
    # Keep validation previews flat so actual placement and silhouettes remain
    # readable. This changes previews only, not the stadium materials/geometry.
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.055, 0.065, 0.08)
    scene.view_settings.look = "AgX - Medium High Contrast"
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    cameras = []
    all_top = camera("ST_Camera_AllTop", collection, (970.0, -2200.0, 1010.0), (970.0, 0.0, 1010.0), ortho_scale=2150.0)
    cameras.append(all_top)
    render(scene, all_top, PREVIEW_DIR / "stadiums_all_top.png", (1500, 1500))
    shutil.copy2(PREVIEW_DIR / "stadiums_all_top.png", PREVIEW_DIR / "whole_campus_sports_view.png")

    top_aliases = {
        "ST_EAST_01": "east_01_top.png",
        "ST_EAST_02": "east_02_top.png",
        "ST_WEST_01": "west_01_top.png",
        "ST_WEST_02": "west_02_top.png",
    }
    for stadium_id in STADIUM_IDS:
        stadium = stadiums[stadium_id]
        cx, cz = stadium["centerLocalXZ"]
        gy = build_results[stadium_id]["levelingOriginY"]
        top = camera(f"ST_Camera_{stadium_id}_Top", collection, (cx, gy - 420.0, cz), (cx, gy, cz), ortho_scale=255.0)
        cameras.append(top)
        internal_top = PREVIEW_DIR / f"{stadium_id.lower()}_top.png"
        render(scene, top, internal_top, (1100, 1100))
        shutil.copy2(internal_top, PREVIEW_DIR / top_aliases[stadium_id])

    east = stadiums["ST_EAST_01"]
    ex, ez = east["centerLocalXZ"]
    ey = build_results["ST_EAST_01"]["levelingOriginY"]
    oblique = camera("ST_Camera_East01_Oblique", collection, (ex + 175.0, ey - 115.0, ez - 215.0), (ex, ey - 2.0, ez), lens=55.0)
    mid = camera("ST_Camera_East01_Mid", collection, (ex + 300.0, ey - 180.0, ez - 390.0), (ex, ey - 1.0, ez), lens=62.0)
    cameras.extend((oblique, mid))
    render(scene, oblique, PREVIEW_DIR / "east_01_oblique.png", (1400, 1000))
    render(scene, mid, PREVIEW_DIR / "east_01_mid.png", (1400, 900))

    east_group = camera("ST_Camera_EastGroup", collection, (1760.0, -520.0, 1050.0), (1750.0, 0.0, 1050.0), ortho_scale=850.0)
    west_group = camera("ST_Camera_WestGroup", collection, (160.0, -520.0, 860.0), (160.0, 0.0, 860.0), ortho_scale=850.0)
    cameras.extend((east_group, west_group))
    render(scene, east_group, PREVIEW_DIR / "east_stadiums_campus_view.png", (1200, 1400))
    render(scene, west_group, PREVIEW_DIR / "west_stadiums_campus_view.png", (1200, 1400))

    for camera_obj in cameras:
        camera_obj.hide_render = True

    sports_objects = [obj for obj in scene.objects if obj == sports_root or obj.parent == sports_root]
    descendant_stack = list(sports_root.children)
    descendants = []
    while descendant_stack:
        obj = descendant_stack.pop()
        descendants.append(obj)
        descendant_stack.extend(obj.children)
    meshes = [obj for obj in descendants if obj.type == "MESH"]
    triangles = sum(object_triangles(obj) for obj in meshes)
    material_names = sorted({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material})

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUTPUT), check_existing=False)

    report = {
        "status": "created_not_integrated",
        "baseModel": str(MODEL),
        "baseModelSha256": sha256(MODEL),
        "baseModelModified": False,
        "outputBlend": str(BLEND_OUTPUT),
        "integrationStatus": "NO_V005_CREATED",
        "coordinateConvention": {"east": "+X", "north": "+Z", "height": "-Y"},
        "stadiums": {},
        "geometry": {
            "stadiumCount": len(STADIUM_IDS),
            "meshCount": len(meshes),
            "triangleCount": triangles,
            "materialCount": len(material_names),
            "materials": material_names,
            "visualLaneGuidesPerStadium": VISUAL_LANE_GUIDES,
            "laneCountStatus": "UNCONFIRMED_VISUAL_GUIDES_ONLY",
        },
        "scope": {
            "east01RoofedWestStand": True,
            "otherLargeStandsModeled": False,
            "auxiliaryCourts": "simplified group surfaces and grids from plan inventory",
            "fineSeatsRailingsTextures": False,
        },
        "previews": {path.stem: str(path) for path in sorted(PREVIEW_DIR.glob("*.png"))},
    }
    for stadium_id in STADIUM_IDS:
        result = build_results[stadium_id]
        root = result["root"]
        report["stadiums"][stadium_id] = {
            "rootWorldLocation": list(root.matrix_world.translation),
            "centerLocalXZ": stadiums[stadium_id]["centerLocalXZ"],
            "trackEnvelopeMeters": [stadiums[stadium_id]["track"]["outerLengthMeters"], stadiums[stadium_id]["track"]["outerWidthMeters"]],
            "footballPitchMeters": [stadiums[stadium_id]["footballPitch"]["lengthMeters"], stadiums[stadium_id]["footballPitch"]["widthMeters"]],
            "orientationDegrees": stadiums[stadium_id]["orientationDegrees"],
            "groundRaycasts": result["groundRaycasts"],
            "groundYMean": result["groundYMean"],
            "groundYSpreadMeters": result["groundYSpreadMeters"],
            "terrainSurfaceRaycasts": result["terrainSurfaceRaycasts"],
            "surfaceYSpreadMeters": result["surfaceYSpreadMeters"],
            "levelingOriginY": result["levelingOriginY"],
            "levelBaseBottomLocalY": result["levelBaseBottomLocalY"],
            "auxiliaryGroups": result["auxiliaryGroups"],
            "stand": result["stand"],
        }
    REPORT_OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
