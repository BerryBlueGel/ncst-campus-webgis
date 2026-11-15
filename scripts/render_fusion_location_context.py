import math
from pathlib import Path

import bpy


OUTPUT = (Path(__file__).resolve().parents[1] / 'diagnostics/fusion_location_context_top.png')

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "WORLD"
scene.display.shading.color_type = "MATERIAL"
scene.render.resolution_x = 1400
scene.render.resolution_y = 1400
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.filepath = str(OUTPUT)

camera_data = bpy.data.cameras.new("FusionLocationContextCamera")
camera = bpy.data.objects.new("FusionLocationContextCamera", camera_data)
scene.collection.objects.link(camera)
camera.data.type = "ORTHO"
camera.data.ortho_scale = 470.0
camera.data.clip_start = 0.1
camera.data.clip_end = 2000.0
camera.location = (990.0, -500.0, 425.0)
camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
scene.camera = camera

bpy.ops.render.render(write_still=True)
print(OUTPUT)
