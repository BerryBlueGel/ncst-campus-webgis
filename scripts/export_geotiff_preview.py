from pathlib import Path

import bpy


import os
SOURCE = Path(os.environ.get('CAMPUS_GEOREF_TIF', Path(__file__).resolve().parents[2] / '￥%……&/campus_georef.tif'))
OUTPUT = (Path(__file__).resolve().parents[1] / 'diagnostics/campus_georef_preview.png')

image = bpy.data.images.load(str(SOURCE), check_existing=False)
width, height = image.size
preview_width = 1350
preview_height = round(height * preview_width / width)
image.scale(preview_width, preview_height)
image.filepath_raw = str(OUTPUT)
image.file_format = "PNG"
image.save()
print(f"saved={OUTPUT} source={width}x{height} preview={preview_width}x{preview_height}")
