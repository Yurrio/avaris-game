import {buildLander} from './lander.js';
/* ============================================================================
   XR-7 · «Туманная котловина» — сборка мира.
   Ровный (но неровный по рельефу) участок с одной большой горой,
   по краю — стена непроходимого тумана.
   ========================================================================== */
import * as THREE from 'three';
import {
  ZONE_R, WORLD_SIZE, GRID_N, GRID_CELL, LANDING_SITE, onAscent, groundNodeHeight, setArchivePad, meshHeightAt, meshNormalAt,
  meshPlaneAt, biomeAt, biomeIdAt, slopeAt, SUMMIT, summitLevel,
  FOG_START, FOG_HARD, fogAt, TEMPLE, MOUND_R, MOUND_H, MOUND_FLAT,
  moundHeightAt, moundDepthAt, digProgress, refreshNodes, craterDepthAt,
  planWorld, mulberry32, BIOMES, clamp, smoothstep, zoneBulge, zoneRadiusAt,
} from './terrain.js';

import { ENV_MODELS, COOL_CRYSTAL_MODEL, TOXIC_CRYSTAL_MODEL, pickPlantModel,
  loadPropModels, makePropInstances } from './prop-models.js';
import { cityObstacles, buildCity, buildSummitShrine } from './world-kit.js';
import { TANGUT, glyphOf, canvasFont } from './tangut.js';
import { buildGate as buildMechGate, buildBeacon as buildMechBeacon,
  buildLift as buildMechLift, setKitBase, placeLiftTrack } from './mech.js';
import { SCROLLS, scrollSites } from './story.js';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';

/** папка с моделями мира */
const KIT_DIR = 'assets/world-kit/';


const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/* ------------------------------------------------------ реквизит биомов */
const PROP_CFG = {
  edge:  { rock: 0.20, crystal: 0.04, plant: 0.00 },
  sand:  { rock: 0.26, crystal: 0.05, plant: 0.00 },
  stone: { rock: 0.34, crystal: 0.06, plant: 0.00 },
  oasis: { rock: 0.14, crystal: 0.03, plant: 0.60 },
  snow:  { rock: 0.24, crystal: 0.05, plant: 0.00 },
};
const TOXIC_BIOMES = new Set(['oasis']);
const SPORE_OFFSET = new THREE.Matrix4().makeTranslation(0, 1.24, 0);

/* ---------------------------------------------------------------- мелочи */
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.15)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}

function glowSprite(color, size, opacity = 0.8) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  spr.scale.setScalar(size);
  return spr;
}

/** Ставит объект на землю: позиция по (x,z) — по ВИДИМОЙ грани, верх — её нормаль */
function placeOnGround(obj, x, z, sink = 0) {
  obj.position.set(x, meshHeightAt(x, z) - sink, z);
  meshNormalAt(x, z, _n);
  obj.quaternion.setFromUnitVectors(UP, _n);
  return obj;
}

/* ================================================================== ЗЕМЛЯ */
const SOIL = new THREE.Color(0x6a5540);
const _cTmp = new THREE.Color();
const _baseTmp = new THREE.Color();

/** Цвет грунта: биом, а внутри кургана — земля со слоями */
function groundColorInto(c, x, z, h, f) {
  const bi = biomeAt(x, z);
  _baseTmp.setHex(bi.color);
  const j = (Math.sin(f * 12.9898) * 43758.5453) % 1;
  c.copy(_baseTmp).offsetHSL(0, 0, (j - 0.5) * 0.06);

  const depth = moundDepthAt(x, z);
  if (depth > 0.02) {
    const strata = 0.5 + 0.5 * Math.sin((h - summitLevel()) * 1.9);
    c.lerp(SOIL, Math.min(0.85, 0.35 + depth * 0.6));
    c.multiplyScalar(0.86 + strata * 0.22);
  }
  const track=onAscent(x,z,5);
  if(track) {
    const shoulder=.65*Math.sin(x*.21+z*.09);
    c.lerp(SOIL,(1-smoothstep(1.4,5.5,track.distance+shoulder))*.20);
  }
  // свежий грунт в ручном шурфе виден издалека
  const pit = craterDepthAt(x, z);
  if (pit > 0.05) {
    const strata = 0.5 + 0.5 * Math.sin(h * 3.1 + x * 0.7);
    c.lerp(SOIL, Math.min(0.9, 0.4 + pit * 0.45));
    c.multiplyScalar(0.8 + strata * 0.24);
  }
  return c;
}

/** Насколько зернистый грунт в этом биоме (0 — гладко, 1 — песок) */
function groundGrainFor(id) {
  switch (id) {
    case 'sand': return 1.0;
    case 'edge': return 0.85;
    case 'stone': return 0.55;
    case 'oasis': return 0.35;
    case 'snow': return 0.12;
    default: return 0.5;
  }
}

/** Записывает одну ячейку земли (6 вершин = 18 float) со смещением o */
function groundCell(ix, iz, pos, nor, col, o, grain) {
  const cell = GRID_CELL;
  const half = WORLD_SIZE / 2;
  const x0 = -half + ix * cell, z0 = -half + iz * cell;
  const x1 = x0 + cell, z1 = z0 + cell;

  const h00 = groundNodeHeight(x0, z0);
  const h10 = groundNodeHeight(x1, z0);
  const h01 = groundNodeHeight(x0, z1);
  const h11 = groundNodeHeight(x1, z1);

  const f = iz * GRID_N + ix;
  const c = _cTmp;
  groundColorInto(c, x0 + cell * 0.5, z0 + cell * 0.5, (h00 + h11) * 0.5, f);
  const gr = grain ? groundGrainFor(biomeAt(x0 + cell * 0.5, z0 + cell * 0.5).id) : 0;

  const put = (x, y, z, nx, ny, nz, at) => {
    pos[at] = x; pos[at + 1] = y; pos[at + 2] = z;
    nor[at] = nx; nor[at + 1] = ny; nor[at + 2] = nz;
    col[at] = c.r; col[at + 1] = c.g; col[at + 2] = c.b;
    if (grain) grain[at / 3] = gr;
  };

  // грань A: (x0,z0) → (x0,z1) → (x1,z0), нормаль вверх
  let ax = -(h10 - h00) / cell, az = -(h01 - h00) / cell;
  let al = Math.hypot(ax, 1, az);
  let nx = ax / al, ny = 1 / al, nz = az / al;
  put(x0, h00, z0, nx, ny, nz, o);
  put(x0, h01, z1, nx, ny, nz, o + 3);
  put(x1, h10, z0, nx, ny, nz, o + 6);

  // грань B: (x1,z0) → (x0,z1) → (x1,z1)
  ax = -(h11 - h01) / cell; az = -(h11 - h10) / cell;
  al = Math.hypot(ax, 1, az);
  nx = ax / al; ny = 1 / al; nz = az / al;
  put(x1, h10, z0, nx, ny, nz, o + 9);
  put(x0, h01, z1, nx, ny, nz, o + 12);
  put(x1, h11, z1, nx, ny, nz, o + 15);
}

function buildGround() {
  const t0 = performance.now();
  const N = GRID_N;
  const faces = N * N * 2;
  const pos = new Float32Array(faces * 9);
  const nor = new Float32Array(faces * 9);
  const col = new Float32Array(faces * 9);
  const grain = new Float32Array(faces * 3);

  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      groundCell(ix, iz, pos, nor, col, (iz * N + ix) * 18, grain);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aGrain', new THREE.BufferAttribute(grain, 1));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.94, metalness: 0.02,
  });
  // Зерно песка — не полноэкранное, а по поверхности: две частоты шума от
  // мировых координат, сила берётся из атрибута (песок 1, снег 0.12),
  // и затухает к 40 м — иначе вдали шум мерцает пикселями.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrainAmt = { value: 1 };
    mat.userData.shader = shader;   // чтобы можно было подкрутить силу зерна из отладки
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aGrain;
        varying float vGrain;
        varying vec3 vWPos;
        varying float vDist;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGrain = aGrain;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vDist = -(modelViewMatrix * vec4(position, 1.0)).z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vGrain;
        varying vec3 vWPos;
        varying float vDist;
        uniform float uGrainAmt;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gGrain(vec2 p) {
          return (gHash(floor(p * 7.0)) - 0.5) * 0.62
               + (gHash(floor(p * 23.0)) - 0.5) * 0.38;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float gAmt = vGrain * uGrainAmt * smoothstep(42.0, 9.0, vDist);
        float gN = gGrain(vWPos.xz) * gAmt;
        diffuseColor.rgb *= 1.0 + gN * 0.55;
        diffuseColor.rgb += vec3(gN * 0.045);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + gN * 0.5, 0.4, 1.0);`);
  };

  const mesh = new THREE.Mesh(geo, mat);
  console.log(`[XR-7] земля: ${N * N * 2} граней за ${(performance.now() - t0).toFixed(0)} мс`);
  return mesh;
}

/* ==================================================================== НЕБО */
function buildSky() {
  const geo = new THREE.SphereGeometry(2200, 32, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(0x060a12) },
      uMid: { value: new THREE.Color(0x16293c) },
      uHorizon: { value: new THREE.Color(0x7d95a8) },
      uSun: { value: new THREE.Vector3(0.45, 0.30, 0.84).normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uMid, uHorizon, uSun;
      varying vec3 vDir;
      void main() {
        float y = clamp(vDir.y, -1.0, 1.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.28, y));
        col = mix(col, uTop, smoothstep(0.22, 0.85, y));
        // мягкое свечение у горизонта со стороны солнца
        float sunAmt = max(0.0, dot(normalize(vDir), uSun));
        float glow = pow(sunAmt, 6.0) * smoothstep(-0.05, 0.35, y);
        col += vec3(0.45, 0.34, 0.22) * glow * 0.9;
        // дымка прямо над землёй
        col = mix(col, uHorizon, smoothstep(0.08, -0.06, y));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  return new THREE.Mesh(geo, mat);
}

function buildStars(rnd) {
  const count = 1800;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const y = 0.04 + rnd() * 0.96;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(1900);
    pos[i * 3] = d.x; pos[i * 3 + 1] = d.y; pos[i * 3 + 2] = d.z;
    c.setHSL(0.52 + rnd() * 0.14, 0.3, 0.7 + rnd() * 0.3);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({
    vertexColors: true, size: 2.2, sizeAttenuation: false,
    transparent: true, opacity: 0.85, fog: false, depthWrite: false,
  }));
}

/* ==================================================== СТЕНА ТУМАНА ПО КРАЮ */
// All six cloud shells sample the same seamless, alpha-painted dust belt.
const stormDust=new THREE.TextureLoader().load(new URL('../assets/world-kit/storm-dust.png',import.meta.url).href);
stormDust.colorSpace=THREE.SRGBColorSpace;
stormDust.wrapS=THREE.RepeatWrapping;

function fogWallLayer(radius, height, opacity, speed, seed) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true);
  // Контур не круглый: тянем кольцо по тому же закону, что и граница зоны
  // (для кольца бури radius = 1 — форма остаётся при любом масштабе).
  const pa = geo.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), z = pa.getZ(i);
    if (Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6) continue;
    const k = zoneBulge(Math.atan2(z, x));
    pa.setX(i, x * k);
    pa.setZ(i, z * k);
  }
  pa.needsUpdate = true;
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uDust: {value:stormDust},
      uColor: { value: new THREE.Color(0xb4c8d6) },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uSpeed: { value: speed },
      uSeed: { value: seed },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uDust;
      uniform vec3 uColor;
      uniform float uTime, uOpacity, uSpeed, uSeed;
      varying vec2 vUv;
      void main() {
        // у земли плотнее, кверху растворяется
        float a = pow(clamp(1.0 - vUv.y * 1.12, 0.0, 1.0), 1.7) * uOpacity;
        float scroll=uTime*.009*uSpeed;
        vec4 dust=texture2D(uDust,vec2(vUv.x*5.0+scroll+uSeed, .32+vUv.y*.78));
        float billow=smoothstep(.08,.72,dust.a);
        vec3 shade=mix(uColor*.52,dust.rgb*.67+uColor*.65,billow);
        a *= .42+.64*billow;
        gl_FragColor=vec4(shade, clamp(a,0.0,.97));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height * 0.5 - 24;
  return { mesh, mat };
}

function buildFogWall(rnd) {
  const grp = new THREE.Group();
  // стена стоит ДАЛЬШЕ границы езды: в туман можно въехать и вернуться
  // ближний слой — редкий, дальние — плотнее, чтобы читалась глубина
  const layers = [
    fogWallLayer(FOG_HARD + 6, 230, 0.50, 1.0, 0.0),
    fogWallLayer(FOG_HARD + 18, 300, 0.82, 1.7, 2.1),
    fogWallLayer(FOG_HARD + 34, 380, 1.00, 2.4, 4.7),
  ];
  for (const l of layers) grp.add(l.mesh);

  // клубы тумана — от кромки зоны и до самой стены
  const band = FOG_HARD + 30 - FOG_START + 14;
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2;
    const k = zoneBulge(a);
    const r = (FOG_START - 14 + rnd() * band) * k;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // чем дальше от центра — тем плотнее
    const deep = clamp((r - FOG_START + 14) / (FOG_HARD + 30 - FOG_START + 14), 0, 1);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xd2e0ea, transparent: true,
      opacity: 0.07 + deep * 0.5 * (0.45 + rnd() * 0.55), depthWrite: false,
      blending: THREE.NormalBlending, fog: false,
    }));
    s.position.set(x, meshHeightAt(x, z) + 2 + rnd() * 14, z);
    const sc = (26 + rnd() * 44) * (0.75 + deep * 1.1);
    s.scale.set(sc, sc * 0.6, 1);
    s.userData = { phase: rnd() * 6.28, drift: 0.1 + rnd() * 0.25, base: s.position.clone(), op: s.material.opacity };
    grp.add(s);
  }

  return { group: grp, layers: layers.map((l) => l.mat) };
}

/* ------------------------ стена бури, которая сжимается к центру карты */
function buildStormRing() {
  const grp = new THREE.Group();
  const conf = [
    { h: 240, op: 0.70, sp: 1.4, seed: 0.0 },
    { h: 350, op: 0.92, sp: 2.1, seed: 2.1 },
    { h: 470, op: 1.00, sp: 2.9, seed: 4.7 },
  ];
  const layers = conf.map((c) => fogWallLayer(1, c.h, c.op, c.sp, c.seed));
  for (const l of layers) {
    l.mat.uniforms.uColor.value.setHex(0xe9f0f4);  // стена гибели почти белая
    l.mat.side = THREE.DoubleSide;                  // видна и изнутри, и снаружи
    grp.add(l.mesh);
  }
  grp.visible = false;
  return {
    group: grp,
    layers: layers.map((l) => l.mat),
    meshes: layers.map((l) => l.mesh),
    base: conf.map((c) => c.op),
  };
}

/* --------------------------------------------------------- дымка и пыль */
function buildHaze(rnd) {
  const grp = new THREE.Group();
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 60 + rnd() * (ZONE_R + 40);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xb9cdd9, transparent: true,
      opacity: 0.03 + rnd() * 0.05, depthWrite: false,
      blending: THREE.NormalBlending, fog: false,
    }));
    s.position.set(x, meshHeightAt(x, z) + 3 + rnd() * 16, z);
    const sc = 45 + rnd() * 95;
    s.scale.set(sc, sc * 0.5, 1);
    s.userData = {
      phase: rnd() * 6.28, speed: 0.04 + rnd() * 0.12,
      base: s.position.clone(), op: s.material.opacity,
    };
    grp.add(s);
  }
  return grp;
}

/** Яркость пыли в воздухе: днём MOTE_DAY, ночью — доля MOTE_NIGHT от неё */
const MOTE_DAY = 0.4;
const MOTE_NIGHT = 0.12;
/** Базисная яркость гало голубых кристаллов (жёлтый осколок — 0.55) */
const CGLOW_BASE = 0.2;

function buildMotes(rnd) {
  const count = 700;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * ZONE_R;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    pos[i * 3] = x;
    pos[i * 3 + 1] = meshHeightAt(x, z) + 1 + rnd() * 22;
    pos[i * 3 + 2] = z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // аддитивное смешивание: в темноте эти точки светятся сами по себе,
  // поэтому ночью их гасит setMotes() из applyDaylight, но не до нуля —
  // остаётся еле заметное гало
  return new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xbfe0f2, size: 0.62, transparent: true, opacity: 0.4,
    map: glowTexture(),            // мягкое круглое гало вместо квадратной точки
    alphaTest: 0.01,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
}

/* ------------------------------------------------------- инопланетные деревья */
/** Склеивает несколько геометрий с разными цветами в одну (position + normal + color) */
function mergeParts(parts) {
  let total = 0;
  const prepared = parts.map((p) => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    if (p.m) g.applyMatrix4(p.m);
    if (!g.attributes.normal) g.computeVertexNormals();
    total += g.attributes.position.count;
    return { g, color: p.color };
  });

  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const c = new THREE.Color();
  let o = 0;
  for (const { g, color } of prepared) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    pos.set(p, o);
    nor.set(n, o);
    c.setHex(color);
    for (let i = 0; i < p.length / 3; i++) {
      col[o + i * 3] = c.r;
      col[o + i * 3 + 1] = c.g;
      col[o + i * 3 + 2] = c.b;
    }
    o += p.length;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Одно дерево в нормализованных единицах: высота ~1.2, основание на y=0 */
function alienTreeGeometry() {
  const T = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Matrix4();
    m.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz)
    );
    return m;
  };
  const bark = 0x30383a;      // угольная кора — как у моделей набора
  const fleshA = 0x9c9b86;    // бледные рёбра (pale fossil ribs)
  const fleshB = 0x696651;    // сухая охра мембран (dry ochre membranes)

  return mergeParts([
    // коряжистый ствол из двух изломанных сегментов
    { g: new THREE.CylinderGeometry(0.055, 0.13, 0.52, 5), m: T(0, 0.26, 0, 0, 0, 0.10), color: bark },
    { g: new THREE.CylinderGeometry(0.045, 0.07, 0.38, 5), m: T(0.06, 0.62, 0, 0, 0, -0.30), color: bark },
    // крона: три неровных сгустка
    { g: new THREE.IcosahedronGeometry(0.30, 0), m: T(0.04, 0.95, 0, 0.2, 0.6, 0, 1.3, 0.8, 1.3), color: fleshA },
    { g: new THREE.IcosahedronGeometry(0.21, 0), m: T(0.33, 1.09, 0.07, 0.4, 0, 0.3), color: fleshB },
    { g: new THREE.IcosahedronGeometry(0.18, 0), m: T(-0.27, 1.02, -0.06, 0, 0.3, -0.4), color: fleshB },
    // свисающие щупальца
    { g: new THREE.ConeGeometry(0.065, 0.34, 4), m: T(0.36, 0.80, 0.13, 0.2, 0, 2.7), color: fleshA },
    { g: new THREE.ConeGeometry(0.055, 0.30, 4), m: T(-0.31, 0.76, -0.10, -0.2, 0, -2.6), color: fleshA },
  ]);
}

/* ================================================================= РУИНЫ */
function buildRuinSite(rnd) {
  const g = new THREE.Group();
  const matOf = () => new THREE.MeshStandardMaterial({
    color: [0x6d6a63, 0x5e5a54, 0x7d7a71, 0x6a5f54][(rnd() * 4) | 0],
    flatShading: true, roughness: 0.95, metalness: 0.05,
  });

  const platR = 5.5 + rnd() * 3;
  const platH = 1.1 + rnd() * 0.9;
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(platR, platR + 1.2, platH, 6), matOf());
  plat.position.y = platH / 2 - 0.55;
  g.add(plat);

  if (rnd() > 0.45) {
    const step = new THREE.Mesh(new THREE.CylinderGeometry(platR + 2.2, platR + 2.6, 0.5, 6), matOf());
    step.position.y = -0.35;
    g.add(step);
  }

  const pillars = 3 + ((rnd() * 4) | 0);
  for (let i = 0; i < pillars; i++) {
    const ang = (i / pillars) * Math.PI * 2 + rnd() * 0.7;
    const rad = platR * 0.62;
    const h = 2.5 + rnd() * 8;
    const w = 0.8 + rnd() * 0.7;
    const broken = rnd() > 0.55;
    const pil = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), matOf());
    pil.position.set(Math.cos(ang) * rad, h / 2, Math.sin(ang) * rad);
    pil.rotation.set(
      (rnd() - 0.5) * (broken ? 0.55 : 0.1),
      rnd() * 3.14,
      (rnd() - 0.5) * (broken ? 0.55 : 0.1)
    );
    g.add(pil);

    if (rnd() > 0.55) {
      const rune = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.35, 0.14, w * 0.35),
        new THREE.MeshStandardMaterial({
          color: rnd() > 0.5 ? 0x3ad4ff : 0xffa040,
          emissive: rnd() > 0.5 ? 0x3ad4ff : 0xffa040,
          emissiveIntensity: 1.6, flatShading: true,
        })
      );
      rune.position.copy(pil.position).add(new THREE.Vector3(0, h * 0.25, 0));
      rune.rotation.copy(pil.rotation);
      g.add(rune);
    }
  }

  if (rnd() > 0.5) {
    const h = 5 + rnd() * 8;
    const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.9, h, 4), matOf());
    ob.position.set((rnd() - 0.5) * 5, h / 2, (rnd() - 0.5) * 5);
    ob.rotation.z = (rnd() - 0.5) * 0.35;
    g.add(ob);
  }

  const rubble = 2 + ((rnd() * 5) | 0);
  for (let i = 0; i < rubble; i++) {
    const s = 0.6 + rnd() * 1.5;
    const blk = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s), matOf());
    const ang = rnd() * 6.28, rr = platR * 0.7 + rnd() * 4;
    blk.position.set(Math.cos(ang) * rr, s * 0.3, Math.sin(ang) * rr);
    blk.rotation.set(rnd() * 0.4, rnd() * 3, rnd() * 0.4);
    g.add(blk);
  }

  return { group: g, radius: platR + 1.6 };
}

/* ================================================================== ХРАМ */
/**
 * Круглые руины храма на вершине горы.
 * Верх площадки почти вровень с землёй — иначе ровер «утопает» в камне
 * (высота ровера берётся с сетки рельефа, а не с построек).
 */
function buildTemple(rnd) {
  const g = new THREE.Group();
  const colliders = [];

  const stone = (hex) => new THREE.MeshStandardMaterial({
    color: hex, flatShading: true, roughness: 0.94, metalness: 0.06,
  });
  const light = stone(0x8e8880);
  const mid = stone(0x7a756d);
  const dark = stone(0x615c55);
  const frozen = stone(0x9ba6b0);
  const runeMat = new THREE.MeshStandardMaterial({
    color: 0x53e0ff, emissive: 0x53e0ff, emissiveIntensity: 1.9,
    flatShading: true, roughness: 0.4, metalness: 0.2,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffc46a, emissive: 0xffa040, emissiveIntensity: 1.6,
    flatShading: true, roughness: 0.4, metalness: 0.3,
  });

  const SEG = 24;
  const R_OUT = 17.4;     // внешний край площадки
  const R_WALL = 15.2;    // разорванное кольцо стены
  const R_COL = 12.0;     // кольцо колонн
  const N_COL = 8;        // 8 колонн — между ними проезд шире корпуса ровера

  /* --- площадка: три уровня, верх на 6/10/13 см выше земли --- */
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(R_OUT, R_OUT + 1.2, 3.4, SEG), mid);
  plat.position.y = -1.64;
  g.add(plat);

  const ring2 = new THREE.Mesh(new THREE.CylinderGeometry(R_OUT - 1.9, R_OUT - 1.5, 0.16, SEG), light);
  ring2.position.y = 0.02;
  g.add(ring2);

  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R_OUT - 4.4, R_OUT - 3.8, 0.2, SEG), dark);
  floor.position.y = 0.03;
  g.add(floor);

  // радиальные швы пола — читаются как плиты
  for (let i = 0; i < SEG; i += 2) {
    const a = (i / SEG) * Math.PI * 2;
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, R_OUT - 6.4), frozen);
    seam.position.set(Math.cos(a) * (6.2 + (R_OUT - 6.4) / 2), 0.15, Math.sin(a) * (6.2 + (R_OUT - 6.4) / 2));
    seam.rotation.y = -a + Math.PI / 2;
    g.add(seam);
  }

  /* --- кольцо стены с тремя воротами --- */
  const gates = [3, 11, 19];
  const segAng = (Math.PI * 2) / SEG;
  const segW = 2 * R_WALL * Math.sin(segAng / 2) * 0.94;
  for (let i = 0; i < SEG; i++) {
    if (gates.some((gt) => i === gt || i === (gt + 1) % SEG)) continue;
    const a = i * segAng;
    const hh = 0.85 + rnd() * 1.05;
    const blk = new THREE.Mesh(new THREE.BoxGeometry(1.0, hh, segW), rnd() > 0.55 ? light : mid);
    blk.position.set(Math.cos(a) * R_WALL, hh / 2 - 0.12, Math.sin(a) * R_WALL);
    blk.rotation.y = -a;
    blk.rotation.z = (rnd() - 0.5) * 0.07;
    g.add(blk);
    colliders.push({ x: blk.position.x, z: blk.position.z, r: 0.9 });
  }

  // воротные столбы — видно, куда заезжать
  for (const gt of gates) {
    for (const off of [-0.6, 1.6]) {
      const a = (gt + off) * segAng;
      const hh = 2.4 + rnd() * 0.6;
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.4, hh, 1.4), light);
      post.position.set(Math.cos(a) * R_WALL, hh / 2, Math.sin(a) * R_WALL);
      post.rotation.y = -a;
      g.add(post);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 1.8), goldMat);
      cap.position.set(post.position.x, hh + 0.14, post.position.z);
      cap.rotation.y = -a;
      g.add(cap);

      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.1, hh * 0.55, 0.34), runeMat);
      slit.position.set(
        post.position.x * 0.995, hh * 0.55, post.position.z * 0.995
      );
      slit.rotation.y = -a;
      g.add(slit);

      colliders.push({ x: post.position.x, z: post.position.z, r: 0.9 });
    }
  }

  /* --- колонны --- */
  const cols = [];
  for (let i = 0; i < N_COL; i++) {
    const a = (i / N_COL) * Math.PI * 2 + 0.26;
    const cx = Math.cos(a) * R_COL, cz = Math.sin(a) * R_COL;
    const broken = rnd() < 0.42;
    const h = broken ? 1.5 + rnd() * 2.8 : 8.8 + rnd() * 1.5;

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.8, 2.7), dark);
    plinth.position.set(cx, 0.42, cz);
    plinth.rotation.y = -a;
    g.add(plinth);

    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.92, h, 8), rnd() > 0.5 ? light : frozen);
    col.position.set(cx, 0.78 + h / 2, cz);
    if (broken) {
      col.rotation.z = (rnd() - 0.5) * 0.24;
      col.rotation.x = (rnd() - 0.5) * 0.24;
    }
    g.add(col);
    colliders.push({ x: cx, z: cz, r: 0.8 });

    // рунический пояс — светится у всех колонн, даже сломанных
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.97, 0.3, 8), i % 3 === 0 ? goldMat : runeMat);
    band.position.set(cx, 2.35, cz);
    g.add(band);

    if (!broken) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 2.6), mid);
      cap.position.set(cx, 0.78 + h + 0.3, cz);
      cap.rotation.y = -a;
      g.add(cap);
    }
    cols.push({ a, cx, cz, h, broken });
  }

  /* --- антаблемент: соединяем уцелевшие соседние колонны --- */
  for (let i = 0; i < N_COL; i++) {
    const a = cols[i], b = cols[(i + 1) % N_COL];
    if (a.broken || b.broken) continue;
    if (rnd() < 0.35) continue;                       // часть пролётов обрушилась
    const mx = (a.cx + b.cx) / 2, mz = (a.cz + b.cz) / 2;
    const len = Math.hypot(b.cx - a.cx, b.cz - a.cz);
    const ang = Math.atan2(b.cz - a.cz, b.cx - a.cx);
    const hl = (a.h + b.h) / 2 + 0.78;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(len + 0.6, 0.7, 1.9), rnd() > 0.5 ? mid : light);
    beam.position.set(mx, hl, mz);
    beam.rotation.y = -ang;
    g.add(beam);

    const trim = new THREE.Mesh(new THREE.BoxGeometry(len + 0.2, 0.16, 1.5), goldMat);
    trim.position.set(mx, hl - 0.42, mz);
    trim.rotation.y = -ang;
    g.add(trim);
  }

  /* --- алтарь в центре --- */
  const altar = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 4.4, 1.6, 8), mid);
  altar.position.y = 0.9;
  g.add(altar);
  const altarTop = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 3.0, 0.9, 8), light);
  altarTop.position.y = 2.1;
  g.add(altarTop);
  const altarRing = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.14, 4, 16), runeMat);
  altarRing.position.y = 2.58;
  altarRing.rotation.x = Math.PI / 2;
  g.add(altarRing);

  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.3, 0), goldMat);
  crystal.position.y = 3.9;
  crystal.rotation.y = 0.6;
  g.add(crystal);

  const glow = glowSprite(0xffb45a, 30, 0.5);
  glow.position.y = 3.9;
  g.add(glow);

  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffc46a, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.7, 80, 6, 1, true), beamMat);
  beam.position.y = 40;
  g.add(beam);

  colliders.push({ x: 0, z: 0, r: 4.8 });

  /* --- обломки и снег на полу --- */
  for (let i = 0; i < 16; i++) {
    const s = 0.7 + rnd() * 1.8;
    const ang = rnd() * 6.28;
    const rr = 5.2 + rnd() * (R_OUT - 6);
    const blk = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.55, s * (0.7 + rnd() * 0.7)), rnd() > 0.5 ? mid : light);
    blk.position.set(Math.cos(ang) * rr, 0.2 + s * 0.2, Math.sin(ang) * rr);
    blk.rotation.set((rnd() - 0.5) * 0.5, rnd() * 3.14, (rnd() - 0.5) * 0.5);
    g.add(blk);
  }

  // лежащие куски колонн
  for (let i = 0; i < 5; i++) {
    const len = 2.4 + rnd() * 2.6;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, len, 8), frozen);
    const ang = rnd() * 6.28;
    const rr = 6.5 + rnd() * (R_OUT - 8.5);
    drum.position.set(Math.cos(ang) * rr, 0.85, Math.sin(ang) * rr);
    drum.rotation.set(Math.PI / 2, rnd() * 3.14, rnd() * 0.4);
    g.add(drum);
  }

  return { group: g, colliders, radius: R_OUT + 1.5, crystal, beam, glow, altarRing };
}

/* ================================================================= ПЛИТА */
/** Знак на камне: canvas → спрайт (тангутские иероглифы).
    Шрифт обязан быть уже загружен (см. предзагрузку в main.js): canvas не
    умеет ждать @font-face и нарисует пустые рамки, которые запекутся в текстуру.
    Спрайт всегда развёрнут к камере, поэтому «поворачивать» знак не нужно. */
function glyphSprite(char, color, size = 6) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;          // мягкое свечение, но штрихи знака не слипаются
  // несколько знаков — строками (\n), кегль подбирается под самую длинную
  const lines = String(char).split('\n');
  const widest = Math.max(1, ...lines.map((l) => Array.from(l).length));
  const fs = Math.round(Math.min(190, 214 / widest));
  ctx.font = canvasFont(fs);
  const lh = fs * 1.04;
  const y0 = 128 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => ctx.fillText(line, 128, y0 + i * lh));
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  spr.scale.setScalar(size);
  return spr;
}

/** Центральная плита с надписью — точка «письмена» */
function buildTablet() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x8a8074, flatShading: true, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x5b544a, flatShading: true, roughness: 0.9 });
  const rune = new THREE.MeshStandardMaterial({
    color: 0x8cecdf, emissive: 0x5de8d6, emissiveIntensity: 0.7, flatShading: true,
  });

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 6.2, 1.4, 8), dark);
  plinth.position.y = 0.4;
  g.add(plinth);

  const slab = new THREE.Mesh(new THREE.BoxGeometry(8.6, 5.2, 1.7), stone);
  slab.position.y = 3.2;
  g.add(slab);

  const face = new THREE.Mesh(new THREE.BoxGeometry(7.4, 4.1, 0.12), dark);
  face.position.set(0, 3.2, 0.9);
  g.add(face);

  const marks = glyphSprite(`${TANGUT.shut.char}${TANGUT.burn.char}${TANGUT.down.char}\n${TANGUT.open.char}${TANGUT.up.char}${TANGUT.dark.char}`, '#9ff2e6', 4.4);
  marks.position.set(0, 3.4, 1.1);
  g.add(marks);

  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 4.2, 1.4), stone);
    wing.position.set(s * 5.4, 2.6, -0.4);
    wing.rotation.y = s * 0.35;
    g.add(wing);
  }

  const strip = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.22, 0.22), rune);
  strip.position.set(0, 5.9, 0.7);
  g.add(strip);

  const glow = glowSprite(0x8cecdf, 15, 0.28);
  glow.position.y = 3.4;
  g.add(glow);

  return { group: g, marks, strip, rune, glow,
    // кадр для миниигры «переводчик»: плита целиком, чуть сбоку
    shot: { cam: [2.6, 4.9, 13.6], look: [0, 3.2, 1.0], fov: 46 } };
}

/**
 * Схрон с манускриптом: полузасыпанный каменный ларец. Крышка на петле,
 * открывается по мере раскопок; внутри — светящаяся табличка.
 */
function buildScrollCache(sc) {
  const group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0x9c8f78 });
  const stoneDark = new THREE.MeshLambertMaterial({ color: 0x6f6555 });
  const bronze = new THREE.MeshLambertMaterial({ color: 0x8a6a3f });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.72, 1.15), stone);
  body.position.y = 0.36;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);
  for (const y of [0.16, 0.58]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.09, 1.22), bronze);
    band.position.y = y;
    group.add(band);
  }
  // полосы поперёк — «оковка»
  for (const x of [-0.55, 0.55]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.74, 1.2), bronze);
    strap.position.set(x, 0.36, 0);
    group.add(strap);
  }

  // крышка на петле сзади
  const lid = new THREE.Group();
  lid.position.set(0, 0.74, -0.56);
  const lidTop = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.14, 1.18), stoneDark);
  lidTop.position.set(0, 0.07, 0.56);
  lidTop.castShadow = true;
  lid.add(lidTop);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.12), bronze);
  lock.position.set(0, 0.05, 1.14);
  lid.add(lock);
  group.add(lid);

  // светящаяся табличка внутри (видна, когда крышка приподнята)
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xa8ffe9, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  plate.position.set(0, 0.5, 0);
  plate.rotation.x = -Math.PI / 2;
  group.add(plate);
  const glow = new THREE.PointLight(0x9ff2e6, 0, 7, 2);
  glow.position.y = 0.8;
  group.add(glow);

  return { group, lid, plate, glow, dug: 0 };
}

/** Три древности, где находятся слова: стена с бурей, ахола, резьба у горы */
function buildArtifactSite(kind) {
  const site = kind === 'gate' ? buildMechGate()
    : kind === 'beacon' ? buildMechBeacon()
      : buildMechLift();
  site.kind = kind;
  site.on = false;
  site.t = 0;          // плавный коэффициент перехода между состояниями

  /* Кит-модели как основания механизмов (они уже с материалами и фактурой):
     очаг — ярусный фалзовый алтарь, противовес — аркада-мост. */
  const kitId = kind === 'beacon' ? 'phase-altar'
    : kind === 'lift' ? 'crest-tower' : null;
  if (kitId) {
    new GLTFLoader().loadAsync(`${KIT_DIR}${kitId}.glb`)
      .then((gltf) => {
        const root = gltf.scene;
        setKitBase(site, root, kind === 'beacon' ? 0.92 : 0.3, 0);
        if (kind === 'lift') placeLiftTrack(site);   // кабина и груз — перед башней
        site.group.updateMatrixWorld(true);
        // пломбу со знаком сажаем на переднюю грань основания — ровная вертикаль

      })
      .catch((e) => console.warn('[XR-7] основание механизма не загрузилось:', kitId, e));
  }
  return site;
}

/**
 * Переключить состояние артефакта. Анимация плавная: створки поворачиваются,
 * платформа ездит, огонь разгорается — знак меняется сразу.
 */
export function applyArtifactState(site, on) {
  site.on = !!on;
  site.markOff.visible = !site.on;
  site.markOn.visible = site.on;
}

/* ============================================================ ФАЗОВЫЙ КЛЮЧ */
/**
 * Обрушенная святилище-пещера вокруг алтаря: кольцо стен с проломом-входом,
 * осыпавшийся свод — тяжёлые плиты повисли над нищей, обломки на полу.
 * Ключ стоит на алтаре в середине, подсвеченный изнутри.
 */
function buildPhaseVault() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({
    color: 0x7f7963, flatShading: true, roughness: 0.94, metalness: 0.05,
  });
  const stoneDark = new THREE.MeshStandardMaterial({
    color: 0x504d3c, flatShading: true, roughness: 0.9, metalness: 0.08,
  });
  const rune = new THREE.MeshStandardMaterial({
    color: 0x53e0ff, emissive: 0x53e0ff, emissiveIntensity: 1.6,
    flatShading: true, roughness: 0.35, metalness: 0.2,
  });

  const R = 5.2;                 // радиус пещеры
  const GAP = 1.15;              // пролом-вход обращён к югу (+Z)

  /* --- стены: сектора разной высоты, свод обрушен --- */
  const sectors = 9;
  for (let i = 0; i < sectors; i++) {
    const a0 = (i / sectors) * Math.PI * 2;
    // вход не застраиваем
    const midA = a0 + Math.PI / sectors;
    if (Math.abs(((midA - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < GAP) continue;

    const h = (i % 3 === 0 ? 5.4 : i % 2 === 0 ? 4.2 : 3.0) + Math.random() * 0.6;
    const w = (Math.PI * 2 * R) / sectors * 0.94;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.9), i % 4 === 1 ? stoneDark : stone);
    wall.position.set(Math.cos(midA) * R, h / 2 - 0.4, Math.sin(midA) * R);
    wall.rotation.y = -midA + Math.PI / 2;
    wall.rotation.z = (Math.random() - 0.5) * 0.06;
    g.add(wall);
  }

  /* --- обрушившийся свод --- */
  // Перекладины лежат НА стенах и проходят над ключом (ключ ниже 4.4, плиты с 5.2).
  const lintels = [
    { ang: 0.15, len: 10.6, y: 5.35, w: 2.1 },
    { ang: 1.65, len: 9.4, y: 5.15, w: 1.7 },
  ];
  for (const L of lintels) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(L.len, 0.42, L.w), stoneDark);
    slab.position.set(0, L.y, 0);
    slab.rotation.y = L.ang;
    slab.rotation.z = 0.02;
    g.add(slab);
  }

  // Осыпь с одной стороны: пласты легли друг на друга от стены к полу,
  // каждый следующий опирается на предыдущий — ничего не висит в воздухе.
  for (let i = 0; i < 5; i++) {
    const k = i / 4;
    const y = 4.1 - k * 3.2;                      // 4.1 → 0.9
    const rr = 3.1 + k * 1.5;                     // от стены к центру пола
    const ang = 2.5 + k * 0.28;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(2.6 - k * 0.5, 0.34, 1.9 - k * 0.3), stoneDark);
    slab.position.set(Math.cos(ang) * rr, y, Math.sin(ang) * rr);
    slab.rotation.set(0.5 + k * 0.35, ang, 0.12 + k * 0.1);
    g.add(slab);
  }

  /* --- обломки на полу (только у стен, центр свободен) --- */
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = 3.4 + Math.random() * (R - 3.2);
    const s = 0.45 + Math.random() * 1.1;
    const blk = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.5, s * (0.7 + Math.random() * 0.6)), stone);
    blk.position.set(Math.cos(a) * rr, s * 0.22, Math.sin(a) * rr);
    blk.rotation.set((Math.random() - 0.5) * 0.35, Math.random() * 3.14, (Math.random() - 0.5) * 0.35);
    g.add(blk);
  }

  /* --- свет изнутри: холодный, будто от самого ключа --- */
  const light = new THREE.PointLight(0x9ff2e6, 2.6, 16, 2);
  light.position.set(0, 3.0, 0);
  g.add(light);
  const halo = glowSprite(0x9ff2e6, 12, 0.3);
  halo.position.set(0, 3.0, 0);
  g.add(halo);

  // светящаяся жила по полу к алтарю
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i - 1) * 0.22;
    const vein = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 3.2), rune);
    vein.position.set(Math.cos(a) * 1.8, 0.03, Math.sin(a) * 1.8);
    vein.rotation.y = -a;
    g.add(vein);
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, light, halo, radius: R };
}

/**
 * Главный артефакт: слоистый камень с тремя кольцами-регуляторами.
 * Стиль тот же, что у остального мира — плоские грани, приглушённый камень,
 * единственный яркий акцент — циан в швах между слоями.
 * Кольца крутятся в разные стороны (анимация в main.js).
 */
export function buildPhaseCore() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({
    color: 0x8b866c, flatShading: true, roughness: 0.93, metalness: 0.05,
  });
  const stoneDark = new THREE.MeshStandardMaterial({
    color: 0x62604c, flatShading: true, roughness: 0.9, metalness: 0.08,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x4b4f54, flatShading: true, roughness: 0.55, metalness: 0.5,
  });
  const rune = new THREE.MeshStandardMaterial({
    color: 0x53e0ff, emissive: 0x53e0ff, emissiveIntensity: 1.7,
    flatShading: true, roughness: 0.35, metalness: 0.2,
  });

  // ось: шестигранный камень, сужается кверху
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.4, 1.5, 6), stone);
  g.add(shaft);

  // три кольца-регулятора, каждое на своей высоте
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = 0.66 - i * 0.08;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.085, 4, 10),
      i === 1 ? metal : stoneDark
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.48 + i * 0.46;
    g.add(ring);
    rings.push(ring);
    // насечка на кольце, чтобы вращение читалось
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.1), metal);
    notch.position.set(r, -0.48 + i * 0.46, 0);
    g.add(notch);
    ring.userData.notch = notch;
  }

  // светящиеся швы между слоями
  for (let i = 0; i < 2; i++) {
    const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.04, 8), rune);
    seam.position.y = -0.25 + i * 0.46;
    g.add(seam);
  }

  // наконечник и опорная пятка
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.44, 6), metal);
  tip.position.y = 0.94;
  g.add(tip);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.45, 0.18, 6), metal);
  foot.position.y = -0.8;
  g.add(foot);

  /* Три орбиты вокруг ключа: тонкие кольца в разных плоскостях, по каждому
     бежит искра — иначе вращение симметричного кольца не видно. */
  const orbits = [];
  const orbitMat = new THREE.MeshStandardMaterial({
    color: 0x53e0ff, emissive: 0x53e0ff, emissiveIntensity: 1.3,
    flatShading: true, roughness: 0.4, metalness: 0.1,
  });
  const orbitCfg = [
    { r: 1.22, tilt: 0.0, spin: 0.9 },
    { r: 1.42, tilt: 1.05, spin: -0.62 },
    { r: 1.62, tilt: -0.68, spin: 0.44 },
  ];
  for (const c of orbitCfg) {
    const pivot = new THREE.Group();
    pivot.rotation.x = c.tilt;
    pivot.rotation.z = c.tilt * 0.45;
    const loop = new THREE.Mesh(new THREE.TorusGeometry(c.r, 0.018, 3, 26), orbitMat);
    loop.rotation.x = Math.PI / 2;
    pivot.add(loop);
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), orbitMat);
    spark.position.set(c.r, 0, 0);
    pivot.add(spark);
    pivot.userData.spin = c.spin;
    g.add(pivot);
    orbits.push(pivot);
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, rings, orbits };
}

/* ================================================================== МАЯКИ */
function buildBeacon(rnd, index) {  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x55595e, flatShading: true, roughness: 0.9, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f34, flatShading: true, roughness: 0.8, metalness: 0.3 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.6, 1.3, 6), stone);
  base.position.y = 0.25;
  g.add(base);

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.2, 2.4), dark);
    rib.position.set(Math.cos(a) * 3.6, 1.3, Math.sin(a) * 3.6);
    rib.rotation.y = -a;
    g.add(rib);
  }

  const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.9, 10, 4), stone);
  ob.position.y = 6.2;
  ob.rotation.y = Math.PI / 4;
  g.add(ob);

  for (const y of [5.4, 8.6]) {
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 3.2), dark);
    belt.position.y = y;
    belt.rotation.y = Math.PI / 4;
    g.add(belt);
  }

  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x2f4757, emissive: 0x1d3442, emissiveIntensity: 0.6,
    flatShading: true, roughness: 0.25, metalness: 0.35,
  });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(2.0, 0), crystalMat);
  crystal.position.y = 12.6;
  g.add(crystal);

  const rings = [];
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x3ad4ff, emissive: 0x3ad4ff, emissiveIntensity: 0,
    flatShading: true, transparent: true, opacity: 0.15,
  });
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4 + i * 1.1, 0.1, 4, 24), ringMat);
    ring.position.y = 12.6;
    ring.rotation.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
    g.add(ring);
    rings.push(ring);
  }

  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x3ad4ff, transparent: true, opacity: 0.06,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.5, 70, 6, 1, true), beamMat);
  beam.position.y = 40;
  g.add(beam);

  const glow = glowSprite(0x3ad4ff, 16, 0.0);
  glow.position.y = 12.6;
  g.add(glow);

  return { group: g, crystal, crystalMat, rings, ringMat, beam, beamMat, glow, index };
}

/* ================================================================ АНОМАЛИИ */
const ARC_PTS = 12;   // изломов в молнии: больше — дороже, меньше — «прямая палка»

/** Ломаная от одной точки к другой: середина гуляет, концы стоят на месте */
function shapeArc(line, from, to, jitter) {
  const pos = line.geometry.attributes.position;
  for (let i = 0; i < ARC_PTS; i++) {
    const k = i / (ARC_PTS - 1);
    const bend = Math.sin(k * Math.PI) * jitter;
    pos.setXYZ(
      i,
      from[0] + (to[0] - from[0]) * k + (Math.random() - 0.5) * bend,
      from[1] + (to[1] - from[1]) * k + (Math.random() - 0.5) * bend,
      from[2] + (to[2] - from[2]) * k + (Math.random() - 0.5) * bend,
    );
  }
  pos.needsUpdate = true;
}

function buildAnomaly(rnd) {
  const g = new THREE.Group();
  const hue = 0xc07bff;

  const coreMat = new THREE.MeshStandardMaterial({
    color: hue, emissive: hue, emissiveIntensity: 1.8,
    flatShading: true, metalness: 0.3, roughness: 0.25,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3 + rnd() * 1.1, 0), coreMat);
  g.add(core);

  const ringMat = new THREE.MeshStandardMaterial({
    color: hue, emissive: hue, emissiveIntensity: 1.1, flatShading: true,
  });
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6 + i * 1.3, 0.07, 3, 20), ringMat);
    ring.rotation.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
    g.add(ring);
    rings.push(ring);
  }

  const shardGeo = new THREE.OctahedronGeometry(0.3, 0);
  const shards = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(shardGeo, coreMat);
    shards.push({ mesh: s, angle: rnd() * 6.28, radius: 3 + rnd() * 1.8, tilt: rnd() * 6.28 });
    g.add(s);
  }

  /* Видно издалека, но не слепит: широкое туманное гало + яркое ядро */
  const aura = glowSprite(hue, 54, 0.10);
  g.add(aura);
  const glow = glowSprite(hue, 20, 0.55);
  g.add(glow);

  /* Мягкий столб вверх — читается как «место занято» с любой дистанции */
  const column = glowSprite(hue, 1, 0.09);
  column.scale.set(9, 46, 1);
  column.position.y = 15;
  g.add(column);

  /* Молнии: две тонкие линии, живут доли секунды и гаснут */
  const arcs = [];
  for (let i = 0; i < 2; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_PTS * 3), 3));
    const mat = new THREE.LineBasicMaterial({
      color: hue, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.visible = false;
    g.add(line);
    arcs.push({ line, mat });
  }

  return {
    group: g, core, coreMat, ringMat, rings, shards, glow, aura, column, arcs,
    hue: new THREE.Color(hue), hueHex: hue,
    nextArc: 1.5 + rnd() * 5, arcLife: 0, arcMax: 1, groundY: 0, arcBranch: false,
  };
}

/* ================================================================= ОСКОЛКИ */
function buildShard() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd25a, emissive: 0xff9a20, emissiveIntensity: 1.7,
    flatShading: true, metalness: 0.5, roughness: 0.2,
  });
  const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), mat);
  cr.scale.y = 1.6;
  cr.position.y = 1.5;
  g.add(cr);
  const glow = glowSprite(0xffd25a, 7, 0.55);
  glow.position.y = 1.5;
  g.add(glow);
  return { group: g, mesh: cr, glow };
}

/* ================================================================== АРХИВ */
function buildVault() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x4c5157, flatShading: true, roughness: 0.92, metalness: 0.1 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x33383d, flatShading: true, roughness: 0.85, metalness: 0.25 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(15, 18, 2.4, 8), darkStone);
  base.position.y = -0.6;
  g.add(base);

  const step2 = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 13.5, 1.6, 8), stone);
  step2.position.y = 0.9;
  g.add(step2);

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const h = 6 + (i % 3) * 1.6;
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.5, h, 1.5), stone);
    p.position.set(Math.cos(a) * 12.6, h / 2 + 1.7, Math.sin(a) * 12.6);
    p.rotation.y = -a;
    g.add(p);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 2.2), darkStone);
    cap.position.set(Math.cos(a) * 12.6, h + 1.9, Math.sin(a) * 12.6);
    cap.rotation.y = -a;
    g.add(cap);
  }

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xffa040, emissive: 0xffa040, emissiveIntensity: 0.4,
    flatShading: true, metalness: 0.4, roughness: 0.3,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9.4, 0.5, 6, 40), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2.6;
  g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.22, 4, 36), ringMat);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 9.5;
  g.add(ring2);

  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x4a3a2a, emissive: 0x2a1d10, emissiveIntensity: 0.5,
    flatShading: true, metalness: 0.5, roughness: 0.2,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(3.2, 0), coreMat);
  core.position.y = 9.5;
  core.scale.y = 1.5;
  g.add(core);

  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffa040, transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 5, 90, 8, 1, true), beamMat);
  beam.position.y = 46;
  g.add(beam);

  const glow = glowSprite(0xffa040, 34, 0.0);
  glow.position.y = 9.5;
  g.add(glow);

  /* --- шпиль в небо и развалины вокруг --- */
  const spire = new THREE.Group();
  const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 3.2, 62, 5), darkStone);
  sp.position.y = 31;
  spire.add(sp);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const but = new THREE.Mesh(new THREE.BoxGeometry(1.6, 12 + i * 4, 1.6), stone);
    but.position.set(Math.cos(a) * 5.6, 10 + i * 2, Math.sin(a) * 5.6);
    but.rotation.z = Math.cos(a) * 0.16;
    but.rotation.x = Math.sin(a) * 0.16;
    spire.add(but);
  }
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xffd7a0, emissive: 0xffa040, emissiveIntensity: 2.2, flatShading: true,
  });
  const tip = new THREE.Mesh(new THREE.OctahedronGeometry(2.4, 0), tipMat);
  tip.position.y = 64;
  spire.add(tip);
  g.add(spire);

  // кольцо обрушенных стен вокруг
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    if (Math.cos(a) > 0.72) continue;             // проезд с востока
    const h = 5 + (i % 4) * 3.4;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(9, h, 2.4), i % 3 ? stone : darkStone);
    wall.position.set(Math.cos(a) * 30, h / 2, Math.sin(a) * 30);
    wall.rotation.y = -a;
    wall.rotation.z = (i % 5 === 0) ? 0.06 : 0;
    g.add(wall);
  }

  const fallback = new THREE.Group();
  fallback.add(...g.children.slice());
  g.add(fallback);

  /* --- завеса аномалии: пока буря не укрощена, внутрь не пускает --- */
  const barrierMat = new THREE.MeshBasicMaterial({
    color: 0x9c7edb, transparent: true, opacity: 0.14, side: THREE.DoubleSide,
    depthWrite: false, fog: false,
  });
  const barrier = new THREE.Mesh(new THREE.CylinderGeometry(50, 50, 90, 48, 1, true), barrierMat);
  barrier.position.y = 44;
  g.add(barrier);
  const barrierWire = new THREE.Mesh(
    new THREE.CylinderGeometry(50.2, 50.2, 89, 24, 6, true),
    new THREE.MeshBasicMaterial({ color: 0xb9a0ef, wireframe: true, transparent: true, opacity: 0.10, depthWrite: false, fog: false })
  );
  barrierWire.position.y = 44;
  g.add(barrierWire);

  return { group: g, fallback, ring, ring2, core, coreMat, beamMat, glow, spire, tip, tipMat, barrier, barrierWire, barrierMat };
}

/* ==================================================== ИНДЕКС СТОЛКНОВЕНИЙ */
class ObstacleGrid {
  constructor(cell = 26) {
    this.cell = cell;
    this.map = new Map();
    this._buf = [];
  }

  _key(ix, iz) { return ix * 100000 + iz; }

  add(pos, r, extra = null) {
    const c = this.cell;
    const ex = Math.ceil((r + 2) / c);
    const ix = Math.floor(pos.x / c);
    const iz = Math.floor(pos.z / c);
    // extra тащит метку («round» = мелкий камень-трамплин, kind = тип)
    const o = extra ? Object.assign({ pos: pos.clone(), r }, extra) : { pos: pos.clone(), r };
    for (let dx = -ex; dx <= ex; dx++) {
      for (let dz = -ex; dz <= ex; dz++) {
        const k = this._key(ix + dx, iz + dz);
        let arr = this.map.get(k);
        if (!arr) { arr = []; this.map.set(k, arr); }
        arr.push(o);
      }
    }
  }

  query(pos) {
    const out = this._buf;
    out.length = 0;
    const c = this.cell;
    const ix = Math.floor(pos.x / c);
    const iz = Math.floor(pos.z / c);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = this.map.get(this._key(ix + dx, iz + dz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          if (out.indexOf(arr[i]) === -1) out.push(arr[i]);
        }
      }
    }
    return out;
  }
}

/* ================================================================== WORLD */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.plan = planWorld();
    this.obstacles = [];
    this.propObstacles = [];
    this.reserved = [];
    this.beacons = [];
    this.shards = [];
    this.anomalies = [];
    this.ruins = [];
    this.time = 0;

    const rnd = mulberry32(2718);
    const P = this.plan;
    setArchivePad(...P.vault.p);

    /* --- небо, земля, туман --- */
    this.sky = buildSky();
    scene.add(this.sky);
    // звёзды гаснут, когда встаёт солнце — поэтому нужна ссылка
    this.stars = buildStars(rnd);
    scene.add(this.stars);
    this.ground = buildGround();
    scene.add(this.ground);

    this.lander=buildLander();
    scene.add(this.lander.root);
    this.reserved.push({x:LANDING_SITE.x+2,z:LANDING_SITE.z,r:13});
    for(const dx of [-4,-1,2.7]){
      this.obstacles.push({pos:new THREE.Vector3(LANDING_SITE.x+dx,this.lander.root.position.y,LANDING_SITE.z),r:2.65,kind:'wall'});
    }
    for(const dz of [-3.4,3.4]){
      this.obstacles.push({pos:new THREE.Vector3(LANDING_SITE.x,this.lander.root.position.y,LANDING_SITE.z+dz),r:1.75,kind:'wall'});
    }
    this.wall = buildFogWall(rnd);
    scene.add(this.wall.group);
    this.stormRing = buildStormRing();
    scene.add(this.stormRing.group);

    this.haze = buildHaze(rnd);
    scene.add(this.haze);
    this.motes = buildMotes(rnd);
    scene.add(this.motes);

    /* --- руины --- */
    for (const site of P.ruins) {
      const { group, radius } = buildRuinSite(rnd);
      placeOnGround(group, site.p[0], site.p[1], 0.6);
      scene.add(group);
      this.ruins.push({ pos: group.position.clone(), group });
      this.obstacles.push({ pos: group.position.clone(), r: radius });
    }

    /* --- маяки --- */
    P.beacons.forEach((b, i) => {
      const parts = buildBeacon(rnd, i);
      placeOnGround(parts.group, b.p[0], b.p[1], 0.5);
      scene.add(parts.group);

      meshNormalAt(b.p[0], b.p[1], _n);
      const beacon = {
        ...parts,
        pos: parts.group.position.clone(),
        crystalPos: parts.group.position.clone().addScaledVector(_n, 12.6),
        biome: b.biome,
        lit: false,
        litT: 0,
      };
      this.beacons.push(beacon);
      this.obstacles.push({ pos: beacon.pos.clone(), r: 3.4 });
    });

    /* --- аномалии --- */
    for (const a of P.anomalies) {
      const parts = buildAnomaly(rnd);
      const ground = meshHeightAt(a.p[0], a.p[1]);
      const y = ground + 11;
      parts.group.position.set(a.p[0], y, a.p[1]);
      parts.groundY = ground;
      scene.add(parts.group);

      this.anomalies.push({
        ...parts, base: parts.group.position.clone(),
        phase: rnd() * 6.28, boost: 0, scanned: false,
      });
    }

    /* --- осколки --- */
    for (const s of P.shards) {
      const parts = buildShard();
      placeOnGround(parts.group, s.p[0], s.p[1], 0);
      scene.add(parts.group);
      this.shards.push({
        ...parts, base: parts.group.position.clone(),
        phase: rnd() * 6.28, collected: false, t: 0,
      });
    }

    /* --- Архив / Сердце бури --- */
    const v = buildVault();
    placeOnGround(v.group, P.vault.p[0], P.vault.p[1], 0.16);
    scene.add(v.group);
    this.vault = v;
    this.vault.pos = v.group.position.clone();
    this.vault.corePos = v.group.position.clone().addScaledVector(UP, 9.5);
    this.vault.open = false;
    this.archiveWalls = [{ pos: this.vault.pos.clone(), r: 13 }];
    this.reserved.push({ x: v.pos.x, z: v.pos.z, r: 26 });
    this.loadCityArchive(P.anomalies[0].p).catch((err) => console.warn('[АВАРИС] Хранилище:', err));
    // завеса вокруг финала: пока не снята — внутрь не проехать
    this.barrierOpen = false;
    this.coreColliders = [{ pos: this.vault.pos.clone(), r: 50 }];

    /* --- плиты с письменами в мире больше нет: три текста закопаны в схронах --- */
    this.tablet = null;

    /* --- три артефакта с двойным состоянием --- */
    this.artifactSites = [];
    const kinds = ['gate', 'beacon', 'lift'];
    (P.words || []).forEach((w, i) => {
      const site = buildArtifactSite(kinds[i]);
      // механизм стоит СТРОГО вертикально, хотя мир под уклоном:
      // положение по высоте берём из рельефа, а наклон грунта не наследуем
      site.group.position.set(w.p[0], meshHeightAt(w.p[0], w.p[1]) + 0.35, w.p[1]);
      site.group.rotation.set(0, 0, 0);
      scene.add(site.group);
      this.artifactSites.push({ ...site, kind: kinds[i], pos: site.group.position.clone() });
      const rad = kinds[i] === 'gate' ? 4.2 : 2.6;
      this.obstacles.push({ pos: site.group.position.clone(), r: rad });
    });

    /* --- три манускрипта, закопанные в безопасных точках (вне аномалий) --- */
    this.scrollCaches = [];
    for (const sc of scrollSites()) {
      const cache = buildScrollCache(sc);
      placeOnGround(cache.group, sc.x, sc.z, 0);
      scene.add(cache.group);
      this.scrollCaches.push({
        ...cache,
        id: sc.id,
        title: sc.title,
        pos: cache.group.position.clone(),
        baseY: cache.group.position.y,
        dug: 0,
        target: 0,
        found: false,
      });
      // коллайдера нет: над закопанной пластиной можно проехать
    }

    /* --- круглые руины храма ЗАКОПАНЫ в вершину --- */
    const temple = buildTemple(rnd);
    // ставим на уровень площадки, а не на верх кургана
    const baseY = meshHeightAt(SUMMIT.x, SUMMIT.z) - moundHeightAt(SUMMIT.x, SUMMIT.z);
    temple.group.position.set(SUMMIT.x, baseY, SUMMIT.z);
    meshNormalAt(SUMMIT.x, SUMMIT.z, _n);
    temple.group.quaternion.setFromUnitVectors(UP, _n);
    scene.add(temple.group);
    this.temple = temple;
    // пока насыпь не вскрыта, храм не показываем вовсе: из горы ничего не торчит
    temple.group.visible = false;
    this.temple.pos = temple.group.position.clone();
    this.reserved.push({ x: SUMMIT.x, z: SUMMIT.z, r: 22 });
    // ключ живёт в отдельной группе вершины: скрытый храм его больше не прячет
    this.summitKey = new THREE.Group();
    this.summitKey.position.set(SUMMIT.x, baseY, SUMMIT.z);
    this.summitKey.visible = false;      // ключ показывается только после раскопок
    scene.add(this.summitKey);
    // коллизии храма включаются не сразу: пока он под землёй — ровер по ней едет
    this.templeColliders = temple.colliders.map((c) => ({
      pos: new THREE.Vector3(SUMMIT.x + c.x, baseY, SUMMIT.z + c.z),
      r: c.r,
    }));

    /* --- мёртвый город за завесой: набор avaris-world-kit ---------------
       Стоит вокруг «Сердца бури», фасадом к подъезду. Коллайдеры и резерв
       места под декор считаются сразу, сами модели догружаются асинхронно. */
    const cityCenter = { x: this.vault.pos.x, z: this.vault.pos.z };
    const approachSite = (P.anomalies && P.anomalies[0]) || { p: [0, -120] };
    const cityFrom = { x: approachSite.p[0], z: approachSite.p[1] };
    const city = cityObstacles(cityCenter, cityFrom);
    for (const o of city.obstacles) this.obstacles.push(o);
    for (const r of city.reserved) this.reserved.push(r);
    this.citySite = { center: cityCenter, from: cityFrom };

    /* --- камни, кристаллы, растения --- */
    for (const site of this.scrollCaches || []) this.reserved.push({x:site.pos.x,z:site.pos.z,r:12});
    this.reserved.push({x:P.anomalies[0].p[0],z:P.anomalies[0].p[1],r:10});
    this._buildProps(rnd);

    /* --- фазовый ключ на алтаре храма --- */
    this.loadPhaseCore();

    /* --- вершина из набора avaris-world-kit: врата + фазовый алтарь -------
       Старый процедурный храм и пещера-святилище остаются в коде, но скрыты.
       Врата прячутся, пока насыпь не вскрыта, и открывают проезд внутрь. */
    this.summitRoot = null;
    this.gatewayColliders = [];
    // вершину занимает набор avaris-world-kit: коллайдеры старого храма не нужны
    this.kitSummit = true;
    const tabletDir = { x: 13, z: -4 };
    const summitYaw = Math.atan2(tabletDir.x, tabletDir.z);
    buildSummitShrine(scene, {
      x: SUMMIT.x, z: SUMMIT.z, y: baseY, yaw: summitYaw, scale: 0.72,
    }).then((kit) => {
      this.summitRoot = kit.group;
      kit.group.visible = digProgress() > 0.01;

      // ключ висит над единственной платформой — на месте прежнего кристалла
      const keyY = kit.altarTopY + 0.45;
      if (this.phaseCore) this.phaseCore.group.position.set(0, keyY, 0);
      if (this.temple && this.temple.phaseHalo) {
        this.temple.phaseHalo.position.set(0, keyY, 0);
        this.temple.phaseKeyY = keyY;
      }

      // коллайдеры: две боковые стены врат и сам алтарь; проезд свободен
      const s = kit.scale, cos = Math.cos(kit.yaw), sin = Math.sin(kit.yaw);
      const add = (lx, lz, r) => this.gatewayColliders.push({
        pos: new THREE.Vector3(
          SUMMIT.x + (lx * cos + lz * sin) * s, baseY,
          SUMMIT.z + (-lx * sin + lz * cos) * s,
        ),
        r: r * s,
        kind: 'wall',
      });
      for (const lz of [-16, -11, -6, -1, 4, 9]) { add(-10.4, lz, 5.4); add(10.4, lz, 5.4); }
      // задняя стена модели висит с 4,6 м — низ открыт, закрываем проезд сзади
      for (const lx of [-8, -4, 0, 4, 8]) add(lx, -19, 4.6);
      add(0, -1.5, 3.4);
      this._buildGrid();
    }).catch((e) => console.warn('[XR-7] врата вершины не загрузились:', e));

    /* --- геометрия города: приедет, когда догрузится --- */
    this.cityObjects = [];
    buildCity(scene, cityCenter, cityFrom)
      .then((objs) => { this.cityObjects = objs; })
      .catch((e) => console.warn('[XR-7] город не загрузился:', e));

    /* --- тени: считается только то, что реально бросает тень --- */
    this.enableShadows();

    /* --- индекс столкновений --- */
    this._buildGrid();
  }

  /**
   * Раздаём castShadow/receiveShadow вручную, а не traverse по всей сцене:
   * купол неба, звёзды, мошкара и стена тумана тени давать не должны —
   * иначе карта теней забивается мусором и всё тонет в артефактах.
   */
  enableShadows() {
    if (this.ground) this.ground.receiveShadow = true;
    if (this.props) {
      // траву и споры не включаем: тонкие силуэты дают грязное пятно
      for (const k of ['rocks', 'cool', 'toxic', 'trees']) {
        if (this.props[k]) this.props[k].castShadow = true;
      }
    }
    const groups = [this.vault, this.tablet, this.temple];
    for (const r of this.ruins) groups.push(r.group);
    for (const b of this.beacons) groups.push(b.group);
    for (const s of this.artifactSites) groups.push(s.group);
    for (const g of groups) {
      if (!g) continue;
      const root = g.group || g;
      if (!root || !root.traverse) continue;
      root.traverse((o) => {
        if (o.isMesh || o.isInstancedMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
    }
    this.vault.barrier.castShadow = this.vault.barrierWire.castShadow = false;
  }

  /** Пересобрать индекс коллизий (меняется при раскопках и снятии завесы) */
  _buildGrid() {
    this.grid = new ObstacleGrid();
    for (const o of this.archiveWalls) this.grid.add(o.pos, o.r, { kind: 'wall' });
    for (const o of this.obstacles) this.grid.add(o.pos, o.r, o.kind ? { kind: o.kind } : null);
    for (const o of this.propObstacles) {
      this.grid.add(o.pos, o.r, { kind: o.kind || 'rock', bump: !!o.bump });
    }
    if (this.templeColliders && !this.kitSummit) {
      for (const o of this.templeColliders) {
        // пока над этим местом лежит грунт, преграда не мешает ехать по кургану
        if (moundHeightAt(o.pos.x, o.pos.z) > 1.0) continue;
        this.grid.add(o.pos, o.r);
      }
    }
    if (this.gatewayColliders && this.kitSummit && digProgress() > 0.01) {
      // как только насыпь тронута, врата видны — нельзя проезжать сквозь их стены
      for (const o of this.gatewayColliders) this.grid.add(o.pos, o.r);
    }
    if (!this.barrierOpen && this.coreColliders) {
      for (const o of this.coreColliders) this.grid.add(o.pos, o.r, { kind: 'barrier' });
    }
  }

  /** Внешнее состояние артефакта (врата/очаг/противовес) */
  setArtifact(kind, on) {
    const a = this.artifactSites && this.artifactSites.find((x) => x.kind === kind);
    if (!a) return false;
    a.on = !!on;
    a.markOff.visible = !a.on;
    a.markOn.visible = a.on;
    return true;
  }

  /** Снять или вернуть завесу вокруг финальных развалин */
  setBarrier(open) {
    this.barrierOpen = !!open;
    this.vault.open = !!open;
    this._buildGrid();
  }

  queryObstacles(pos) { return this.grid.query(pos); }

  async loadCityArchive([approachX, approachZ]) {
    const vault = this.vault;
    const { scene: model } = await new GLTFLoader().loadAsync(KIT_DIR + 'avaris-vault.glb');
    model.rotation.y = Math.atan2(approachX - vault.pos.x, approachZ - vault.pos.z);
    model.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    vault.group.add(model);
    model.updateWorldMatrix(true, true);
    vault.scanPos = model.getObjectByName('Rover_scan').getWorldPosition(new THREE.Vector3());
    model.getObjectByName('Core_focus').getWorldPosition(vault.corePos);

    // The rover resolves XZ circles. Keep the nave open between the shelving
    // banks; a single bounding circle would block the ramp and the scan point.
    const walls = [];
    const wall = (x, z, r) => walls.push({ pos: model.localToWorld(new THREE.Vector3(x, 0, z)), r });
    for (const side of [-1, 1]) {
      for (const z of [-12, -8, -4, 0, 4]) wall(side * 8.2, z, 2.4);
      for (const z of [-11, -5, 1, 6]) wall(side * 13.4, z, 5.2);
      wall(side * 8.2, 10, 1.6);
      wall(side * 5.1, -15.5, 2.8);
    }
    wall(0, -16, 4.0);
    wall(0, -7.4, 4.1);
    this.archiveWalls = walls;
    vault.model = model;
    vault.fallback.visible = false;
    this._buildGrid();
  }

  /**
   * Стена бури сжимается к центру: radius — её радиус, density 0..1 — плотность.
   * radius <= 0.6 прячет стену.
   */
  setStormRing(radius, density = 1) {
    const sr = this.stormRing;
    if (!sr) return;
    const on = radius > 0.6;
    sr.group.visible = on;
    if (!on) return;
    for (let i = 0; i < sr.meshes.length; i++) {
      sr.meshes[i].scale.set(radius, 1, radius);
      const u = sr.layers[i].uniforms.uOpacity;
      u.value = Math.min(1, sr.base[i] * density);
    }
  }

  /** Перестроить землю в районе кургана после очередного нажатия «копать» */
  repaintDig() {
    return this.repaintArea(TEMPLE.x, TEMPLE.z, MOUND_R + 6, true);
  }

  /** Перестроить землю в произвольном районе (ручные шурфы) */
  repaintArea(x, z, r, rebuildGrid = true) {
    const reg = refreshNodes(x, z, r);
    const geo = this.ground.geometry;
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const col = geo.attributes.color.array;
    const N = GRID_N;
    const i0 = Math.max(0, reg.i0), i1 = Math.min(N - 1, reg.i1);
    const j0 = Math.max(0, reg.j0), j1 = Math.min(N - 1, reg.j1);
    let cells = 0;
    for (let iz = j0; iz <= j1; iz++) {
      for (let ix = i0; ix <= i1; ix++) {
        groundCell(ix, iz, pos, nor, col, (iz * N + ix) * 18);
        cells++;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    // The perimeter determines the terrain bounds, excavation only lowers interior nodes.
    // открывшиеся части храма становятся преградами
    if (rebuildGrid) this._buildGrid();
    return cells;
  }

  /**
   * Разложить загруженные модели растений и минералов по своим местам.
   * Каждая модель — несколько InstancedMesh (по мешам GLB), матрицы мест
   * общие, поэтому regroundArea двигает их все сразу.
   */
  _applyModelProps(models) {
    const slots = this._modelSlots;
    if (!slots) return 0;
    let placed = 0;
    for (const id of Object.keys(slots)) {
      const list = slots[id];
      const model = models[id];
      if (!model || !model.parts.length || !list.length) continue;
      for (const im of makePropInstances(model.parts, list, this._modelTints && this._modelTints[id])) {
        // трава не бросает тень: тонкие стебли дают кашу на карте теней
        if (id !== 'hollow-lantern') im.castShadow = true;
        im.receiveShadow = true;
        this.scene.add(im);
        this.propSets.push({ mesh: im, mats: list, sink: 0.05 });
      }
      placed += list.length;
    }

    // Коллайдеры: радиус берём из геометрии (основание модели), чтобы ровер
    // не проезжал сквозь камень и ствол. Крона выше — под ней проезжать можно.
    let added = 0;
    for (const c of this._modelColliders || []) {
      const model = models[c.id];
      if (!model) continue;
      const r = Math.max(0.25, model.solidR * c.u * 0.85);
      this.propObstacles.push({
        pos: new THREE.Vector3(c.m.elements[12], c.m.elements[13], c.m.elements[14]),
        r, kind: c.kind, m: c.m,
      });
      added++;
    }
    this._modelColliders = [];
    if (added) this._buildGrid();

    if (placed) console.log(`[XR-7] реквизит из моделей: ${placed} шт., преград ${added}`);
    return placed;
  }

  /**
   * Опустить реквизит на новую землю после раскопок.
   * Земля рисуется и считается заново, а камни/кристаллы/деревья остаются
   * на своих матрицах — без этого они висят в воздухе над шурфом и курганом.
   */
  /** Спрятать камни в радиусе — чтобы декор не закрывал вид на механизм */
  hideRocksNear(x, z, radius) {
    this.restoreRocks();
    this._rockHide = [];
    if (!this.propSets) return 0;
    const r2 = radius * radius;
    for (const set of this.propSets) {
      if (set.kind !== 'rock' || !set.mesh) continue;
      const mesh = set.mesh;
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz > r2) continue;
        this._rockHide.push([mesh, i, m.clone()]);
        mesh.setMatrixAt(i, m.clone().scale(new THREE.Vector3(1e-4, 1e-4, 1e-4)));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    return this._rockHide.length;
  }

  /**
   * Спрятать только те камни, которые реально перекрывают вид: те, что лежат
   * между камерой и механизмом, в узком цилиндре вдоль линии взгляда.
   */
  hideRocksBlocking(cam, target, radius = 3) {
    this.restoreRocks();
    this._rockHide = [];
    if (!this.propSets) return 0;
    const ax = cam.x, az = cam.z;
    const bx = target.x, bz = target.z;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const r2 = radius * radius;
    for (const set of this.propSets) {
      if (set.kind !== 'rock' || !set.mesh) continue;
      const mesh = set.mesh;
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const t = ((p.x - ax) * dx + (p.z - az) * dz) / len2;   // проекция на луч
        if (t < 0.02 || t > 1.02) continue;                      // вне отрезка
        const px = ax + dx * t, pz = az + dz * t;
        const ox = p.x - px, oz = p.z - pz;
        if (ox * ox + oz * oz > r2) continue;                    // близко к линии
        this._rockHide.push([mesh, i, m.clone()]);
        mesh.setMatrixAt(i, m.clone().scale(new THREE.Vector3(1e-4, 1e-4, 1e-4)));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    return this._rockHide.length;
  }

  /** Вернуть камни на место */
  restoreRocks() {
    if (!this._rockHide || !this._rockHide.length) return;
    for (const [mesh, i, m] of this._rockHide) {
      mesh.setMatrixAt(i, m);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this._rockHide = [];
  }

  regroundArea(x, z, r) {
    if (!this.propSets) return 0;
    const r2 = r * r;
    let moved = 0;
    for (const set of this.propSets) {
      const { mesh, mats, from } = set;
      const sink = set.sink === undefined ? 0.3 : set.sink;
      if (!mesh || !mesh.instanceMatrix) continue;
      let dirty = false;
      for (let i = 0; i < mats.length; i++) {
        const src = from ? from[set.fromIdx ? set.fromIdx[i] : i] : mats[i];
        const e = src.elements;
        const dx = e[12] - x, dz = e[14] - z;
        if (dx * dx + dz * dz > r2) continue;
        const y = meshHeightAt(e[12], e[14]) - sink;
        if (Math.abs(y - e[13]) < 1e-3) continue;
        e[13] = y;
        if (from) mats[i].copy(src).multiply(SPORE_OFFSET);
        mesh.setMatrixAt(i, mats[i]);
        dirty = true;
        moved++;
      }
      if (dirty) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
    if (!moved) return 0;

    // коллайдеры должны ехать вместе с камнями, иначе в них «врезаешься» в воздухе
    let touched = false;
    for (const o of this.propObstacles) {
      if (!o.m) continue;
      const ny = o.m.elements[13];
      if (Math.abs(ny - o.pos.y) > 1e-3) { o.pos.y = ny; touched = true; }
    }
    if (touched) this._buildGrid();
    return moved;
  }

  /** Свободно ли место для ровера (в радиусе pad от центра) */
  isFree(x, z, pad = 1.2) {
    const list = this.grid.query({ x, y: 0, z });
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o.bump) continue;   // галька не мешает встать
      const rr = o.r + 1.1 + pad;
      const dx = o.pos.x - x, dz = o.pos.z - z;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    return true;
  }

  /** Ближайшее свободное место к точке (спираль) */
  freeSpot(x, z, pad = 1.2) {
    if (this.isFree(x, z, pad)) return [x, z];
    for (let r = 3; r <= 30; r += 2) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const nx = x + Math.cos(a) * r;
        const nz = z + Math.sin(a) * r;
        if (Math.hypot(nx, nz) > ZONE_R - 10) continue;
        if (this.isFree(nx, nz, pad)) return [nx, nz];
      }
    }
    return [x, z];
  }

  /**
   * Фазовый ключ на алтаре храма: собран кодом, как остальной реквизит —
   * слоистый камень, три кольца-регулятора и два светящихся шва между ними.
   * Модели из редактора сюда не годятся: они гладкие и выбиваются из мира.
   */
  loadPhaseCore() {
    if (!this.temple) return null;

    // пещера-святилище остаётся в коде, но сейчас скрыта: вершину занимает
    // врата из набора avaris-world-kit, а ключ стоит на её алтаре
    const vault = buildPhaseVault();
    vault.group.position.set(0, 0, 0);
    vault.group.visible = false;
    if (vault.light) vault.light.intensity = 0;
    this.temple.group.add(vault.group);
    this.phaseVault = vault;

    const core = buildPhaseCore();
    const keyY = 3.55;                  // уточняется, когда догрузится алтарь
    core.group.scale.setScalar(0.82);
    core.group.position.set(0, keyY, 0);
    const halo = glowSprite(0x9ff2e6, 8, 0.3);
    halo.position.set(0, keyY, 0);
    halo.visible = false;
    // ключ живёт в отдельной группе вершины, а не внутри скрытого храма —
    // иначе он исчезал бы вместе с ним
    this.summitKey.add(core.group, halo);
    this.temple.crystal.visible = false;
    this.temple.phaseHalo = halo;
    this.temple.phaseKeyY = keyY;
    this.phaseCore = core;
    return core;
  }

  /** Насыпь вскрыта: ключ проявляется в нище, алтарь светится ярче. */
  revealPhaseCore() {
    if (!this.phaseCore) return null;
    if (this.summitKey) this.summitKey.visible = true;
    this.phaseCore.group.visible = true;
    this.phaseRevealed = true;
    if (this.temple.phaseHalo) this.temple.phaseHalo.visible = true;
    if (this.phaseVault) this.phaseVault.light.intensity = 2.6;
    return this.phaseCore;
  }

  /** Ключ забрали: в нище пусто, свет в алтаре гаснет до тлеющего. */
  takePhaseCore() {
    if (!this.phaseCore) return null;
    this.phaseCore.group.visible = false;
    this.phaseRevealed = false;
    if (this.temple.phaseHalo) this.temple.phaseHalo.visible = false;
    if (this.phaseVault) this.phaseVault.light.intensity = 0.7;
    return null;
  }

  /** Пока насыпь не начали снимать, из горы не должно торчать ничего. */
  setTempleReveal(dig) {
    // старый процедурный храм остаётся в коде, но на вершине его больше нет:
    // вместо него вскрывается врата из набора avaris-world-kit
    if (this.temple) this.temple.group.visible = false;
    const on = dig > 0.01;
    if (this.summitRoot) this.summitRoot.visible = on;
  }

  _buildProps(rnd) {
    const balls = { rock: [], crystalCool: [], crystalToxic: [], plant: [], spore: [] };
    const cols = { rock: [], crystalCool: [], crystalToxic: [], plant: [], spore: [] };
    // точки для гало у голубых кристаллов: собираем позиции, потом один Points
    const coolGlow = [];
    // спора есть не у каждого дерева, поэтому помним, от какого дерева
    // считается каждая спора (после раскопок её надо опустить вместе с кроной)
    const sporeFrom = [];
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const tiltQ = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const mat4 = new THREE.Matrix4();
    const col = new THREE.Color();

    /* Часть растений и кристаллов — модели из набора avaris-environment.
       Их матрицы собираем отдельно: сетки появятся, когда догрузятся GLB. */
    const modelSlots = {
      'ash-fan': [], 'hollow-lantern': [], 'blind-rosette': [],
      'resonant-spar': [], 'amber-fracture': [],
    };
    let plantCount = 0, crystalCount = 0, modelCrystalCount = 0;
    const _mpos = new THREE.Vector3();
    const modelTints = {
      'ash-fan': [], 'hollow-lantern': [], 'blind-rosette': [],
      'resonant-spar': [], 'amber-fracture': [],
    };
    const _tint = new THREE.Color();
    // коллайдеры моделей появятся после загрузки GLB (радиус берётся из геометрии)
    this._modelColliders = [];
    const pushModel = (id, p, q, uniform, kind, blocks, warm = 0) => {
      // у моделей основание уже на нуле, поэтому не топим их на 0.3, как деревья.
      // Лёгкая неоднородность по осям — чтобы силуэты не были клонами
      const sx = uniform * (0.86 + rnd() * 0.28);
      const sy = uniform * (0.78 + rnd() * 0.5);
      const sz = uniform * (0.86 + rnd() * 0.28);
      _mpos.set(p.x, p.y + 0.28, p.z);
      mat4.compose(_mpos, q, scl.set(sx, sy, sz));
      const mat = mat4.clone();
      modelSlots[id].push(mat);
      // Оттенок на экземпляр: яркость ± и сдвиг в тёплый/холодный
      const w = warm + (rnd() - 0.5) * 0.18;
      const b = 0.78 + rnd() * 0.34;
      _tint.setRGB(b * (1 + w), b * (1 + w * 0.25), b * (1 - w * 0.75));
      modelTints[id].push(_tint.clone());
      if (blocks) this._modelColliders.push({ id, u: uniform, kind, m: mat });
      return mat;
    };

    const free = (p) => {
      if (onAscent(p.x,p.z) || Math.hypot(p.x+142,p.z-99)<9) return false;
      for (let i = 0; i < this.obstacles.length; i++) {
        const o = this.obstacles[i];
        const rr = o.r + 4;
        if (p.distanceToSquared(o.pos) < rr * rr) return false;
      }
      // площадка храма остаётся чистой
      for (let i = 0; i < this.reserved.length; i++) {
        const z = this.reserved[i];
        const dx = p.x - z.x, dz = p.z - z.z;
        if (dx * dx + dz * dz < z.r * z.r) return false;
      }
      return true;
    };

    for (let i = 0; i < 950; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * ZONE_R * 1.14;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;

      const bi = biomeAt(x, z);
      const cfg = PROP_CFG[bi.id];
      if (!cfg) continue;

      const total = cfg.rock + cfg.crystal + cfg.plant;
      let pick = rnd() * total;
      let kind = 'rock';
      if (pick >= cfg.rock) {
        pick -= cfg.rock;
        kind = pick < cfg.crystal ? 'crystal' : 'plant';
      }

      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const ang = rnd() * Math.PI * 2;
        const rad = 1.5 + rnd() * 4.5;
        const px = x + Math.cos(ang) * rad;
        const pz = z + Math.sin(ang) * rad;
        if (Math.hypot(px, pz) > zoneRadiusAt(px, pz) + 22) continue;
        pos.set(px, meshHeightAt(px, pz) - 0.3, pz);
        if (!free(pos)) continue;

        meshNormalAt(px, pz, _n);
        quat.setFromUnitVectors(UP, _n);
        eul.set((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5);
        tiltQ.setFromEuler(eul);
        quat.multiply(tiltQ);

        if (kind === 'rock') {
          const s = 0.5 + rnd() * 1.5;
          scl.set(s, s * (0.6 + rnd() * 0.5), s);
          // у додекаэдра центр смещён на +0.45, а низ — на −0.55 в локальных
          // единицах: поднимаем на эту величину, чтобы камень лежал на песке
          // (чуть утоплен), а не прятался в грунте до половины
          pos.setY(meshHeightAt(px, pz) + scl.y * 0.45 - 0.12);
          col.setHex(bi.rock).multiplyScalar(0.8 + rnd() * 0.45);
          mat4.compose(pos, quat, scl);
          const mat = mat4.clone();
          balls.rock.push(mat);
          cols.rock.push(col.getHex());
          // камень крупнее гальки — преграда; радиус по видимому силуэту
          // (геометрия — додекаэдр радиуса 1, масштаб по XZ = s)
          // Мелкие (s ≤ 1.2) не держат, а подбрасывают: bump = трамплин
          if (s > 0.8) {
            this.propObstacles.push({
              pos: pos.clone(), r: Math.max(0.35, s * 0.85),
              kind: 'rock', bump: s <= 1.2, m: mat,
            });
          }
        } else if (kind === 'crystal') {
          const toxic = TOXIC_BIOMES.has(bi.id);
          // зелёных (токсичных) кристаллов — заметно меньше: они ядовито-яркие
          // сами по себе, а светиться им не нужно
          if (toxic && rnd() > 0.4) continue;
          const bucket = toxic ? 'crystalToxic' : 'crystalCool';
          crystalCount++;
          // Каждый второй кристалл — модель: не добавляем новые объекты,
          // а заменяем уже стоящие. Янтарный разлом — ~40 % модельных.
          if (crystalCount % 2 === 0) {
            modelCrystalCount++;
            const id = (modelCrystalCount % 5) < 2 ? TOXIC_CRYSTAL_MODEL : COOL_CRYSTAL_MODEL;
            const cfg = ENV_MODELS[id];
            const u = cfg.scale * (0.7 + rnd() * 0.6);
            pushModel(id, pos, quat, u, 'crystal', true, id === TOXIC_CRYSTAL_MODEL ? 0.12 : -0.08);
            continue;
          }
          const s = 0.26 + rnd() * 0.5;
          scl.set(s, s * (1.5 + rnd() * 1.2), s);
          col.setHex(bi.accent).multiplyScalar(0.85 + rnd() * 0.3);
          mat4.compose(pos, quat, scl);
          const mat = mat4.clone();
          balls[bucket].push(mat);
          cols[bucket].push(col.getHex());
          // голубые кристаллы получают слабое гало, как у жёлтых осколков,
          // но вдвое тусклее; токсичные — нет, они и так ядовито-яркие
          if (bucket === 'crystalCool') coolGlow.push(pos.x, pos.y + s * 1.7, pos.z);
          // кристаллы теперь мельче, поэтому порог ниже — иначе сквозь них едут.
          // Совсем малые осколки (s < 0.45) перемахиваются, остальные держат
          if (s > 0.34) {
            this.propObstacles.push({
              pos: pos.clone(), r: Math.max(0.28, s * 0.7),
              kind: 'crystal', bump: s < 0.45, m: mat,
            });
          }
        } else {
          plantCount++;
          // каждое второе растение — модель из набора: дерево, куст или трава
          if (plantCount % 2 === 0) {
            const id = pickPlantModel(rnd);
            const cfg = ENV_MODELS[id];
            const u = cfg.scale * (0.65 + rnd() * 0.7);
            // твёрдые все: у моделей в основании камень, сквозь него не проехать
            pushModel(id, pos, quat, u, 'tree', true, (rnd() - 0.4) * 0.16);
            continue;
          }
          const w = 2.6 + rnd() * 1.8;
          scl.set(w, 3.8 + rnd() * 2.6, w);
          // лёгкий разброс оттенка на экземпляр: крона не должна быть одинаковой
          const br = 0.82 + rnd() * 0.3;
          col.setRGB(br * (0.94 + rnd() * 0.14), br * (0.94 + rnd() * 0.12), br * (0.90 + rnd() * 0.16));
          mat4.compose(pos, quat, scl);
          const mat = mat4.clone();
          balls.plant.push(mat);
          cols.plant.push(col.getHex());
          // светящаяся спора висит только над частью крон (~треть):
          // над каждым деревом это выглядело как фонари по всему полю
          if (rnd() < 0.34) {
            balls.spore.push(mat.clone().multiply(SPORE_OFFSET));
            cols.spore.push(rnd() < 0.5 ? 0xa9bdb4 : 0xc0c6a8);
            sporeFrom.push(balls.plant.length - 1);
          }
          // коллайдер — только ствол: крона высоко и не мешает
          this.propObstacles.push({ pos: pos.clone(), r: 0.30 + 0.12 * w, kind: 'tree', m: mat });
        }
      }
    }

    this._modelSlots = modelSlots;
    this._modelTints = modelTints;
    // гало — только у процедурных голубых кристаллов: модельные resonant-spar
    // светиться не должны, иначе светятся все подряд
    this._buildCrystalGlow(coolGlow);
    if (Object.values(modelSlots).some((l) => l.length > 0)) {
      loadPropModels()
        .then((models) => this._applyModelProps(models))
        .catch((e) => console.warn('[XR-7] модели реквизита не загрузились:', e));
    }

    const mk = (geo, mat, list, colors) => {
      const n = list.length;
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      for (let i = 0; i < n; i++) {
        im.setMatrixAt(i, list[i]);
        im.setColorAt(i, new THREE.Color(colors[i]));
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      return im;
    };

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    rockGeo.translate(0, 0.45, 0);
    const crystalGeo = new THREE.OctahedronGeometry(1, 0);
    crystalGeo.translate(0, 0.8, 0);
    const treeGeo = alienTreeGeometry();
    const sporeGeo = new THREE.OctahedronGeometry(0.062, 0);

    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95, metalness: 0.04 });
    const coolMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x35d0e8, emissiveIntensity: 1.3,
      flatShading: true, roughness: 0.3, metalness: 0.35,
    });
    const toxicMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x8dff4a, emissiveIntensity: 1.5,
      flatShading: true, roughness: 0.35, metalness: 0.2,
    });
    const treeMat = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05,
    });
    const sporeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x6d8a80, emissiveIntensity: 0.8,
      flatShading: true, roughness: 0.35, metalness: 0.2,
    });

    this.props = {
      rocks: mk(rockGeo, rockMat, balls.rock, cols.rock),
      cool: mk(crystalGeo, coolMat, balls.crystalCool, cols.crystalCool),
      toxic: mk(crystalGeo, toxicMat, balls.crystalToxic, cols.crystalToxic),
      trees: mk(treeGeo, treeMat, balls.plant, cols.plant),
      spores: mk(sporeGeo, sporeMat, balls.spore, cols.spore),
      materials: [coolMat, toxicMat, sporeMat],
      counts: {
        rocks: balls.rock.length,
        crystals: balls.crystalCool.length + balls.crystalToxic.length,
        trees: balls.plant.length,
      },
    };
    // списки матриц — чтобы после раскопок опустить реквизит на новую землю
    // (споры висят над кроной дерева, поэтому пересчитываются от него)
    this.propSets = [
      { mesh: this.props.rocks, mats: balls.rock, kind: 'rock' },
      { mesh: this.props.cool, mats: balls.crystalCool },
      { mesh: this.props.toxic, mats: balls.crystalToxic },
      { mesh: this.props.trees, mats: balls.plant },
      { mesh: this.props.spores, mats: balls.spore, from: balls.plant, fromIdx: sporeFrom },
    ];
    for (const k of ['rocks', 'cool', 'toxic', 'trees', 'spores']) {
      if (this.props[k].count > 0) this.scene.add(this.props[k]);
    }
    console.log(`[XR-7] реквизит: ${this.props.counts.rocks} камней, ` +
                `${this.props.counts.crystals} кристаллов, ${this.props.counts.trees} деревьев`);
  }

  /**
   * Гало голубых кристаллов: один Points на все, поэтому один draw call.
   * Яркость держим низкой (CGLOW_BASE) — это не источник света, а намёк на него.
   */
  _buildCrystalGlow(flat) {
    if (!flat || flat.length < 3) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flat), 3));
    this.crystalGlow = new THREE.Points(g, new THREE.PointsMaterial({
      map: glowTexture(), color: 0x7ce8ff, size: 3.4, transparent: true,
      opacity: CGLOW_BASE, depthWrite: false, alphaTest: 0.01,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true,
    }));
    this.crystalGlow.count = flat.length / 3;
    this.scene.add(this.crystalGlow);
  }

  /** Яркость гало голубых кристаллов: k = 1 днём, >1 в темноте */
  setCrystalGlow(k) {
    if (!this.crystalGlow) return;
    this.crystalGlow.material.opacity = CGLOW_BASE * Math.max(0, Math.min(1.6, k));
  }

  /** Яркость висящей в воздухе пыли: 0 — ночь, 1 — день.
   *  Ночью оставляем минимум (MOTE_NIGHT), чтобы гало еле читалось. */
  setMotes(k) {
    if (!this.motes) return;
    const q = Math.max(0, Math.min(1, k));
    this.motes.material.opacity = MOTE_DAY * (MOTE_NIGHT + (1 - MOTE_NIGHT) * q * q);
  }

  /** Сила зерна грунта (1 — как задумано, 0 — выключить) */
  setGrain(k) {
    const sh = this.ground && this.ground.material && this.ground.material.userData.shader;
    if (sh && sh.uniforms.uGrainAmt) sh.uniforms.uGrainAmt.value = Math.max(0, k);
    return sh ? sh.uniforms.uGrainAmt.value : null;
  }

  litCount() {
    return this.beacons.filter((b) => b.lit).length;
  }

  nextBeacon() {
    return this.beacons.find((b) => !b.lit) || null;
  }

  update(t, dt, roverPos) {
    this.time = t;
    for (const m of this.wall.layers) m.uniforms.uTime.value = t;
    if (this.stormRing && this.stormRing.group.visible) {
      for (const m of this.stormRing.layers) m.uniforms.uTime.value = t * 2.4;
    }

    for (const s of this.wall.group.children) {
      if (!s.userData.base) continue;
      const u = s.userData;
      s.position.copy(u.base);
      s.position.y += Math.sin(t * u.drift + u.phase) * 2.5;
      const push = (Math.cos(t * u.drift * 0.6 + u.phase) * 4);
      s.position.x += push;
      s.position.z += push * 0.7;
    }

    for (const s of this.haze.children) {
      const u = s.userData;
      s.position.copy(u.base);
      s.position.y += Math.sin(t * u.speed + u.phase) * 3;
      s.position.x += Math.cos(t * u.speed * 0.6 + u.phase) * 6;
      s.material.opacity = u.op * (0.6 + 0.4 * Math.sin(t * 0.5 + u.phase));
    }

    for (const b of this.beacons) {
      if (b.lit) b.litT = Math.min(1, b.litT + dt * 0.7);
      const k = b.litT;
      const pulse = 1 + Math.sin(t * 2.4 + b.index) * 0.06 * k;

      b.crystal.rotation.y += dt * (0.6 + k * 1.8);
      b.crystal.scale.setScalar(pulse * (1 + k * 0.12));
      b.crystalMat.emissiveIntensity = 0.55 + k * 2.9;
      b.crystalMat.emissive.setHex(k > 0.02 ? 0x3ad4ff : 0x1d3442);
      b.crystalMat.color.setHex(k > 0.02 ? 0x3ad4ff : 0x2f4757);

      b.ringMat.opacity = 0.12 + k * 0.88;
      b.ringMat.emissiveIntensity = k * 2.6;
      for (let i = 0; i < b.rings.length; i++) {
        const r = b.rings[i];
        r.rotation.x += dt * (0.3 + k * 1.1) * (i ? -1 : 1);
        r.rotation.y += dt * (0.25 + k * 0.8);
        r.scale.setScalar(1 + k * 0.06);
      }
      b.beamMat.opacity = 0.05 + k * 0.22 + Math.sin(t * 2 + b.index) * 0.015;
      b.glow.material.opacity = 0.12 + k * 0.7;
      b.glow.scale.setScalar(14 + k * 22);
    }

    for (const a of this.anomalies) {
      const bob = Math.sin(t * 0.9 + a.phase) * 2.2;
      a.group.position.copy(a.base);
      a.group.position.y += bob;

      a.core.rotation.y += dt * 0.9;
      a.core.rotation.x += dt * 0.55;
      for (let i = 0; i < a.rings.length; i++) {
        const r = a.rings[i];
        r.rotation.x += dt * (0.7 + i * 0.4);
        r.rotation.y += dt * (0.5 + i * 0.5);
      }
      for (const s of a.shards) {
        s.angle += dt * 1.4;
        s.mesh.position.set(
          Math.cos(s.angle) * s.radius,
          Math.sin(s.angle * 1.3 + s.tilt) * 0.8,
          Math.sin(s.angle) * s.radius
        );
        s.mesh.rotation.x += dt * 2.0;
        s.mesh.rotation.y += dt * 1.5;
      }

      const dist = a.group.position.distanceTo(roverPos);
      const prox = Math.max(0, 1 - dist / 50);
      a.boost += (prox - a.boost) * (1 - Math.exp(-4 * dt));

      const dim = a.scanned ? 0.5 : 1;
      const pulse = (1 + Math.sin(t * 2.2 + a.phase) * 0.08 + a.boost * 0.35) * dim;
      a.core.scale.setScalar(pulse);
      a.coreMat.emissiveIntensity = (1.4 + a.boost * 3.2) * dim;
      a.ringMat.emissiveIntensity = (0.9 + a.boost * 2.0) * dim;
      a.glow.material.opacity = (0.5 + a.boost * 0.4) * dim;
      a.glow.scale.setScalar((18 + a.boost * 14) * (dim * 0.5 + 0.5));
      // гало и столб дышат медленно: заметно, но не мигает
      const breathe = 1 + Math.sin(t * 0.7 + a.phase) * 0.08;
      a.aura.material.opacity = (0.10 + a.boost * 0.10) * dim * breathe;
      a.aura.scale.setScalar((54 + a.boost * 16) * breathe);
      a.column.material.opacity = (0.075 + a.boost * 0.06) * dim * breathe;

      /* Молнии: раз в несколько секунд короткий разряд из ядра в землю.
         Вдали не считаем — там всё равно не видно, а лишний шум не нужен. */
      a.nextArc -= dt;
      if (a.nextArc <= 0) {
        a.nextArc = 2.4 + Math.random() * 4.2;
        if (dist < 170) {
          a.arcLife = 0.13 + Math.random() * 0.13;
          a.arcMax = a.arcLife;
          const gy = a.groundY - a.group.position.y + 0.6;   // земля в локальных осях
          const ang = Math.random() * Math.PI * 2;
          const rr = 3 + Math.random() * 11;
          const hit = [Math.cos(ang) * rr, gy, Math.sin(ang) * rr];
          if (Math.random() < 0.22) {
            // редкий вертикальный разряд в небо — «аномалия выплёскивается»
            shapeArc(a.arcs[0].line, [0, 0, 0], [0, 26 + Math.random() * 12, 0], 2.2);
            a.arcBranch = false;
          } else {
            shapeArc(a.arcs[0].line, [0, 0, 0], hit, 1.8);
            const k = 0.4 + Math.random() * 0.3;
            const ang2 = ang + (Math.random() - 0.5) * 1.8;
            shapeArc(a.arcs[1].line,
              [hit[0] * k, hit[1] * k, hit[2] * k],
              [Math.cos(ang2) * (rr + 5), gy, Math.sin(ang2) * (rr + 5)], 1.1);
            a.arcBranch = true;
          }
        }
      }
      if (a.arcLife > 0) {
        a.arcLife = Math.max(0, a.arcLife - dt);
        const k = a.arcLife / a.arcMax;
        // мерцание: разряд дрожит, а не горит ровно
        const flick = 0.55 + Math.random() * 0.55;
        for (let i = 0; i < a.arcs.length; i++) {
          const arc = a.arcs[i];
          const on = i === 0 || a.arcBranch;
          arc.mat.opacity = on ? k * k * 0.85 * flick : 0;
          arc.line.visible = !!on && k > 0;
        }
      }
    }

    for (const s of this.shards) {
      if (s.collected) {
        s.t += dt;
        s.group.position.y += dt * 14;
        s.group.scale.setScalar(Math.max(0, 1 - s.t * 1.6));
        s.glow.material.opacity = Math.max(0, 0.6 - s.t * 1.2);
        if (s.t > 0.7) s.group.visible = false;
        continue;
      }
      s.mesh.rotation.y += dt * 1.4;
      s.mesh.position.y = 1.5 + Math.sin(t * 1.8 + s.phase) * 0.28;
      s.glow.position.y = s.mesh.position.y;
      s.glow.material.opacity = 0.4 + Math.sin(t * 3 + s.phase) * 0.14;
    }

    const v = this.vault;
    v.ring.rotation.z += dt * (v.open ? 0.5 : 0.08);
    v.ring2.rotation.z -= dt * (v.open ? 0.75 : 0.05);
    v.core.rotation.y += dt * (v.open ? 0.8 : 0.15);
    if (v.open) {
      const p = 1 + Math.sin(t * 1.7) * 0.05;
      v.core.scale.set(p, p * 1.5, p);
      v.coreMat.emissiveIntensity = 2.6;
      v.coreMat.emissive.setHex(0xffa040);
      v.coreMat.color.setHex(0xffa040);
      v.beamMat.opacity = 0.16 + Math.sin(t * 2.3) * 0.03;
      v.glow.material.opacity = 0.55 + Math.sin(t * 1.9) * 0.1;
      v.glow.scale.setScalar(46);
    } else {
      v.coreMat.emissiveIntensity = 0.5 + Math.sin(t * 1.1) * 0.1;
      v.beamMat.opacity = 0.02;
      v.glow.material.opacity = 0.10 + Math.sin(t * 1.3) * 0.04;
      v.glow.scale.setScalar(22);
    }

    /* храм на вершине: кристалл алтаря и луч */
    const tm = this.temple;
    const dug = digProgress();
    const tp = 1 + Math.sin(t * 1.5) * 0.06;
    tm.crystal.rotation.y += dt * 0.5;
    tm.crystal.position.y = 3.9 + Math.sin(t * 1.1) * 0.13;
    tm.crystal.scale.setScalar(tp);
    tm.glow.position.y = tm.crystal.position.y;
    // пока храм закопан — света почти нет, он проступает по мере раскопок
    tm.glow.material.opacity = (0.40 + Math.sin(t * 1.3) * 0.10) * (0.08 + dug * 0.92);
    tm.glow.scale.setScalar(30 + Math.sin(t * 0.9) * 3);
    tm.beam.material.opacity = (0.10 + Math.sin(t * 1.7) * 0.025) * (0.12 + dug * 0.88);
    tm.altarRing.scale.setScalar(1 + Math.sin(t * 1.5 + 1) * 0.012);

    /* история: плита, древности, шпиль и завеса */
    if (this.tablet) {
      this.tablet.marks.material.opacity = 0.5 + Math.sin(t * 1.6) * 0.22;
      this.tablet.rune.emissiveIntensity = 1.2 + Math.sin(t * 1.4) * 0.6;
      this.tablet.glow.material.opacity = 0.2 + Math.sin(t * 1.2) * 0.07;
    }
    if (this.artifactSites) {
      for (const a of this.artifactSites) {
        a.t += ((a.on ? 1 : 0) - a.t) * Math.min(1, dt * 3.5);
        const k = a.t;
        if (a.kind === 'gate' && a.left) {
          a.left.rotation.y = -k * 1.55;
          a.right.rotation.y = k * 1.55;
        } else if (a.kind === 'beacon' && a.flame) {
          a.flame.visible = k > 0.04;
          a.flame.scale.set(0.45 + k * 0.55, 0.5 + k * 0.7, 0.45 + k * 0.55);
          a.flame.material.opacity = 0.45 + k * 0.5;
          a.fglow.material.opacity = k * 0.6;
          a.flight.intensity = k * 120;
        } else if (a.kind === 'lift' && a.platform) {
          const lowY = a.lowY ?? 0.85;
          const range = a.range || 3.6;
          a.platform.position.y = lowY + k * range;
          // груз идёт в противофазе: кабина поднялась — глыба опустилась
          if (a.counter) a.counter.position.y = (a.counterLow ?? lowY) + (1 - k) * range;
          // тросы пересчитываются: от ролика балки до кабины и до груза
          if (a.ropes) {
            const top = a.pulleyY ?? 7.75;
            const yCabin = a.platform.position.y + 2.3;
            const yCounter = (a.counter ? a.counter.position.y : 2) + 1.0;
            for (const r of a.ropes) {
              const y2 = r.userData.role === 'counter' ? yCounter : yCabin;
              r.scale.y = Math.max(0.08, top - y2);
              r.position.y = (top + y2) / 2;
            }
          }
        }
        // пломба приоткрывается вместе с состоянием: ободок светится сильнее
        if (a.rim && a.rim.material) {
          a.rim.material.emissiveIntensity = 0.45 + k * 0.55 + Math.sin(t * 1.6 + a.pos.x) * 0.12;
        }
      }
    }
    /* схроны с манускриптами: пока не раскопаны — их вообще не видно (закопаны) */
    if (this.scrollCaches) {
      for (const c of this.scrollCaches) {
        const want = c.dug || 0;
        // ларёк лежит в выкопанной яме и НЕ выезжает из земли: землю снимаем
        // шурфом, самого его не двигаем
        c.group.position.y = c.baseY - 0.86;
        c.group.visible = want > 0.12;
        c.lid.rotation.x = -Math.max(0, (want - 0.62) / 0.38) * 1.9;
        c.plate.visible = want > 0.55;
        c.plate.material.opacity = Math.min(0.9, Math.max(0, (want - 0.55) / 0.45) * 1.2);
        c.glow.intensity = Math.max(0, want - 0.5) * 16;
        c.glow.position.y = 0.8;
      }
    }

    if (v.tip) {
      v.tip.rotation.y += dt * 0.6;
      v.tipMat.emissiveIntensity = 1.5 + Math.sin(t * 2.2) * 0.5;
    }
    if (v.barrierMat) {
      const want = this.barrierOpen ? 0 : 1 - (this.transmission || 0) / 100;
      const ease = Math.min(1, dt * 1.6);
      v.barrierMat.opacity += (0.26 * want - v.barrierMat.opacity) * ease;
      v.barrierWire.material.opacity += (0.28 * want - v.barrierWire.material.opacity) * ease;
      v.barrier.visible = v.barrierWire.visible = v.barrierMat.opacity > 0.004;
      v.barrierWire.rotation.y += dt * 0.05;
    }
  }
}

export { BIOMES, ZONE_R, WORLD_SIZE };
