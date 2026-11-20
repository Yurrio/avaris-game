/* Насколько видимая сетка планеты расходится с аналитической поверхностью.
   node tools/check-mesh-gap.mjs
   Считает: для случайных направлений — радиус поверхности (аналитика)
   против луча, пущенного в центр планеты сквозь реальную геометрию. */
import * as THREE from '../vendor/three.module.js';
import { radiusAt, R } from '../js/terrain.js';

function build(detail) {
  const geo = new THREE.IcosahedronGeometry(R, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const cache = new Map();
  let hit = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const key = `${Math.round(v.x * 1000)}|${Math.round(v.y * 1000)}|${Math.round(v.z * 1000)}`;
    let r = cache.get(key);
    if (r === undefined) { r = radiusAt(v.x, v.y, v.z); cache.set(key, r); hit++; }
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return { mesh, tris: pos.count / 3, unique: hit };
}

function gapFor(detail, samples = 150) {
  const { mesh, tris, unique } = build(detail);
  const ray = new THREE.Raycaster();
  const gaps = [];
  for (let i = 0; i < samples; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const d = new THREE.Vector3(s * Math.cos(th), u, s * Math.sin(th));
    const ana = radiusAt(d.x, d.y, d.z);
    ray.set(d.clone().multiplyScalar(400), d.clone().negate());
    const hits = ray.intersectObject(mesh, false);
    if (!hits.length) continue;
    gaps.push(hits[0].distance === 0 ? 0 : 400 - hits[0].distance - ana);
  }
  gaps.sort((a, b) => a - b);
  const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))];
  return {
    detail, tris, unique, n: gaps.length,
    min: +gaps[0].toFixed(3),
    p50: +q(0.5).toFixed(3),
    p95: +q(0.95).toFixed(3),
    max: +gaps[gaps.length - 1].toFixed(3),
  };
}

for (const d of [5, 6]) {
  const t0 = Date.now();
  const r = gapFor(d);
  console.log(JSON.stringify({ ...r, ms: Date.now() - t0 }));
}
console.log('\n(положительное значение = сетка ВЫШЕ аналитики, ровер тонет)');
