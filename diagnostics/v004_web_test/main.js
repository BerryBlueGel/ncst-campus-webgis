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

new GLTFLoader().load('/output/campus_refined_v004.glb', (gltf) => {
  const root = gltf.scene;
  const refinedBuildings = root.getObjectByName('REFINED_BUILDINGS');
  const refinedLandmarks = root.getObjectByName('REFINED_LANDMARKS');
  const auditorium = root.getObjectByName('AUDITORIUM_REFINED_ROOT');
  const southGate = root.getObjectByName('SOUTH_GATE_REFINED_ROOT');
  const library = root.getObjectByName('LIBRARY_REFINED_ROOT');
  const nameplate = root.getObjectByName('SG_Nameplate_Decal');
  const fusionGroup = root.getObjectByName('FusionSculpture');
  const fusion = root.getObjectByName('FUS_Root');
  let fusionMeshes = 0;
  let fusionTriangles = 0;
  let groundMaterials = 0;

  root.traverse((object) => {
    if (object.isMesh && fusion && (object === fusion || fusion.getObjectById(object.id))) {
      fusionMeshes++;
      const geometry = object.geometry;
      const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
      fusionTriangles += count / 3;
    }
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
  const box = fusion ? new THREE.Box3().setFromObject(fusion) : new THREE.Box3();
  const fusionWorldPosition = fusion ? fusion.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
  const target = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  camera.position.set(target.x + 26, target.y - 34, target.z + 18);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  for (let index = 0; index < 5; index++) renderer.render(scene, camera);

  const passed = Boolean(
    refinedBuildings && refinedLandmarks && auditorium && southGate && library &&
    nameplate && fusionGroup && fusion
  ) && fusionMeshes === 7 && fusionTriangles === 2396 &&
    Math.abs(fusionWorldPosition.x - 992.5924) < 0.001 &&
    Math.abs(fusionWorldPosition.y - 362.7572) < 0.001;
  const validation = {
    status: passed ? 'passed' : 'failed',
    model: 'campus_refined_v004.glb',
    refinedBuildingsPresent: Boolean(refinedBuildings),
    refinedLandmarksPresent: Boolean(refinedLandmarks),
    auditoriumPresent: Boolean(auditorium),
    southGatePresent: Boolean(southGate),
    libraryPresent: Boolean(library),
    nameplatePresent: Boolean(nameplate),
    fusionGroupPresent: Boolean(fusionGroup),
    fusionSculpturePresent: Boolean(fusion),
    fusionMeshCount: fusionMeshes,
    fusionTriangleCount: fusionTriangles,
    fusionWorldPosition: fusionWorldPosition.toArray(),
    fusionCrosshairLocationMatched: Math.abs(fusionWorldPosition.x - 992.5924) < 0.001 && Math.abs(fusionWorldPosition.y - 362.7572) < 0.001,
    fusionBounds: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() },
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
  window.__campusV004Validation = validation;
  document.body.dataset.ready = validation.status;
  document.body.dataset.validation = JSON.stringify(validation);
  status.textContent =
    `${validation.status.toUpperCase()} campus_refined_v004.glb\n` +
    `auditorium=${validation.auditoriumPresent} southGate=${validation.southGatePresent} library=${validation.libraryPresent}\n` +
    `fusion=${validation.fusionSculpturePresent} meshes=${fusionMeshes} triangles=${fusionTriangles}\n` +
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
