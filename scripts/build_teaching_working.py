"""Create a reversible campus/teaching work scene, never overwrite official GLB."""
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

PROJECT = Path(__file__).resolve().parents[1]
TARGET = PROJECT / 'blender/teaching_area_working_v004.blend'
if TARGET.exists():
    raise RuntimeError(f'Refusing to overwrite {TARGET}')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(PROJECT / 'output/campus_refined_v005.glb'))
paths = [
    # Blender retains original glTF names, unlike Three's globally uniquified _1/_2 suffixes.
    'Area_02/TPX_Buildings/TPX_Buildings_8',
    'Area_04/TPX_Buildings/TPX_Buildings_35',
    'Area_01/TPX_Buildings/TPX_Buildings_65',
    'Area_03/TPX_Buildings/TPX_Buildings_48',
    'Area_01/TPX_Buildings/TPX_Buildings_54',
    'Area_03/TPX_Buildings/TPX_Buildings_49',
    'Area_01/TPX_Buildings/TPX_Buildings_53',
    'Area_03/TPX_Buildings/TPX_Buildings_50',
    'Area_04/TPX_Buildings/TPX_Buildings_33',
    'Area_04/TPX_Buildings/TPX_Buildings_34',
    'Area_01/TPX_Buildings/TPX_Buildings_66',
]

def resolve_path(path):
    parts = path.split('/')
    node = bpy.data.objects.get(parts[0])
    for name in parts[1:]:
        if node is None:
            break
        node = next((c for c in node.children if c.name.split('.')[0] == name), None)
    if node is None:
        raise RuntimeError(f'Missing source reference {path}')
    return node

reference = bpy.data.collections.new('SOURCE_TEACHING_REFERENCE_UNCHANGED')
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

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(PROJECT / 'output/teaching_area_preview_v004.glb'))
preview = list(set(bpy.data.objects) - before)
working = bpy.data.collections.new('REFINED_TEACHING_WORKING_APPROXIMATE')
bpy.context.scene.collection.children.link(working)
for node in preview:
    for collection in list(node.users_collection):
        collection.objects.unlink(node)
    working.objects.link(node)
    node['geometry_status'] = 'APPROXIMATE_DISPLAY_ONLY'
    node['height_status'] = 'NOT_A_BUILDING_HEIGHT' if node.name.startswith('plan-connection') else 'SOURCE_ROUGH_MODEL_NOT_SURVEYED'

meshes = [obj for obj in preview if obj.type == 'MESH']
if len(meshes) != 10:
    raise RuntimeError(f'Expected 8 buildings and 2 reference connections, got {len(meshes)}')

camera_data = bpy.data.cameras.new('Teaching_Review_Top')
camera = bpy.data.objects.new('Teaching_Review_Top', camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (990, -700, 895)
camera.rotation_euler = Matrix(((1,0,0),(0,0,-1),(0,1,0))).to_euler()
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 490
bpy.context.scene.camera = camera
bpy.context.scene['teaching_preview_status'] = 'SHARED_RASTER_GEOREFERENCE_NOT_SURVEYED'
bpy.context.scene['teaching_preview_version'] = 'v004'
bpy.context.scene['axis_convention'] = 'BLENDER_X_EAST_Z_NORTH_MINUS_Y_UP'
bpy.context.scene['source_model'] = 'campus_refined_v005.glb (unchanged)'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.clip_end = 10000
            space.region_3d.view_location = Vector((990, -3, 895))
            space.region_3d.view_distance = 450
            space.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
            space.region_3d.view_perspective = 'ORTHO'
bpy.ops.object.select_all(action='DESELECT')
for mesh in meshes:
    mesh.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.wm.save_as_mainfile(filepath=str(TARGET))
print(f'TEACHING_WORKING_SAVED: {TARGET}; source references={len(paths)}; preview meshes={len(meshes)}')
