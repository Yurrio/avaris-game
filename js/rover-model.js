/* ============================================================================
   Ровер «Кочевник-03» из GLB.
   В файле 904 меша (904 draw call на кадр) — поэтому сразу объединяем их по
   материалам. Колёса (шины и протектор) собираем в отдельные группы, чтобы
   они крутились, а передняя ось подруливала.
   Модель сделана в метрах: 6.4 × 3.4 × 3.02, Y вверх, +Z вперёд,
   центр основания — в начале координат.
   ========================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { withEnv } from './sky-env.js';

export const ROVER_GLB = 'assets/models/avaris-nomad-03.glb';
export const ROVER_SCALE = 0.55;        // 3.4 м ширины → ~1.9 м (под коллайдер 2 м)
export const ROVER_WHEEL_R = 0.69 * ROVER_SCALE;   // радиус колеса в мире

/** Материалы, которые крутятся вместе с колесом */
const WHEEL_MATS = new Set(['Tyres / dusty elastomer', 'Tread blocks']);
/** Шесть колёс модели: x = ±1.3, три оси по z, радиус 0.69 */
const WHEEL_CENTERS = [
  [-1.3, 0.73, -1.97], [1.3, 0.73, -1.97],
  [-1.3, 0.73, 0], [1.3, 0.73, 0],
  [-1.3, 0.73, 1.97], [1.3, 0.73, 1.97],
].map((c) => new THREE.Vector3(c[0], c[1], c[2]));

/**
 * Склеивает список {geometry, material, matrix} в по одному мешу на материал.
 * Геометрии переводятся в non-indexed (иначе индексы разных мешей не сложить).
 */
function mergeByMaterial(parts) {
  const buckets = new Map();
  for (const part of parts) {
    const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    g.applyMatrix4(part.matrix);
    const key = part.material.uuid;
    let b = buckets.get(key);
    if (!b) { b = { material: part.material, list: [] }; buckets.set(key, b); }
    b.list.push(g);
  }

  const out = [];
  for (const b of buckets.values()) {
    let total = 0;
    for (const g of b.list) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    let o = 0;
    for (const g of b.list) {
      const p = g.attributes.position.array;
      const n = g.attributes.normal && g.attributes.normal.array;
      pos.set(p, o * 3);
      if (n) nor.set(n, o * 3);
      o += g.attributes.position.count;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.frustumCulled = false;   // колесо/корпус двигаются вместе с ровером
    out.push(mesh);
  }
  return out;
}

/**
 * Загружает GLB и собирает готовую модель.
 * Возвращает { group, wheels:[{pivot, steerGroup, front}], scale }
 */
export async function loadRoverModel(url = ROVER_GLB) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // --- разбираем меши на «колёса», «экипаж» и «корпус» ---------------------
  const wheelParts = WHEEL_CENTERS.map(() => []);
  const bodyParts = [];
  // фигуры в салоне (Seated researcher…) не склеиваем с корпусом:
  // в финале они вылетают из машины отдельными объектами
  const crewParts = new Map();
  const tmpBox = new THREE.Box3();
  const tmpVec = new THREE.Vector3();

  root.traverse((o) => {
    if (!o.isMesh) return;

    /* --- экипаж ------------------------------------------------------- */
    let figure = null;
    for (let p = o.parent; p && p !== root; p = p.parent) {
      // GLTFLoader нормализует имена: «Seated researcher / …» → Seated_researcher__
      if (/^seated[ _]researcher/i.test(p.name || '')) { figure = p; break; }
    }
    if (figure) {
      let rec = crewParts.get(figure);
      if (!rec) {
        figure.getWorldPosition(tmpVec);
        rec = { at: tmpVec.clone(), parts: [] };
        crewParts.set(figure, rec);
      }
      const m = o.matrixWorld.clone();
      rec.parts.push({ geometry: o.geometry, material: o.material, matrix: m });
      return;
    }

    const matName = (o.material && o.material.name) || '';
    const part = { geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() };
    if (!WHEEL_MATS.has(matName)) { bodyParts.push(part); return; }

    // ближайшее колесо — по центру меша
    tmpBox.setFromObject(o);
    tmpBox.getCenter(tmpVec);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < WHEEL_CENTERS.length; i++) {
      const d = tmpVec.distanceTo(WHEEL_CENTERS[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0 || bestD > 1.4) { bodyParts.push(part); return; }

    // переносим геометрию в систему координат колеса
    const c = WHEEL_CENTERS[best];
    part.matrix.premultiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    wheelParts[best].push(part);
  });

  // --- собираем ------------------------------------------------------------
  const group = new THREE.Group();
  group.scale.setScalar(ROVER_SCALE);

  // металлу нужны отражения, иначе корпус выглядит чёрным
  root.traverse((o) => { if (o.isMesh) withEnv(o.material, 1.05); });

  for (const mesh of mergeByMaterial(bodyParts)) group.add(mesh);

  const wheels = [];
  for (let i = 0; i < WHEEL_CENTERS.length; i++) {
    const c = WHEEL_CENTERS[i];
    const steerGroup = new THREE.Group();
    steerGroup.position.copy(c);
    const pivot = new THREE.Group();
    steerGroup.add(pivot);
    for (const mesh of mergeByMaterial(wheelParts[i])) pivot.add(mesh);
    group.add(steerGroup);
    // передняя ось — та, что ближе к +Z
    wheels.push({ pivot, steerGroup, front: c.z > 1 });
  }

  /* --- экипаж: своя группа на каждого, начало — центр фигуры -------------
     Фигуру режем на торс, две руки и две ноги: в финале её выбрасывает из
     машины, и конечности должны болтаться в воздухе, а не лететь статуей.
     Части узнаются по габаритам: руки — выше пояса и далеко от оси, ноги —
     ниже пояса. Пивоты ставим в плечо (верх руки) и в бедро (верх ноги). */
  const crew = [];
  for (const rec of crewParts.values()) {
    const parts = rec.parts.map((p) => {
      const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
      g.applyMatrix4(p.matrix);
      return { geo: g, material: p.material };
    });
    const box = new THREE.Box3();
    for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
    const center = box.isEmpty() ? rec.at.clone() : box.getCenter(new THREE.Vector3());
    for (const p of parts) {
      p.geo.translate(-center.x, -center.y, -center.z);
      p.geo.computeBoundingBox();
      p.geo.computeBoundingSphere();
    }

    const size = box.getSize(new THREE.Vector3());
    const halfW = Math.max(0.2, size.x / 2);
    const ySplit = (box.min.y - center.y) + size.y * 0.42;   // пояс
    const armMin = halfW * 0.45;
    const legMin = halfW * 0.30;

    const buckets = { torso: [], armL: [], armR: [], legL: [], legR: [] };
    const tmpC = new THREE.Vector3();
    for (const p of parts) {
      p.geo.boundingBox.getCenter(tmpC);
      const ax = Math.abs(tmpC.x);
      if (tmpC.y < ySplit && ax > legMin) (tmpC.x < 0 ? buckets.legL : buckets.legR).push(p);
      else if (tmpC.y >= ySplit && ax > armMin) (tmpC.x < 0 ? buckets.armL : buckets.armR).push(p);
      else buckets.torso.push(p);
    }

    const holder = new THREE.Group();
    holder.position.copy(center);
    const limbs = {};
    const addLimb = (list, key, pivotFn) => {
      if (!list.length) return null;
      const lb = new THREE.Box3();
      for (const p of list) lb.union(p.geo.boundingBox);
      const pivot = pivotFn(lb);
      const g = new THREE.Group();
      g.position.copy(pivot);
      const moved = list.map((p) => {
        const geo = p.geo.clone();
        geo.translate(-pivot.x, -pivot.y, -pivot.z);
        geo.computeBoundingSphere();
        return { geometry: geo, material: p.material, matrix: new THREE.Matrix4() };
      });
      for (const mesh of mergeByMaterial(moved)) g.add(mesh);
      holder.add(g);
      if (key) limbs[key] = g;
      return g;
    };

    addLimb(buckets.torso, null, () => new THREE.Vector3(0, 0, 0));
    // плечо — верхняя точка руки, чуть ближе к оси тела
    const shoulder = (lb) => {
      const c = lb.getCenter(new THREE.Vector3());
      return new THREE.Vector3(c.x, lb.max.y, c.z);
    };
    // бедро — верхняя задняя точка ноги (там, где нога выходит из торса)
    const hip = (lb) => {
      const c = lb.getCenter(new THREE.Vector3());
      return new THREE.Vector3(c.x, lb.max.y, lb.min.z + (lb.max.z - lb.min.z) * 0.3);
    };
    addLimb(buckets.armL, 'armL', shoulder);
    addLimb(buckets.armR, 'armR', shoulder);
    addLimb(buckets.legL, 'legL', hip);
    addLimb(buckets.legR, 'legR', hip);

    group.add(holder);
    crew.push({ group: holder, home: center.clone(), limbs });
  }

  return { group, wheels, crew, scale: ROVER_SCALE, wheelRadius: ROVER_WHEEL_R };
}
