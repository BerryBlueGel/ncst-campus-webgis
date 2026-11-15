import math
from pathlib import Path

import bpy


MODEL = (Path(__file__).resolve().parents[1] / 'output/campus_cropped.glb')
OUTPUT = (Path(__file__).resolve().parents[1] / 'diagnostics/auditorium_locator_top.png')
TARGET_NAME = "TPX_Buildings_14.001"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(MODEL))

for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        obj.hide_render = True
        continue
    if obj.name == TARGET_NAME:
        obj.hide_render = False
        obj.color = (1.0, 0.16, 0.03, 1.0)
    elif "TPX_Ground" in obj.name:
        obj.hide_render = False
        obj.color = (0.72, 0.72, 0.72, 1.0)
    elif "TPX_Waterways" in obj.name:
        obj.hide_render = False
        obj.color = (0.08, 0.42, 0.82, 1.0)
    else:
        obj.hide_render = True

camera_data = bpy.data.cameras.new("AUD_Locator_Camera")
camera = bpy.data.objects.new("AUD_Locator_Camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (981.0433, -250.0, 1188.7729)
camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
camera_data.type = "ORTHO"
camera_data.ortho_scale = 220.0
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "OBJECT"
scene.display.shading.show_shadows = False
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "WORLD"
scene.display.shading.curvature_ridge_factor = 1.5
scene.display.shading.curvature_valley_factor = 1.0
scene.display.shading.background_type = "VIEWPORT"
scene.display.shading.background_color = (0.95, 0.95, 0.95)
scene.render.resolution_x = 1200
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(OUTPUT)
bpy.ops.render.render(write_still=True)
print(f"saved={OUTPUT}")
