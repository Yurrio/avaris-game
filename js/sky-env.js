/* ============================================================================
   Простая «небесная» панорама для PBR-материалов моделей.
   Без envMap металл (metalness ≈ 1) рисуется чёрным — ему нечего отражать.
   Дешёвый эквиректангулярный градиент: тёмный зенит, светлый горизонт,
   тёплый низ. Three сам превращает такую текстуру в PMREM при загрузке.
   ========================================================================== */
import * as THREE from 'three';

let _env = null;
/** материалы, у которых есть envMap: их яркость ведётся вместе со временем суток */
const _envMats = new Set();

export function skyEnv() {
  if (_env) return _env;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 32;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0.00, '#0b1422');   // зенит
  g.addColorStop(0.38, '#43617c');
  g.addColorStop(0.52, '#9fb7c9');   // горизонт — основной свет сверху
  g.addColorStop(0.60, '#c8b89a');   // подсветка от песка
  g.addColorStop(1.00, '#5b4a36');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _env = tex;
  return _env;
}

/** Подмешать отражения в материал модели (металл без них чёрный) */
export function withEnv(material, intensity = 1.0) {
  if (!material || !material.isMeshStandardMaterial) return material;
  material.envMap = skyEnv();
  material.envMapIntensity = intensity;
  material.userData.envBase = intensity;
  _envMats.add(material);
  material.needsUpdate = true;
  return material;
}

/**
 * Множитель отражений для всего, что получило withEnv: 1 — день, ~0.2 — ночь.
 * Ловушка: гасить только лампы нельзя — металл продолжает отражать «яркое»
 * небо и светится в темноте; гасить только envMap тоже нельзя — металл станет
 * чёрным. Поэтому яркость отражений идёт синхронно со светом.
 */
export function setSkyEnvFactor(k) {
  const f = Math.max(0, Math.min(2, k));
  for (const m of _envMats) m.envMapIntensity = (m.userData.envBase ?? 1) * f;
}
