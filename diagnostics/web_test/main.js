import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') || 'oblique';
const clipNear = Number(params.get('near') || (view === 'far' ? 1 : 0.1));
const clipFar = Number(params.get('far') || (view === 'far' ? 5000 : 6000));
const status = document.querySelector('#status');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161a1e);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, clipNear, clipFar);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x303840, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-1000, -1500, 2500);
scene.add(sun);

const hotspot = new THREE.Vector3(976.227, 1291.704, 0);
const center = new THREE.Vector3(948, 1118, 0);
const presets = {
  near: { target: hotspot, position: new THREE.Vector3(hotspot.x - 220, hotspot.y - 220, 120) },
  mid: { target: hotspot, position: new THREE.Vector3(hotspot.x - 500, hotspot.y - 500, 250) },
  far: { target: hotspot, position: new THREE.Vector3(hotspot.x - 1400, hotspot.y - 1400, 500) },
  overhead: { target: center, position: new THREE.Vector3(948, 1118, 3000) },
  oblique: { target: center, position: new THREE.Vector3(-950, -950, 1200) },
};
const preset = presets[view] || presets.oblique;
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

function applyLayerFilter(root) {
  const requested = params.get('layers');
  if (!requested) return;
  const allowed = new Set(requested.split(','));
  root.traverse((object) => {
    if (object.isMesh || object.isLine || object.isLineSegments) {
      const layer = classify(object);
      object.visible = allowed.has(layer);
    }
  });
}

new GLTFLoader().load('./campus_cropped.glb', (gltf) => {
  applyLayerFilter(gltf.scene);
  scene.add(gltf.scene);
  let frames = 0;
  function settle() {
    renderer.render(scene, camera);
    if (++frames < 8) requestAnimationFrame(settle);
    else {
      status.textContent = `READY view=${view} clip=${clipNear}/${clipFar}`;
      document.body.dataset.ready = 'true';
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
