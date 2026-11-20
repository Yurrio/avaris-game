/* ============================================================================
   МЕХАНИЗМЫ АВАРИСЦЕВ — врата, очаг-маяк и противовес.

   Задача модуля: собрать три «древности» так, чтобы
     • знак лежал на НЕПОДВИЖНОЙ части (подвижные — створки, пламя, площадка);
     • поверхность под знаком была ровная и вертикальная (круглая пломба);
     • корпус выглядел проработанным: каменная кладка с трещинами, бронза
       с патиной и заклёпками, тёмный металл с прокаткой — всё текстурами,
       сгенерированными на canvas (никаких внешних файлов).

   Кит-модели (assets/world-kit) подставляются как основания:
     очаг  → phase-altar  (ярусный алтарь с кристаллом — кристалл заменяем огнём)
     подъём → arcade-section (аркада-мост — площадка ездит в её пролёте)
   ========================================================================== */
import * as THREE from 'three';
import { glyphOf, canvasFont } from './tangut.js';

/* ---------------------------------------------------------------- текстуры */
function canvasTex(size, draw, repeat = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.setScalar(repeat);
  t.anisotropy = 4;
  return t;
}

/** Каменная кладка: блоки, швы, трещины, зерно */
function stoneMap() {
  return canvasTex(256, (g, S) => {
    g.fillStyle = '#b9ad96';
    g.fillRect(0, 0, S, S);
    const rows = 6, cols = 4;
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      const w = S / cols;
      const off = (r % 2) * w * 0.5;
      for (let c = -1; c <= cols; c++) {
        const x = c * w + off;
        const shade = 0.86 + Math.random() * 0.16;
        g.fillStyle = `rgba(${(190 * shade) | 0},${(178 * shade) | 0},${(150 * shade) | 0},1)`;
        g.fillRect(x + 1.2, r * h + 1.2, w - 2.4, h - 2.4);
      }
    }
    // зерно и выбоины
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const a = 0.03 + Math.random() * 0.08;
      g.fillStyle = Math.random() < 0.5 ? `rgba(80,70,55,${a})` : `rgba(255,248,225,${a})`;
      g.fillRect(x, y, 1.6, 1.6);
    }
    // трещины
    g.strokeStyle = 'rgba(60,52,40,.5)';
    for (let i = 0; i < 7; i++) {
      g.lineWidth = 0.7 + Math.random();
      g.beginPath();
      let x = Math.random() * S, y = Math.random() * S;
      g.moveTo(x, y);
      for (let s = 0; s < 7; s++) {
        x += (Math.random() - 0.5) * 34;
        y += (Math.random() - 0.5) * 34;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }, 2);
}

/** Бронза: патина, разводы, заклёпки по краям */
function bronzeMap(withRivets = true) {
  return canvasTex(256, (g, S) => {
    g.fillStyle = '#8a6a3f';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 1800; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const patina = Math.random() < 0.45;
      const a = 0.05 + Math.random() * 0.2;
      g.fillStyle = patina ? `rgba(92,140,120,${a})` : `rgba(215,170,110,${a * 0.8})`;
      g.beginPath();
      g.arc(x, y, 1 + Math.random() * 5, 0, Math.PI * 2);
      g.fill();
    }
    if (withRivets) {
      for (let i = 0; i < 14; i++) {
        const x = 16 + (i % 7) * 34, y = i < 7 ? 16 : S - 16;
        g.fillStyle = 'rgba(40,28,16,.55)';
        g.beginPath(); g.arc(x, y + 1.5, 5.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(226,190,128,.9)';
        g.beginPath(); g.arc(x, y, 4.2, 0, Math.PI * 2); g.fill();
      }
    }
  }, 2);
}

/** Тёмный металл: прокатка и потёртости */
function ironMap() {
  return canvasTex(256, (g, S) => {
    g.fillStyle = '#3c4249';
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y++) {
      const v = 60 + Math.random() * 26;
      g.fillStyle = `rgba(${v},${v + 5},${v + 10},.5)`;
      g.fillRect(0, y, S, 1);
    }
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      g.fillStyle = Math.random() < 0.4 ? 'rgba(120,96,70,.22)' : 'rgba(200,214,226,.12)';
      g.fillRect(x, y, 2 + Math.random() * 5, 1.5);
    }
  }, 3);
}

let MATS = null;
function materials() {
  if (MATS) return MATS;
  const stone = stoneMap();
  const bronze = bronzeMap();
  const iron = ironMap();
  MATS = {
    stone: new THREE.MeshStandardMaterial({
      map: stone, bumpMap: stone, bumpScale: 0.35, roughness: 0.92, metalness: 0.04,
      color: 0xb7ab94,
    }),
    stoneDark: new THREE.MeshStandardMaterial({
      map: stone, bumpMap: stone, bumpScale: 0.4, roughness: 0.95, metalness: 0.03,
      color: 0x7d7460,
    }),
    bronze: new THREE.MeshStandardMaterial({
      map: bronze, bumpMap: bronze, bumpScale: 0.25, roughness: 0.44, metalness: 0.85,
      color: 0xb08a55,
    }),
    iron: new THREE.MeshStandardMaterial({
      map: iron, bumpMap: iron, bumpScale: 0.3, roughness: 0.58, metalness: 0.72,
      color: 0x8892a0,
    }),
    glow: new THREE.MeshStandardMaterial({
      color: 0xd6efe8, emissive: 0x63e3d0, emissiveIntensity: 0.8,
      roughness: 0.24, metalness: 0.5,
    }),
  };
  return MATS;
}

/* ------------------------------------------------------------------ пломба */
function faceTexture(char, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = canvasFont(156);
  g.fillText(char, 128, 132);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  return t;
}

/**
 * Круглая пломба со знаком: бронзовый диск, светящийся ободок и две грани
 * с иероглифами (погасшее/активное состояние). Грани переключаются видимостью.
 */
export function makeMedallion(r, offKey, onKey) {
  const M = materials();
  const med = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.1, 44), M.bronze);
  disc.rotation.x = Math.PI / 2;
  med.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.93, r * 0.055, 10, 44), M.glow);
  med.add(rim);
  const inner = new THREE.Mesh(new THREE.RingGeometry(r * 0.86, r * 0.89, 44), M.iron);
  inner.position.z = 0.053;
  med.add(inner);
  const face = (id, color) => {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.84, 44),
      new THREE.MeshBasicMaterial({
        map: faceTexture(glyphOf(id), color), transparent: true, depthWrite: false,
      }),
    );
    m.position.z = 0.058;
    return m;
  };
  const off = face(offKey, '#efe6ff');
  const on = face(onKey, '#a8ffe9');
  on.visible = false;
  med.add(off, on);
  return { group: med, rim, off, on };
}

/**
 * Бронзовая плита-подложка под пломбу: гарантирует, что знак лежит на ровной
 * вертикальной поверхности, даже если основание скульптурное или круглое.
 */
export function mountPlate(r) {
  const M = materials();
  const g = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(r * 2.55, r * 3.0, 0.16), M.bronze);
  slab.castShadow = true; slab.receiveShadow = true;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(r * 2.85, r * 3.3, 0.1), M.iron);
  frame.position.z = -0.08;
  frame.castShadow = true;
  g.add(frame, slab);
  // заклёпки по углам плиты
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(r * 0.115, 10, 8), M.iron);
      rivet.position.set(sx * r * 1.1, sy * r * 1.32, 0.1);
      g.add(rivet);
    }
  }
  // литая рамка вокруг диска
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.14, r * 0.05, 8, 36), M.iron);
  ring.position.z = 0.1;
  g.add(ring);
  return g;
}

/**
 * Габариты собранного механизма в его локальных координатах.
 * skip — объекты, которые не должны учитываться (пломба, плита, подвижное).
 * yRange — [низ, верх]: учесть только то, что попало в этот слой по высоте
 * (чтобы плитка села на настоящую грань сужающейся башни, а не в воздух).
 */
export function localBox(group, skip = [], yRange = null) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Matrix4();
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    for (let p = o; p && p !== group; p = p.parent) if (skip.includes(p)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone();
    tmp.multiplyMatrices(inv, o.matrixWorld);
    b.applyMatrix4(tmp);
    if (yRange && (b.max.y < yRange[0] || b.min.y > yRange[1])) return;
    box.union(b);
  });
  return box;
}

/**
 * Поставить пломбу (и её плиту) на переднюю грань уже собранного механизма.
 * Габариты считаются в локальных координатах группы, поэтому подходит и для
 * китовых оснований произвольной формы. yFrac — доля высоты снизу вверх.
 */
export function fitMedallion(site, yFrac = 0.42, yOverride = null) {
  const med = site.medallion;
  const plate = site.plate;
  if (!med) return null;
  const skip = [med, ...(site.moving || [])];
  if (plate) skip.push(plate);
  const box = localBox(site.group, skip);
  if (box.isEmpty()) return null;
  const size = new THREE.Vector3();
  box.getSize(size);
  const y = yOverride == null ? box.min.y + size.y * yFrac : yOverride;
  // передняя грань именно на этой высоте: лучем из точки перед механизмом
  // ищем настоящую поверхность, иначе плитка висит в воздухе перед
  // сужающейся башней или утопает внутрь скульптурного основания
  site.group.updateMatrixWorld(true);
  const fwd = new THREE.Vector3(0, 0, 1).transformDirection(site.group.matrixWorld).normalize();
  const basePt = new THREE.Vector3(0, y, 0).applyMatrix4(site.group.matrixWorld);
  const ray = new THREE.Raycaster(basePt.clone().addScaledVector(fwd, 8), fwd.clone().negate(), 0, 16);
  const skipHit = (o) => { for (let n = o; n; n = n.parent) if (skip.includes(n)) return true; return false; };
  const hit = ray.intersectObject(site.group, true).find((h) => !skipHit(h.object));
  let z;
  if (hit) {
    const inv = new THREE.Matrix4().copy(site.group.matrixWorld).invert();
    z = hit.point.clone().applyMatrix4(inv).z;
  } else {
    const slab = localBox(site.group, skip, [y - 0.9, y + 0.9]);
    z = (slab.isEmpty() ? box : slab).max.z;
  }
  if (plate) {
    plate.position.set(0, y, z + 0.13);   // рамка плиты упирается в поверхность
    plate.rotation.set(0, 0, 0);
  }
  med.position.set(0, y, z + 0.31);      // диск лежит на плите, не в воздухе
  med.rotation.set(0, 0, 0);
  return { y, z, size };
}

/**
 * Развести стойки, кабину и груз по сторонам от основания: считается ширина
 * башни, и всё подвижное уходит наружу — кабина справа, противовес слева.
 * Никакая часть механизма не проходит сквозь другую ни в одном положении.
 */
export function placeLiftTrack(site) {
  if (!site || !site.colRight) return null;
  const skip = [site.medallion, ...(site.moving || [])];
  if (site.plate) skip.push(site.plate);
  const box = localBox(site.group, skip);
  if (box.isEmpty()) return null;
  const halfX = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
  const colX = halfX + 0.85;                 // стойки вплотную к бокам башни
  site.colRight.position.x = colX;
  site.colLeft.position.x = -colX;
  // кабина и груз висят снаружи своих стоек
  site.platform.position.x = colX + 1.3;
  site.counter.position.x = -colX - 1.3;
  for (const r of site.ropes || []) {
    r.position.x = r.userData.role === 'counter' ? -colX - 1.3 : colX + 1.3;
  }
  for (const r of site.rollers || []) r.position.x = Math.sign(r.position.x) * (colX + 1.3);
  // балансирная балка и кронштейны пересчитываются под новую ширину
  const span = 2 * (colX + 1.6);
  site.beam.scale.x = span / site.beam.userData.baseLen;
  const gap = colX - halfX;                  // от грани башни до стойки
  for (const arm of site.arms) {
    arm.scale.x = Math.max(0.2, gap + 0.2) / arm.userData.baseLen;
    arm.position.x = Math.sign(arm.userData.side) * (halfX + gap / 2);
  }
  site.frontZ = box.max.z;
  site.colX = colX;
  return { colX, halfX, span };
}

/* -------------------------------------------------------------- детали */
/** Широкая каменная колонна с резными поясками */
function pillar(w, h, d, M) {
  const g = new THREE.Group();
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(w * 1.25, 0.5, d * 1.25), M.stoneDark);
  plinth.position.y = 0.25;
  g.add(plinth);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.stone);
  shaft.position.y = 0.5 + h / 2;
  g.add(shaft);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.2, 0.45, d * 1.2), M.stoneDark);
  cap.position.y = 0.5 + h + 0.2;
  g.add(cap);
  // резные пояски
  for (const t of [0.28, 0.62]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, 0.12, d * 1.06), M.bronze);
    band.position.y = 0.5 + h * t;
    g.add(band);
  }
  return g;
}

/** Поставить на место запасного основания модель кита */
export function setKitBase(site, model, scale = 1, y = 0) {
  if (!site || !model) return false;
  for (const o of site.fallback || []) { if (o.parent) o.parent.remove(o); }
  if (site.fallback) site.fallback.length = 0;
  model.scale.setScalar(scale);
  model.position.set(0, y, 0);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  site.group.add(model);
  return true;
}

/* ============================================================ ВРАТА */
/** Врата: две каменные опоры, бронзовая перекладина с пломбой и створки */
export function buildGate() {
  const M = materials();
  const g = new THREE.Group();
  const OPEN = 4.6;          // ширина проёма
  const DOOR_H = 6.2;        // высота створки
  const half = OPEN / 2;

  for (const s of [-1, 1]) {
    const p = pillar(1.7, 6.5, 2.1, M);
    p.position.set(s * (half + 0.85), 0, 0);
    g.add(p);
  }

  // порог
  const sill = new THREE.Mesh(new THREE.BoxGeometry(OPEN + 1.6, 0.3, 2.6), M.stoneDark);
  sill.position.y = 0.15;
  g.add(sill);

  // перекладина: камень + бронзовый фриз (пломба крепится сюда — часть неподвижна)
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(OPEN + 3.4, 0.9, 2.3), M.stone);
  lintel.position.y = DOOR_H + 0.75;
  g.add(lintel);
  const frieze = new THREE.Mesh(new THREE.BoxGeometry(OPEN + 2.2, 1.5, 0.18), M.bronze);
  frieze.position.set(0, DOOR_H + 1.85, 0.9);
  g.add(frieze);
  const crown = new THREE.Mesh(new THREE.BoxGeometry(OPEN + 3.8, 0.5, 2.6), M.stoneDark);
  crown.position.y = DOOR_H + 2.85;
  g.add(crown);

  // створки: петли на внутренних гранях опор, створки сходятся ровно в центре
  const doors = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(s * half, 0, 0);
    const leafW = half;                       // ровно половина проёма
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, DOOR_H, 0.32), M.bronze);
    leaf.position.set(-s * leafW / 2, DOOR_H / 2 + 0.3, 0);
    hinge.add(leaf);
    // поперечные накладки и заклёпки
    for (const y of [1.4, 3.3, 5.2]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.94, 0.22, 0.42), M.iron);
      band.position.set(-s * leafW / 2, y, 0.06);
      hinge.add(band);
    }
    // стык: узкая полоса по центру створки
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.16, DOOR_H * 0.96, 0.4), M.iron);
    seam.position.set(-s * (leafW - 0.1), DOOR_H / 2 + 0.3, 0.02);
    hinge.add(seam);
    // петли
    for (const y of [0.9, 3.2, 5.6]) {
      const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.5, 10), M.iron);
      knuckle.position.set(0, y, 0.22);
      knuckle.rotation.z = Math.PI / 2;
      hinge.add(knuckle);
    }
    g.add(hinge);
    doors.push(hinge);
  }

  const med = makeMedallion(0.82, 'shut', 'open');
  med.group.position.set(0, DOOR_H + 1.85, 1.02);   // на бронзовом фризе
  g.add(med.group);

  return {
    group: g,
    markOff: med.off,
    markOn: med.on,
    medallion: med.group,
    rim: med.rim,
    left: doors[0],
    right: doors[1],
    shot: { fov: 46, pad: 1.05, yaw: 15 },
  };
}

/* ====================================================== ОЧАГ-МАЯК */
/** Очаг: ярусный алтарь (кит) или своя чаша, огонь и пломба на цоколе */
export function buildBeacon(kitModel) {
  const M = materials();
  const g = new THREE.Group();
  const fallback = [];

  if (true) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 1.1, 10), M.stoneDark);
    base.position.y = 0.55;
    g.add(base); fallback.push(base);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.2, 1.4, 12), M.bronze);
    bowl.position.y = 1.9;
    g.add(bowl); fallback.push(bowl);
  }

  // огонь в чаше/на месте кристалла
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffc46a, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.5, 8), flameMat);
  flame.position.y = 3.05;
  flame.visible = false;
  g.add(flame);
  const fglow = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0xffb45a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  fglow.position.y = 3.1;
  g.add(fglow);
  const flight = new THREE.PointLight(0xffa040, 0, 30, 2);
  flight.position.y = 3.4;
  g.add(flight);

  // пломба — на неподвижной плите, привинченной к передней грани основания
  const med = makeMedallion(0.62, 'dark', 'burn');
  med.group.position.set(0, 1.3, 2.6);
  g.add(med.group);
  const plate = mountPlate(0.62);
  plate.position.set(0, 1.3, 2.5);
  g.add(plate);

  return {
    group: g,
    markOff: med.off,
    markOn: med.on,
    medallion: med.group,
    plate,
    rim: med.rim,
    flame, fglow, flight,
    fallback,
    shot: { fov: 45, pad: 1.08, yaw: 12 },
  };
}

/* ====================================================== ПРОТИВОВЕС */
/**
 * Противовес: две стойки по бокам основания и балансирная балка сверху.
 * Справа на тросе ходит кабина, слева — каменный груз, всегда в противофазе.
 * Всё движется СНАРУЖИ башни, поэтому ни кабина, ни груз не проходят сквозь
 * конструкцию ни в одном положении.
 */
export function buildLift(kitModel) {
  const M = materials();
  const g = new THREE.Group();
  const fallback = [];
  const COL_X = 3.1;     // положение стоек (placeLiftTrack пересчитает под кит)
  const COL_H = 7.2;     // высота стоек
  const RANGE = 3.6;     // ход кабины

  // --- своя каменная база (уйдёт, если подставится китовое основание)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.3, 0.5, 12), M.stoneDark);
  base.position.y = 0.25;
  g.add(base); fallback.push(base);

  // --- стойка: каменный башмак, железный столб с бронзовыми поясами, блок-шкив
  const makeColumn = (side) => {
    const col = new THREE.Group();
    col.userData.side = side;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 1.0), M.stoneDark);
    foot.position.y = 0.25;
    foot.receiveShadow = true;
    col.add(foot);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.34, COL_H, 0.34), M.iron);
    shaft.position.y = COL_H / 2 + 0.4;
    shaft.castShadow = true;
    col.add(shaft);
    for (let i = 0; i < 6; i++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.44), M.bronze);
      band.position.y = 0.7 + i * 1.15;
      col.add(band);
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.28, 0.62), M.bronze);
    cap.position.y = COL_H + 0.55;
    col.add(cap);
    const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14), M.bronze);
    pulley.position.y = COL_H + 0.55;
    pulley.rotation.z = Math.PI / 2;
    col.add(pulley);
    col.position.set(side * COL_X, 0, 0);
    g.add(col);
    return col;
  };
  const colRight = makeColumn(1);
  const colLeft = makeColumn(-1);

  // --- кронштейны: стойки притянуты к бокам основания
  const arms = [];
  for (const side of [-1, 1]) {
    for (const y of [1.1, COL_H - 0.5]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.22), M.iron);
      arm.userData.baseLen = 0.9;
      arm.userData.side = side;
      arm.position.set(side * 2.1, y, 0);
      g.add(arm);
      arms.push(arm);
    }
  }

  // --- балансирная балка поверх стоек + ролики на её концах
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1, 0.34, 0.42), M.iron);
  beam.userData.baseLen = 1;
  beam.position.set(0, COL_H + 0.55, 0);
  beam.scale.x = COL_X * 2 + 3.2;
  beam.castShadow = true;
  g.add(beam);
  const rollers = [];
  for (const side of [-1, 1]) {
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12), M.bronze);
    roller.rotation.z = Math.PI / 2;
    roller.position.set(side * (COL_X + 1.3), COL_H + 0.55, 0);
    g.add(roller);
    rollers.push(roller);
  }

  // --- КАБИНА: закрытая будка с проёмом — сразу видно, что внутри едет человек
  const platform = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.26, 1.8), M.iron);
  deck.castShadow = true; deck.receiveShadow = true;
  platform.add(deck);
  const CAB_H = 1.75;
  const wall = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.bronze);
    m.position.set(x, y, z);
    m.castShadow = true;
    platform.add(m);
    return m;
  };
  wall(1.9, CAB_H, 0.1, 0, CAB_H / 2 + 0.1, -0.85);        // задняя стена
  wall(0.1, CAB_H, 1.7, -0.9, CAB_H / 2 + 0.1, 0);         // левая стена
  wall(0.1, CAB_H, 1.7, 0.9, CAB_H / 2 + 0.1, 0);          // правая стена
  wall(0.5, CAB_H, 0.1, -0.7, CAB_H / 2 + 0.1, 0.85);      // стенки у проёма
  wall(0.5, CAB_H, 0.1, 0.7, CAB_H / 2 + 0.1, 0.85);
  wall(1.9, 0.24, 1.8, 0, CAB_H + 0.2, 0);                 // потолок
  wall(1.1, 0.16, 0.16, 0, CAB_H * 0.62, 0.86);            // поручень у проёма
  // скамья внутри и тёплый огонёк — будка «обжитая»
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.5), M.stone);
  bench.position.set(0, 0.85, -0.55);
  platform.add(bench);
  const lantern = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.3, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffd79a }),
  );
  lantern.position.set(0, CAB_H + 0.42, 0);
  platform.add(lantern);
  const lampPost = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), M.iron);
  lampPost.position.set(0, CAB_H + 0.18, 0);
  platform.add(lampPost);
  // петля под трос
  const cabinRing = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 14), M.iron);
  cabinRing.rotation.y = Math.PI / 2;
  cabinRing.position.set(0, CAB_H + 0.55, 0);
  platform.add(cabinRing);
  platform.position.set(COL_X + 1.3, 0.85, 0);
  g.add(platform);

  // --- ГРУЗ: дикая каменная глыба на цепях, без стен и навеса
  const counter = new THREE.Group();
  const block = new THREE.Mesh(new THREE.DodecahedronGeometry(0.78, 0), M.stoneDark);
  block.scale.set(1.15, 1.0, 1.0);
  block.rotation.set(0.18, 0.5, 0.12);
  block.castShadow = true;
  counter.add(block);
  // сколы-камни, чтобы силуэт был грубым
  for (const [x, y, z, r] of [[0.55, 0.3, 0.2, 0.26], [-0.5, -0.25, 0.3, 0.22], [0.15, -0.55, -0.4, 0.2]]) {
    const chip = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), M.stone);
    chip.position.set(x, y, z);
    chip.rotation.set(x, y, z);
    counter.add(chip);
  }
  // железный обруч-обвязка и рым под трос
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 8, 20), M.iron);
  hoop.rotation.x = Math.PI / 2;
  hoop.position.y = 0.15;
  counter.add(hoop);
  const hoop2 = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.055, 8, 20), M.iron);
  hoop2.rotation.y = Math.PI / 2;
  counter.add(hoop2);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.06, 8, 16), M.iron);
  shackle.position.y = 0.82;
  counter.add(shackle);
  // четыре цепи от рыма
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 5), M.iron);
    chain.position.set(Math.cos(a) * 0.3, 0.55, Math.sin(a) * 0.3);
    chain.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    counter.add(chain);
  }
  counter.position.set(-COL_X - 1.3, 0.85 + RANGE, 0);
  g.add(counter);

  // --- тросы: правый держит кабину, левый — груз (длину считает анимация)
  const mkRope = (x, role) => {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), M.iron);
    rope.position.set(x, 4, 0);
    rope.scale.y = 4;
    rope.userData.role = role;
    g.add(rope);
    return rope;
  };
  const ropes = [mkRope(COL_X + 1.3, 'cabin'), mkRope(-COL_X - 1.3, 'counter')];

  // --- пломба на передней грани башни: кабина и груз идут сбоку, знак не закрыт
  const med = makeMedallion(0.62, 'down', 'up');
  med.group.position.set(0, 3.1, 2.6);
  g.add(med.group);
  const plate = mountPlate(0.62);
  plate.position.set(0, 3.1, 2.5);
  g.add(plate);

  return {
    group: g,
    markOff: med.off,
    markOn: med.on,
    medallion: med.group,
    plate,
    rim: med.rim,
    platform,
    counter,
    colRight,
    colLeft,
    beam,
    arms,
    rollers,
    ropes,
    // не учитываются при расчёте габаритов основания
    moving: [platform, counter, colRight, colLeft, beam, ...arms, ...rollers, ...ropes],
    fallback,
    range: RANGE,
    lowY: 0.85,
    counterLow: 0.85,
    pulleyY: COL_H + 0.55,
    shot: { fov: 45, pad: 1.08, yaw: 16 },
  };
}
