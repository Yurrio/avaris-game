/* ============================================================================
   XR-7 · «Туманная котловина» — ограниченная круглая зона вместо планеты.
   Рельеф — аналитическое высотное поле h(x, z): по нему же строится сетка,
   поэтому физика и картинка совпадают. Без three.js — проверяется в node.
   ========================================================================== */

export const ZONE_R = 190;        // отсюда начинается туман
/* Мир продолжается и ЗА зоной — туман стоит на земле, а не вместо неё.
   В туман можно въехать на несколько метров, дальше — стена. */
export const WORLD_SIZE = 500;    // сторона квадрата под сетку земли
export const GRID_N = 150;        // ячеек на сторону сетки земли
export const GRID_CELL = WORLD_SIZE / GRID_N;
export const FOG_START = ZONE_R;         // лёгкая дымка
export const FOG_HARD = ZONE_R + 18;     // здесь ехать уже нельзя
export const WALL_LIMIT = FOG_HARD;      // старое имя (совместимость)
const GRID_HALF = WORLD_SIZE / 2;

/**
 * Контур зоны: 1 — базовая окружность, больше/меньше — выступы и заливы.
 * Один и тот же шум используют туман (`fogAt`), биомы (`biomeIdAt`),
 * стена в `world.js` и мини-карта в `main.js` — иначе край «плывёт».
 */
export function zoneBulge(a) {
  return 1
    + 0.075 * Math.sin(a * 3 + 0.7)
    + 0.045 * Math.sin(a * 5 - 1.9)
    + 0.030 * Math.sin(a * 8 + 3.1)
    + 0.022 * Math.sin(a * 13 + 5.4);
}

/** Радиус кромки зоны в точке (неровный, не окружность) */
export function zoneRadiusAt(x, z) {
  return ZONE_R * zoneBulge(Math.atan2(z, x));
}

/** Где уже нельзя ехать — стена тумана в этом направлении */
export function fogHardAt(x, z) {
  return FOG_HARD * zoneBulge(Math.atan2(z, x));
}

/** Насколько глубоко в тумане точка: 0 — чисто, 1 — стена */
export function fogAt(x, z) {
  const r = Math.hypot(x, z);
  const k = zoneBulge(Math.atan2(z, x));
  const start = FOG_START * k;
  const hard = FOG_HARD * k;
  return clamp((r - start) / (hard - start), 0, 1);
}

/* ---------------------------------------------------------------- генератор */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* -------------------------------------------------------------------- шум */
function hash2(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const c00 = hash2(xi, yi), c10 = hash2(xi + 1, yi);
  const c01 = hash2(xi, yi + 1), c11 = hash2(xi + 1, yi + 1);
  const a = c00 + (c10 - c00) * u;
  const b = c01 + (c11 - c01) * u;
  return (a + (b - a) * v) * 2 - 1;
}

export function fbm2(x, y, oct) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise2(x * freq + i * 7.3, y * freq - i * 3.1);
    norm += amp;
    amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

/* ------------------------------------------------------------- большая гора */
const MOUNT = { x: -18, z: 34, r: 128, h: 88, pow: 2.2 };

/* ------------------------------------- ручные шурфы (копать где угодно) */
export const HAND_DIGS = 10;        // сколько шурфов за экспедицию
export const HAND_DIG_COST = 34;    // % энергии за шурф
export const HAND_DIG_R = 6.2;      // радиус ямы
export const HAND_DIG_DEPTH = 1.9;  // глубина ямы

const _handDigs = [];

/** Список шурфов (для отрисовки и сохранения) */
export function handDigList() { return _handDigs; }

export function addHandDig(x, z) {
  const e = { x, z, r: HAND_DIG_R, depth: HAND_DIG_DEPTH, k: 0.0001 };
  _handDigs.push(e);
  return e;
}

/** Плавное углубление ямы (k 0..1) — земля как будто проседает */
export function setHandDigGrow(e, k) {
  if (e) e.k = clamp(k, 0, 1);
  return e;
}

/** Восстановить шурфы из сейва (k = 1, без анимации) */
export function restoreHandDigs(list) {
  _handDigs.length = 0;
  if (Array.isArray(list)) {
    for (const d of list) {
      if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
      _handDigs.push({ x: d.x, z: d.z, r: HAND_DIG_R, depth: HAND_DIG_DEPTH, k: 1 });
    }
  }
  return _handDigs.length;
}

export function clearHandDigs() { _handDigs.length = 0; }

/**
 * Насколько земля просела в точке от всех шурфов.
 * Положительное — вниз (чаша), отрицательное — вверх (валик выброшенного грунта).
 */
export function craterAt(x, z) {
  let d = 0;
  for (let i = 0; i < _handDigs.length; i++) {
    const e = _handDigs[i];
    if (e.k <= 0.002) continue;
    const dx = x - e.x, dz = z - e.z;
    const rim = e.r * 1.32;
    if (dx < -rim || dx > rim || dz < -rim || dz > rim) continue;
    const t = Math.hypot(dx, dz) / e.r;
    if (t <= 1) {
      const u = 1 - t;
      d += e.depth * e.k * u * u * (3 - 2 * u);       // чаша: глубина в центре
    } else {
      const u = (t - 1) / 0.32;                        // 0..1 к внешнему краю
      d -= 0.5 * e.k * (1 - u) * (1 - u);              // валик выброшенного грунта
    }
  }
  return d;
}

/** Глубина чаши (только вниз) — для цвета свежего грунта */
export function craterDepthAt(x, z) {
  const v = craterAt(x, z);
  return v > 0 ? v : 0;
}

/* ------------------------------------------------------------------ рельеф */
export function heightAt(x, z) {
  const base = mesaAt(x, z) + moundHeightAt(x, z);
  if (_handDigs.length === 0) return base;
  return base - craterAt(x, z);
}

function mesaAt(x, z) {
  const h = rawHeightAt(x, z);
  const d = Math.hypot(x - MOUNT.x, z - MOUNT.z);
  if (d > SUMMIT_R) return h;
  if (_level === null) _level = rawHeightAt(MOUNT.x, MOUNT.z) - SUMMIT_DROP;

  // вершина — пологая меса: верх срезаем, НО борта не поднимаем
  // (если наращивать склон, получается стена ~70°, на которую не заехать)
  const diff = SUMMIT_SOFT - Math.abs(h - _level);
  if (diff <= 0) return Math.min(h, _level);
  return Math.min(h, _level) - (diff * diff) / (4 * SUMMIT_SOFT);
}

/** Где стоит храм (вершина) */
export const SUMMIT = { x: MOUNT.x, z: MOUNT.z };

/** Высота плоской площадки на вершине (правильна после первого heightAt) */
export function summitLevel() {
  if (_level === null) _level = rawHeightAt(MOUNT.x, MOUNT.z) - SUMMIT_DROP;
  return _level;
}

/* --------------------------------------------------- курган над храмом */
export const TEMPLE = { x: MOUNT.x, z: MOUNT.z };
export const MOUND_R = 30;      // радиус насыпи вокруг храма
export const MOUND_H = 8.0;     // насколько насыпь выше площадки
export const MOUND_FLAT = 13;   // ровная верхушка: внутри торчат только колонны
export const DIG_MAX = 60;      // сколько нажатий пробела до полной раскопки

let _dig = 0;
let _digH = MOUND_H;

export const digProgress = () => _dig;
export const digDone = () => _dig >= 1;

/** Сдвинуть раскопки на долю (0..1) */
export function setDig(v) {
  _dig = clamp(v, 0, 1);
  // высота падает чуть быстрее к концу — курган «сползает» пластами
  _digH = MOUND_H * Math.pow(1 - _dig, 1.25);
  return _dig;
}

export function digOnce() { return setDig(_dig + 1 / DIG_MAX); }

/** Высота насыпи в точке */
export function moundHeightAt(x, z) {
  if (_digH <= 0.002) return 0;
  const d = Math.hypot(x - TEMPLE.x, z - TEMPLE.z);
  if (d > MOUND_R) return 0;
  return _digH * (1 - smoothstep(MOUND_FLAT, MOUND_R, d));
}

/** Насколько глубоко в кургане (0..1) — для цвета грунта и подсказок */
export function moundDepthAt(x, z) {
  if (MOUND_H <= 0) return 0;
  return clamp(moundHeightAt(x, z) / MOUND_H, 0, 1);
}

export function rawHeightAt(x, z) {
  // пологая основа: широкие всхолмления + мелкая рябь
  let h = 11
    + fbm2(x * 0.0075, z * 0.0075, 4) * 13
    + fbm2(x * 0.027 + 5.3, z * 0.027 - 3.1, 3) * 5.6
    + fbm2(x * 0.085 - 2.2, z * 0.085 + 7.4, 2) * 0.8;

  // холмы помельче
  h += fbm2(x * 0.048 + 9.1, z * 0.048 - 2.3, 3) * 2.6;

  // впадины: где шум высок, рельеф проседает чашей
  const pitN = fbm2(x * 0.021 - 11.3, z * 0.021 + 4.7, 3);
  h -= smoothstep(0.34, 0.92, pitN) * 6.8;

  // одна большая гора: купол + радиальные отроги
  const dx = x - MOUNT.x, dz = z - MOUNT.z;
  const d = Math.hypot(dx, dz);
  const k = Math.max(0, 1 - d / MOUNT.r);
  if (k > 0) {
    const body = Math.pow(k, MOUNT.pow) * MOUNT.h;
    const ang = Math.atan2(dz, dx);
    const spur = 0.55 + 0.45 * Math.sin(ang * 5 + 1.7);
    const ridged = (1 - Math.abs(fbm2(x * 0.011 + 4, z * 0.011 - 9, 3))) * 20;
    h += body + ridged * Math.pow(k, 1.4) * spur;
  }

  return h;
}
const SUMMIT_R = 52;      // радиус зоны среза
const SUMMIT_DROP = 29;   // насколько срезаем макушку (меса под храм)
const SUMMIT_SOFT = 9;    // ширина мягкого перехода
let _level = null;

export function gradientAt(x, z, eps = 1.4) {
  const gx = (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps);
  const gz = (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps);
  return { gx, gz, slope: Math.hypot(gx, gz) };
}

/* ------------------------------------------------- поверхность сетки земли */
/* Физика и расстановка объектов идут по ТОЙ ЖЕ триангуляции, что и картинка:
   две плоскости на ячейку. Иначе всё висит в воздухе на крутых склонах. */
let _nodes = null;

function nodeH(ix, iz) {
  if (!_nodes) {
    const N = GRID_N + 1;
    _nodes = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        _nodes[j * N + i] = heightAt(-GRID_HALF + i * GRID_CELL, -GRID_HALF + j * GRID_CELL);
      }
    }
  }
  return _nodes[iz * (GRID_N + 1) + ix];
}

/** Пересчитать узлы сетки в районе (x, z) — после раскопок */
export function refreshNodes(x, z, r) {
  const N = GRID_N + 1;
  const c = GRID_CELL;
  const i0 = Math.max(0, Math.floor((x - r + GRID_HALF) / c));
  const i1 = Math.min(N - 1, Math.ceil((x + r + GRID_HALF) / c));
  const j0 = Math.max(0, Math.floor((z - r + GRID_HALF) / c));
  const j1 = Math.min(N - 1, Math.ceil((z + r + GRID_HALF) / c));
  if (_nodes) {
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        _nodes[j * N + i] = heightAt(-GRID_HALF + i * c, -GRID_HALF + j * c);
      }
    }
  }
  return { i0, i1, j0, j1 };
}

const _plane = { h: 0, gx: 0, gz: 0 };

/** Высота и градиент видимой грани в точке (x, z) */
export function meshPlaneAt(x, z) {
  const c = GRID_CELL;
  let fx = (x + GRID_HALF) / c;
  let fz = (z + GRID_HALF) / c;
  fx = fx < 0 ? 0 : fx > GRID_N - 1e-5 ? GRID_N - 1e-5 : fx;
  fz = fz < 0 ? 0 : fz > GRID_N - 1e-5 ? GRID_N - 1e-5 : fz;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const u = fx - ix, v = fz - iz;

  const h00 = nodeH(ix, iz);
  const h10 = nodeH(ix + 1, iz);
  const h01 = nodeH(ix, iz + 1);
  const h11 = nodeH(ix + 1, iz + 1);

  if (u + v <= 1) {
    _plane.h = h00 + (h10 - h00) * u + (h01 - h00) * v;
    _plane.gx = (h10 - h00) / c;
    _plane.gz = (h01 - h00) / c;
  } else {
    _plane.h = h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
    _plane.gx = (h11 - h01) / c;
    _plane.gz = (h11 - h10) / c;
  }
  return _plane;
}

export function meshHeightAt(x, z) {
  return meshPlaneAt(x, z).h;
}

/** Нормаль видимой грани */
export function meshNormalAt(x, z, out) {
  const p = meshPlaneAt(x, z);
  const l = Math.hypot(p.gx, 1, p.gz);
  return out.set(-p.gx / l, 1 / l, -p.gz / l);
}

export function slopeAt(x, z) {
  return gradientAt(x, z).slope;
}

/** Единичная нормаль поверхности в точке (x, z) */
export function normalAt(x, z, out) {
  const g = gradientAt(x, z);
  const l = Math.hypot(g.gx, 1, g.gz);
  return out.set(-g.gx / l, 1 / l, -g.gz / l);
}

/* ------------------------------------------------------------------ биомы */
/* Одна пустынная планета: песок — основа, камень — гребни и гора,
   оазис — низины с влагой, снег — только на самой вершине.
   Палитры с референсов из ~/Desktop/Игры. */
export const BIOMES = {
  edge:  { name: 'ТУМАННАЯ КРОМКА', color: 0x8f9aa6, rock: 0x5d646c, accent: 0xa9c4d6 },
  sand:  { name: 'ПЕСКИ',           color: 0xefd081, rock: 0x514940, accent: 0x5fd8e0 },
  stone: { name: 'КАМЕННЫЕ ГРЯДЫ',  color: 0xa89a88, rock: 0x5a5148, accent: 0x8fc9e8 },
  oasis: { name: 'ОАЗИС',           color: 0x6f7c43, rock: 0x3b3a2c, accent: 0x8de06a },
  snow:  { name: 'СНЕЖНАЯ ВЕРШИНА', color: 0xe9f4fd, rock: 0x8ba3b8, accent: 0xcfe8ff },
};

function mixHex(a, b, t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
  const g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
  const bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
  return (r << 16) | (g << 8) | bl;
}

export function biomeIdAt(x, z, h = heightAt(x, z)) {
  const r = Math.hypot(x, z);
  // кромка тумана не круглая — тот же контур, что и в fogAt()
  if (r > ZONE_R * 0.88 * zoneBulge(Math.atan2(z, x))) return 'edge';

  // снег только на самой вершине
  if (h > 60) return 'snow';

  // камень: склоны большой горы и крупные скальные выходы
  const dMount = Math.hypot(x - MOUNT.x, z - MOUNT.z);
  if (dMount < MOUNT.r * 0.54) return 'stone';
  const rocky = fbm2(x * 0.0125 - 71, z * 0.0125 + 37, 3);
  if (rocky > 0.52) return 'stone';

  // оазис — низины, куда «стекается влага» (крупные пятна по шуму)
  const wet = fbm2(x * 0.0085 + 51, z * 0.0085 - 23, 3);
  if (h < 14 && wet > 0.10) return 'oasis';

  return 'sand';
}

export function biomeAt(x, z) {
  const h = heightAt(x, z);
  const id = biomeIdAt(x, z, h);
  const m = fbm2(x * 0.02 + 31, z * 0.02 - 17, 3);

  let c = BIOMES[id].color;
  switch (id) {
    case 'sand':
      c = mixHex(c, 0xc9a86a, Math.max(0, -m) * 0.5);
      c = mixHex(c, 0xfbe79b, Math.max(0, m) * 0.4);
      break;
    case 'stone':
      c = mixHex(c, 0x8a7d6d, Math.max(0, m) * 0.35);
      c = mixHex(c, 0x6d6459, Math.max(0, -m) * 0.4);
      c = mixHex(c, 0xd8cdbb, Math.max(0, h - 40) / 45);
      break;
    case 'oasis':
      c = mixHex(c, 0x8f9a52, Math.max(0, m) * 0.4);
      c = mixHex(c, 0x4d5b2f, Math.max(0, -m) * 0.35);
      break;
    case 'snow':
      c = mixHex(c, 0xb9d2e4, Math.max(0, 70 - h) / 40);
      break;
    case 'edge':
      c = mixHex(c, 0x7f8b98,
        Math.max(0, Math.hypot(x, z) - ZONE_R * 0.88 * zoneBulge(Math.atan2(z, x))) / 40);
      break;
    default: break;
  }
  return { id, name: BIOMES[id].name, color: c, elevation: h,
           rock: BIOMES[id].rock, accent: BIOMES[id].accent };
}

/* ------------------------------------------------------------- планировка */
export function randomPoint(rnd, maxR) {
  const a = rnd() * Math.PI * 2;
  const r = Math.sqrt(rnd()) * maxR;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pickSites(rnd, count, opts = {}) {
  const {
    minDist = 60, maxR = ZONE_R - 30, minH = -1e9, maxH = 1e9,
    maxSlope = 0.4, filter = null, tries = 80000,
  } = opts;
  const out = [];
  for (let i = 0; i < tries && out.length < count; i++) {
    const p = randomPoint(rnd, maxR);
    // курган над храмом и его окрестности оставляем пустыми
    if (Math.hypot(p[0] - TEMPLE.x, p[1] - TEMPLE.z) < MOUND_R + 12) continue;
    const h = heightAt(p[0], p[1]);
    if (h < minH || h > maxH) continue;
    if (maxSlope < 50 && slopeAt(p[0], p[1]) > maxSlope) continue;
    let ok = true;
    for (const o of out) if (dist2(p, o.p) < minDist) { ok = false; break; }
    if (!ok) continue;
    if (filter && !filter(p, h)) continue;
    out.push({ p, h, biome: biomeIdAt(p[0], p[1], h) });
  }
  return out;
}

export function planWorld(seed = 20261107) {
  const rnd = mulberry32(seed);

  /* ахолы: по одному в разные биомы, не ближе 66 друг от друга */
  const used = new Map();
  const beacons = pickSites(rnd, 6, {
    minDist: 62, maxR: ZONE_R - 30, maxSlope: 0.38,
    filter: (p, h) => {
      const id = biomeIdAt(p[0], p[1], h);
      if (id === 'edge') return false;
      const c = used.get(id) || 0;
      if (c >= 2) return false;
      used.set(id, c + 1);
      return true;
    },
  });

  /* осколки: по два у маяка + россыпь */
  const shards = [];
  for (const b of beacons) {
    for (let k = 0; k < 2; k++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const a = rnd() * Math.PI * 2;
        const rr = 16 + rnd() * 22;
        const p = [b.p[0] + Math.cos(a) * rr, b.p[1] + Math.sin(a) * rr];
        if (Math.hypot(p[0], p[1]) > ZONE_R - 20) continue;
        if (slopeAt(p[0], p[1]) > 0.5) continue;
        shards.push({ p, cluster: beacons.indexOf(b) });
        break;
      }
    }
  }
  for (const s of pickSites(rnd, 10, { minDist: 34, maxR: ZONE_R - 26, maxSlope: 0.42 })) {
    shards.push({ p: s.p, cluster: -1 });
  }

  /* --- плита с письменами (сюжетный центр) --- */
  let tabletSites = pickSites(rnd, 1, {
    maxR: ZONE_R - 70, maxSlope: 0.13, minH: 9, maxH: 26,
    filter: (p) => beacons.every((b) => dist2(p, b.p) > 78),
  });
  if (!tabletSites.length) {
    tabletSites = pickSites(rnd, 1, { maxR: ZONE_R - 60, maxSlope: 0.3 });
  }
  const tablet = tabletSites[0] ||
    { p: [46, -58], h: heightAt(46, -58), biome: biomeIdAt(46, -58) };

  /* три древности вокруг плиты: не вплотную к ней, а разнесённые на 36–62 м
     по своим сторонам света (раньше стояли в 16 м и лепились друг к другу) */
  const ART_MIN = 46, ART_MAX = 74, ART_GAP = 52;
  const words = [];
  const baseAng = rnd() * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const want = baseAng + i * (Math.PI * 2 / 3);
    let best = null, bestScore = 1e9;
    for (let a = 0; a < Math.PI * 2; a += 0.08) {
      for (let rr = ART_MIN; rr <= ART_MAX; rr += 2) {
        const p = [tablet.p[0] + Math.cos(a) * rr, tablet.p[1] + Math.sin(a) * rr];
        if (Math.hypot(p[0], p[1]) > ZONE_R - 30) continue;
        if (words.some((w) => dist2(p, w.p) < ART_GAP)) continue;
        if (beacons.some((b) => dist2(p, b.p) < 42)) continue;
        const sl = slopeAt(p[0], p[1]);
        if (sl > 0.34) continue;
        const angErr = Math.abs(Math.atan2(Math.sin(a - want), Math.cos(a - want)));
        // ровно, в свою сторону света и подальше от соседей
        const score = sl * 12 + angErr * 1.4 + rr * 0.10;
        if (score < bestScore) { bestScore = score; best = p; }
      }
    }
    if (!best) {
      const a = baseAng + i * (Math.PI * 2 / 3);
      best = [tablet.p[0] + Math.cos(a) * 58, tablet.p[1] + Math.sin(a) * 58];
    }
    words.push({ p: best, h: heightAt(best[0], best[1]), biome: biomeIdAt(best[0], best[1]) });
  }

  /** Держит точку подальше от плиты и всех трёх древностей сразу */
  const awayFromNet = (p, r) =>
    dist2(p, tablet.p) > r && words.every((w) => dist2(p, w.p) > r);

  /* Архив — в стороне от сюжетного узла */
  let vaultSites = pickSites(rnd, 1, {
    maxR: ZONE_R - 46, maxSlope: 0.16, minH: 8, maxH: 34,
    filter: (p) => beacons.every((b) => dist2(p, b.p) > 95) && awayFromNet(p, 85),
  });
  if (!vaultSites.length) {
    vaultSites = pickSites(rnd, 1, {
      maxR: ZONE_R - 40, maxSlope: 0.26,
      filter: (p) => beacons.every((b) => dist2(p, b.p) > 70) && awayFromNet(p, 60),
    });
  }
  const vault = vaultSites[0] ||
    { p: [0, -120], h: heightAt(0, -120), biome: biomeIdAt(0, -120) };

  /* аномалии висят в воздухе — реже и не над сюжетными точками */
  const anomalies = pickSites(rnd, 7, {
    minDist: 62, maxR: ZONE_R - 20, maxSlope: 50,
    filter: (p) => awayFromNet(p, 55)
      && beacons.every((b) => dist2(p, b.p) > 42)
      && dist2(p, vault.p) > 45,
  });

  /* руины — ровные места, подальше от всего сюжетного */
  const ruins = pickSites(rnd, 10, {
    minDist: 46, maxR: ZONE_R - 34, maxSlope: 0.26,
    filter: (p) => dist2(p, tablet.p) > 46
      && words.every((w) => dist2(p, w.p) > 32)
      && beacons.every((b) => dist2(p, b.p) > 42)
      && anomalies.every((a) => dist2(p, a.p) > 36)
      && dist2(p, vault.p) > 42,
  });

  return { beacons, shards, anomalies, ruins, vault, tablet, words, seed };
}
