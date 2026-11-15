import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const status = document.querySelector('#status');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161a1e);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 5000);
camera.up.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ antialias: true, reversedDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x303840, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-1000, -1500, 2500);
scene.add(sun);

function family(object) {
  let current = object;
  while (current) {
    if ((current.name || '').startsWith('TPX_Ground')) return 'Ground';
    current = current.parent;
  }
  return null;
}

new GLTFLoader().load('/output/campus_refined_v003.glb', (gltf) => {
  const root = gltf.scene;
  const refined = root.getObjectByName('REFINED_BUILDINGS');
  const auditorium = root.getObjectByName('AUDITORIUM_REFINED_ROOT');
  const southGate = root.getObjectByName('SOUTH_GATE_REFINED_ROOT');
  const library = root.getObjectByName('LIBRARY_REFINED_ROOT');
  const nameplate = root.getObjectByName('SG_Nameplate_Decal');
  const area01 = root.getObjectByName('Area_01');
  const oldLibrary = [];
  let libraryMeshes = 0;
  let groundMaterials = 0;

  if (area01) area01.traverse((object) => {
    if (object.name === 'TPX_Buildings_47' || object.name === 'TPX_Buildings_48') oldLibrary.push(object.name);
  });
  root.traverse((object) => {
    if (object.isMesh && library && (object === library || library.getObjectById(object.id))) libraryMeshes++;
    if (!object.material || family(object) !== 'Ground') return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.polygonOffset = true;
      const sign = renderer.capabilities.reversedDepthBuffer ? -1 : 1;
      material.polygonOffsetFactor = sign;
      material.polygonOffsetUnits = sign;
      material.needsUpdate = true;
      groundMaterials++;
    }
  });

  scene.add(root);
  root.updateMatrixWorld(true);
  const box = library ? new THREE.Box3().setFromObject(library) : new THREE.Box3();
  const target = box.getCenter(new THREE.Vector3());
  camera.position.set(target.x + 330, target.y - 410, target.z + 230);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  for (let index = 0; index < 5; index++) renderer.render(scene, camera);

  const passed = Boolean(refined && auditorium && southGate && library && nameplate && area01) && oldLibrary.length === 0;
  const validation = {
    status: passed ? 'passed' : 'failed',
    model: 'campus_refined_v003.glb',
    refinedBuildingsPresent: Boolean(refined),
    auditoriumPresent: Boolean(auditorium),
    southGatePresent: Boolean(southGate),
    libraryPresent: Boolean(library),
    nameplatePresent: Boolean(nameplate),
    oldArea01LibraryObjects: oldLibrary,
    libraryMeshCount: libraryMeshes,
    requestedReversedDepthBuffer: true,
    actualReversedDepthBuffer: renderer.capabilities.reversedDepthBuffer,
    groundPolygonOffsetMaterials: groundMaterials,
    groundPolygonOffsetSign: renderer.capabilities.reversedDepthBuffer ? -1 : 1,
    camera: { near: camera.near, far: camera.far },
    renderer: {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      lines: renderer.info.render.lines,
      points: renderer.info.render.points,
    },
  };
  window.__campusV003Validation = validation;
  document.body.dataset.ready = validation.status;
  document.body.dataset.validation = JSON.stringify(validation);
  status.textContent =
    `${validation.status.toUpperCase()} campus_refined_v003.glb\n` +
    `auditorium=${validation.auditoriumPresent} southGate=${validation.southGatePresent} library=${validation.libraryPresent}\n` +
    `old47/48=${validation.oldArea01LibraryObjects.length} libraryMeshes=${validation.libraryMeshCount}\n` +
    `reverse=${validation.actualReversedDepthBuffer} near=${camera.near} far=${camera.far}\n` +
    `calls=${validation.renderer.calls} triangles=${validation.renderer.triangles}`;
}, undefined, (error) => {
  console.error(error);
  document.body.dataset.ready = 'error';
  status.textContent = `ERROR ${error.message}`;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.render(scene, camera);
});
