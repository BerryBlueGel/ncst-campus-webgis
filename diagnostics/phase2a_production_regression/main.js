import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const scenarioName = params.get('scenario') || 'campus_far';
const selectedVariant = (params.get('variant') || 'A').toUpperCase();
const status = document.querySelector('#status');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161a1e);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 5000);
camera.up.set(0, 0, 1);

// preserveDrawingBuffer is deliberately omitted: this page follows production behavior.
const renderer = new THREE.WebGLRenderer({ antialias: true, reversedDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x303840, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-1000, -1500, 2500);
scene.add(sun);

function classify(object) {
  let current = object;
  while (current) {
    const name = current.name || '';
    if (name.startsWith('TPX_RoadsOutlines')) return 'RoadsOutlines';
    for (const [prefix, family] of [
      ['TPX_Ground', 'Ground'], ['TPX_Buildings', 'Buildings'], ['TPX_Roads', 'Roads'],
      ['TPX_Waterways', 'Waterways'], ['TPX_GreenAreas', 'GreenAreas'], ['TPX_Trees', 'Trees'],
      ['TPX_Contours', 'Contours'], ['TPX_Railways', 'Railways'],
    ]) if (name.startsWith(prefix)) return family;
    current = current.parent;
  }
  return null;
}

function objectBox(object) {
  return new THREE.Box3().setFromObject(object);
}

function unionBox(objects) {
  const box = new THREE.Box3();
  for (const object of objects) box.union(objectBox(object));
  return box;
}

function validBox(box) {
  return Number.isFinite(box.min.x) && Number.isFinite(box.max.x);
}

function largestObject(objects) {
  let best = null;
  let bestArea = -1;
  for (const object of objects) {
    const box = objectBox(object);
    const size = box.getSize(new THREE.Vector3());
    const area = size.x * size.y;
    if (area > bestArea) { bestArea = area; best = object; }
  }
  return best;
}

function chooseBuilding(objects) {
  const plausible = objects.filter((object) => {
    const size = objectBox(object).getSize(new THREE.Vector3());
    const area = size.x * size.y;
    return area > 20 && area < 50000 && size.z > 2;
  });
  return largestObject(plausible.length ? plausible : objects);
}

function lowestBoundaryPoint(object, fallback) {
  const position = object?.geometry?.attributes?.position;
  if (!position) return fallback.clone();
  const box = objectBox(object);
  const center = box.getCenter(new THREE.Vector3());
  let minimumZ = Infinity;
  const candidates = [];
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
    if (point.z < minimumZ - 0.05) {
      minimumZ = point.z;
      candidates.length = 0;
      candidates.push(point.clone());
    } else if (Math.abs(point.z - minimumZ) <= 0.05) {
      candidates.push(point.clone());
    }
  }
  if (!candidates.length) return fallback.clone();
  candidates.sort((a, b) =>
    Math.hypot(b.x - center.x, b.y - center.y) - Math.hypot(a.x - center.x, a.y - center.y));
  return candidates[0];
}

function nearestObjectTo(objects, point) {
  let best = null;
  let bestDistance = Infinity;
  for (const object of objects) {
    const center = objectBox(object).getCenter(new THREE.Vector3());
    const distance = Math.hypot(center.x - point.x, center.y - point.y);
    if (distance < bestDistance) { bestDistance = distance; best = object; }
  }
  return best;
}

function collectPoints(objects, limit = 7000) {
  const points = [];
  let total = 0;
  for (const object of objects) total += object.geometry?.attributes?.position?.count || 0;
  const step = Math.max(1, Math.ceil(total / limit));
  let serial = 0;
  const point = new THREE.Vector3();
  for (const object of objects) {
    const position = object.geometry?.attributes?.position;
    if (!position) continue;
    for (let index = 0; index < position.count; index++, serial++) {
      if (serial % step !== 0) continue;
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      points.push(point.clone());
    }
  }
  return points;
}

function nearestPoint(points, target) {
  let best = target.clone();
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance < bestDistance) { bestDistance = distance; best = point; }
  }
  return best.clone();
}

function nearestPair(pointsA, pointsB, cellSize = 20) {
  if (!pointsA.length || !pointsB.length) return null;
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  for (const point of pointsB) {
    const cell = key(point.x, point.y);
    if (!grid.has(cell)) grid.set(cell, []);
    grid.get(cell).push(point);
  }
  let best = null;
  let bestDistance = Infinity;
  for (const a of pointsA) {
    const cx = Math.floor(a.x / cellSize), cy = Math.floor(a.y / cellSize);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      for (const b of grid.get(`${cx + dx},${cy + dy}`) || []) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance < bestDistance) { bestDistance = distance; best = [a, b]; }
      }
    }
  }
  if (!best) return null;
  return {
    distance: bestDistance,
    point: best[0].clone().add(best[1]).multiplyScalar(0.5),
  };
}

function cameraPose(target, horizontalDistance, verticalDistance, azimuth = -0.78) {
  return {
    target: target.clone(),
    position: new THREE.Vector3(
      target.x + Math.cos(azimuth) * horizontalDistance,
      target.y + Math.sin(azimuth) * horizontalDistance,
      target.z + verticalDistance,
    ),
  };
}

function buildScenarios(byLayer, allObjects) {
  const campusBox = unionBox(allObjects);
  const campusCenter = campusBox.getCenter(new THREE.Vector3());
  const campusSize = campusBox.getSize(new THREE.Vector3());
  const span = Math.max(campusSize.x, campusSize.y);

  const groundPoints = collectPoints(byLayer.Ground || []);
  const waterPoints = collectPoints(byLayer.Waterways || []);
  const greenPoints = collectPoints(byLayer.GreenAreas || []);
  const roadPoints = collectPoints(byLayer.RoadsOutlines || []);
  const buildingPoints = collectPoints(byLayer.Buildings || []);

  const largestBuilding = chooseBuilding(byLayer.Buildings || []);
  const buildingBox = largestBuilding ? objectBox(largestBuilding) : campusBox;
  const buildingCenter = buildingBox.getCenter(new THREE.Vector3());
  buildingCenter.z = buildingBox.min.z + Math.min(8, Math.max(2, (buildingBox.max.z - buildingBox.min.z) * 0.4));
  const buildingFoot = lowestBoundaryPoint(largestBuilding, buildingCenter);
  buildingFoot.z += 0.2;

  const centralTree = nearestObjectTo(byLayer.Trees || [], campusCenter);
  const treeBox = centralTree ? objectBox(centralTree) : campusBox;
  const treeFoot = new THREE.Vector3(
    (treeBox.min.x + treeBox.max.x) / 2,
    (treeBox.min.y + treeBox.max.y) / 2,
    treeBox.min.z + 0.1,
  );

  const groundTarget = nearestPoint(groundPoints, campusCenter);
  const waterCenter = validBox(unionBox(byLayer.Waterways || []))
    ? unionBox(byLayer.Waterways || []).getCenter(new THREE.Vector3()) : campusCenter;
  const shoreline = nearestPoint(waterPoints, waterCenter);
  const roadGreen = nearestPair(roadPoints, greenPoints)?.point || nearestPoint(roadPoints, campusCenter);
  const roadBuilding = nearestPair(roadPoints, buildingPoints)?.point || buildingFoot;

  return {
    campus_far: { label: '全校园远景', near: 0.5, ...cameraPose(campusCenter, span * 0.85, span * 0.48) },
    campus_mid: { label: '全校园中景', near: 0.5, ...cameraPose(campusCenter, span * 0.38, span * 0.22) },
    building_near: { label: '大型建筑近景 5-20m', near: 0.1, ...cameraPose(buildingCenter, 16, 8) },
    ground_near: { label: '地面近景 2-10m', near: 0.1, ...cameraPose(groundTarget, 8, 4) },
    building_ground: { label: '大型建筑脚底与 Ground', near: 0.1, ...cameraPose(buildingFoot, 24, 9) },
    tree_ground: { label: '树木与 Ground 接触', near: 0.1, ...cameraPose(treeFoot, 6, 3) },
    shoreline: { label: '水体岸线', near: 0.1, ...cameraPose(shoreline, 12, 6) },
    road_green: { label: '道路与绿地交界', near: 0.1, ...cameraPose(roadGreen, 10, 5) },
    road_building: { label: '道路与建筑交界', near: 0.1, ...cameraPose(roadBuilding, 12, 5) },
  };
}

function capturePixels() {
  const context = renderer.getContext();
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  const pixels = new Uint8Array(width * height * 4);
  context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
  return { width, height, pixels };
}

function pixelSummary(frame) {
  let fnv = 2166136261;
  let nonBackground = 0;
  let luminance = 0;
  for (let index = 0; index < frame.pixels.length; index += 4) {
    const r = frame.pixels[index], g = frame.pixels[index + 1], b = frame.pixels[index + 2];
    fnv ^= r; fnv = Math.imul(fnv, 16777619);
    fnv ^= g; fnv = Math.imul(fnv, 16777619);
    fnv ^= b; fnv = Math.imul(fnv, 16777619);
    if (!(r < 40 && g < 45 && b < 50)) nonBackground++;
    luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const pixelCount = frame.width * frame.height;
  return {
    width: frame.width,
    height: frame.height,
    hash32: (fnv >>> 0).toString(16).padStart(8, '0'),
    nonBackgroundPixels: nonBackground,
    meanLuminance: Number((luminance / pixelCount).toFixed(4)),
  };
}

function compareFrames(first, second) {
  let changed1 = 0, changed5 = 0, changed20 = 0, sum = 0, max = 0;
  const pixelCount = first.width * first.height;
  for (let index = 0; index < first.pixels.length; index += 4) {
    const delta = Math.max(
      Math.abs(first.pixels[index] - second.pixels[index]),
      Math.abs(first.pixels[index + 1] - second.pixels[index + 1]),
      Math.abs(first.pixels[index + 2] - second.pixels[index + 2]),
    );
    sum += delta;
    max = Math.max(max, delta);
    if (delta > 1) changed1++;
    if (delta > 5) changed5++;
    if (delta > 20) changed20++;
  }
  const percent = (count) => Number((count * 100 / pixelCount).toFixed(5));
  return {
    changedPixelsAbove1: changed1,
    changedPercentAbove1: percent(changed1),
    changedPixelsAbove5: changed5,
    changedPercentAbove5: percent(changed5),
    changedPixelsAbove20: changed20,
    changedPercentAbove20: percent(changed20),
    meanMaxChannelDelta: Number((sum / pixelCount).toFixed(6)),
    maxChannelDelta: max,
  };
}

const originalStates = new Map();
const renderable = [];
const byLayer = {};

function prepareObject(object) {
  if (!(object.isMesh || object.isLine || object.isLineSegments)) return;
  const layer = classify(object);
  if (!layer) return;
  object.material = Array.isArray(object.material)
    ? object.material.map((material) => material.clone())
    : object.material.clone();
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  originalStates.set(object, {
    renderOrder: object.renderOrder,
    materials: materials.map((material) => ({
      material,
      depthWrite: material.depthWrite,
      polygonOffset: material.polygonOffset,
      polygonOffsetFactor: material.polygonOffsetFactor,
      polygonOffsetUnits: material.polygonOffsetUnits,
    })),
  });
  renderable.push(object);
  (byLayer[layer] ||= []).push(object);
}

function applyVariant(variant) {
  const ordered = variant === 'B' || variant === 'C';
  const disableRoadDepthWrite = variant === 'C';
  const enableGroundOffset = variant !== 'N';
  const renderOrders = { Ground: 0, GreenAreas: 10, RoadsOutlines: 20, Waterways: 30, Roads: 40 };
  const offsetSign = renderer.capabilities.reversedDepthBuffer ? -1 : 1;

  for (const object of renderable) {
    const layer = classify(object);
    const state = originalStates.get(object);
    object.renderOrder = ordered ? (renderOrders[layer] ?? 0) : state.renderOrder;
    for (const entry of state.materials) {
      const material = entry.material;
      material.depthWrite = entry.depthWrite;
      material.polygonOffset = entry.polygonOffset;
      material.polygonOffsetFactor = entry.polygonOffsetFactor;
      material.polygonOffsetUnits = entry.polygonOffsetUnits;
      if (enableGroundOffset && layer === 'Ground') {
        material.polygonOffset = true;
        material.polygonOffsetFactor = offsetSign;
        material.polygonOffsetUnits = offsetSign;
      }
      if (disableRoadDepthWrite && layer === 'Roads' && (object.isLine || object.isLineSegments)) {
        material.depthWrite = false;
      }
      material.needsUpdate = true;
    }
  }
}

function renderSettled() {
  for (let count = 0; count < 4; count++) renderer.render(scene, camera);
}

new GLTFLoader().load('../web_test/campus_cropped.glb', async (gltf) => {
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(prepareObject);
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);

  const scenarios = buildScenarios(byLayer, renderable);
  const scenario = scenarios[scenarioName] || scenarios.campus_far;
  camera.near = scenario.near;
  camera.far = 5000;
  camera.position.copy(scenario.position);
  camera.lookAt(scenario.target);
  camera.updateProjectionMatrix();

  const roadMaterialStates = [];
  const originalRenderOrders = new Set();
  for (const object of renderable) {
    const state = originalStates.get(object);
    originalRenderOrders.add(state.renderOrder);
    if (classify(object) === 'Roads') {
      for (const entry of state.materials) roadMaterialStates.push(entry.depthWrite);
    }
  }

  const frames = {};
  const summaries = {};
  for (const variant of ['N', 'A', 'B', 'C']) {
    applyVariant(variant);
    renderSettled();
    frames[variant] = capturePixels();
    summaries[variant] = pixelSummary(frames[variant]);
  }

  const comparisons = {
    N_to_A: compareFrames(frames.N, frames.A),
    A_to_B: compareFrames(frames.A, frames.B),
    B_to_C: compareFrames(frames.B, frames.C),
    A_to_C: compareFrames(frames.A, frames.C),
  };

  applyVariant(['N', 'A', 'B', 'C'].includes(selectedVariant) ? selectedVariant : 'A');
  renderSettled();

  const metrics = {
    scenario: scenarioName,
    scenarioLabel: scenario.label,
    selectedVariant,
    originalMaterials: true,
    preserveDrawingBuffer: false,
    camera: {
      near: camera.near,
      far: camera.far,
      position: camera.position.toArray(),
      target: scenario.target.toArray(),
    },
    requestedReversedDepthBuffer: true,
    actualReversedDepthBuffer: renderer.capabilities.reversedDepthBuffer,
    groundPolygonOffsetSign: renderer.capabilities.reversedDepthBuffer ? -1 : 1,
    originalStateInventory: {
      renderOrders: [...originalRenderOrders].sort((a, b) => a - b),
      roadMaterials: roadMaterialStates.length,
      roadDepthWriteTrue: roadMaterialStates.filter(Boolean).length,
      roadDepthWriteFalse: roadMaterialStates.filter((value) => !value).length,
    },
    variants: {
      N: 'diagnostic control: reversed depth without Ground polygonOffset',
      A: 'reversed depth + Ground polygonOffset',
      B: 'A + renderOrder',
      C: 'B + Roads depthWrite=false',
    },
    summaries,
    comparisons,
    rendererInfo: {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      lines: renderer.info.render.lines,
      points: renderer.info.render.points,
    },
  };

  window.__phase2a1Metrics = metrics;
  document.body.dataset.ready = 'true';
  document.body.dataset.metrics = JSON.stringify(metrics);
  status.textContent =
    `READY ${scenario.label} / Variant ${selectedVariant}\n` +
    `near=${camera.near} far=${camera.far} reverse=${metrics.actualReversedDepthBuffer}\n` +
    `A→B changed>5: ${comparisons.A_to_B.changedPercentAbove5}%\n` +
    `B→C changed>5: ${comparisons.B_to_C.changedPercentAbove5}%`;
}, undefined, (error) => {
  console.error(error);
  status.textContent = `ERROR ${error.message}`;
  document.body.dataset.ready = 'error';
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.render(scene, camera);
});
