import json
import sys
from pathlib import Path

import bpy
import numpy as np


args = sys.argv[sys.argv.index("--") + 1 :]
image_path = Path(args[0])
output_path = Path(args[1])

image = bpy.data.images.load(str(image_path), check_existing=False)
width, height = image.size
pixels = np.empty(width * height * 4, dtype=np.float32)
image.pixels.foreach_get(pixels)
rgba = pixels.reshape(height, width, 4)
rgba = np.flipud(rgba)
r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]

# Saturated green tree crowns in the Blender viewport. The mask is limited to
# the 3D viewport so toolbar and taskbar icons cannot become candidates.
mask = (g > 0.10) & (g > r * 1.35 + 0.01) & (g > b * 1.35 + 0.01)
yy, xx = np.indices(mask.shape)
mask &= (xx < 2100) & (yy > 70) & (yy < 1385)


parent = []
runs = []
previous = []


def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra


for y in range(height):
    row = mask[y]
    padded = np.pad(row.astype(np.int8), (1, 1))
    delta = np.diff(padded)
    starts = np.flatnonzero(delta == 1)
    ends = np.flatnonzero(delta == -1) - 1
    current = []
    p_index = 0
    for x0, x1 in zip(starts.tolist(), ends.tolist()):
        run_id = len(runs)
        parent.append(run_id)
        runs.append((y, x0, x1))
        current.append(run_id)
        while p_index < len(previous) and runs[previous[p_index]][2] < x0 - 1:
            p_index += 1
        q = p_index
        while q < len(previous) and runs[previous[q]][1] <= x1 + 1:
            union(run_id, previous[q])
            q += 1
    previous = current

groups = {}
for run_id, (y, x0, x1) in enumerate(runs):
    root = find(run_id)
    group = groups.setdefault(
        root,
        {"area": 0, "sum_x": 0.0, "sum_y": 0.0, "min_x": x0, "max_x": x1, "min_y": y, "max_y": y},
    )
    count = x1 - x0 + 1
    group["area"] += count
    group["sum_x"] += (x0 + x1) * count * 0.5
    group["sum_y"] += y * count
    group["min_x"] = min(group["min_x"], x0)
    group["max_x"] = max(group["max_x"], x1)
    group["min_y"] = min(group["min_y"], y)
    group["max_y"] = max(group["max_y"], y)

blobs = []
for group in groups.values():
    w = group["max_x"] - group["min_x"] + 1
    h = group["max_y"] - group["min_y"] + 1
    area = group["area"]
    if area < 20 or area > 8000 or w < 4 or h < 4 or w > 120 or h > 120:
        continue
    blobs.append(
        {
            "center": [group["sum_x"] / area, group["sum_y"] / area],
            "bbox": [group["min_x"], group["min_y"], group["max_x"], group["max_y"]],
            "area": area,
            "width": w,
            "height": h,
        }
    )

blobs.sort(key=lambda item: (item["center"][1], item["center"][0]))
output_path.write_text(
    json.dumps({"image": str(image_path), "size": [width, height], "blobs": blobs}, indent=2),
    encoding="utf-8",
)
print(output_path)
