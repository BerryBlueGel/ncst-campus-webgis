import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') || 'mid';
const mode = params.get('mode') || 'baseline';
const clipNear = Number(params.get('near') || 0.5);
const clipFar = Number(params.get('far') || 5000);
const layerNames = (params.get('layers') || 'Ground,Waterways,GreenAreas,Roads,RoadsOutlines').split(',');
const allowed = new Set(layerNames);
const showAllLayers = allowed.has('all');
const useOriginalMaterials = params.get('materials') === 'original';
const status = document.querySelector('#status');

const wantsReverse = mode === 'reverse' || mode === 'reverse-offset' || mode === 'reverse-offset-fixed';
const wantsLog = mode === 'log';
const wantsOffset = mode === 'offset' || mode === 'reverse-offset' || mode === 'reverse-offset-fixed';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161a1e);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, clipNear, clipFar);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  reversedDepthBuffer: wantsReverse,
  logarithmicDepthBuffer: wantsLog,
});
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x303840, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-1000, -1500, 2500);
scene.add(sun);

const hotspot = new THREE.Vector3(1098.123, 622.292, 0);
const center = new THREE.Vector3(948, 1118, 0);
const presets = {
  near: { target: hotspot, position: new THREE.Vector3(hotspot.x - 220, hotspot.y - 220, 120) },
  mid: { target: hotspot, position: new THREE.Vector3(hotspot.x - 500, hotspot.y - 500, 250) },
  far: { target: hotspot, position: new THREE.Vector3(hotspot.x - 1400, hotspot.y - 1400, 500) },
  overhead: { target: center, position: new THREE.Vector3(948, 1118, 3000) },
};
const preset = presets[view] || presets.mid;
camera.position.copy(preset.position);
camera.lookAt(preset.target);

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

const meshMaterials = {
  Ground: new THREE.MeshBasicMaterial({ color: 0xd9d9d9, side: THREE.DoubleSide }),
  Waterways: new THREE.MeshBasicMaterial({ color: 0x1565c0, side: THREE.DoubleSide }),
  GreenAreas: new THREE.MeshBasicMaterial({ color: 0x2e7d32, side: THREE.DoubleSide }),
  RoadsOutlines: new THREE.MeshBasicMaterial({ color: 0xffc107, side: THREE.DoubleSide }),
};
const lineMaterials = {
  Roads: new THREE.LineBasicMaterial({ color: 0xff5722 }),
};

function configureObject(object) {
  if (!(object.isMesh || object.isLine || object.isLineSegments)) return;
  const layer = classify(object);
  object.visible = showAllLayers || allowed.has(layer);
  if (!object.visible) return;

  if (!useOriginalMaterials && object.isMesh && meshMaterials[layer]) object.material = meshMaterials[layer].clone();
  if (!useOriginalMaterials && (object.isLine || object.isLineSegments) && lineMaterials[layer]) object.material = lineMaterials[layer].clone();
  if (useOriginalMaterials) {
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
  }

  const renderOrders = { Ground: 0, GreenAreas: 10, RoadsOutlines: 20, Waterways: 30, Roads: 40 };
  object.renderOrder = renderOrders[layer] ?? 0;

  if (wantsOffset && object.isMesh && layer === 'Ground') {
    const offsetSign = mode === 'reverse-offset-fixed' ? -1 : 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = offsetSign;
      material.polygonOffsetUnits = offsetSign;
    }
  }
  if (object.isLine || object.isLineSegments) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.depthWrite = false;
  }
}

function colorCounts() {
  const context = renderer.getContext();
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  const pixels = new Uint8Array(width * height * 4);
  context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
  const counts = { ground: 0, water: 0, green: 0, roadSurface: 0, roadLine: 0, background: 0 };
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
    if (b > 95 && b > r * 1.35 && b > g * 1.12) counts.water++;
    else if (g > 75 && g > r * 1.25 && g > b * 1.15) counts.green++;
    else if (r > 150 && g > 75 && g < r * 0.9 && b < 90) counts.roadSurface++;
    else if (r > 130 && g < 120 && b < 80) counts.roadLine++;
    else if (r > 145 && g > 145 && b > 145 && Math.max(r, g, b) - Math.min(r, g, b) < 35) counts.ground++;
    else if (r < 40 && g < 45 && b < 50) counts.background++;
  }
  return { width, height, ...counts };
}

new GLTFLoader().load('../web_test/campus_cropped.glb', (gltf) => {
  gltf.scene.traverse(configureObject);
  scene.add(gltf.scene);
  let frames = 0;
  function settle() {
    renderer.render(scene, camera);
    if (++frames < 8) requestAnimationFrame(settle);
    else {
      const metrics = {
        view, mode, clipNear, clipFar, layers: layerNames,
        requestedReverse: wantsReverse,
        actualReverse: renderer.capabilities.reversedDepthBuffer,
        actualLog: renderer.capabilities.logarithmicDepthBuffer,
        colors: colorCounts(),
      };
      window.__phase2aMetrics = metrics;
      status.textContent = `READY mode=${mode} view=${view} clip=${clipNear}/${clipFar}\n` +
        `reverse=${metrics.actualReverse} log=${metrics.actualLog}\n` +
        `water=${metrics.colors.water} green=${metrics.colors.green} road=${metrics.colors.roadSurface}`;
      document.body.dataset.ready = 'true';
      document.body.dataset.metrics = JSON.stringify(metrics);
    }
  }
  settle();
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
