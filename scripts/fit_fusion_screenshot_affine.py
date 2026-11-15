import itertools
import json
from pathlib import Path

import numpy as np


OUTPUT = (Path(__file__).resolve().parents[1] / 'diagnostics/fusion_screenshot_affine.json')

# Five unmistakable trees in the long west-east row visible in the screenshot.
row_world = np.array(
    [
        [855.68, 395.62],
        [868.66, 394.92],
        [880.60, 401.59],
        [892.66, 400.88],
        [920.55, 395.83],
    ],
    dtype=float,
)
row_screen = np.array(
    [
        [361.9, 700.1],
        [419.9, 692.6],
        [483.4, 658.7],
        [538.2, 651.3],
        [665.1, 646.6],
    ],
    dtype=float,
)

# Six-tree cluster immediately south-east of that row. The screen blobs are
# detected from the supplied screenshot; permutation search establishes the
# exact correspondence from the cluster geometry itself.
cluster_world = np.array(
    [
        [917.39, 364.39],
        [910.12, 355.96],
        [921.29, 353.38],
        [926.83, 354.40],
        [927.86, 348.88],
        [912.09, 349.53],
    ],
    dtype=float,
)
cluster_screen = np.array(
    [
        [616.4, 771.8],
        [656.1, 805.5],
        [568.7, 813.9],
        [624.3, 816.9],
        [655.0, 832.1],
        [570.9, 842.3],
    ],
    dtype=float,
)


def fit_affine(world, screen):
    design = np.column_stack([world, np.ones(len(world))])
    coeff, _, _, _ = np.linalg.lstsq(design, screen, rcond=None)
    predicted = design @ coeff
    error = np.linalg.norm(predicted - screen, axis=1)
    return coeff, error


best = None
for permutation in itertools.permutations(range(len(cluster_screen))):
    screen = np.vstack([row_screen, cluster_screen[list(permutation)]])
    world = np.vstack([row_world, cluster_world])
    coeff, error = fit_affine(world, screen)
    score = float(np.mean(error**2))
    if best is None or score < best["score"]:
        best = {
            "score": score,
            "permutation": list(permutation),
            "coeff": coeff,
            "error": error,
            "world": world,
            "screen": screen,
        }

# The crosshair center in the original 2559x1599 screenshot. Its visible four
# ticks are centered at approximately (1036.5, 713.5).
crosshair = np.array([1036.5, 713.5, 1.0])
affine3 = np.vstack([best["coeff"].T, [0.0, 0.0, 1.0]])
world_h = np.linalg.inv(affine3) @ crosshair


def fit_homography(world, screen):
    matrix = []
    rhs = []
    for (x, z), (u, v) in zip(world, screen):
        matrix.append([x, z, 1.0, 0.0, 0.0, 0.0, -u * x, -u * z])
        rhs.append(u)
        matrix.append([0.0, 0.0, 0.0, x, z, 1.0, -v * x, -v * z])
        rhs.append(v)
    params, _, _, _ = np.linalg.lstsq(np.array(matrix), np.array(rhs), rcond=None)
    h = np.array(
        [
            [params[0], params[1], params[2]],
            [params[3], params[4], params[5]],
            [params[6], params[7], 1.0],
        ]
    )
    homogeneous = np.column_stack([world, np.ones(len(world))])
    projected = (h @ homogeneous.T).T
    projected = projected[:, :2] / projected[:, 2:3]
    error = np.linalg.norm(projected - screen, axis=1)
    return h, error


homography, homography_error = fit_homography(best["world"], best["screen"])
homography_target = np.linalg.inv(homography) @ crosshair
homography_target /= homography_target[2]

payload = {
    "method": "affine fit from 11 tree correspondences in user screenshot",
    "rmsPixels": float(np.sqrt(best["score"])),
    "maxErrorPixels": float(np.max(best["error"])),
    "permutation": best["permutation"],
    "coeffWorldXZToScreenXY": best["coeff"].tolist(),
    "crosshairScreenXY": crosshair[:2].tolist(),
    "targetWorldXZ": world_h[:2].tolist(),
    "homographyWorldXZToScreenXY": homography.tolist(),
    "homographyRmsPixels": float(np.sqrt(np.mean(homography_error**2))),
    "homographyMaxErrorPixels": float(np.max(homography_error)),
    "homographyTargetWorldXZ": homography_target[:2].tolist(),
    "matchedPairs": [
        {
            "worldXZ": w.tolist(),
            "screenXY": s.tolist(),
            "errorPixels": float(e),
        }
        for w, s, e in zip(best["world"], best["screen"], best["error"])
    ],
}
OUTPUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(json.dumps(payload, indent=2))
