import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';


const here = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(here, '../../output/campus_refined_v001.glb');
const reportPath = path.resolve(here, '../../output/campus_refined_v001_threejs_validation.json');
const bytes = fs.readFileSync(modelPath);
const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const gltf = await new Promise((resolve, reject) => {
  new GLTFLoader().parse(data, '', resolve, reject);
});

const area02 = gltf.scene.getObjectByName('Area_02');
const refinedRoot = gltf.scene.getObjectByName('AUDITORIUM_REFINED_ROOT');
if (!area02 || !refinedRoot) {
  throw new Error('Three.js 场景缺少 Area_02 或精修会堂根节点');
}

const oldInsideArea02 = area02.getObjectByName('TPX_Buildings_14');
let objectCount = 0;
let meshCount = 0;
let lineObjectCount = 0;
let refinedMeshCount = 0;
gltf.scene.traverse((object) => {
  objectCount += 1;
  if (object.isMesh) meshCount += 1;
  if (object.isLine || object.isLineSegments || object.isLineLoop) lineObjectCount += 1;
});
refinedRoot.traverse((object) => {
  if (object.isMesh) refinedMeshCount += 1;
});

const bounds = new Box3().setFromObject(refinedRoot);
const size = bounds.getSize(new Vector3());
const center = bounds.getCenter(new Vector3());
const rootPosition = refinedRoot.getWorldPosition(new Vector3());
const expected = new Vector3(981.0433, 1212.0, 0.0);
const rootPositionError = rootPosition.distanceTo(expected);

if (oldInsideArea02) throw new Error('Three.js 中 Area_02 仍包含原始会堂');
if (refinedMeshCount !== 25) throw new Error(`精修会堂 Mesh 数量异常: ${refinedMeshCount}`);
if (rootPositionError > 0.001) throw new Error(`Three.js 中精修会堂定位漂移: ${rootPositionError}m`);

const report = {
  status: 'passed',
  loader: 'Three.js GLTFLoader 0.180.0',
  model: modelPath,
  objectCount,
  meshCount,
  lineObjectCount,
  refinedMeshCount,
  sourceBuildingPresentInsideArea02: false,
  refinedRootWorldPosition: rootPosition.toArray(),
  refinedRootPositionErrorMeters: rootPositionError,
  refinedBounds: {
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    center: center.toArray(),
    size: size.toArray(),
  },
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
