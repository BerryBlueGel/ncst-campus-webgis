import math
from pathlib import Path

import bpy


MODEL = (Path(__file__).resolve().parents[1] / 'output/campus_refined_v002.glb')
OUTPUT = (Path(__file__).resolve().parents[1] / 'reference/library/library_overlap_47_48.png')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(MODEL))

for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        obj.hide_render = True
    elif obj.name == "TPX_Buildings_48":
        obj.hide_render = False
        obj.color = (1.0, 0.12, 0.02, 1.0)
    elif obj.name == "TPX_Buildings_47":
        obj.hide_render = False
        obj.color = (0.05, 0.55, 0.16, 1.0)
    elif "TPX_Ground" in obj.name:
        obj.hide_render = False
        obj.color = (0.78, 0.78, 0.78, 1.0)
    elif "TPX_Roads" in obj.name:
        obj.hide_render = False
        obj.color = (0.25, 0.25, 0.25, 1.0)
    elif "TPX_Waterways" in obj.name:
        obj.hide_render = False
        obj.color = (0.05, 0.42, 0.84, 1.0)
    else:
        obj.hide_render = True

camera_data = bpy.data.cameras.new("LIB_Overlap_Camera")
camera = bpy.data.objects.new("LIB_Overlap_Camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (989.3, -350.0, 530.0)
camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
camera_data.type = "ORTHO"
camera_data.ortho_scale = 500.0
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "OBJECT"
scene.display.shading.show_shadows = False
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "WORLD"
scene.display.shading.background_type = "VIEWPORT"
scene.display.shading.background_color = (0.96, 0.96, 0.96)
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(OUTPUT)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.render.render(write_still=True)
print(f"saved={OUTPUT}")
