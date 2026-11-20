/* ============================================================================
   «Мёртвый город» из набора avaris-world-kit (8 моделей).
   По сюжету город стоит за завесой — вокруг «Сердца бури»: врата лицом к
   подъезду, за ними аркады, башня-гребень как доминанта, ячейки архива,
   фазовый алтарь, битые пилоны и остатки зонтичных деревьев по краю.

   Модели приходят асинхронно, а коллайдеры и резерв места под декор считаются
   сразу (cityObstacles) — иначе растения насыпались бы внутрь стен.
   ========================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { meshHeightAt, meshNormalAt } from './terrain.js';

const KIT = 'assets/world-kit/';
const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();

/** id → коллайдеры в локальных координатах (круги XZ, метры) */
const COLLIDERS = {
  // у врат оставляем открытым центральный проход — поэтому два бока
  'temple-gateway': [
    { x: -15.5, z: -1, r: 6.5 },
    { x: 15.5, z: -1, r: 6.5 },
    { x: -13.5, z: 13, r: 4.4 },
    { x: 13.5, z: 13, r: 4.4 },
  ],
  'crest-tower': [ { x: 0, z: 0, r: 6.2 } ],
  'arcade-section': [ { x: -8.4, z: 0, r: 3.2 }, { x: 8.4, z: 0, r: 3.2 } ],
  'archive-bay': [ { x: 0, z: 0, r: 3.9 } ],
  'phase-altar': [ { x: 0, z: 0, r: 2.9 } ],
  'broken-spire': [ { x: -1.2, z: 0, r: 4.2 }, { x: 3.4, z: 1.2, r: 2.6 } ],
  'dead-canopy': [ { x: 0, z: 0, r: 0.9 } ],
  'dune-rocks': [ { x: 0, z: 0, r: 4.6 } ],
};

/** Габарит для резервирования места под процедурный декор */
const RESERVE = {
  'temple-gateway': 24,
  'crest-tower': 11,
  'arcade-section': 14,
  'archive-bay': 7,
  'phase-altar': 5,
  'broken-spire': 8,
  'dead-canopy': 5,
  'dune-rocks': 7,
};

/**
 * План города в полярных координатах вокруг центра (угол в радианах от
 * направления на подъезд). yaw — поворот вокруг оси Y, градусы.
 */
const PLAN = [
  { id: 'temple-gateway', r: 46, a: 0, yaw: 0, sink: 0.35 },
  { id: 'arcade-section', r: 40, a: 34, yaw: 0, sink: 0.3 },
  { id: 'arcade-section', r: 39, a: 56, yaw: 0, sink: 0.3 },
  { id: 'archive-bay', r: 39, a: -34, yaw: 0, sink: 0.25 },
  { id: 'archive-bay', r: 38, a: -48, yaw: 0, sink: 0.25 },
  { id: 'archive-bay', r: 38, a: 74, yaw: 0, sink: 0.25 },
  { id: 'archive-bay', r: 37, a: 88, yaw: 0, sink: 0.25 },
  { id: 'phase-altar', r: 38, a: 108, yaw: 0, sink: 0.2 },
  { id: 'crest-tower', r: 48, a: 180, yaw: 0, sink: 0.4 },
  { id: 'broken-spire', r: 44, a: -100, yaw: 22, sink: 0.3 },
  { id: 'broken-spire', r: 43, a: 142, yaw: -14, sink: 0.3 },
  { id: 'broken-spire', r: 46, a: 216, yaw: 40, sink: 0.3 },
  { id: 'dead-canopy', r: 62, a: -8, yaw: 0, sink: 0.2 },
  { id: 'dead-canopy', r: 66, a: 118, yaw: 0, sink: 0.2 },
  { id: 'dead-canopy', r: 70, a: 196, yaw: 0, sink: 0.2 },
  { id: 'dead-canopy', r: 58, a: 250, yaw: 0, sink: 0.2 },
  { id: 'dead-canopy', r: 74, a: -60, yaw: 0, sink: 0.2 },
  { id: 'dune-rocks', r: 54, a: 20, yaw: 15, sink: 0.3 },
  { id: 'dune-rocks', r: 64, a: 60, yaw: -30, sink: 0.3 },
  { id: 'dune-rocks', r: 60, a: -70, yaw: 55, sink: 0.3 },
  { id: 'dune-rocks', r: 72, a: 150, yaw: -10, sink: 0.3 },
  { id: 'dune-rocks', r: 68, a: 232, yaw: 80, sink: 0.3 },
];

/** Точки плана в мировых координатах: центр + направление на подъезд */
export function citySpots(center, approach) {
  const ax = approach.x - center.x;
  const az = approach.z - center.z;
  const gateAngle = Math.atan2(az, ax);   // направление «на подъезд»
  const out = [];
  for (const p of PLAN) {
    const ang = gateAngle + (p.a * Math.PI) / 180;
    const x = center.x + Math.cos(ang) * p.r;
    const z = center.z + Math.sin(ang) * p.r;
    // фасад моделей смотрит в +Z → поворачиваем «наружу к подъезду»
    const yaw = gateAngle - Math.PI / 2 + (p.yaw * Math.PI) / 180;
    out.push({ ...p, x, z, yaw, ang });
  }
  return out;
}

/**
 * Коллайдеры и резерв места — синхронно, до генерации декора.
 * Возвращает { obstacles, reserved } в формате, который ждёт world.js.
 */
export function cityObstacles(center, approach) {
  const obstacles = [];
  const reserved = [];
  for (const s of citySpots(center, approach)) {
    const y = meshHeightAt(s.x, s.z);
    const cs = COLLIDERS[s.id] || [];
    const cos = Math.cos(s.yaw), sin = Math.sin(s.yaw);
    for (const c of cs) {
      // поворот локального круга в мир
      const wx = s.x + c.x * cos + c.z * sin;
      const wz = s.z - c.x * sin + c.z * cos;
      obstacles.push({
        pos: new THREE.Vector3(wx, meshHeightAt(wx, wz), wz),
        r: c.r,
        kind: 'wall',
      });
    }
    reserved.push({ x: s.x, z: s.z, r: Math.max(RESERVE[s.id] || 6, s.id === 'temple-gateway' ? 26 : 0) });
  }
  return { obstacles, reserved };
}

/**
 * Вершина горы: врата храма и фазовый алтарь внутри проезда.
 * Проход врат на модели — около ±4.1 м по X при 8 м ширины, поэтому ровер
 * (коллайдер 1.55 м) проезжает свободно. Возвращает группу и высоту столешницы
 * алтаря от основания — на неё ставится фазовый ключ.
 */
export async function buildSummitShrine(scene, { x, z, y, yaw = 0, scale = 0.62 }) {
  const loader = new GLTFLoader();
  const [gate, altar] = await Promise.all([
    loader.loadAsync(`${KIT}temple-gateway.glb`),
    loader.loadAsync(`${KIT}phase-altar.glb`),
  ]);

  const root = new THREE.Group();
  root.position.set(x, y, z);
  root.rotation.y = yaw;
  root.scale.setScalar(scale);
  scene.add(root);

  const gateObj = gate.scene;
  gateObj.position.set(0, 0, 0);
  gateObj.updateMatrixWorld(true);
  // нижняя плита-подиум модели не нужна: врата стоят прямо на скале.
  // Заодно запоминаем её высоту — на неё рассчитаны ступени, поэтому всю
  // модель надо опустить, иначе лестница ведёт на уровень выше пола.
  let floorY = 0;
  gateObj.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    if (b.max.y < 2.2) {
      o.visible = false;
      floorY = Math.max(floorY, b.max.y);
    }
  });
  // Опускаем ниже уровня пола: ступени и внутренний подиум уходят в камень,
  // иначе ровер проезжает сквозь их геометрию (физика считает только рельеф).
  gateObj.position.y = -(floorY + 1.0);
  root.add(gateObj);

  // алтарь — в середине проезда, чуть ближе к дальней стене.
  // От модели берём только основание-платформу: золотые кольца и бирюзовое
  // ядро не нужны — над платформой висит наш фазовый ключ.
  const altarObj = altar.scene;
  altarObj.position.set(0, 0, -1.5);
  altarObj.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'bronze' || o.name.startsWith('ACTIVE_CYAN')) o.visible = false;
  });
  root.add(altarObj);
  root.updateMatrixWorld(true);

  let topWorld = 0;
  altarObj.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const b = new THREE.Box3().setFromObject(o);
    topWorld = Math.max(topWorld, b.max.y);
  });
  const platformTopY = (topWorld - root.position.y) / scale;

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });

  return { group: root, altarTopY: platformTopY * scale, scale, yaw };
}

/** Загрузить и расставить город. Возвращает массив добавленных объектов. */
export async function buildCity(scene, center, approach) {
  const spots = citySpots(center, approach);
  const loader = new GLTFLoader();
  const ids = [...new Set(spots.map((s) => s.id))];
  const cache = {};
  await Promise.all(ids.map(async (id) => {
    const gltf = await loader.loadAsync(`${KIT}${id}.glb`);
    gltf.scene.updateMatrixWorld(true);
    cache[id] = gltf.scene;
  }));

  const added = [];
  for (const s of spots) {
    const src = cache[s.id];
    if (!src) continue;
    const obj = src.clone(true);
    meshNormalAt(s.x, s.z, _n);
    const tilt = new THREE.Quaternion().setFromUnitVectors(UP, _n);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, s.yaw);
    obj.quaternion.copy(tilt).multiply(yawQ);
    obj.position.set(s.x, meshHeightAt(s.x, s.z) - s.sink, s.z);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    obj.userData.kitId = s.id;
    scene.add(obj);
    added.push(obj);
  }
  return added;
}
