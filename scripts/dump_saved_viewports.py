import json
import sys
from pathlib import Path

import bpy


output = Path(sys.argv[sys.argv.index("--") + 1])
screens = []
for screen in bpy.data.screens:
    screen_data = {"name": screen.name, "areas": []}
    for area in screen.areas:
        area_data = {
            "type": area.type,
            "x": area.x,
            "y": area.y,
            "width": area.width,
            "height": area.height,
        }
        if area.type == "VIEW_3D":
            space = area.spaces.active
            r3d = space.region_3d
            region = next((r for r in area.regions if r.type == "WINDOW"), None)
            area_data.update(
                {
                    "region": None
                    if region is None
                    else {
                        "x": region.x,
                        "y": region.y,
                        "width": region.width,
                        "height": region.height,
                    },
                    "view_matrix": [list(row) for row in r3d.view_matrix],
                    "perspective_matrix": [list(row) for row in r3d.perspective_matrix],
                    "view_location": list(r3d.view_location),
                    "view_distance": r3d.view_distance,
                    "view_perspective": r3d.view_perspective,
                    "view_camera_zoom": r3d.view_camera_zoom,
                    "view_camera_offset": list(r3d.view_camera_offset),
                }
            )
        screen_data["areas"].append(area_data)
    screens.append(screen_data)

output.write_text(json.dumps(screens, indent=2), encoding="utf-8")
print(output)
