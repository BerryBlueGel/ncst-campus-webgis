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

function meshStats(root) {
  let meshes = 0;
  let triangles = 0;
  root?.traverse((object) => {
    if (!object.isMesh) return;
    meshes++;
    const geometry = object.geometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    triangles += count / 3;
  });
  return { meshes, triangles };
}

new GLTFLoader().load('/output/campus_refined_v005.glb', (gltf) => {
  const root = gltf.scene;
  const refinedBuildings = root.getObjectByName('REFINED_BUILDINGS');
  const refinedLandmarks = root.getObjectByName('REFINED_LANDMARKS');
  const refinedSports = root.getObjectByName('REFINED_SPORTS');
  const auditorium = root.getObjectByName('AUDITORIUM_REFINED_ROOT');
  const southGate = root.getObjectByName('SOUTH_GATE_REFINED_ROOT');
  const library = root.getObjectByName('LIBRARY_REFINED_ROOT');
  const nameplate = root.getObjectByName('SG_Nameplate_Decal');
  const fusion = root.getObjectByName('FUS_Root');
  const east01 = root.getObjectByName('ST_EAST_01_Root');
  const east02 = root.getObjectByName('ST_EAST_02_Root');
  const west01 = root.getObjectByName('ST_WEST_01_Root');
  const west02 = root.getObjectByName('ST_WEST_02_Root');
  const east01Roof = root.getObjectByName('ST_EAST_01_Stand_Roof');
  let groundMaterials = 0;

  root.traverse((object) => {
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
  const sportsStats = meshStats(refinedSports);
  const stadiumRoots = [east01, east02, west01, west02];
  const positions = Object.fromEntries(stadiumRoots.filter(Boolean).map((object) => [
    object.name,
    object.getWorldPosition(new THREE.Vector3()).toArray(),
  ]));
  const east01Position = east01?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3();
  const east01RoofPosition = east01Roof?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3();
  const otherStandObjects = [east02, west01, west02].flatMap((stadium) => {
    const names = [];
    stadium?.traverse((object) => {
      if ((object.name || '').includes('_Stand_')) names.push(object.name);
    });
    return names;
  });
  const expectedPositions = {
    ST_EAST_01_Root: [1752.896, 904.499],
    ST_EAST_02_Root: [1749.759, 1197.105],
    ST_WEST_01_Root: [163.466, 688.631],
    ST_WEST_02_Root: [139.800, 1024.177],
  };
  const positionsMatched = Object.entries(expectedPositions).every(([name, expected]) => {
    const actual = positions[name];
    return actual && Math.abs(actual[0] - expected[0]) < 0.001 && Math.abs(actual[1] - expected[1]) < 0.001;
  });
  const standOnWestSide = Boolean(east01Roof) && east01RoofPosition.x < east01Position.x - 50;

  const sportsBounds = refinedSports ? new THREE.Box3().setFromObject(refinedSports) : new THREE.Box3();
  const target = sportsBounds.getCenter(new THREE.Vector3());
  const size = sportsBounds.getSize(new THREE.Vector3());
  camera.position.set(target.x + 950, target.y - 1200, 900);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  for (let index = 0; index < 5; index++) renderer.render(scene, camera);

  const passed = Boolean(
    refinedBuildings && refinedLandmarks && refinedSports && auditorium && southGate &&
    library && nameplate && fusion && east01 && east02 && west01 && west02 && east01Roof
  ) && sportsStats.meshes === 310 && sportsStats.triangles === 6494 &&
    positionsMatched && standOnWestSide && otherStandObjects.length === 0 &&
    renderer.capabilities.reversedDepthBuffer && camera.near === 0.5 && camera.far === 5000;

  const validation = {
    status: passed ? 'passed' : 'failed',
    model: 'campus_refined_v005.glb',
    refinedBuildingsPresent: Boolean(refinedBuildings),
    refinedLandmarksPresent: Boolean(refinedLandmarks),
    refinedSportsPresent: Boolean(refinedSports),
    auditoriumPresent: Boolean(auditorium),
    southGatePresent: Boolean(southGate),
    libraryPresent: Boolean(library),
    nameplatePresent: Boolean(nameplate),
    fusionSculpturePresent: Boolean(fusion),
    fourStadiumRootsPresent: stadiumRoots.every(Boolean),
    stadiumMeshCount: sportsStats.meshes,
    stadiumTriangleCount: sportsStats.triangles,
    stadiumWorldPositions: positions,
    stadiumPositionsMatched: positionsMatched,
    east01RoofedStandPresent: Boolean(east01Roof),
    east01StandOnWestSide: standOnWestSide,
    otherLargeStandObjects: otherStandObjects,
    sportsBounds: { min: sportsBounds.min.toArray(), max: sportsBounds.max.toArray(), size: size.toArray() },
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
  window.__campusV005Validation = validation;
  document.body.dataset.ready = validation.status;
  document.body.dataset.validation = JSON.stringify(validation);
  status.textContent =
    `${validation.status.toUpperCase()} campus_refined_v005.glb\n` +
    `auditorium=${validation.auditoriumPresent} southGate=${validation.southGatePresent} library=${validation.libraryPresent} fusion=${validation.fusionSculpturePresent}\n` +
    `stadiums=${validation.fourStadiumRootsPresent} meshes=${sportsStats.meshes} triangles=${sportsStats.triangles}\n` +
    `positions=${positionsMatched} east01WestStand=${standOnWestSide} otherStands=${otherStandObjects.length}\n` +
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
