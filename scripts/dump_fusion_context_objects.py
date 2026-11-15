import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


output = Path(sys.argv[sys.argv.index("--") + 1])
rows = []
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    cx = (min(xs) + max(xs)) * 0.5
    cy = (min(ys) + max(ys)) * 0.5
    cz = (min(zs) + max(zs)) * 0.5
    if 730 <= cx <= 1250 and 180 <= cz <= 680:
        rows.append(
            {
                "name": obj.name,
                "center": [cx, cy, cz],
                "bounds": [min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)],
                "dimensions": [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)],
            }
        )

output.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
print(output)
