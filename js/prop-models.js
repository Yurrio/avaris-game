/* ============================================================================
   Потухшая флора и минералы из набора avaris-environment.
   В каждом GLB 4–5 мешей по материалам и 3–6.5 тыс. треугольников, поэтому
   на каждый меш делается свой InstancedMesh — так сотни экземпляров остаются
   в десятке draw call вместо тысяч.
   Начало координат у моделей — центр основания на земле, Y вверх.
   ========================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { withEnv } from './sky-env.js';

/** id модели → масштаб, радиус коллизии и роль в мире */
export const ENV_MODELS = {
  // ВЫСОКОЕ ДЕРЕВО: веер минеральных рёбер на стволе
  'ash-fan':        { scale: 1.80, radius: 0.50, kind: 'plant', role: 'tree' },
  // ТРАВА: одиночные сухие стебли, сквозь них можно ехать
  'hollow-lantern': { scale: 0.50, radius: 0.00, kind: 'plant', role: 'grass' },
  // КУСТАРНИК: широкая низкая розетка свёрнутых листьев
  'blind-rosette':  { scale: 1.50, radius: 0.60, kind: 'plant', role: 'bush' },
  'resonant-spar':  { scale: 0.60, radius: 0.34, kind: 'crystal' }, // резонансный шпат
  'amber-fracture': { scale: 0.75, radius: 0.46, kind: 'crystal' }, // янтарный разлом
};

export const PLANT_MODELS = ['ash-fan', 'hollow-lantern', 'blind-rosette'];
export const COOL_CRYSTAL_MODEL = 'resonant-spar';
export const TOXIC_CRYSTAL_MODEL = 'amber-fracture';

/**
 * Какое растение ставить: травы больше, деревьев и кустов меньше.
 * Дерево — ash-fan, куст — blind-rosette, трава — hollow-lantern.
 */
export function pickPlantModel(rnd) {
  const r = rnd();
  if (r < 0.34) return 'ash-fan';        // дерево
  if (r < 0.66) return 'blind-rosette';  // кустарник
  return 'hollow-lantern';               // трава
}

/**
 * Загружает модели набора и возвращает
 * { id: { parts: [{geometry, material}], solidR, height } }
 * Геометрия уже в системе координат модели (основание в нуле).
 * solidR — радиус основания (нижние 30 % высоты): по нему ставим коллайдер,
 * чтобы ровер не проезжал сквозь камень и ствол, но мог проехать под кроной.
 */
export async function loadPropModels(ids = Object.keys(ENV_MODELS)) {
  const loader = new GLTFLoader();
  const out = {};
  await Promise.all(ids.map(async (id) => {
    const gltf = await loader.loadAsync(`assets/models/${id}.glb`);
    gltf.scene.updateMatrixWorld(true);
    const parts = [];
    let maxY = 0;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > maxY) maxY = pos.getY(i);
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      g.deleteAttribute('uv');       // материалов с текстурами в наборе нет
      withEnv(o.material, 0.9);
      parts.push({ geometry: g, material: o.material });
    });

    let solidR = 0;
    const low = maxY * 0.3;
    for (const part of parts) {
      const pos = part.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > low) continue;
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        if (r > solidR) solidR = r;
      }
    }
    out[id] = { parts, solidR, height: maxY };
  }));
  return out;
}

/** InstancedMesh на каждый меш модели; оттенок задаётся на экземпляр */
export function makePropInstances(parts, matrices, tints = null) {
  const n = matrices.length;
  const meshes = [];
  for (const part of parts) {
    const im = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, n));
    for (let i = 0; i < n; i++) {
      im.setMatrixAt(i, matrices[i]);
      if (tints && tints[i]) im.setColorAt(i, tints[i]);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    meshes.push(im);
  }
  return meshes;
}
