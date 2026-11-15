"""Reviewed building batches in one reversible Blender scene; no formal export."""
import json,sys,hashlib
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

PROJECT = Path(__file__).resolve().parents[1]
TARGET = PROJECT / 'blender/campus_buildings_working_v007.blend'
if TARGET.exists():
    if '--repair-owned-current-work' not in sys.argv or hashlib.sha256(TARGET.read_bytes()).hexdigest().upper() != '12A31BC1DA65BFC60D0C28D9BDB86CA898B71B5F63CBE2512B3D347976DBCB58':
        raise RuntimeError(f'Refusing to overwrite {TARGET}')
batch = json.loads((PROJECT / 'reference/buildings/residential_batch_v004.json').read_text(encoding='utf-8'))
academic = json.loads((PROJECT / 'reference/buildings/academic_batch_v001.json').read_text(encoding='utf-8'))
southwest = json.loads((PROJECT / 'reference/buildings/southwest_batch_v001.json').read_text(encoding='utf-8'))
remaining = json.loads((PROJECT / 'reference/buildings/remaining_batch_v001.json').read_text(encoding='utf-8'))
queue = json.loads((PROJECT / 'reference/buildings/campus_whole_school_queue_v004.json').read_text(encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(PROJECT / 'output/campus_refined_v005.glb'))

def resolve_path(path):
    parts = path.split('/')
    node = bpy.data.objects.get(parts[0])
    for part in parts[1:]:
        node = next((c for c in node.children if c.name.split('.')[0] == part), None) if node else None
    if not node:
        raise RuntimeError(f'Missing exact source: {path}')
    return node

paths = [r['sourceModelPath'] for r in [*batch['records'], *academic['records'], *southwest['records'], *remaining['records']]] + [
    'Area_02/TPX_Buildings/TPX_Buildings_8', 'Area_04/TPX_Buildings/TPX_Buildings_35',
    'Area_01/TPX_Buildings/TPX_Buildings_65', 'Area_03/TPX_Buildings/TPX_Buildings_48',
    'Area_01/TPX_Buildings/TPX_Buildings_54', 'Area_03/TPX_Buildings/TPX_Buildings_49',
    'Area_01/TPX_Buildings/TPX_Buildings_53', 'Area_03/TPX_Buildings/TPX_Buildings_50',
    'Area_04/TPX_Buildings/TPX_Buildings_33', 'Area_04/TPX_Buildings/TPX_Buildings_34',
    'Area_01/TPX_Buildings/TPX_Buildings_66',
]
paths += [r['sourceModelPath'] for r in queue['records'] if r.get('planDisposition', {}).get('suppressed')]
if len(set(paths)) != 148:
    raise RuntimeError('Expected 148 independently retained source references')
reference = bpy.data.collections.new('SOURCE_BUILDING_REFERENCES_UNCHANGED')
bpy.context.scene.collection.children.link(reference)
for path in paths:
    root = resolve_path(path)
    for node in [root, *root.children_recursive]:
        reference.objects.link(node)
        node.hide_render = True
        node.hide_set(True)
        node['source_path'] = path
        node['reference_only'] = True
for node in list(bpy.data.objects):
    if node.name.startswith('TPX_Contours'):
        for obj in [node, *node.children_recursive]:
            obj.hide_render = True
            obj.hide_set(True)
for filename, collection_name, expected in [
    ('teaching_area_preview_v004.glb', 'TEACHING_WORK_V004_APPROXIMATE', 10),
    ('residential_area_preview_v004.glb', 'RESIDENTIAL_WORK_V004_APPROXIMATE', 57),
    ('academic_area_preview_v001.glb', 'ACADEMIC_WORK_V001_APPROXIMATE', 11),
    ('southwest_area_preview_v001.glb', 'SOUTHWEST_WORK_V001_APPROXIMATE', 9),
    ('campus_remaining_preview_v001.glb', 'WHOLE_CAMPUS_WORK_V001_APPROXIMATE', 39),
]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(PROJECT / 'output' / filename))
    added = set(bpy.data.objects) - before
    collection = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(collection)
    for node in added:
        for original_collection in list(node.users_collection):
            original_collection.objects.unlink(node)
        collection.objects.link(node)
        node['geometry_status'] = 'APPROXIMATE_DISPLAY_ONLY'
    if len([o for o in added if o.type == 'MESH']) != expected:
        raise RuntimeError(f'Unexpected mesh count in {filename}')
camera_data = bpy.data.cameras.new('Residential_Review_Top')
camera = bpy.data.objects.new('Residential_Review_Top', camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (600, -800, 810)
camera.rotation_euler = Matrix(((1,0,0),(0,0,-1),(0,1,0))).to_euler()
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2200
bpy.context.scene.camera = camera
bpy.context.scene['building_work_version'] = 'v007_WHOLE_CAMPUS_PLAN_QC_166_WITH_NINE_EVIDENCE_GAPS'
bpy.context.scene['authority_source_records'] = 166
bpy.context.scene['working_roof_source_ids'] = 124
bpy.context.scene['remaining_external_evidence_ids'] = ','.join(queue['pendingIds'])
bpy.context.scene['source_model'] = 'campus_refined_v005.glb UNCHANGED'
bpy.context.scene['axis_convention'] = 'BLENDER_X_EAST_Z_NORTH_MINUS_Y_UP'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.clip_end = 10000
            space.region_3d.view_location = Vector((1000, -3, 920))
            space.region_3d.view_distance = 2200
            space.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
            space.region_3d.view_perspective = 'ORTHO'
bpy.ops.object.select_all(action='DESELECT')
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(TARGET))
print(f'BUILDING_WORK_SAVED: {TARGET}; 126 meshes; 148 source references retained; nine evidence gaps')
