import {animateDeparture,departureDuration} from './lander.js';
import {createEpilogue} from './epilogue.js';
import {LANDING_SITE} from './terrain.js';
import {showDigPanel} from './dig-panel.js';
import {templeReport} from './excavation.js';
import {ASCENT} from './terrain.js';
import {newResonance,stepResonance} from './resonance.js';
/* ============================================================================
   АВАРИС · «По ту сторону бури» — игровой слой.
   Состояние истории живёт в js/story.js (чистая логика, проверяется в node).
   Здесь: мир, камера, ввод, интерфейс, миниигры, карта, журнал, сейвы.
   ========================================================================== */
import * as THREE from 'three';
import { World, buildPhaseCore } from './world.js';
import { Rover } from './rover.js';
import { GroundMotes, StormDebris } from './motes.js';
import { TANGUT, TANGUT_FONT, TANGUT_LINE, TANGUT_ORDER } from './tangut.js';
import {
  meshHeightAt, heightAt, biomeAt, ZONE_R, FOG_START, FOG_HARD, TEMPLE, MOUND_R,
  digProgress, setDig, zoneBulge,
  addHandDig, setHandDigGrow, restoreHandDigs, clearHandDigs, HAND_DIG_COST,
} from './terrain.js';
import * as STORY from './story.js';
import { setSkyEnvFactor } from './sky-env.js';
import { EffectComposer } from '../vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/postprocessing/ShaderPass.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const P = STORY.buildPoints();

/* Тихий режим: открывать ?mute=1 — игра запускается без звука вообще
   (ни эффектов, ни музыки). Нужно для отладки и для тихой демонстрации.
   В остальных случаях звук ВСЕГДА включён при старте (сохранённый выбор
   прошлой сессии не берём: игра должна звучать по умолчанию).
   В самой игре звук переключается клавишей N. */
const MUTED_PARAM = /(?:^|[?&#])mute(?:=(?:1|true|on))?(?:$|[&#])/i.test(location.search + location.hash);
let muted = MUTED_PARAM;
// вычищаем старую сохранённую галочку «без звука»: звук по умолчанию ВКЛЮЧЁН
try { localStorage.removeItem('avaris.muted'); } catch { /* приватный режим */ }

/** Включить/выключить весь звук: эффекты, ветер и музыка */
function setMuted(on) {
  muted = !!on;
  if (audio.master) audio.master.gain.value = muted ? 0 : 0.42;
  if (MUSIC.el) MUSIC.el.muted = muted;
  if (!muted) audio.resume();
  return muted;
}

function toggleSound() {
  const on = setMuted(!muted);
  toast(on ? 'Звук выключен · N' : 'Звук включён · N');
}

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

/* =============================================================== РЕНДЕРЕР */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// 1.5 вместо 1.75: на Retina это разница в 1.36× меньше пикселей на кадр
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// мягкие тени от солнца: теней в игре не было вообще и всё выглядело плоским
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a121c);
scene.fog = new THREE.FogExp2(0x8ba1b2, 0.0034);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.5, 9000);
/** Базовый угол обзора: миниигры временно сужают его под свои кадры */
const CAM_FOV = 58;

/* ============================================================ ПОСТОБРАБОТКА
   Bloom нужен, чтобы настоящие источники (кристаллы, фара, маяки, споры)
   светились, а не были просто светлыми пятнами. Виньетка и мелкое зерно —
   чтобы картинка читалась как камера, а не как плоская заливка.
   Ловушка: у composer MSAA не включается сам — рендер-таргет делаем с
   samples: 4 и HalfFloat (иначе bloom отсчитывается по 8-битным цветам и
   даёт грязные кромки). */
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
    type: THREE.HalfFloatType, samples: 4,
  }),
);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  0.38,   // strength — сколько подмешивать
  0.55,   // radius
  0.92,   // threshold: ниже него ничего не светится (тонмапленные цвета 0…1)
);
composer.addPass(bloom);
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.5 },
    uSat: { value: 1.05 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSat;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      float v = smoothstep(0.78, 0.30, length(vUv - 0.5));
      c.rgb *= mix(1.0, v, uVignette);
      gl_FragColor = c;
      // Ловушка: сцена рисуется в таргет, где нет перевода в sRGB —
      // без этого include весь кадр выглядит в разы темнее, чем без composer
      #include <colorspace_fragment>
    }`,
});
composer.addPass(gradePass);

/* ================================================================== СВЕТ */
const SUN_DIR = new THREE.Vector3(0.45, 0.30, 0.84).normalize();
const hemi = new THREE.HemisphereLight(0xa8c6e0, 0x2b2f2a, 0.95);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0x5a6b78, 0.75);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
sun.position.copy(SUN_DIR).multiplyScalar(900);
// Теневую камеру держим маленькой и водим за ровером: карта 2048 на куб
// 140×140 м даёт ~7 см на тексель. На всю планету (500 м) было бы мыло.
sun.castShadow = true;
const SHADOW_R = 70;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -SHADOW_R;
sun.shadow.camera.right = SHADOW_R;
sun.shadow.camera.top = SHADOW_R;
sun.shadow.camera.bottom = -SHADOW_R;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 520;
sun.shadow.bias = -0.0006;      // без этого плоская земля «затеняет» сама себя
sun.shadow.normalBias = 0.05;   // и без него на склонах зубчатая кайма
scene.add(sun);
scene.add(sun.target);

const moon = new THREE.DirectionalLight(0x7d9bd6, 0.85);
moon.position.copy(SUN_DIR).multiplyScalar(-900);
scene.add(moon);

const fill = new THREE.DirectionalLight(0x5a8cd8, 0.45);
fill.position.copy(SUN_DIR).multiplyScalar(-600).setY(200);
scene.add(fill);

/* ======================================= СУТКИ: свет = часы на этой планете
   Прогресс p: 0 — предрассветная тьма, 1 — полдень, когда буря закрывает зону.
   Каждый ключ — полный набор: солнце, луна, полусфера, заполняющий свет,
   цвет и плотность дымки, цвета неба, звёзды, отражения моделей и фара.
   Между ключами всё линейно, поэтому рассвет идёт без скачков. */
const DAY_KEY = [
  { p: 0.00, sun: 0.00, sunC: 0x50749c, moon: 1.05, hemi: 0.34, hemiC: 0x2a3d55, gndC: 0x0d1114,
    amb: 0.30, ambC: 0x33465c, fill: 0.18, fogC: 0x16212e, fogD: 0.0052,
    top: 0x03060c, mid: 0x0a1521, hor: 0x223446, stars: 0.95, env: 0.22, head: 1.00 },
  { p: 0.11, sun: 0.05, sunC: 0x6a6a8a, moon: 0.82, hemi: 0.42, hemiC: 0x3a5473, gndC: 0x141a1e,
    amb: 0.36, ambC: 0x44546a, fill: 0.24, fogC: 0x22303f, fogD: 0.0047,
    top: 0x060b14, mid: 0x152435, hor: 0x3b4f63, stars: 0.62, env: 0.36, head: 0.95 },
  { p: 0.21, sun: 1.30, sunC: 0xff9a52, moon: 0.28, hemi: 0.62, hemiC: 0x8fb0c8, gndC: 0x2a2620,
    amb: 0.52, ambC: 0x6a5f5a, fill: 0.32, fogC: 0x6b6a72, fogD: 0.0042,
    top: 0x1a2a44, mid: 0x4a4a63, hor: 0xb5825a, stars: 0.12, env: 0.66, head: 0.45 },
  { p: 0.34, sun: 2.40, sunC: 0xffd7a8, moon: 0.18, hemi: 0.90, hemiC: 0xa8c6e0, gndC: 0x2b2f2a,
    amb: 0.70, ambC: 0x5a6b78, fill: 0.42, fogC: 0x8ba1b2, fogD: 0.0038,
    top: 0x21476b, mid: 0x6f95b5, hor: 0xc7d3da, stars: 0.00, env: 0.92, head: 0.00 },
  { p: 0.55, sun: 2.70, sunC: 0xfff0d8, moon: 0.12, hemi: 0.95, hemiC: 0xa8c6e0, gndC: 0x2b2f2a,
    amb: 0.75, ambC: 0x5a6b78, fill: 0.45, fogC: 0x8ba1b2, fogD: 0.0034,
    top: 0x2e6394, mid: 0x7ba1c1, hor: 0xd0dbe0, stars: 0.00, env: 1.00, head: 0.00 },
  { p: 1.00, sun: 1.55, sunC: 0xffe0b8, moon: 0.10, hemi: 0.80, hemiC: 0x9d9a90, gndC: 0x2a2822,
    amb: 0.70, ambC: 0x6a655c, fill: 0.40, fogC: 0x9a9186, fogD: 0.0050,
    top: 0x2b3a46, mid: 0x6b6a63, hor: 0xb3a99a, stars: 0.00, env: 0.86, head: 0.18 },
  // дальше — если ахолы отодвинули бурю за полдень: день идёт своим чередом
  { p: 1.40, sun: 2.20, sunC: 0xffe8c8, moon: 0.10, hemi: 0.85, hemiC: 0xb9c9cf, gndC: 0x332e26,
    amb: 0.68, ambC: 0x6f6c62, fill: 0.38, fogC: 0x9d9a90, fogD: 0.0040,
    top: 0x2c5a86, mid: 0x86a3b6, hor: 0xd8d2c2, stars: 0.00, env: 0.95, head: 0.00 },
  { p: 2.00, sun: 1.10, sunC: 0xff8a4a, moon: 0.20, hemi: 0.55, hemiC: 0x8a7f8c, gndC: 0x2a2018,
    amb: 0.50, ambC: 0x6a5450, fill: 0.30, fogC: 0x8a6a58, fogD: 0.0044,
    top: 0x1b2540, mid: 0x4a4460, hor: 0xc07a4e, stars: 0.12, env: 0.70, head: 0.35 },
];
const HEAD_INTENSITY = 300;
const _dc1 = new THREE.Color();
const _dc2 = new THREE.Color();
const _mixC = (out, a, b, k) => out.copy(_dc1.setHex(a)).lerp(_dc2.setHex(b), k);
let fogDay = 0.0034;              // дневная плотность дымки; задаётся в applyDaylight
let dayP = -1;                    // применённый прогресс суток

function applyDaylight(p) {
  const q = clamp(p, 0, 2);      // 0 — ночь, 1 — полдень, 2 — закат
  let i = 0;
  while (i < DAY_KEY.length - 2 && q > DAY_KEY[i + 1].p) i++;
  const a = DAY_KEY[i], b = DAY_KEY[i + 1];
  const k = b.p === a.p ? 0 : clamp((q - a.p) / (b.p - a.p), 0, 1);
  const lerp = (x, y) => x + (y - x) * k;

  sun.intensity = lerp(a.sun, b.sun);
  _mixC(sun.color, a.sunC, b.sunC, k);
  moon.intensity = lerp(a.moon, b.moon);
  hemi.intensity = lerp(a.hemi, b.hemi);
  _mixC(hemi.color, a.hemiC, b.hemiC, k);
  _mixC(hemi.groundColor, a.gndC, b.gndC, k);
  ambient.intensity = lerp(a.amb, b.amb);
  _mixC(ambient.color, a.ambC, b.ambC, k);
  fill.intensity = lerp(a.fill, b.fill);
  _mixC(scene.fog.color, a.fogC, b.fogC, k);
  fogDay = lerp(a.fogD, b.fogD);

  const u = world.sky.material.uniforms;
  _mixC(u.uTop.value, a.top, b.top, k);
  _mixC(u.uMid.value, a.mid, b.mid, k);
  _mixC(u.uHorizon.value, a.hor, b.hor, k);
  const starAmt = lerp(a.stars, b.stars);
  world.stars.material.opacity = starAmt;
  // пыль в воздухе — только днём: ночью аддитивные точки светятся сами и мешают
  world.setMotes(1 - starAmt);
  // гало голубых кристаллов в темноте читается сильнее, днём — еле-еле
  world.setCrystalGlow(1 + starAmt * 0.5);

  // отражения в материалах моделей идут вместе со светом (см. sky-env.js)
  setSkyEnvFactor(lerp(a.env, b.env, k));
  // ночью фара — единственный ориентир, днём она не нужна
  if (rover.headlight) rover.headlight.intensity = HEAD_INTENSITY * lerp(a.head, b.head);
  dayP = q;
}

let shadowsEnabled = true;

/* ------------------------------------------------- АВТО-КАЧЕСТВО
   Машина греется на ноутбуке, поэтому включаем «второй режим» сами:
   если средний fps за 1.2 с падает ниже 42 — снимаем bloom, тень до 1024
   и пиксель-рейшо до 1.0; если держится выше 56 — возвращаем обратно.
   Гистерезис нужен, иначе качество будет дёргаться на каждом кадре. */
const QUALITY_BASE_RATIO = 1.5;
let lowQuality = false;
let autoQuality = true;
let motes = null;            // частицы земли (создаются после мира)
let debris = null;           // пыль финала: мусор в воздухе перед белизной
let qFrames = 0, qTime = 0;

function applyQuality() {
  const ratio=lowQuality ? Math.min(devicePixelRatio,.85) : Math.min(devicePixelRatio, QUALITY_BASE_RATIO);
  renderer.setPixelRatio(ratio);
  composer.setPixelRatio(ratio);
  bloom.enabled = !lowQuality;
  const size = lowQuality ? 1024 : 1536;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
  if (motes) motes.setQuality(lowQuality);
  if (debris) debris.setQuality(lowQuality);
}

function adaptQuality(dt) {
  if (!autoQuality || !(dt > 0)) return;
  qFrames++;
  qTime += dt;
  if (qTime < 1.2) return;
  const fps = qFrames / qTime;
  qFrames = 0; qTime = 0;
  if (!lowQuality && fps < 42) { lowQuality = true; applyQuality(); }
  else if (lowQuality && fps > 56) { lowQuality = false; applyQuality(); }
}

/**
 * Теневая камера живёт вокруг ровера: двигаем и свет, и его цель вместе с ним.
 * Вызывать раз в кадр после обновления позиции ровера.
 */
function updateSunShadow() {
  const p = rover.pos;
  sun.target.position.set(p.x, p.y, p.z);
  sun.position.set(p.x + SUN_DIR.x * 200, p.y + SUN_DIR.y * 200, p.z + SUN_DIR.z * 200);
  sun.target.updateMatrixWorld();
  // на ночной стороне солнце выключено — тени от него всё равно не видно
  sun.castShadow = shadowsEnabled && sun.intensity > 0.35;
}

/** Раз в кадр: подтянуть свет к текущему времени суток */
function updateDaylight() {
  const p = STORY.skyProgress(state);
  if (Math.abs(p - dayP) > 0.0005 || dayP < 0) applyDaylight(p);
}

const poiLight = new THREE.PointLight(0x66ddff, 0, 90, 2);
scene.add(poiLight);

/* ================================================================= МИР */
// Шрифт тангутских знаков грузим ДО построения мира: таблички и механизмы
// рисуются в canvas, а canvas не умеет ждать @font-face — иначе в текстуру
// запекутся пустые прямоугольники (tofu), и они останутся навсегда.
// Поэтому создаём FontFace руками: его load() резолвится, когда данные
// реально готовы к отрисовке.
try {
  const first = Array.from(TANGUT_LINE)[0] || ' ';
  if (!document.fonts.check(`190px ${TANGUT_FONT}`, first)) {
    const face = new FontFace(TANGUT_FONT, 'url("assets/fonts/NotoSerifTangut.woff2")');
    await face.load();
    document.fonts.add(face);
  }
  await document.fonts.ready;
  // контрольная проверка: наш шрифт рисует знак не так, как «пустой» Georgia
  const ink = (font) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(first, 32, 34);
    const d = g.getImageData(0, 0, 64, 64).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
    return n;
  };
  if (ink(`190px ${TANGUT_FONT}, serif`) === ink('190px Georgia, serif')) {
    console.warn('[XR-7] тангутский шрифт не применился — знаки будут пустыми');
  }
} catch (e) {
  console.warn('[XR-7] шрифт тангутских знаков не загрузился:', e);
}
const world = new World(scene);
const rover = new Rover(scene);
// частицы земли вокруг машины: один пул, один draw call
motes = new GroundMotes(scene);
motes.setQuality(lowQuality);
// мусор, который несёт буря в самом финале: появляется до полной белизны
debris = new StormDebris(scene);
debris.setQuality(lowQuality);
rover.placeAt(-142, 99, [TEMPLE.x, TEMPLE.z]);

/* ================================================================ ЗВУК */
const audio = {
  ctx: null, master: null, engineGain: null, engine: [], windGain: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = muted ? 0 : 0.42;
    this.master.connect(this.ctx.destination);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 260;
    this.engineFilt = filt;
    this.engineGain.connect(filt);
    filt.connect(this.master);
    for (const [f, d] of [[46, 0], [69, 1.5]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(this.engineGain);
      o.start();
      this.engine.push(o);
    }

    // ветер великой бури: белый шум через низкий фильтр
    const len = this.ctx.sampleRate * 3;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.05;
    noise.connect(lp); lp.connect(this.windGain); this.windGain.connect(this.master);
    noise.start();

    // браузер мог завести контекст «на паузе» до первого действия — будим
    this.resume();

    // песок под колёсами: тот же шум, но узкой полосой и тише
    const roll = this.ctx.createBufferSource();
    roll.buffer = buf;
    roll.loop = true;
    const rf = this.ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 900;
    rf.Q.value = 0.7;
    this.rollFilt = rf;
    this.rollGain = this.ctx.createGain();
    this.rollGain.gain.value = 0;
    roll.connect(rf); rf.connect(this.rollGain); this.rollGain.connect(this.master);
    roll.start();
  },

  /** Разбудить звук после блокировки автозапуска браузером */
  resume() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => { /* ждём следующего клика */ });
    }
  },

  /* ---------------------------------------------- библиотека звуков */
  /** Один буфер белого шума на все эффекты */
  _noiseBuf() {
    if (this.noiseBuf) return this.noiseBuf;
    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  },

  /** Шумовой всплеск через фильтр — основа скрежета, песка, треска */
  burst(dur = 0.2, opts = {}) {
    if (!this.ctx) return;
    const {
      freq = 1200, q = 1, type = 'bandpass', vol = 0.2, slideTo = null, delay = 0,
    } = opts;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + Math.min(0.03, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0, Math.random() * 1.2);
    src.stop(t0 + dur + 0.06);
  },

  /** Шипение песка под колёсами — громкость и тон от скорости */
  setRoll(speed) {
    if (!this.ctx || !this.rollGain) return;
    const t = this.ctx.currentTime;
    const sp = Math.abs(speed || 0);
    const k = Math.min(1, sp / 20);
    this.rollGain.gain.setTargetAtTime(Math.max(0, (sp - 1.2) / 20) * 0.085, t, 0.14);
    this.rollFilt.frequency.setTargetAtTime(650 + k * 1700, t, 0.14);
  },

  /** Врата: металл расходится */
  clank() {
    this.tone(190, 0.12, 'square', 0.09, 120);
    this.tone(285, 0.16, 'square', 0.055, 170, 0.012);
    this.burst(0.2, { freq: 2400, q: 0.9, vol: 0.15 });
  },

  /** Наехали на гальку: глухой толчок и хруст камня под колесом */
  bumpStone(power = 1) {
    this.tone(88 + power * 46, 0.10, 'sine', 0.04 + power * 0.06, 52);
    this.burst(0.13, { freq: 2400 + power * 1300, q: 1.5, vol: 0.04 + power * 0.07 });
    this.burst(0.09, { freq: 620, q: 0.8, type: 'lowpass', vol: 0.05 + power * 0.05, delay: 0.01 });
  },

  /** Жёсткий удар о камень/кристалл: лязг, скрежет, низкий удар */
  impact(power = 1) {
    const k = Math.min(1, Math.max(0.2, power));
    this.tone(72, 0.26, 'square', 0.10 * k, 40);
    this.tone(146, 0.16, 'sawtooth', 0.05 * k, 88, 0.015);
    this.burst(0.34, { freq: 1700, q: 0.8, vol: 0.11 * k, slideTo: 460 });
    this.burst(0.16, { freq: 3400, q: 2.6, vol: 0.06 * k, delay: 0.02 });
    this.burst(0.42, { freq: 120, q: 0.7, type: 'lowpass', vol: 0.13 * k });
  },

  /** Очаг: вспышка и потрескивание */
  fire() {
    this.burst(0.45, { freq: 900, q: 0.7, type: 'highpass', vol: 0.12 });
    this.tone(110, 0.4, 'sine', 0.07, 70);
    for (let i = 0; i < 5; i++) {
      this.burst(0.05, { freq: 2600, q: 2, vol: 0.045, delay: 0.08 + i * 0.1 });
    }
  },

  /** Противовес: скрип древних тросов */
  creak() {
    this.tone(240, 0.7, 'sawtooth', 0.045, 95);
    this.tone(360, 0.5, 'triangle', 0.03, 150, 0.05);
    this.burst(0.5, { freq: 500, q: 3, vol: 0.06 });
  },

  /** Находка в грунте: тихий звон и шорох земли */
  unearth() {
    this.tone(1180, 0.35, 'triangle', 0.09);
    this.tone(1770, 0.5, 'sine', 0.055, null, 0.06);
    this.burst(0.32, { freq: 3200, q: 1.2, vol: 0.06 });
  },

  /** Низкий рокот земли (вскрышные работы, гибель мира) */
  rumble(dur = 1.2, vol = 0.12) {
    this.tone(62, dur, 'sine', vol, 40);
    this.burst(dur, { freq: 150, q: 0.6, type: 'lowpass', vol: vol * 0.8 });
  },

  /** Щелчок интерфейса */
  ui() {
    this.tone(1250, 0.05, 'sine', 0.045);
    this.burst(0.04, { freq: 4200, q: 2, vol: 0.018 });
  },

  /** Короткий отказ: «так нельзя» */
  deny() { this.tone(210, 0.16, 'square', 0.05, 150); },

  /** Завеса расходится */
  whoosh() {
    this.burst(1.2, { freq: 260, q: 0.5, type: 'lowpass', vol: 0.16, slideTo: 2800 });
    this.tone(70, 1.0, 'sine', 0.06, 120);
  },

  /** Искра ахолы */
  spark() {
    this.burst(0.3, { freq: 2800, q: 1.5, vol: 0.09 });
    this.tone(880, 0.22, 'triangle', 0.05, 1320);
  },

  /* ---------------------- звук гибели мира: рёв, давление, треск, белый звон */
  deathStart() {
    if (!this.ctx || this.death) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5, now + 1.6);
    g.connect(this.master);

    // суб-гул земли
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 34;
    const subG = ctx.createGain();
    subG.gain.value = 0.35;
    sub.connect(subG); subG.connect(g); sub.start();

    // рёв бури
    const roar = ctx.createBufferSource();
    roar.buffer = this._noiseBuf();
    roar.loop = true;
    const roarF = ctx.createBiquadFilter();
    roarF.type = 'lowpass';
    roarF.frequency.value = 240;
    roarF.Q.value = 0.6;
    const roarG = ctx.createGain();
    roarG.gain.value = 0.35;
    roar.connect(roarF); roarF.connect(roarG); roarG.connect(g); roar.start();

    // нарастающее давление
    const rise = ctx.createOscillator();
    rise.type = 'triangle';
    rise.frequency.value = 110;
    const riseG = ctx.createGain();
    riseG.gain.value = 0.02;
    rise.connect(riseG); riseG.connect(g); rise.start();

    this.death = { g, sub, subG, roar, roarF, roarG, rise, riseG, crack: 0.6 };
  },

  /** k — фаза гибели 0..1 */
  deathUpdate(k) {
    const d = this.death;
    if (!d) return;
    const t = this.ctx.currentTime;
    d.roarF.frequency.setTargetAtTime(240 + k * 2600, t, 0.3);   // рёв светлеет
    d.roarG.gain.setTargetAtTime(0.3 + k * 0.35, t, 0.3);
    d.sub.frequency.setTargetAtTime(34 + k * 16, t, 0.4);        // земля гудит выше
    d.subG.gain.setTargetAtTime(0.3 + k * 0.4, t, 0.3);
    d.rise.frequency.setTargetAtTime(110 + k * 330, t, 0.3);     // давление растёт
    d.riseG.gain.setTargetAtTime(0.015 + k * 0.055, t, 0.3);

    // обломки: чем ближе стена, тем чаще
    d.crack -= 1 / 60;
    if (d.crack <= 0 && k > 0.2) {
      d.crack = Math.max(0.12, 0.85 - k * 0.7) + Math.random() * 0.35;
      this.burst(0.07 + Math.random() * 0.1, {
        freq: 600 + Math.random() * 1800, q: 1.4, vol: 0.03 + k * 0.05,
      });
    }
  },

  /** Всё смолкает, остаётся только белый звон в ушах */
  deathStop() {
    const d = this.death;
    if (!d) return;
    const t = this.ctx.currentTime;
    d.g.gain.setTargetAtTime(0.0001, t, 0.22);
    this.tone(5400, 3.4, 'sine', 0.05, 4200);
    this.tone(7200, 2.6, 'sine', 0.024, 6000, 0.06);
    setTimeout(() => this.deathKill(), 1600);
  },

  deathKill() {
    const d = this.death;
    if (!d) return;
    this.death = null;
    try {
      d.sub.stop(); d.roar.stop(); d.rise.stop();
      d.g.disconnect();
    } catch { /* уже остановлено */ }
  },

  /** Долгий аккорд финала — не обрывается, а растворяется */
  endPad() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (const [f, del] of [[130.81, 0], [196, 0.18], [261.63, 0.34], [329.63, 0.52]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      const start = t0 + del;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.055, start + 1.4);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 8);
      o.connect(g); g.connect(this.master);
      o.start(start); o.stop(start + 8.2);
    }
    this.burst(2.2, { freq: 300, q: 0.6, type: 'lowpass', vol: 0.05 });
  },
  setEngine(speed, boosting) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = Math.abs(speed || 0);
    // на стоянке двигатель молчит: плавный вход от 0.4 до 3 м/с
    const gate = Math.min(1, Math.max(0, (sp - 0.4) / 2.6));
    const fast = Math.min(1, sp / 23);              // 23 — максимум на форсаже
    const target = gate * (0.008 + Math.pow(fast, 0.85) * 0.105 + (boosting ? 0.025 : 0));
    this.engineGain.gain.setTargetAtTime(target, t, 0.12);
    if (this.engineFilt) {
      this.engineFilt.frequency.setTargetAtTime(240 + fast * 700, t, 0.15);
    }
    this.engine[0].frequency.setTargetAtTime(38 + sp * 2.9, t, 0.1);
    this.engine[1].frequency.setTargetAtTime(57 + sp * 3.7, t, 0.1);
  },
  setStorm(level, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(active ? 0.04 + level * 0.22 : 0.01, t, 0.4);
  },
  tone(freq, dur, type = 'sine', vol = 0.15, slideTo = null, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  pickup() { this.tone(880, 0.12, 'triangle', 0.13); this.tone(1320, 0.16, 'triangle', 0.10, null, 0.07); },
  word() { this.tone(520, 0.25, 'triangle', 0.12); this.tone(780, 0.3, 'triangle', 0.1, null, 0.1); },
  ahola() { [392, 523.25, 659.25].forEach((f, i) => this.tone(f, 1.1, 'triangle', 0.1, null, i * 0.1)); },
  stage() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 1.5, 'sine', 0.1, null, i * 0.09)); },
  crash() { this.tone(90, 0.18, 'square', 0.06, 50); },
  dig(ok) { ok ? this.tone(150, 0.06, 'square', 0.05) : this.tone(70, 0.1, 'sawtooth', 0.04, 40); },
  fail() { this.tone(160, 1.2, 'sawtooth', 0.12, 60); },
};

/* Браузер разрешает звук только после действия игрока: будим контекст
   на первом же клике или клавише, чтобы эффекты не оказались «немыми» */
addEventListener('pointerdown', () => audio.resume(), { once: true });
addEventListener('keydown', () => audio.resume(), { once: true });

/* ================================================================= МУЗЫКА */
/* Один восьмиминутный трек на всю экспедицию. В файле уже вшито плавное
   затухание (последние 12 с), а здесь дополнительно гасим его на последних
   секундах, приглушаем на паузе и мягко уводим в тишину на финале — чтобы
   ничего не обрывалось. */
const MUSIC = {
  src: 'assets/music/avaris-theme.mp3',
  el: null,
  base: 0.36,          // рабочая громкость
  fadeIn: 3,           // секунд мягкого входа
  tail: 6,             // за сколько секунд до конца гасим средствами игры
  level: 1,            // плавный «общий» уровень (0 — тишина)
  target: 1,
  dead: false,         // мир погиб — музыка больше не вернётся
  ready: false,

  init() {
    if (this.el) return this.el;
    this.el = new Audio(this.src);
    this.el.preload = 'auto';
    this.el.loop = false;
    this.el.volume = 0;
    this.el.muted = muted;          // тихий режим: трек не звучит совсем
    this.el.addEventListener('ended', () => {
      // трек кончился, а экспедиция ещё идёт (ахолы продлили бурю) — едем дальше
      if (mode === 'explore') { this.el.currentTime = 0; this.play(); }
    });
    this.ready = true;
    return this.el;
  },

  play() {
    const el = this.init();
    el.volume = 0;
    const p = el.play();
    if (p && p.catch) p.catch(() => { /* автозапуск запрещён — не беда */ });
  },

  restart() {
    const el = this.init();
    this.dead = false;
    this.target = 1;
    this.level = 0;
    try { el.currentTime = 0; } catch { /* ещё не загрузился */ }
    this.play();
  },

  /** Оборвать насовсем (гибель мира): дальше музыка уже не вернётся */
  kill() {
    this.dead = true;
    this.target = 0;
  },

  /** Мгновенная тишина для меню: трек встаёт на паузу с того же места.
      Вернулись в игру — update() плавно поднимет его обратно. */
  suspend() {
    this.target = 0;
    this.level = 0;
    const el = this.el;
    if (!el) return;
    el.volume = 0;
    if (!el.paused) el.pause();
  },

  /**
   * Музыка звучит РОВНО столько, сколько идёт таймер бури: пока время капает,
   * трек играет; в диалогах, минииграх, на карте и на паузе время стоит —
   * музыка плавно уходит в тишину и ставится на паузу с того же места.
   */
  update(dt) {
    if (!this.dead) this.target = STORY.stormRuns(mode) ? 1 : 0;

    // общий уровень плавно идёт к цели — нигде нет обрыва
    this.level += (this.target - this.level) * Math.min(1, dt / 0.8);

    const el = this.el;
    if (!el) return;
    if (this.dur === undefined) this.dur = 0;

    // тишина: ставим трек на паузу, чтобы он ждал вместе с таймером
    if (this.level < 0.01) {
      el.volume = 0;
      if (!el.paused) el.pause();
      return;
    }
    if (el.paused) {
      if (this.target > 0.5) {
        const p = el.play();
        if (p && p.catch) p.catch(() => { /* ждём клика */ });
      } else if (!this.dead) {
        return;
      }
    }

    const dur = el.duration || 468.8;
    const t = el.currentTime;
    const left = dur - t;

    let v = this.base * this.level;
    if (t < this.fadeIn) v *= t / this.fadeIn;                // мягкий вход
    if (left < this.tail) v *= Math.max(0, left / this.tail); // мягкий уход
    el.volume = Math.max(0, Math.min(1, v));
  },
};

/* ================================================================ ТЕКСТЫ */
const STORY_TEXT = {
  intro:
    '2132 год. Аварис — планета, чей сигнал повторяет всплески, которые ловили ещё ' +
    'примитивные антенны Земли. На поверхность вышли трое: археолог Мира, физик Лев ' +
    'и бортинженер Нина. «Одиссей» ждёт на орбите. И где-то здесь идёт Великая буря.',
  fog: "Стоп! Дальше буря слишком плотная — она царапает обшивку. Пять метров, не больше.",
  repair: "Обшивка не выдержала. Я заварила пробоины — но больше так не подставляйся.",
  digDone: "Готово. Слои расходятся, словно лепестки Сиренума. Ни следа коррозии.",
  artifact: "Фазовый ключ. Его слои — не украшение: это регуляторы энергии. Он откликается на импульсы к востоку от храма — к порогу резонанса.",
  signalDone: "Резонанс достигнут. Завеса расходится — по ту сторону стоят руины.",
  ahola: "Ахола. Древний буфер: активируешь его — и буря отступает. Каждый работает лишь единожды.",
  aholaLocked: "Ахола молчит: без следующего этапа расследования мы не знаем, как её активировать.",
  tabletLocked: (n) => `Переводчик не знает слов: нужно ещё ${n}.`,
  core: 'Мы у самых развалин. Шпиль уходит в небо и держит завесу.',
};

/* ================================================================ СОСТОЯНИЕ */
let state = STORY.freshState();
let mode = 'menu';
let navTarget = null;
let saveTimer = 0;
let nearHint = null;
const ui = {};

/* ---------------------------------------------------------------- сейвы */
function yawOf() { return Math.atan2(rover.heading.x, rover.heading.z); }

function saveGame(note = false) {
  state.position = { x: rover.pos.x, z: rover.pos.z, yaw: yawOf() };
  state.hp = rover.hp;
  state.dig = digProgress();
  try {
    localStorage.setItem(STORY.SAVE_KEY, JSON.stringify(state));
    if (note) toast('Экспедиция сохранена');
  } catch {
    toast('Сохранение недоступно: браузер запрещает localStorage');
  }
}

function readSave() {
  try {
    return STORY.normalizeSave(JSON.parse(localStorage.getItem(STORY.SAVE_KEY)));
  } catch {
    return null;
  }
}

function applyState(s) {
  state = s;
  const dx=s.position.x-LANDING_SITE.x, dz=s.position.z-LANDING_SITE.z;
  // Older saves can place the rover on ground now occupied by the lander.
  if(dx>-6.7 && dx<5.2 && Math.abs(dz)<4.6) rover.placeAt(LANDING_SITE.exitX,LANDING_SITE.exitZ);
  else rover.placeAt(s.position.x, s.position.z);
  rover.hp = s.hp;
  setDig(s.dig);
  world.repaintDig();
  world.regroundArea(TEMPLE.x, TEMPLE.z, MOUND_R + 10);
  clearHandDigs();
  restoreHandDigs(s.digSpots || []);
  for (const d of s.digSpots || []) {
    world.repaintArea(d.x, d.z, 10);
    world.regroundArea(d.x, d.z, 12);
  }
  for (const b of world.beacons) { b.lit = false; b.litT = 0; }
  // уже поднятые манускрипты показываются открытыми
  for (const c of world.scrollCaches || []) {
    if (s.scrolls.includes(c.id)) { c.dug = 1; c.target = 1; c.found = true; }
  }
  for (const id of s.used) {
    const a = P.aholas.find((x) => x.id === id);
    if (a && world.beacons[a.beacon]) {
      world.beacons[a.beacon].lit = true;
      world.beacons[a.beacon].litT = 1;
    }
  }
  world.setBarrier(s.synced);
  world.setTempleReveal(s.dig);
  // артефакт уже в инвентаре — на платформе его нет
  if (s.artifact) world.takePhaseCore();
  syncKeyItem();
  paintProgress();
}

/** Насыпь вскрыта и письмена разобраны, а ключ так и не попал в сумку
    (старые сейвы, где насыпь вскрыли до расшифровки) — забираем его сразу. */
function syncKeyItem() {
  if (state.artifact || state.dig < 1) return false;
  if (!STORY.complete(state, 'artifact')) return false;
  world.takePhaseCore();
  saveGame();
  return true;
}

/* ================================================================ ВВОД */
const keys = Object.create(null);
const BLOCK = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

addEventListener('keydown', (e) => {
  if (mode === 'epilogue') {
    if (['Space', 'Escape', 'Enter'].includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) skipEpilogue();
    }
    return;
  }
  if(mode==='departure'){
    if(['Space','Escape','Enter'].includes(e.code)){
      e.preventDefault();
      if(!e.repeat) finishDeparture();
    }
    return;
  }
  // печатаем в поле журнала — клавиши игры не слушаем вовсе
  if (mode==='signal' && (e.code==='Space' || e.code==='Escape')) {
    e.preventDefault();
    if(e.code==='Space') keys.Space=true;
    else if(!e.repeat) openPause();
    return;
  }
  const tgt = e.target;
  if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) {
    if (e.code === 'Escape') tgt.blur();
    return;
  }
  if (BLOCK.has(e.code) && mode === 'explore') e.preventDefault();
  if (e.code === 'KeyN' && !e.repeat) { toggleSound(); return; }
  if (mode === 'menu') { if (e.code === 'Enter' || e.code === 'Space') begin(); return; }
  keys[e.code] = true;

  // секретная комбинация: свободный зум (Ctrl/Cmd + Shift + Z)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyZ' && !e.repeat) {
    e.preventDefault();
    toggleFreeZoom();
    return;
  }

  if (mode === 'dialog') {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); nextLine(); }
    return;
  }
  if (mode === 'explore') {
    if (e.code === 'KeyE' && !e.repeat) tryInteract();
    if (e.code === 'KeyF' && !e.repeat) {
      // у схрона F снимает грунт с ларца, иначе — копает землю как обычно
      const near=nearestInteract();
      if (near && near.kind === 'scroll') digScroll(near.obj);
      else handDig();
    }
    if (e.code === 'KeyR' && !e.repeat) respawn();
    if (e.code === 'KeyM' && !e.repeat) openMap();
    if (e.code === 'KeyJ' && !e.repeat) openJournal();
    if (e.code === 'KeyI' && !e.repeat) openTranslate();
    // сразу после закрытия журнала/миниигры Esc не должен проваливаться в паузу
    if (e.code === 'Escape') {
      if (performance.now() > overlayClosedAt + 300) openPause();
      return;
    }
    return;
  }
  if (mode === 'inspect') {
    // короткое нажатие — переключить состояние, удержание — выйти
    if (e.code === 'KeyE' && !e.repeat) {
      inspect.holdFrom = performance.now();
      inspect.holding = true;
    }
    // журнал доступен и от механизма: посмотреть знаки, вписать перевод
    if (e.code === 'KeyI' && !e.repeat) { openTranslate(); return; }
    if (e.code === 'Escape') exitInspect();
    return;
  }
  if (mode === 'lesson' && e.code === 'Escape') { closeTop(); return; }
  // список курсоров закрывается обратно в паузу, а не выпускает в игру
  if (e.code === 'Escape' && !$('cursorPick').classList.contains('hidden')) { closeCursorPick(); return; }
  if (e.code === 'Escape') closeTop();
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (mode === 'inspect' && e.code === 'KeyE' && inspect.holding) {
    inspect.holding = false;
    if (performance.now() - inspect.holdFrom >= 450) exitInspect();
    else toggleInspect();
  }
});
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  if (mode === 'explore' || mode === 'signal') openPause(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (mode === 'explore' || mode === 'signal')) openPause(true);
});

function readInput() {
  return {
    fwd: !!(keys.KeyW || keys.ArrowUp),
    back: !!(keys.KeyS || keys.ArrowDown),
    left: !!(keys.KeyA || keys.ArrowLeft),
    right: !!(keys.KeyD || keys.ArrowRight),
    boost: !!(keys.ShiftLeft || keys.ShiftRight),
    brake: !!keys.Space,
  };
}

/* =============================================================== КАМЕРА */
const ZOOM_NEAR = 8;        // ближе не подъехать
const ZOOM_FAR = 45;        // обычный предел отдаления
const ZOOM_MAX = 1500;      // предел в свободном обзоре (Ctrl/Cmd+Shift+Z)
const FOG_DENSITY = 0.0034; // базовая плотность дымки
const cam = {
  yaw: 0, pitch: 0.22, dist: 15, far: false, lift: 0,
  pos: new THREE.Vector3(), target: new THREE.Vector3(),
  dragging: false, lastX: 0, lastY: 0, idle: 99, locked: false,
  // режим «миниигра»: камера уходит с машины на механизм и медленно обходит его
  focus: null,
};

/** Поставить камеру в заранее собранный кадр (локальные координаты объекта) */
function focusShot(obj, shot) {
  if (!obj || !shot) return;
  obj.updateMatrixWorld(true);
  cam.focus = {
    pos: new THREE.Vector3(...shot.cam).applyMatrix4(obj.matrixWorld),
    look: new THREE.Vector3(...shot.look).applyMatrix4(obj.matrixWorld),
    fov: shot.fov || 46,
    shiftRight: shot.shiftRight ?? 0.16,
    shiftDown: shot.shiftDown ?? 0.1,
    dist: 0,
    t: 0,
  };
  cam.focus.dist = cam.focus.pos.distanceTo(cam.focus.look);
}

/**
 * Кадр по габаритам: механизм обязан влезть в экран целиком, с какой бы
 * стороны мы ни подъехали. Центр — центр габаритов, направление — «лицо»
 * механизма (локальная +Z), дистанция — из радиуса описанной сферы и FOV.
 */
function focusFit(obj, shot = {}, inscription = null) {
  if (!obj) return;
  obj.updateMatrixWorld(true);
  // габариты считаем только по мешам: спрайты свечения и источники света
  // сильно раздувают бокс (Box3 не смотрит на visible) и загоняют камеру далеко
  const box = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tmpBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(tmpBox);
  });
  if (box.isEmpty()) box.setFromObject(obj);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fov = shot.fov || 46;
  const half = (fov * Math.PI) / 360;
  const dist = (sphere.radius / Math.sin(half)) * (shot.pad || 1.06);
  const q = new THREE.Quaternion();
  obj.getWorldQuaternion(q);
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
  front.applyAxisAngle(new THREE.Vector3(0, 1, 0), ((shot.yaw ?? 14) * Math.PI) / 180);
  const look = sphere.center.clone();
  if(inscription) look.lerp(inscription.getWorldPosition(new THREE.Vector3()),.16);
  const pos = look.clone().addScaledVector(front, dist);
  pos.y += sphere.radius * 0.12;
  cam.focus = {
    pos, look, fov, dist: pos.distanceTo(look), t: 0,
    shiftRight: shot.shiftRight ?? 0.1,
    shiftDown: shot.shiftDown ?? 0.06,
  };
}

/** Поставить камеру в кадр мгновенно (после затемнения — не видно рывка) */
function snapToFocus() {
  const f = cam.focus;
  if (!f) return;
  cam.pos.copy(f.pos);
  camera.position.copy(f.pos);
  camera.up.set(0, 1, 0);
  camera.fov = f.fov;
  camera.updateProjectionMatrix();
  const look = f.look.clone();
  const dir = look.clone().sub(camera.position).normalize();
  const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
  look.addScaledVector(right, f.dist * f.shiftRight);
  look.y -= f.dist * f.shiftDown;
  cam.target.copy(look);
  camera.lookAt(cam.target);
}

function clearFocus() {
  if (!cam.focus) return;
  cam.focus = null;
  if (Math.abs(camera.fov - CAM_FOV) > 0.01) {
    camera.fov = CAM_FOV;
    camera.updateProjectionMatrix();
  }
}

/** Кадр миниигры: камера едет в свою точку и стоит там неподвижно */
function updateFocusCamera(dt) {
  const f = cam.focus;
  f.t += dt;
  const k = 1 - Math.exp(-5.5 * dt);
  cam.pos.lerp(f.pos, k);
  camera.position.copy(cam.pos);
  camera.up.set(0, 1, 0);
  // точка взгляда сдвинута вправо и вниз: механизм встаёт левее центра,
  // а справа освобождается место под электронный журнал
  const look = f.look.clone();
  const dir = look.clone().sub(camera.position).normalize();
  const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
  look.addScaledVector(right, f.dist * f.shiftRight);
  look.y -= f.dist * f.shiftDown;
  cam.target.lerp(look, k);
  camera.lookAt(cam.target);
  if (Math.abs(camera.fov - f.fov) > 0.01) {
    camera.fov += (f.fov - camera.fov) * (1 - Math.exp(-4 * dt));
    camera.updateProjectionMatrix();
  }
}

/** Повернуть камеру на смещение мыши (работает и с захватом указателя, и перетаскиванием) */
function applyLook(dx, dy) {
  cam.yaw -= dx * 0.006;
  // в свободном обзоре можно смотреть почти сверху и чуть снизу
  const pMin = cam.far ? -0.18 : 0.02;
  const pMax = cam.far ? 1.45 : 0.95;
  cam.pitch = clamp(cam.pitch + dy * 0.004, pMin, pMax);
  cam.idle = 0;
}

/** Захват указателя: в езде мышь не видна, обзор идёт от одного движения мыши */
let lookRetry = 0;
let lockDropIgnore = 0;   // до этого момента потеря захвата — наша, не игрока
let overlayClosedAt = 0;  // когда закрыли журнал/миниигру: Esc сразу после — не пауза
function requestLook(attempt = 0) {
  if (mode !== 'explore') return;
  if (document.pointerLockElement === renderer.domElement) return;
  try {
    const p = renderer.domElement.requestPointerLock?.();
    if (p && typeof p.catch === 'function') p.catch(() => { /* браузер не дал — повторим ниже */ });
  } catch { /* noop */ }
  // Chrome не даёт захват сразу после Esc — пробуем ещё пару раз
  clearTimeout(lookRetry);
  if (attempt < 3) {
    lookRetry = setTimeout(() => {
      if (mode === 'explore' && document.pointerLockElement !== renderer.domElement) requestLook(attempt + 1);
    }, 500 + attempt * 500);
  }
}

function releaseLook() {
  if (document.pointerLockElement) {
    // сняли захват сами (открыли журнал/миниигру) — это не игрок нажал Esc,
    // пауза по такому событию не нужна
    lockDropIgnore = performance.now() + 700;
    document.exitPointerLock();
  }
}

document.addEventListener('pointerlockchange', () => {
  const wasLocked = cam.locked;
  cam.locked = document.pointerLockElement === renderer.domElement;
  renderer.domElement.classList.toggle('locked', cam.locked);
  // Esc снимает захват сам — игрок ждёт паузу, а не просто вернувшийся курсор.
  // Но если захват сняли мы сами (оверлей только что закрылся) — не мешаем.
  if (wasLocked && !cam.locked && mode === 'explore'
      && performance.now() > lockDropIgnore) openPause();
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode === 'explore' && document.pointerLockElement !== renderer.domElement) {
    requestLook();
    return;
  }
  cam.dragging = true;
  cam.lastX = e.clientX; cam.lastY = e.clientY;
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* захват уже недоступен */ }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  cam.dragging = false;
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* noop */ }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === renderer.domElement) {
    applyLook(e.movementX || 0, e.movementY || 0);
    return;
  }
  if (!cam.dragging) return;
  applyLook(e.clientX - cam.lastX, e.clientY - cam.lastY);
  cam.lastX = e.clientX; cam.lastY = e.clientY;
});
addEventListener('wheel', (e) => {
  // в свободном обзоре шаг колеса крупнее, чтобы дотянуться до орбиты
  const step = cam.far ? 0.36 : 0.03;
  const maxD = cam.far ? ZOOM_MAX : ZOOM_FAR;
  cam.dist = clamp(cam.dist + e.deltaY * step, ZOOM_NEAR, maxD);
}, { passive: true });

/** Секретный переключатель: зум без ограничений (Ctrl/Cmd + Shift + Z) */
function toggleFreeZoom() {
  cam.far = !cam.far;
  if (cam.far) {
    cam.dist = Math.max(cam.dist, 140);
    cam.pitch = Math.max(cam.pitch, 0.45);
    toast('Свободный обзор: зум без ограничений · Ctrl+Shift+Z');
  } else {
    cam.dist = clamp(cam.dist, ZOOM_NEAR, ZOOM_FAR);
    cam.pitch = clamp(cam.pitch, 0.02, 0.95);
    toast('Обычный обзор камеры');
  }
  return cam.far;
}

const _camUp = new THREE.Vector3(0, 1, 0);
const _targetUp = new THREE.Vector3();

/**
 * Насколько надо поднять камеру, чтобы склон не закрывал машину.
 * Идём по отрезку «машина → камера» по высотному полю: если земля его
 * перекрывает на параметре t, то подъём камеры на L поднимает отрезок на L·t,
 * значит нужен подъём (gy − sy) / t. Ближе к машине — дороже, поэтому t ≥ 0.3.
 */
function occlusionLift(tx, ty, tz, cx, cy, cz) {
  let need = 0;
  const STEPS = 9;
  for (let i = 1; i <= STEPS; i++) {
    const t = 0.2 + (0.78 * i) / STEPS;
    const gy = meshHeightAt(tx + (cx - tx) * t, tz + (cz - tz) * t) + 1.0;
    const sy = ty + (cy - ty) * t;
    if (gy > sy) need = Math.max(need, (gy - sy) / Math.max(0.3, t));
  }
  return need;
}

function updateCamera(dt) {
  // миниигра смотрит на механизм, а не на машину
  // осмотр механизма, переводчик и диалог во время осмотра — камера в кадре
  if (cam.focus && (mode === 'inspect' || mode === 'translate' || mode === 'dialog')) {
    updateFocusCamera(dt);
    return;
  }
  cam.idle += dt;
  // свободный обзор не возвращает камеру сам — иначе дальний вид срывает
  if (!cam.dragging && cam.idle > 1.6 && !cam.far) {
    cam.yaw *= Math.exp(-1.4 * dt);
    cam.pitch += (0.22 - cam.pitch) * Math.min(1, dt * 1.2);
  }
  // дымка не должна съедать планету, когда смотрим с орбиты
  if (whiteT <= 0) {
    scene.fog.density = cam.far
      ? fogDay * Math.max(0.015, Math.min(1, 15 / Math.max(1, cam.dist)))
      : fogDay;
  }
  _targetUp.set(0, 1, 0).lerp(rover.up, 0.22).normalize();
  _camUp.lerp(_targetUp, 1 - Math.exp(-4 * dt)).normalize();
  const up = _camUp;

  const back = rover.heading.clone().applyAxisAngle(up, Math.PI + cam.yaw);
  const desired = rover.pos.clone()
    .addScaledVector(back, cam.dist * Math.cos(cam.pitch))
    .addScaledVector(up, cam.dist * Math.sin(cam.pitch) + 1.8);

  const camGround = meshHeightAt(desired.x, desired.z) + 3.4;
  if (desired.y < camGround) desired.y = camGround;

  /* Склон между машиной и камерой не должен закрывать обзор (особенно на
     спуске с горы): поднимаем камеру тем сильнее, чем выше гребень. */
  const tx = rover.pos.x, ty = rover.pos.y + 1.4, tz = rover.pos.z;
  const need = Math.min(30, occlusionLift(tx, ty, tz, desired.x, desired.y, desired.z));
  // вверх тянем быстро, опускаем медленно — иначе камера дрожит на кочках
  const rate = need > cam.lift ? 9 : 2.0;
  cam.lift += (need - cam.lift) * (1 - Math.exp(-rate * dt));
  if (cam.lift > 0.02) {
    desired.y += cam.lift;
    // склон нелинейный — после подъёма проверяем ещё раз
    const again = occlusionLift(tx, ty, tz, desired.x, desired.y, desired.z);
    if (again > 0.05) desired.y += Math.min(20, again);
  }

  cam.pos.lerp(desired, 1 - Math.exp(-7 * dt));
  camera.position.copy(cam.pos);

  const cpGround = meshHeightAt(camera.position.x, camera.position.z) + 2.2;
  if (camera.position.y < cpGround) camera.position.y = cpGround;

  if (rover.shake > 0.001) {
    const a = rover.shake * 0.28;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
  }

  camera.up.copy(up);
  cam.target.copy(rover.pos).addScaledVector(up, 1.4);
  camera.lookAt(cam.target);
}

/* ================================================================== HUD */
function initUi() {
  Object.assign(ui, {
    stormFill: $('stormFill'), stormTime: $('stormTime'), stormBox: $('storm'),
    words: $('wordsVal'), aholas: $('aholasVal'), hp: $('hpFill'), hpVal: $('hpVal'),
    signs: $('signStrip'),
    energy: $('energyFill'), digLeft: $('digVal'), objective: $('objective'), sub: $('objectiveSub'),
    prompt: $('prompt'), toast: $('toast'),
    fog: $('fogveil'), damage: $('damage'), whiteout: $('whiteout'),
    waypoint: $('waypoint'), wpArrow: $('wpArrow'), wpDist: $('wpDist'),
    biome: $('biome'), coords: $('coords'), speed: $('speed'), stats: $('stats'),
    clock: $('clock'),
  });
}

let toastTimer = 0;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('on');
  toastTimer = 1.8;
}
function tickToast(dt) {
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) ui.toast.classList.remove('on');
  }
}

let hudTimer = 0;
function updateHud(dt) {
  hudTimer += dt;
  if (hudTimer < 0.1) return;
  hudTimer = 0;

  const lvl = STORY.stormLevel(state);
  ui.stormFill.style.width = `${(100 - lvl * 100).toFixed(1)}%`;
  // сколько осталось до бури — в часах и минутах
  if (ui.stormTime) ui.stormTime.textContent = STORY.leftLabel(state);
  ui.stormBox.classList.toggle('warn', lvl > 0.66);
  ui.stormBox.classList.toggle('crit', lvl > 0.86);

  ui.words.textContent = `${state.keys.length} / ${STORY.KEYS.length}`;
  ui.aholas.textContent = `${state.used.length} / 6`;
  const hpPct = Math.max(0, Math.min(100, rover.hp));
  ui.hp.style.width = `${hpPct.toFixed(1)}%`;
  ui.hpVal.textContent = `${Math.round(hpPct)}%`;
  ui.stats.classList.toggle('crit', hpPct <= 30);
  ui.energy.style.width = `${rover.energy.toFixed(0)}%`;
  if (ui.digLeft) {
    const left = STORY.handDigLeft(state);
    ui.digLeft.textContent = `${STORY.HAND_DIGS_MAX - left} / ${STORY.HAND_DIGS_MAX}`;
    ui.digLeft.style.color = left === 0 ? '#ff9a8a' : '';
  }

  const bi = biomeAt(rover.pos.x, rover.pos.z);
  ui.biome.textContent = bi.name;
  if (ui.clock) ui.clock.textContent = STORY.dayLabel(state);
  rover.surface = bi.id;               // от этого зависят частицы из-под колёс
  ui.coords.textContent = `${rover.pos.x.toFixed(0)} : ${rover.pos.z.toFixed(0)}`;
  ui.speed.textContent = rover.speed.toFixed(1);

  const obj = STORY.objective(state, rover.pos);
  ui.objective.textContent = obj.title;
  ui.sub.textContent = obj.hint;

  if (whiteT < 0) ui.fog.style.opacity = Math.min(0.92, rover.fog * 0.95).toFixed(3);
  ui.damage.style.opacity = (rover.hitFlash * 0.55).toFixed(3);
}

function paintSignStrip() {
  if (!ui.signs) return;
  ui.signs.innerHTML = TANGUT_ORDER.map((id) => {
    const k = TANGUT[id];
    const got = state.keys.includes(id);
    return `<span class="sg${got ? ' on' : ''}" title="${got ? k.gloss + ' · ' + k.code : 'знак ещё не найден'}">${got ? k.char : '·'}</span>`;
  }).join('');
}

let journalHintShown = false;
function paintProgress() {
  if (!ui.words) return;
  ui.words.textContent = `${state.keys.length} / ${STORY.KEYS.length}`;
  // первый знак найден — объясняем, зачем журнал и что туда писать
  if (state.keys.length === 1 && !journalHintShown) {
    journalHintShown = true;
    setTimeout(() => {
      if (mode === 'explore') {
        toast('Знак записан. Откройте I — в журнале впишите свою догадку о смысле');
      }
    }, 1400);
  }
  // журнал знаков в HUD появляется только после первого механизма
  const sb = $('signsBlock');
  if (sb) sb.classList.toggle('hidden', state.keys.length === 0);
  ui.aholas.textContent = `${state.used.length} / 6`;
  paintSignStrip();
  if (ui.digLeft) {
    const left = STORY.handDigLeft(state);
    ui.digLeft.textContent = `${STORY.HAND_DIGS_MAX - left} / ${STORY.HAND_DIGS_MAX}`;
    ui.digLeft.style.color = left === 0 ? '#ff9a8a' : '';
  }
}

/* ================================================ РУЧНОЙ ШУРФ (клавиша F) */
const handGrow = [];   // растущие ямы: { e, t, x, z }
function handDig() {
  if (mode !== 'explore') return;
  if (onMound()) { moundDig(); return; }
  const left = STORY.handDigLeft(state);
  if (left <= 0) {
    toast(`Шурфы кончились: на экспедицию их ${STORY.HAND_DIGS_MAX}`);
    audio.tone(170, 0.22, 'sine', 0.06, 120);
    return;
  }
  if (rover.energy < HAND_DIG_COST) {
    toast(`Мало энергии: на шурф нужно ${HAND_DIG_COST}%`);
    audio.tone(200, 0.18, 'sine', 0.05, 120);
    return;
  }

  // шурф начинается со стабилизации: машина встаёт, даже если её тянуло с уклона
  rover.vel.x = 0;
  rover.vel.z = 0;
  rover.speed = 0;
  rover.energy = Math.max(0, rover.energy - HAND_DIG_COST);
  const x = rover.pos.x, z = rover.pos.z;
  const res = STORY.digAnywhere(state, x, z);
  if (!res.ok) return;

  const e = addHandDig(x, z);
  handGrow.push({ e, t: 0 });
  rover.shake = Math.max(rover.shake, 0.35);
  audio.dig(true);
  paintProgress();
  saveGame();

  // пыль и грунт летят наверх
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 4.5;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    rover.dust.emit(new THREE.Vector3(px, meshHeightAt(px, pz) + 0.5, pz), 2, 4.2, 'clod');
  }

  digOutcome(res);
}


/** Исход копания: находка (с репликой) или «пусто» — одинаково в любом месте */
function digOutcome(res) {
  if (res.trinket) {
    const t = res.trinket;
    setTimeout(() => {
      if (mode === 'explore') {
        say([
          { who: 'МИРА', text: `В грунте — ${t.name.toLowerCase()}. ${t.text}` },
          ...(t.id==='tag' && !res.again ? [{"who": "МИРА", "text": "Это не просто список имён — на ней целые родословные. А в самом низу другой рукой, позже, выбито: «Имена оставлены тем, кто проснётся и вернёт их нам». Они кого-то ждали, Лев. Не гостей — тех, кто разбудит."}, {"who": "ЛЕВ", "text": "Записываю как наблюдение: приписка сделана позже основного текста. Гипотеза: имена хранили не для памяти, а для возвращения. Зачем и кому — пока не знаю."}] : [{ who: 'ЛЕВ', text: res.again ? 'Такое у нас уже есть. Второй экземпляр в отчёт не пойдёт.' : 'Безделушка. Для отчёта мелко, но место запомним.' }]),
        ], 'explore');
      }
      audio.unearth();
      toast(`Находка: ${t.name.toLowerCase()}`);
    }, 1100);
  } else {
    setTimeout(() => {
      if (mode === 'explore') {
        audio.burst(0.25, { freq: 700, q: 1, vol: 0.05 });
        toast('Пусто: слежавшийся грунт и битый камень');
      }
    }, 1100);
  }
}

function updateHandDigs(dt) {
  for (let i = handGrow.length - 1; i >= 0; i--) {
    const a = handGrow[i];
    a.t = Math.min(1, a.t + dt / 1.35);
    if (a.t < 1 && Math.floor(a.t*10) === (a.step || 0)) continue;
    a.step=Math.floor(a.t*10);
    setHandDigGrow(a.e, a.t * a.t * (3 - 2 * a.t));
    world.repaintArea(a.e.x, a.e.z, a.e.r + 4, a.t >= 1);
    if (a.t>=1) world.regroundArea(a.e.x, a.e.z, a.e.r * 1.6);
    if (Math.random() < dt * 30) {
      const ang = Math.random() * Math.PI * 2;
      const r = a.e.r * (0.5 + Math.random() * 0.5);
      const px = a.e.x + Math.cos(ang) * r, pz = a.e.z + Math.sin(ang) * r;
      rover.dust.emit(new THREE.Vector3(px, meshHeightAt(px, pz) + 0.4, pz), 1, 2.4, 'clod');
    }
    if (a.t >= 1) handGrow.splice(i, 1);
  }
  if (handGrow.length && rover.grounded) rover.snapToGround();
}

/* ============================================================ ВЗАИМОДЕЙСТВИЕ */
function nearestInteract() {
  const p = rover.pos;
  let best = null, bestD = Infinity;
  const consider = (kind, obj, pos, radius) => {
    const d = Math.hypot(p.x - pos.x, p.z - pos.z);
    if (d < radius && d < bestD) { bestD = d; best = { kind, obj, pos, d }; }
  };

  for (const a of world.artifactSites) {
    // механизмы остаются доступными навсегда: подъехал — включил, отъехал,
    // вернулся — включил снова, сколько угодно раз
    consider('artifact', a, a.pos, 14);
  }
  // закопанные манускрипты: подъехал — копаешь F, пока крышка не отойдёт
  for (const c of world.scrollCaches || []) {
    if (state.scrolls.includes(c.id)) continue;
    consider('scroll', c, c.pos, 12);
  }
  // плиты в мире нет: расшифровщик открывается из журнала знаков
  if (!state.synced) {
    const a = world.anomalies[P.anomaly.index];
    if (a) consider('anomaly', a, a.group.position, 28);
  }
  for (const ah of P.aholas) {
    const b = world.beacons[ah.beacon];
    if (!b || state.used.includes(ah.id)) continue;
    consider('ahola', { ahola: ah, beacon: b }, b.pos, 18);
  }
  if (state.synced) {
    const vault = world.vault;
    if (!state.visitedVault) consider('vault',vault,vault.scanPos || vault.pos,vault.model?5:20);
    else consider('core',P.core,P.core,11);
  }
  // фазовый ключ висит над алтарём, пока его не сняли
  if (state.excavation && state.excavation.recorded && !state.artifact && world.summitKey) {
    consider('key', world.summitKey, { x: TEMPLE.x, z: TEMPLE.z }, 13);
  }
  return best;
}

function updatePrompt() {
  nearHint = nearestInteract();
  if (state.decoded && onMound()) {
    ui.prompt.innerHTML=state.artifact?'<b>F</b> — восстановить ход раскопок':'<b>F</b> — начать раскопки храма';ui.prompt.classList.add('on');return;
  }
  if (!nearHint) { ui.prompt.classList.remove('on'); return; }

  let text = '';
  switch (nearHint.kind) {
    case 'artifact': {
      const art = STORY.artifactById(nearHint.obj.kind);
      const isOn = !!nearHint.obj.on;
      text = `<b>E</b> — переключить состояние <span>(${art.name}${isOn ? ' · включён' : ''})</span>`;
      break;
    }
    case 'tablet': text = '<b>E</b> — ИИ-расшифровщик: прочитать три манускрипта'; break;
    case 'scroll': text = `<b>F</b> — раскопать схрон <span>(${Math.round((nearHint.obj.dug || 0) * 100)}%)</span>`; break;
    case 'anomaly':
      text = state.artifact ? '<b>E</b> — настроиться на аномалию' : 'Аномалия не реагирует · нужен артефакт';
      break;
    case 'ahola': {
      const a = nearHint.obj.ahola;
      const add = 60;
      text = STORY.aholaOpen(state, a)
        ? `<b>E</b> — разрядить ахолу <span>(+${add} с бури)</span>`
        : `Ахола молчит · ступень ${a.tier}`;
      break;
    }
    case 'vault': text='<b>E</b> — осмотреть криокапсулы'; break;
    case 'key': text = '<b>E</b> — снять фазовый ключ с алтаря'; break;
    case 'core': text = '<b>E</b> — войти в Сердце бури'; break;
    default: break;
  }
  ui.prompt.innerHTML = text;
  ui.prompt.classList.add('on');
}

function tryInteract() {
  if (mode !== 'explore') return;
  const t = nearestInteract();
  if (!t) return;

  if (t.kind === 'artifact') {
    // никаких меню: камера показывает механизм, состояние переключается сколько угодно
    enterInspect(t.obj);
    return;
  }
  if (t.kind === 'tablet') {
    if (!STORY.keysComplete(state)) {
      toast(STORY_TEXT.tabletLocked(STORY.KEYS.length - state.keys.length));
      return;
    }
    openTranslate();
    return;
  }
  if (t.kind === 'anomaly') {
    if (!state.artifact) { toast("Не подъезжай! Без ключа эта штука режет обшивку."); audio.tone(180, 0.2, 'sine', 0.06, 120); return; }
    openSignal();
    return;
  }
  if (t.kind === 'ahola') {
    const a = t.obj.ahola;
    if (!STORY.aholaOpen(state, a)) { toast(STORY_TEXT.aholaLocked); return; }
    if (STORY.activate(state, a.id)) {
      t.obj.beacon.lit = true;
      t.obj.beacon.litT = 0;
      audio.ahola();
      audio.spark();
      const add = 60;
      say([{ who: 'НИНА', text: STORY_TEXT.ahola }], 'explore');
      toast(`Ахола разряжена · +${add} с`);
      paintProgress();
      saveGame();
    }
    return;
  }
  if (t.kind==='vault') {
    state.visitedVault=true;
    if (!state.journal.includes('vault')) state.journal.push('vault');
    saveGame(); say([{"who": "МИРА", "text": "Огни горят. Хранилище питается от той самой бури — поэтому и держится до сих пор."}, {"who": "ЛЕВ", "text": "Криокапсулы. Сотни. И они разные — смотри: эти высокие, с гребнем, а эти ниже и шире. Совсем другие пропорции."}, {"who": "МИРА", "text": "Это не один народ — несколько видов. Они собирали тех, кого могли спасти. И все капсулы повёрнуты к городу, как будто ждут, что кто-то откроет двери."}, {"who": "ЛЕВ", "text": "Сами капсулы мертвы, но записи внутри целы. Если передать их ретранслятору до отключения, потом по ним смогут восстановить всё, что здесь спит. Но хранилище исчезнет."}, {"who": "МИРА", "text": "Значит, они ждали не нас. Они ждали того, кто решится их разбудить."}],'explore'); return;
  }
  if (t.kind === 'core') finalDialogue();
  if (t.kind === 'key') {
    if (!STORY.complete(state, 'artifact')) return;
    if (world.takePhaseCore) world.takePhaseCore();
    audio.unearth();
    paintProgress();
    saveGame();
    say([{ who: 'ЛЕВ', text: STORY_TEXT.artifact }], () => openArtifact());
  }
}

/** Раскопать схрон: одного верного захода достаточно */
/** Копать землю у схрона: переиспользуем настоящую механику шурфа */
function digScroll(cache) {
  if (!cache || state.scrolls.includes(cache.id) || cache.target >= 1) return;
  rover.vel.x=rover.vel.z=rover.speed=0;
  rover.shake = Math.max(rover.shake, 0.4);
  audio.dig(true);
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 4.5;
    const px = cache.pos.x + Math.cos(a) * r, pz = cache.pos.z + Math.sin(a) * r;
    rover.dust.emit(new THREE.Vector3(px, meshHeightAt(px, pz) + 0.5, pz), 2, 4.2, 'clod');
  }
  // Копаем как в любом другом месте: земля проседает, яма растёт,
  // схрон остаётся в грунте и просто открывается
  const hole = addHandDig(cache.pos.x, cache.pos.z);
  handGrow.push({ e: hole, t: 0 });
  cache.target = 1;
}

/** Довести раскопки до конца и только потом показать пластину */
function updateScrollDig(dt) {
  for (const c of world.scrollCaches || []) {
    if (!c.target || c.dug >= 1) continue;
    c.dug = Math.min(1, (c.dug || 0) + dt / 1.35);   // ровно как рост ямы
    if (c.dug >= 1 && !c.found) {
      c.found = true;
      if (!state.scrolls.includes(c.id)) {
        state.scrolls.push(c.id);
        state.journal.push(c.id);
        paintProgress();
        saveGame();
      }
      toast(`${c.title || 'Текст'}: найдена`);
      openTranslate();
    }
  }
}

/** Показать находку: открываем единое меню — пластины и журнал сразу на виду */
function openFound() {
  openTranslate();
}

function respawn() {
  // если машина застряла под сводом, ставим её перед входом во врата
  const d = Math.hypot(rover.pos.x - TEMPLE.x, rover.pos.z - TEMPLE.z);
  if (d < 18 && digProgress() > 0.01) {
    const ax = P.tablet.x - TEMPLE.x, az = P.tablet.z - TEMPLE.z;
    const L = Math.hypot(ax, az) || 1;
    const s = world.freeSpot(TEMPLE.x + (ax / L) * 24, TEMPLE.z + (az / L) * 24, 2);
    rover.placeAt(s[0], s[1], [TEMPLE.x, TEMPLE.z]);
    audio.tone(300, 0.3, 'sine', 0.08, 600);
    return;
  }
  const s = world.freeSpot(rover.pos.x, rover.pos.z, 1.5);
  rover.placeAt(s[0], s[1]);
  audio.tone(300, 0.3, 'sine', 0.08, 600);
}

/* ================================================================= ДИАЛОГ */
const dlg = { queue: [], done: null, i: 0 };

function say(lines, after = 'explore') {
  dlg.queue = lines.slice();
  dlg.done = after;
  dlg.i = 0;
  mode = 'dialog';
  $('dialog').classList.remove('hidden');
  renderDialog();
  audio.tone(440, 0.1, 'sine', 0.06);
}

function renderDialog() {
  const line = dlg.queue[dlg.i];
  if (!line) return;
  $('dlgName').textContent = line.who;
  $('dlgText').textContent = line.text;
  $('dlgStep').textContent = `${dlg.i + 1} / ${dlg.queue.length} · пробел`;
}

function nextLine() {
  dlg.i++;
  if (dlg.i < dlg.queue.length) { renderDialog(); audio.tone(400, 0.06, 'sine', 0.05); return; }
  closeDialog();
}

function closeDialog() {
  $('dialog').classList.add('hidden');
  const after = dlg.done;
  dlg.done = null;
  dlg.queue = [];
  if (after === 'ending') { mode = 'ending'; $('ending').classList.remove('hidden'); }
  else if (typeof after === 'function') { mode = inspect.site ? 'inspect' : 'explore'; after(); }
  else mode = inspect.site ? 'inspect' : 'explore';
  if (mode === 'explore') requestLook();
}

/* ============================================ ОСМОТР МЕХАНИЗМА (без меню)
   Игрок подходит к вратам/чаше/противовесу, нажимает E — камера встаёт в
   заранее выбранный кадр, и дальше он просто щёлкает состояние сколько
   захочет: знак на ровной плите меняется вместе с механизмом. Как только
   увидены оба состояния — оба слова сами попадают в переводчик.
   Выход — удержать E (или Esc). */
const inspect = { site: null, holdFrom: 0, holding: false };

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
let signSaveTimer = 0;
function scheduleSignSave() {
  clearTimeout(signSaveTimer);
  signSaveTimer = setTimeout(() => saveGame(), 600);
}

function enterInspect(site) {
  const art = STORY.artifactById(site.kind);
  if (!art) return;
  enterInspectCut(site, art);
}

/** Затемнение → кадр на весь экран → просветление */
function fadeCut(to, ms) {
  const el = $('cut');
  if (!el) return Promise.resolve();
  el.style.transitionDuration = `${ms}ms`;
  el.style.opacity = String(to);
  return new Promise((res) => setTimeout(res, ms + 40));
}

async function enterInspectCut(site, art) {
  if (mode !== 'explore') return;
  mode = 'inspect-wait';
  await fadeCut(1, 170);       // затемнение
  inspect.site = site;
  inspect.holding = false;
  focusFit(site.group, site.shot, site.medallion);   // механизм влезает целиком
  snapToFocus();
  rover.group.visible = false; // машина уезжает из кадра
  // убираем только те камни, что стоят между камерой и механизмом
  world.hideRocksBlocking(camera.position, site.pos || site.group.position, 2.6);
  mode = 'inspect';
  const first = !Object.values(state.seen).some(entries=>entries.length);
  STORY.seeState(state,art.id,site.on?art.on:art.off);
  if(first) toast("Это знак аварисцев. Запишите его себе и предположите, что он значит — любыми словами.");
  audio.ui();
  paintInspectPrompt();
  saveGame();
  await fadeCut(0, 300);       // просветление: виден только механизм
}

function paintInspectPrompt() {
  if (mode !== 'inspect') return;
  const art = STORY.artifactById(inspect.site.kind);
  const now = inspect.site.on ? art.on : art.off;
  const k = STORY.KEYS.find((x) => x.id === now);
  const left = STORY.artifactReady(state, art.id) ? '' : ' · нужны оба состояния';
  // слово-значение не подсказываем: его игрок выводит сам
  ui.prompt.innerHTML = '<b>E</b> — переключить'
    + '<br><span>I — журнал · удержать E или Esc — отойти</span>';
  ui.prompt.classList.add('on');  const sub = ui.sub;
  if (sub) sub.textContent = `${art.name}: знак ${k.glyph}${left}`;
}

function exitInspect() {
  if (mode !== 'inspect') return;
  exitInspectCut();
}

async function exitInspectCut() {
  mode = 'inspect-wait';
  await fadeCut(1, 170);       // затемнение
  inspect.site = null;
  inspect.holding = false;
  clearFocus();
  rover.group.visible = true;
  if (world.restoreRocks) world.restoreRocks();
  ui.prompt.classList.remove('on');
  mode = 'explore';
  paintProgress();
  saveGame();
  await fadeCut(0, 300);       // снова за рулём
}

/** Переключить состояние механизма. Сколько угодно раз подряд. */
function toggleInspect() {
  const site = inspect.site;
  if (!site) return;
  const art = STORY.artifactById(site.kind);
  const next = !site.on;
  world.setArtifact(site.kind, next);
  if (site.kind === 'gate') audio.clank();
  else if (site.kind === 'beacon') audio.fire();
  else audio.creak();

  const st = next ? art.on : art.off;
  const k = STORY.KEYS.find((x) => x.id === st);
  // только сам знак, без навязанного значения
  if (STORY.seeState(state, art.id, st)) toast(`Знак ${k.glyph}`);

  const added = STORY.learnArtifact(state, art.id);
  if (added) {
    paintProgress();
    saveGame();
    // все механизмы изучены — прямо говорим, что теперь можно делать
    if (STORY.keysComplete(state) && !state.decoded) {
      say([
        { who: 'МИРА', text: art.text },
        { who: 'ЛЕВ', text: 'Все три механизма изучены, шесть знаков в журнале. Теперь на пластинах можно вписывать значения — и отправить их ИИ. Откройте журнал (I).' },
        { who: 'НИНА', text: 'Кнопка отправки появится в окне переводчика вместе с последним знаком. До этого пластины не нажимаются — нечего и пытаться.' },
      ], () => {
        paintInspectPrompt();
        toast('Пластины открыты · I — вписать значения и отправить ИИ');
      });
      return;
    }
    const firstTime = state.solved.length === 1;
    const levLine = firstTime
      ? 'Записал оба знака. Открой журнал (I) и впиши своими словами, что они означают — потом сверим с пластинами.'
      : `Записал. Осталось механизмов: ${3 - state.solved.length}. Чем больше знаков, тем легче будет прочесть пластины.`;
    say([{ who:'НИНА',text:art.text },{who:'ЛЕВ',text:levLine}], () => paintInspectPrompt());
    return;
  }
  paintInspectPrompt();
  saveGame();
}

/* ============================================ ЯЗЫК: назвать значения знаков */
const lesson = { id: null, values: [] };

function openLesson(artifactId, site) {
  audio.ui();
  const art = STORY.artifactById(artifactId);
  const pair = STORY.KEYS.filter((k) => k.pair === artifactId);
  mode = 'lesson';
  // Камера уходит с машины в заранее подготовленный кадр этого механизма:
  // знак на его ровной плите должен быть виден целиком и крупно.
  if (site && site.group) focusShot(site.group, site.shot);
  $('lesson').classList.add('focus');
  lesson.id = artifactId;
  lesson.values = ['', ''];
  const words = pair.map((k) => k.word);
  const rows = pair.map((k, i) => `
    <div class="tr-row">
      <span class="tr-glyph">${k.glyph}</span>
      <select data-slot="${i}">
        <option value="">— что значит —</option>
        ${words.map((w) => `<option value="${w}">${w}</option>`).join('')}
      </select>
    </div>`).join('');
  $('lsTitle').textContent = art.name.toUpperCase();
  $('lsBody').innerHTML = `
    <p>Вы видели оба состояния механизма. Знаки на нём меняются вместе с ним —
       значит, они называют состояние. Что значит каждый?</p>
    <div class="mini">
      <div class="ls-demo" id="lsDemo">${pair.map((k) => `<div class="ls-glyph">${k.glyph}</div>`).join('')}</div>
      <div>${rows}</div>
    </div>`;
  $('lsBody').querySelectorAll('select').forEach((sel) => {
    sel.addEventListener('change', () => { lesson.values[+sel.dataset.slot] = sel.value; });
  });
  $('lsStatus').textContent = 'Сопоставьте два знака с двумя состояниями';
  $('lsSubmit').disabled = false;
  $('lesson').classList.remove('hidden');
}

function submitLesson() {
  const art = STORY.artifactById(lesson.id);
  if (!STORY.checkArtifact(lesson.id, lesson.values)) {
    $('lsStatus').textContent = 'Не сходится: знак меняется вместе с состоянием, а не наоборот.';
    audio.deny();
    return;
  }
  if (!STORY.solveArtifact(state, lesson.id, lesson.values)) {
    $('lsStatus').textContent = 'Переводчик не принял значения';
    return;
  }
  const pair = STORY.KEYS.filter((k) => k.pair === lesson.id);
  $('lsBody').innerHTML = `<p>${art.text}</p><div class="ls-solved">${pair
    .map((k) => `<span><span class="sg">${k.glyph}</span> — <b>${k.word}</b><br><small>${k.gloss} · ${k.code}</small></span>`).join('')}</div>`;
  $('lsStatus').textContent = `Значения записаны в переводчик · ${state.keys.length} / ${STORY.KEYS.length}`;
  $('lsSubmit').disabled = true;
  audio.word();
  paintProgress();
  saveGame();
  setTimeout(() => {
    $('lesson').classList.add('hidden');
    $('lesson').classList.remove('focus');
    clearFocus();
    const left = STORY.ARTIFACTS.length - state.solved.length;
    say([{
      who: 'ЛЕВ',
      text: state.solved.length === 1
        ? 'Записал оба знака. Открой журнал (I) и впиши своими словами, что они означают — потом сверим с пластинами.'
        : left > 0
          ? `Записал. Осталось механизмов: ${left}. Чем больше знаков, тем легче будет прочесть плиту.`
          : 'Шесть знаков. Теперь на пластинах можно вписывать значения и отправить их ИИ — откройте I.',
    }], 'explore');
    if (!left) toast('Пластины открыты · I — вписать значения и отправить ИИ');
  }, 1500);
}

/* ===================================================== МИНИИГРА 1: ПЕРЕВОДЧИК */
const tr = { activeGlyph: null, reading: false, typing: false, bad: null, fromInspect: null };

const S = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
/** Схематичные пиктограммы значений — игрок сопоставляет знак со схемой */
const SIGN_PICTO = {
  'ЗАКРЫТО': `<svg viewBox="0 0 40 40"><g ${S}><path d="M7 5h26v30H7z"/>`
    + '<path d="M20 6v28"/><path d="M11 20h18" stroke-width="3"/></g></svg>',
  'ОТКРЫТО': `<svg viewBox="0 0 40 40"><g ${S}><path d="M7 5h26v30H7z"/>`
    + '<path d="M7 5l6 5v20l-6 5"/><path d="M33 5l-6 5v20l6 5"/></g></svg>',
  'ПОГАСЛО': `<svg viewBox="0 0 40 40"><g ${S}><path d="M9 26a11 6 0 0022 0z"/>`
    + '<path d="M20 23c-4-4-2-8 0-12 2 4 4 8 0 12z" stroke-dasharray="3 2.4"/>'
    + '<path d="M11 9l18 19"/></g></svg>',
  'ГОРИТ': `<svg viewBox="0 0 40 40"><g ${S}><path d="M9 26a11 6 0 0022 0z"/>`
    + '<path d="M20 23c-5-4-3-9 0-14 3 5 5 10 0 14z" fill="currentColor"/>'
    + '<path d="M14 34l-1.5 2.5M26 34l1.5 2.5"/></g></svg>',
  'ВНИЗ': `<svg viewBox="0 0 40 40"><g ${S}><path d="M20 6v26"/><path d="M11 24l9 9 9-9"/></g></svg>`,
  'ВВЕРХ': `<svg viewBox="0 0 40 40"><g ${S}><path d="M20 34V8"/><path d="M11 16l9-9 9 9"/></g></svg>`,
};

function openTranslate() {
  audio.ui();
  // запомним, откуда пришли: из осмотра механизма вернём игрока туда же
  tr.fromInspect = inspect.site;
  mode = 'translate';
  tr.activeGlyph = null;
  tr.reading = false;
  tr.bad = null;
  stopTyping();
  $('translate').classList.remove('reading');
  $('trSubmit').textContent = 'ОТПРАВИТЬ ИИ НА РАСШИФРОВКУ';
  renderTranslator();
  closeSignPop();
  $('translate').classList.remove('hidden');
  if (state.decoded) {
    // тексты уже прочитаны — показываем их снова тем же выводом
    renderDecodedTexts();
    paintTrStatus('Эти надписи уже переведены — они лежат в журнале (J).');
    return;
  }
  // подсказку ставит renderTranslator: пока механизмы не изучены, там висит
  // объяснение замка, и перебивать его нельзя
  if (platesUnlocked()) {
    paintTrStatus('Справа — ваши заметки о знаках. На пластине нажмите знак и впишите значение — это уже ответ для ИИ.');
  }
}

/** Три надписи с переводом — то, что игрок читает после расшифровки.
    Перевод «печатается» как вывод ИИ-системы: по символу, в терминальном виде. */
const typeOut = { raf: 0, plan: null, idx: 0, chars: 0, acc: 0, last: 0 };
const TYPE_CPS = 46;   // символов в секунду — читаемо, но всё же «печать»

function stopTyping() {
  if (typeOut.raf) cancelAnimationFrame(typeOut.raf);
  typeOut.raf = 0;
  typeOut.plan = null;
  tr.typing = false;
}

function renderDecodedTexts() {
  stopTyping();
  // журнал с нашими значениями показываем прямо во время вывода —
  // иначе сверять перевод с записями приходится по памяти
  $('trTexts').innerHTML = STORY.TEXTS.map((t) => `
    <article class="tr-text tr-decoded">
      <h4>${t.title}</h4>
      <div class="tr-glyphs">${t.glyphs.map((g) => `<span>${g}</span>`).join('')}</div>
      <p class="tr-term"><span class="tr-text-node"></span><span class="tr-caret"></span></p>
    </article>`).join('');
  paintJournal();
  $('translate').classList.add('reading');

  const nodes = [...$('trTexts').querySelectorAll('.tr-text-node')];
  typeOut.plan = STORY.TEXTS.map((t, i) => ({ node: nodes[i], text: t.ru }));
  typeOut.idx = 0; typeOut.chars = 0; typeOut.acc = 0; typeOut.last = performance.now();
  tr.typing = true;
  $('trSubmit').textContent = 'ПРОПУСТИТЬ ВЫВОД';
  $('trSubmit').disabled = false;
  typeOut.raf = requestAnimationFrame(typeStep);
}

function typeStep(now) {
  if (!typeOut.plan) return;
  typeOut.acc += Math.min(0.1, (now - typeOut.last) / 1000) * TYPE_CPS;
  typeOut.last = now;
  let add = Math.floor(typeOut.acc);
  typeOut.acc -= add;
  while (add > 0 && typeOut.idx < typeOut.plan.length) {
    const p = typeOut.plan[typeOut.idx];
    const need = p.text.length - typeOut.chars;
    const take = Math.min(add, need);
    typeOut.chars += take;
    add -= take;
    p.node.textContent = p.text.slice(0, typeOut.chars);
    if (typeOut.chars >= p.text.length) {
      typeOut.idx += 1;
      typeOut.chars = 0;
      add -= 1;   // пауза между надписями
    }
  }
  if (typeOut.idx >= typeOut.plan.length) { finishTyping(); return; }
  typeOut.raf = requestAnimationFrame(typeStep);
}

/** Дописать всё сразу — «пропустить вывод» */
function finishTyping() {
  if (typeOut.raf) cancelAnimationFrame(typeOut.raf);
  typeOut.raf = 0;
  for (const p of typeOut.plan || []) p.node.textContent = p.text;
  typeOut.plan = null;
  tr.typing = false;
  tr.reading = true;
  document.querySelectorAll('#trTexts .tr-term').forEach((el) => el.classList.add('done'));
  $('trSubmit').textContent = 'ПРОЧИТАНО · ДАЛЬШЕ';
  $('trSubmit').disabled = false;
  paintTrStatus('Три надписи прочитаны — теперь ясно, куда ехать.');
}

/** Иконки предметов: схематичный вид каждого артефакта */
const ITEM_ICONS = {
  key: `<svg viewBox="0 0 40 40"><g fill="none" stroke="#9ff2e6" stroke-width="1.6">
    <ellipse cx="20" cy="21" rx="12" ry="9"/><ellipse cx="20" cy="21" rx="7" ry="5"/>
    <path d="M20 8v6M14 10l2 5M26 10l-2 5"/><circle cx="20" cy="21" r="2.4" fill="#53e0ff" stroke="none"/></g></svg>`,
  bead: `<svg viewBox="0 0 40 40"><g fill="none" stroke="#cfe8f0" stroke-width="1.7">
    <circle cx="20" cy="20" r="10"/><circle cx="20" cy="20" r="2.6"/>
    <path d="M13 14a9 9 0 016-4"/></g></svg>`,
  shard: `<svg viewBox="0 0 40 40"><g fill="none" stroke="#e0c8a8" stroke-width="1.7">
    <path d="M8 12h24l-3 14-9 6-9-6z"/><path d="M8 12c6 4 18 4 24 0"/>
    <path d="M12 27h16"/></g></svg>`,
  disc: `<svg viewBox="0 0 40 40"><g fill="none" stroke="#c8d6dd" stroke-width="1.7">
    <ellipse cx="20" cy="20" rx="11" ry="9"/><circle cx="20" cy="20" r="2.4"/>
    <path d="M9 20h22" opacity=".5"/></g></svg>`,
  figurine: `<svg viewBox="0 0 40 40"><g fill="none" stroke="#d8b48c" stroke-width="1.7">
    <path d="M15 13c0-3 2.4-5 5-5s5 2 5 5v6l4 12H11l4-12z"/>
    <path d="M17 30v5M23 30v5"/><path d="M15 13h10"/></g></svg>`,
  nail: `<svg viewBox="0 0 40 40"><g fill="none" stroke="#c9b184" stroke-width="1.8">
    <path d="M10 8v8l9 3 7-4"/><path d="M26 15l5 14"/><path d="M29 29l4 2"/></g></svg>`,
  tag: `<svg viewBox="0 0 40 40"><g fill="none" stroke="#cfd8dd" stroke-width="1.7">
    <rect x="9" y="12" width="22" height="16" rx="2"/>
    <path d="M14 20h6M22 20h4" opacity=".7"/><path d="M12 14l3 3"/></g></svg>`,
};

/* ------------------------------------------------- 3D-иконки для инвентаря */
const thumbCache = new Map();
let thumbR = null, thumbCam = null;

/** Объёмные находки: те же формы, что лежат в земле */
function buildTrinket(kind) {
  const glass = new THREE.MeshStandardMaterial({ color: 0x7f9aa6, roughness: 0.25, metalness: 0.1 });
  const clay = new THREE.MeshStandardMaterial({ color: 0xc08a5a, roughness: 0.85, flatShading: true });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x9c7a3f, roughness: 0.5, metalness: 0.6 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x8c8b82, roughness: 0.9, flatShading: true });
  const g = new THREE.Group();
  if (kind === 'bead') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), glass);
    g.add(ball);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x11181c }));
    g.add(hole);
  } else if (kind === 'disc') {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.2, 20), bronze);
    g.add(d);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x11181c }));
    g.add(hole);
  } else if (kind === 'shard') {
    const s = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 0.92, 1.4, 14, 1, true, 0, 2.1),
      new THREE.MeshStandardMaterial({ color: 0xc08a5a, roughness: 0.85, side: THREE.DoubleSide, flatShading: true }),
    );
    g.add(s);
  } else if (kind === 'figurine') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.8, 6, 12), clay);
    body.position.y = 0.15;
    g.add(body);
    for (const x of [-0.22, 0.22]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.7, 8), clay);
      leg.position.set(x, -0.85, 0.1);
      g.add(leg);
    }
  } else if (kind === 'nail') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2, 10), bronze);
    shaft.rotation.z = 0.5;
    g.add(shaft);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.1, 12), bronze);
    head.position.set(-0.5, 0.9, 0);
    head.rotation.z = 1.0;
    g.add(head);
    const bend = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 10), bronze);
    bend.position.set(0.85, -0.6, 0);
    bend.rotation.z = -0.9;
    g.add(bend);
  } else {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.12), stone);
    g.add(plate);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x4a4a44 }));
    mark.position.z = 0.09;
    g.add(mark);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** Снять объёмное превью предмета в маленькую картинку */
function itemThumb(kind) {
  if (thumbCache.has(kind)) return thumbCache.get(kind);
  if (!thumbR) {
    thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbR.setPixelRatio(2);
    thumbR.setSize(140, 140);
    thumbCam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    thumbCam.position.set(0, 0, 5);
    thumbCam.lookAt(0, 0, 0);
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.25));
  const l1 = new THREE.DirectionalLight(0xfff0d8, 2.6); l1.position.set(3, 5, 4); scene.add(l1);
  const l2 = new THREE.DirectionalLight(0x86c8ff, 1.4); l2.position.set(-4, -1, -3); scene.add(l2);

  const obj = kind === 'key' ? buildPhaseCore().group : buildTrinket(kind);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  obj.position.sub(center);
  const holder = new THREE.Group();
  holder.add(obj);
  holder.scale.setScalar(2.6 / (Math.max(size.x, size.y, size.z) || 1));
  holder.rotation.set(0.42, 0.72, 0.12);
  scene.add(holder);
  thumbR.render(scene, thumbCam);
  const url = thumbR.domElement.toDataURL('image/png');
  thumbCache.set(kind, url);
  return url;
}

/** Подсветка знаков на пластинах.
    'note'  — у знака есть заметка в журнале (по умолчанию);
    'seen'  — знак уже встречался на механизме;
    'picks' — знаку уже вписано значение (самый строгий вариант). */
const TRANSLATOR_HIGHLIGHT = 'note';

/* Две версии пластин, различаются одним словом в адресе:
   ?notes=on  — знаки, у которых есть заметка, обведены (по умолчанию);
   ?notes=off — пластины чистые: ни обводок, ни притухания, все знаки равны. */
const NOTES_MODE = (() => {
  const m = /(?:^|[?&#])notes=(on|off)(?:$|[&#])/i.exec(location.search + location.hash);
  return m ? m[1].toLowerCase() : 'on';
})();
// версия пластин видна и в разметке: пригодится и для отладки, и для CSS
document.body.dataset.notes = NOTES_MODE;

/* Пластины открываются только после того, как изучены все механизмы:
   три артефакта × два состояния = шесть знаков в журнале. До этого знаки
   на пластинах видны, но нажать их нельзя, и кнопки отправки в окне нет —
   своей возможности вписать значение просто не существует. */
function platesUnlocked() {
  return STORY.keysComplete(state);
}

function plateGlyphClass(glyph, has, bad) {
  if (NOTES_MODE === 'off') return `tr-g${has ? ' has' : ''}${bad ? ' bad' : ''}`;
  const key = STORY.KEYS.find((k) => k.glyph === glyph);
  const noted = key ? !!String(state.signNotes[key.id] || '').trim() : false;
  const seen = key ? state.keys.includes(key.id) : false;
  const mark = TRANSLATOR_HIGHLIGHT === 'note' ? noted
    : TRANSLATOR_HIGHLIGHT === 'seen' ? seen : false;
  const lit = TRANSLATOR_HIGHLIGHT === 'picks' ? has : (mark || has);
  return `tr-g${lit ? ' familiar' : ' unseen'}${has ? ' has' : ''}${bad ? ' bad' : ''}`;
}

/** Обновить подсветку прямо в разметке: журнал при этом не перерисовывается,
    и поле заметки не теряет фокус при вводе */
function paintPlateMarks() {
  const unlocked = platesUnlocked();
  document.querySelectorAll('#trTexts .tr-g').forEach((el) => {
    const glyph = el.dataset.glyph;
    const has = (state.picks || []).some((p) => p.glyph === glyph);
    const bad = !!(tr.bad && tr.bad.has(glyph));
    const cls = `${plateGlyphClass(glyph, has, bad)}${unlocked ? '' : ' locked'}`;
    if (el.className !== cls) el.className = cls;
  });
}

/** Перерисовать пластины манускриптов и строку журнала под ними */
function renderTranslator() {
  // предметы: фазовый ключ и находки — тоже в инвентаре
  const items = [];
  if (state.artifact || state.keyItem) {
    items.push({ icon: 'key', name: 'Фазовый ключ', text: 'Регулятор энергии: слои откликаются на импульсы у порога резонанса.' });
  }
  for (const id of state.trinkets || []) {
    const t = STORY.TRINKETS.find((x) => x.id === id);
    if (t) items.push({ icon: t.id, name: t.name, text: t.text });
  }
  if (items.length) {
    $('trItems').innerHTML = items.map((it) => `<div class="inv-item">`
      + `<img class="ig" alt="" src="${itemThumb(it.icon)}">`
      + `<span><span class="it-name">${it.name}</span>`
      + `<span class="it-text">${it.text}</span></span></div>`).join('');
  } else {
    $('trItems').innerHTML = '<div class="tr-note" style="opacity:.6">пока ничего не найдено</div>';
  }

  const found = state.scrolls;
  const pickedGlyphs = new Set((state.picks || []).map((p) => p.glyph));
  const DMG = ['a', 'b', 'c'];
  const unlocked = platesUnlocked();
  $('trTexts').innerHTML = STORY.SCROLLS.map((sc, idx) => {
    const text = STORY.TEXTS.find((x) => x.id === sc.textId);
    const known = found.includes(sc.id);
    // неподнятая пластина — просто пустой слот: ни металла, ни подписей
    if (!known) return '<article class="tr-text"><h4>&nbsp;</h4><div class="tr-plate tr-plate--empty"></div></article>';
    const body = known
      ? `<div class="tr-plate dmg-${DMG[idx % 3]}"><div class="tr-plate__grid">${text.glyphs.map((g, i) => {
        const has = pickedGlyphs.has(g);
        const bad = tr.bad && tr.bad.has(g);
        const cls = `${plateGlyphClass(g, has, bad)}${unlocked ? '' : ' locked'}`;
        return `<span class="${cls}" data-glyph="${g}" data-slot="${sc.id}-${i}"${unlocked ? '' : ' aria-disabled="true"'}>${g}</span>`;
      }).join('')}</div></div>`
      : `<h4>&nbsp;</h4><div class="tr-plate tr-plate--empty"></div>`;
    return `<article class="tr-text"><h4>${sc.title}</h4>${body}</article>`;
  }).join('');

  // ---- ЖУРНАЛ: просто шпаргалка со знаками, ни на что не влияет
  paintJournal();

  // клик по любому знаку на пластине — окошко для своего перевода.
  // Пока механизмы не изучены, обработчиков нет вовсе: нажимать нечего.
  if (unlocked) {
    $('trTexts').querySelectorAll('.tr-g').forEach((g) => {
      g.addEventListener('click', () => openSignPop(g.dataset.glyph, g.getBoundingClientRect()));
    });
  }

  const n = pickedGlyphs.size;
  const submit = $('trSubmit');
  const status = $('trStatus');
  status.classList.toggle('bad', false);
  status.classList.toggle('locked', !unlocked && !state.decoded);
  // кнопки отправки до изучения механизмов просто нет в окне
  submit.hidden = !unlocked && !state.decoded;
  if (state.decoded) submit.disabled = false;
  else submit.disabled = n < STORY.PICK_MAX || !STORY.scrollsComplete(state);

  if (!unlocked) {
    status.textContent = `Пластины пока не читаются · механизмы ${state.solved.length} / ${STORY.ARTIFACTS.length}, `
      + `знаки ${state.keys.length} / ${STORY.KEYS.length}. Значения на пластины можно будет вписать, `
      + 'когда вы изучите все три механизма — оба состояния каждого.';
  }
}

/** Журнал — только наши заметки: знак и поле, куда пишем своё наблюдение.
    С пластинами он никак не связан: значения для ИИ вводятся на пластинах. */
function paintJournal() {
  const box = $('trWords');
  if (!box) return;
  box.innerHTML = STORY.KEYS.map((k) => {
    const seen = state.keys.includes(k.id);
    const note = state.signNotes[k.id] || '';
    return `<div class="tr-row${seen ? '' : ' empty'}" data-note="${k.id}">`
      + `<span class="tr-glyph">${k.glyph}</span>`
      + `<input class="tr-note-input" data-note="${k.id}" maxlength="120"`
      + ` placeholder="${seen ? 'заметка…' : 'знак ещё не встречался'}"`
      + ` value="${escAttr(note)}"${seen ? '' : ' disabled'}></div>`;
  }).join('');
  box.querySelectorAll('.tr-note-input').forEach((inp) => {
    inp.addEventListener('input', () => {
      const id = inp.dataset.note;
      const v = inp.value.slice(0, 120);
      if (v.trim()) state.signNotes[id] = v;
      else delete state.signNotes[id];
      paintPlateMarks();
      scheduleSignSave();
    });
  });
}

/** Убрать знак из журнала — можно выбрать на его место другой */
function deletePick(glyph) {
  if (!platesUnlocked()) return;
  const i = state.picks.findIndex((p) => p.glyph === glyph);
  if (i < 0) return;
  state.picks.splice(i, 1);
  tr.bad = null;
  if (tr.activeGlyph === glyph) closeSignPop();
  scheduleSignSave();
  renderTranslator();
  audio.ui();
  paintTrStatus(`Перевод для знака ${glyph} убран.`);
}

/** Окошко значения у выбранного знака. Никогда не накрывает журнал. */
function openSignPop(glyph, rect) {
  if (!platesUnlocked()) {
    paintTrStatus('Сначала изучите все три механизма — тогда знаки на пластинах можно будет подписывать.', true);
    audio.deny();
    return;
  }
  const pop = $('trPop');
  const idx = state.picks.findIndex((p) => p.glyph === glyph);
  const picked = idx >= 0;
  tr.activeGlyph = glyph;
  pop.dataset.glyph = glyph;
  $('trPopGlyph').textContent = glyph;
  $('trPopInput').value = picked ? state.picks[idx].value : '';
  $('trPopHint').textContent = picked ? 'перевод записан' : 'новый перевод';
  $('trPopDel').classList.toggle('hidden', !picked);

  pop.classList.remove('hidden');
  // ставим рядом со знаком, но не ниже верха журнала
  const pad = 8;
  const W = 250;
  const card = document.querySelector('#translate .card').getBoundingClientRect();
  const side = document.querySelector('.tr-col--journal');
  const jbar = side ? side.getBoundingClientRect() : card;
  const H = pop.offsetHeight;
  let left = rect.left + rect.width / 2 - W / 2;
  left = Math.max(card.left + 6, Math.min(card.right - W - 6, left));
  let top = rect.bottom + 10;
  const maxTop = jbar.top - H - pad;
  if (top > maxTop) top = rect.top - H - 10;
  top = Math.max(6, Math.min(maxTop, top));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  $('trPopInput').focus();
  $('trPopInput').select();
}

function closeSignPop() {
  tr.activeGlyph = null;
  $('trPop').classList.add('hidden');
}

/** Записать значение из окошка: пустое поле = убрать знак из журнала */
function saveSignPop() {
  if (!platesUnlocked()) {
    closeSignPop();
    paintTrStatus('Сначала изучите все три механизма — тогда знаки на пластинах можно будет подписывать.', true);
    audio.deny();
    return;
  }
  const pop = $('trPop');
  const glyph = pop.dataset.glyph;
  if (!glyph) { closeSignPop(); return; }
  const v = $('trPopInput').value.trim().slice(0, 80);
  const idx = state.picks.findIndex((p) => p.glyph === glyph);
  if (!v) {
    if (idx >= 0) deletePick(glyph);
    else closeSignPop();
    return;
  }
  if (idx >= 0) state.picks[idx].value = v;
  else state.picks.push({ glyph, value: v });
  tr.bad = null;
  scheduleSignSave();
  closeSignPop();
  renderTranslator();
  audio.ui();
  const left = STORY.PICK_MAX - state.picks.length;
  paintTrStatus(left
    ? `Переведено ${state.picks.length} из ${STORY.PICK_MAX}.`
    : `Все ${STORY.PICK_MAX} перевода введены — отправьте ИИ на расшифровку.`);
}

function paintTrStatus(text, bad) {
  const el = $('trStatus');
  el.textContent = text;
  el.classList.toggle('bad', !!bad);
  el.classList.remove('locked');
}

function submitTranslate() {
  if (state.decoded) { renderDecodedTexts(); return; }
  if (!platesUnlocked()) {
    paintTrStatus(`ИИ ждёт шесть знаков · изучено механизмов ${state.solved.length} / ${STORY.ARTIFACTS.length}. `
      + 'Отправка станет доступна, когда будут изучены все три механизма.', true);
    audio.deny();
    return;
  }
  const picks = (state.picks || []).filter((p) => p && p.glyph);
  if (picks.length < STORY.PICK_MAX) {
    paintTrStatus(`Переведено ${picks.length} из ${STORY.PICK_MAX} знаков — нажмите на знак и впишите перевод.`, true);
    audio.deny();
    return;
  }
  const chk = STORY.checkPicks(picks);
  const wrong = [...new Set([...chk.wrong, ...chk.foreign])];
  const missing = chk.missing.map((k) => k.glyph);
  tr.bad = new Set([...wrong, ...missing]);
  renderTranslator();
  if (wrong.length || missing.length) {
    const n = wrong.length + missing.length;
    paintTrStatus(`ИИ: не сходится у ${n} ${n === 1 ? 'знака' : 'знаков'} — они подсвечены красным. `
      + 'Поправьте перевод и отправьте снова.', true);
    audio.deny();
    return;
  }
  if (!STORY.scrollsComplete(state)) {
    paintTrStatus('Слова верны, но не хватает манускриптов: поднимите все три схрона.', true);
    return;
  }
  tr.bad = null;
  if (!STORY.decode(state)) {
    paintTrStatus('Слова верны, но переводчик молчит: проверьте манускрипты.', true);
    return;
  }
  // насыпь уже вскрыта, а ключ так и лежал в нише — теперь его можно снять
  if (state.dig >= 1 && STORY.complete(state, 'artifact')) {
    world.takePhaseCore();
    toast('Фазовый ключ снят с алтаря — он в инвентаре');
  }
  renderDecodedTexts();
  paintTrStatus('Расшифровка идёт — система выводит надписи.');
  audio.stage();
  saveGame();
}

/** Закрыли окно с надписями — короткий обмен репликами и дальше по карте */
function finishReading() {
  if (!tr.reading) return;
  stopTyping();
  tr.reading = false;
  $('trSubmit').textContent = 'НАДПИСИ ПРОЧИТАНЫ';
  $('trSubmit').disabled = true;
  $('translate').classList.remove('reading');
  closeTop();
  say([
    { who: 'МИРА', text: 'Всё. Дальше язык кончается — начинаются дела.' },
    { who: 'НИНА', text: 'Гора, камень, насыпь. Заводи, я проверю баллон.' },
  ], 'explore');
}

/* ============================================ РАСКОПКИ КУРГАНА (та же клавиша F)
   Механика одна на всю игру: жмёте F, земля проседает. Разница только в том,
   сколько грунта предстоит снять — здесь его насыпано восемь метров. */
const moundAnim = { active: false, from: 0, to: 0, t: 0 };
const MOUND_STEP = 1 / 3;   // один заход снимает треть насыпи

function onMound() {
  if (state.excavation && state.excavation.recorded) return false;
  if (state.artifact) return false;
  return Math.hypot(rover.pos.x - TEMPLE.x, rover.pos.z - TEMPLE.z) < MOUND_R - 3;
}

function moundDig() {
  if (state.decoded) { openExcavation(); return; }
  // Копать можно откуда угодно: если машина стоит над осевым проёмом, её
  // мягко оттолкнёт от арки уже во время просадки свода (updateMound).
  if (rover.energy < HAND_DIG_COST) {
    toast(`Мало энергии: на вскрышные работы нужно ${HAND_DIG_COST}%`);
    audio.tone(200, 0.18, 'sine', 0.05, 120);
    return;
  }
  // Без письмен непонятно, где именно под насыпью вход: снимаем только
  // верхний слой грунта и ничего не находим
  if (!state.decoded) {
    // копаем насыпь как обычный шурф: тот же расход, тот же исход
    if (STORY.handDigLeft(state) <= 0) {
      toast(`Шурфы кончились: на экспедицию их ${STORY.HAND_DIGS_MAX}`);
      audio.tone(170, 0.22, 'sine', 0.06, 120);
      return;
    }
    rover.vel.x = 0; rover.vel.z = 0; rover.speed = 0;
    rover.energy = Math.max(0, rover.energy - HAND_DIG_COST);
    const ang = Math.atan2(TEMPLE.z - rover.pos.z, TEMPLE.x - rover.pos.x)
      + (Math.random() - 0.5) * 1.6;
    const x = rover.pos.x + Math.cos(ang) * 2.4;
    const z = rover.pos.z + Math.sin(ang) * 2.4;
    const res = STORY.digAnywhere(state, x, z);
    if (!res.ok) return;
    const e = addHandDig(x, z);
    handGrow.push({ e, t: 0 });
    rover.shake = Math.max(rover.shake, 0.35);
    audio.dig(true);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 3.4;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      rover.dust.emit(new THREE.Vector3(px, meshHeightAt(px, pz) + 0.5, pz), 2, 4.2, 'clod');
    }
    paintProgress();
    saveGame();
    digOutcome(res);
    return;
  }
  rover.vel.x = 0; rover.vel.z = 0; rover.speed = 0;
  rover.energy = Math.max(0, rover.energy - HAND_DIG_COST);
  moundAnim.active = true;
  moundAnim.from = digProgress();
  moundAnim.to = Math.min(1, moundAnim.from + MOUND_STEP);
  moundAnim.t = 0;
  moundAnim.warned = false;
  rover.shake = Math.max(rover.shake, 0.45);
  audio.dig(true);
  audio.rumble(0.9, 0.1);
  saveGame();
}

function openExcavation() {
  if(mode!=='explore' || state.excavation.recorded) return;
  const reconstruction=state.artifact;
  $('cutTitle').textContent=reconstruction?'Реконструкция раскопа':'Раскопки храма';
  $('cutExtract').textContent=reconstruction?'Завершить реконструкцию':'Извлечь фазовый ключ';
  mode='excavation';
  releaseLook(); rover.vel.set(0,0,0); rover.speed=0;
  keys.Space=false;
  camera.position.set(TEMPLE.x+19,meshHeightAt(TEMPLE.x,TEMPLE.z)+28,TEMPLE.z+24);
  camera.lookAt(TEMPLE.x,meshHeightAt(TEMPLE.x,TEMPLE.z),TEMPLE.z);
  composer.render();
  ui.prompt.classList.remove('on');
  $('excavation').classList.remove('hidden');
  showDigPanel(state.excavation,()=>{audio.dig(true);saveGame();},()=>{
    if(mode!=='excavation') return;
    state.excavation.recorded=true;
    if(reconstruction){saveGame();closeTop();toast('Реконструкция записана в журнал');return;}
    // Слои расходимся на глазах: закрываем схему, возвращаем камеру к машине
    // и медленно проседаем насыпью — без мгновенного переноса к храму.
    closeTop();
    world.repaintDig();
    moundAnim.active = true;
    moundAnim.from = digProgress();
    moundAnim.to = 1;
    moundAnim.t = 0;
    moundAnim.warned = false;
    moundAnim.acc = 0;
    rover.shake = Math.max(rover.shake, 0.45);
    audio.rumble(1.2, 0.12);
    saveGame();
  },closeTop);
}

function updateMound(dt) {
  if (!moundAnim.active) return;
  moundAnim.t = Math.min(1, moundAnim.t + dt / 1.7);
  const k = moundAnim.t * moundAnim.t * (3 - 2 * moundAnim.t);
  setDig(moundAnim.from + (moundAnim.to - moundAnim.from) * k);
  state.dig = digProgress();
  world.setTempleReveal(state.dig);

  // страховка: если машина оказалась над осевым проёмом, её вместе с грунтом
  // утащит внутрь арки, откуда нет выезда — плавно отодвигаем к краю
  const gx = rover.pos.x - TEMPLE.x, gz = rover.pos.z - TEMPLE.z;
  const gr = Math.hypot(gx, gz);
  if (gr < 15) {
    const outX = gr > 0.01 ? gx / gr : 1, outZ = gr > 0.01 ? gz / gr : 0;
    // до 9 м/с наружу — без рывка, но гарантированно успевает выйти за арку
    const step = Math.min(15 - gr, 9 * dt) + 0.0001;
    rover.pos.x += outX * step;
    rover.pos.z += outZ * step;
    rover.vel.x = 0; rover.vel.z = 0;
    rover.snapToGround();
    if (!moundAnim.warned) {
      moundAnim.warned = true;
      toast('Свод просел — машину оттолкнуло от арки');
    }
  }

  // рельеф и траву пересчитываем не каждый кадр: на перестройке мешей игра
  // подтормаживала и снятие газа выглядело дрганьем. 0.12 с — незаметно глазу.
  moundAnim.acc = (moundAnim.acc || 0) + dt;
  const final = moundAnim.t >= 1;
  if (moundAnim.acc > 0.12 || final) {
    moundAnim.acc = 0;
    world.repaintArea(TEMPLE.x, TEMPLE.z, MOUND_R + 6, final);
    world.regroundArea(TEMPLE.x, TEMPLE.z, MOUND_R + 10);
    rover.snapToGround();
  }

  // пыль столбом по всей насыпи — видно, как пласт уходит за пластом
  if (Math.random() < dt * 70) {
    const a = Math.random() * Math.PI * 2;
    const r = 5 + Math.random() * (MOUND_R - 5);
    const px = TEMPLE.x + Math.cos(a) * r, pz = TEMPLE.z + Math.sin(a) * r;
    rover.dust.emit(new THREE.Vector3(px, meshHeightAt(px, pz) + 0.6, pz), 2, 5.4, 'clod');
  }
  rover.shake = Math.max(rover.shake, 0.3);
  if (Math.random() < dt * 12) audio.dig(true);
  if (moundAnim.t < 1) return;

  moundAnim.active = false;
  if (moundAnim.to >= 1) {
    setDig(1);
    world.repaintDig();
    world.revealPhaseCore();
    paintProgress();
    saveGame();
    // чистый раскоп или с обвалами — показываем сразу, а не только в журнале
    const digReport = templeReport(state.excavation);
    if (digReport) setTimeout(() => toast(digReport), 1500);
    // ключ остаётся висеть над алтарём: его надо подъехать и снять (E)
    setTimeout(() => {
      say([
        { who: 'МИРА', text: STORY_TEXT.digDone },
        { who: 'НИНА', text: 'Ключ висит над алтарём. Подъезжай ближе и снимай — без него к аномалии лучше не соваться.' },
      ], 'explore');
    }, 900);
  } else {
    toast(`Насыпь просела · вскрыто ${Math.round(moundAnim.to * 100)}%`);
  }
}

/* ============================================== АРТЕФАКТ: осмотр и описание */
let artBoot = null;

function openArtifact() {
  mode = 'artifact';
  $('artifact').classList.remove('hidden');
  if (!artBoot) artBoot = bootArtifact();
  // ключ теперь в руках: он остаётся в инвентаре, а с алтаря исчезает
  state.keyItem = true;
  saveGame();
  world.takePhaseCore();
}

function bootArtifact() {
  const canvas = $('artCanvas');
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xc8eaff, 0x403057, 3.2));
  const dl = new THREE.DirectionalLight(0xffffff, 3);
  dl.position.set(4, 6, 5);
  sc.add(dl);
  const camArt = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camArt.position.set(0, 0, 9);

  const g = new THREE.Group();
  // в панели показываем тот же ключ, что стоит в мире
  const core = buildPhaseCore();
  core.group.scale.setScalar(1.15);
  g.add(core.group);
  sc.add(g);

  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // крутим во всех плоскостях: по горизонтали — вокруг Y, по вертикали — вокруг X
    g.rotation.y += (e.clientX - lastX) * 0.01;
    g.rotation.x = Math.max(-1.35, Math.min(1.35, g.rotation.x + (e.clientY - lastY) * 0.01));
    lastX = e.clientX; lastY = e.clientY;
  });

  return {
    r, sc, cam: camArt, g, core,
    draw(dt, t) {
      const w = canvas.clientWidth || 320, h = canvas.clientHeight || 260;
      if (canvas.width !== Math.round(w * 2) || canvas.height !== Math.round(h * 2)) {
        r.setSize(w, h, false);
        camArt.aspect = w / h;
        camArt.updateProjectionMatrix();
      }
      // объект сам не крутится — его вращает мышь, крутятся только оболочки
      g.position.y = Math.sin(t * 1.2) * 0.12;
      core.rings.forEach((ring, i) => {
        ring.rotation.z += dt * (i % 2 === 0 ? 1 : -1) * (0.9 + i * 0.3);
      });
      for (const o of core.orbits) o.rotation.y += dt * o.userData.spin;
      r.render(sc, camArt);
    },
  };
}

/* =================================================== МИНИИГРА 3: АНОМАЛИЯ */
const sig = { freq: 1.2, phase: 0, hold: 0, score: 0, wired: false };

function openSignal() {
  mode = 'signal';
  sig.freq = 1.2; sig.phase = 0; sig.hold = 0; sig.score = 0;
  $('signal').classList.remove('hidden');
  if (!sig.wired) {
    $('sigFreq').addEventListener('input', (e) => { sig.freq = +e.target.value; });
    $('sigPhase').addEventListener('input', (e) => { sig.phase = +e.target.value; });
    sig.wired = true;
  }
  $('sigFreq').value = sig.freq;
  $('sigPhase').value = sig.phase;
  $('sigStatus').textContent = 'Подстройте частоту и фазу под волну аномалии';
}

function drawWaves() {
  const cv = $('sigCanvas');
  const dpr = Math.min(devicePixelRatio, 2);
  const w = cv.clientWidth || 480, h = cv.clientHeight || 150;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const wave = (freq, phase, color, amp, width) => {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const u = x / w;
      const y = h / 2 + Math.sin(u * Math.PI * 2 * (freq / 1.6) + phase) * amp;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };

  wave(2.65, 1.35, 'rgba(190,140,255,0.85)', h * 0.26, 2);
  wave(sig.freq, sig.phase, 'rgba(140,236,223,0.95)', h * 0.26, 2);
  ctx.strokeStyle = 'rgba(140,180,210,0.18)';
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}

function updateSignal(dt) {
  const score = STORY.syncScore(sig.freq, sig.phase);
  sig.score = score;
  sig.hold = score >= 0.97 ? sig.hold + dt : 0;
  $('sigScore').textContent = `${Math.round(score * 100)}%`;
  $('sigScore').style.color = score >= 0.97 ? '#8cecdf' : '#ffd27a';
  $('sigBar').style.width = `${score * 100}%`;
  $('sigStatus').textContent = sig.hold > 0
    ? `Фиксация резонанса · ${Math.min(STORY.SYNC_HOLD, sig.hold).toFixed(1)} / ${STORY.SYNC_HOLD} с`
    : 'Подстройте частоту и фазу под волну аномалии';
  if (sig.hold >= STORY.SYNC_HOLD) {
    STORY.complete(state, 'synced');
    world.setBarrier(true);
    audio.whoosh();
    audio.stage();
    saveGame();
    $('signal').classList.add('hidden');
    setTimeout(() => {
      say([
        { who: 'ЛЕВ', text: STORY_TEXT.signalDone },
        { who: 'МИРА', text: STORY.LORE.synced[1] },
      ], 'explore');
    }, 300);
  }
}

/* ================================================================== КАРТА */
function mapPoints() {
  const out = [];
  // три схрона с манускриптами: точки уже отодвинуты от аномалий и насыпи
  for (const sc of (P.scrolls || STORY.SCROLLS)) {
    out.push({
      id: `scroll-${sc.id}`, label: sc.name || sc.title, x: sc.x, z: sc.z, color: '#ffcf8a',
      done: state.scrolls.includes(sc.id),
    });
  }
  for (const a of P.artifacts) {
    const art = STORY.artifactById(a.id);
    out.push({
      id: `art-${a.id}`, label: art.name, x: a.x, z: a.z, color: '#9ff2e6',
      done: state.solved.includes(a.id),
    });
  }
  // маркера храма на карте нет: где копать — надо догадаться по текстам
  if (state.artifact) {
    out.push({ id: 'temple', label: 'Храм', x: P.temple.x, z: P.temple.z, color: '#c7b6ff', done: true });
  }
  out.push({ id: 'anomaly', label: 'Аномалия', x: P.anomaly.x, z: P.anomaly.z, color: '#b9a0ef', done: state.synced });
  out.push({ id: 'core', label: 'Сердце бури', x: P.core.x, z: P.core.z, color: '#ffa040', done: false });
  for (const a of P.aholas) {
    // на карте подпись короткая: полное «Ахола 03» наезжает на соседние точки
    const n = Number(String(a.id).replace('ahola', '')) + 1;
    out.push({ id: a.id, label: a.name, short: `А${n}`,
      x: a.x, z: a.z, color: '#8cecdf', done: state.used.includes(a.id), ahola: a });
  }
  return out;
}

function openMap() {
  audio.ui();
  mode = 'map';
  $('map').classList.remove('hidden');
  drawMap();
}

function drawMap() {
  const cv = $('mapCanvas');
  const box = cv.parentElement.getBoundingClientRect();
  const size = Math.max(240, Math.min(box.width - 8, innerHeight - 190));
  const dpr = Math.min(devicePixelRatio, 2);
  cv.style.width = `${size}px`;
  cv.style.height = `${size}px`;
  cv.width = Math.round(size * dpr);
  cv.height = Math.round(size * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const S = size / (ZONE_R * 2.25);
  const cx = size / 2, cy = size / 2;
  const to = (x, z) => [cx + x * S, cy + z * S];

  ctx.fillStyle = 'rgba(10,24,34,0.55)';
  ctx.beginPath(); zoneOutline(ctx, to, ZONE_R, 72); ctx.fill();
  ctx.strokeStyle = 'rgba(120,190,220,0.25)';
  ctx.beginPath(); zoneOutline(ctx, to, ZONE_R, 72); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,190,220,0.10)';
  for (const f of [0.33, 0.66]) {
    ctx.beginPath(); ctx.arc(cx, cy, ZONE_R * S * f, 0, Math.PI * 2); ctx.stroke();
  }

  if (!state.synced) {
    const [px, py] = to(P.core.x, P.core.z);
    ctx.strokeStyle = 'rgba(185,160,239,0.55)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(px, py, 40 * S, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // смертельный радиус аномалии виден сразу: нечего проверять обшивкой
  {
    const [ax, ay] = to(P.anomaly.x, P.anomaly.z);
    ctx.fillStyle = 'rgba(185,160,239,0.10)';
    ctx.beginPath(); ctx.arc(ax, ay, 42 * S, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(198,150,255,0.45)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(ax, ay, 42 * S, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  const target = navTarget || STORY.objective(state, rover.pos).target;
  if (target && target.x !== undefined) {
    const [rx, ry] = to(rover.pos.x, rover.pos.z);
    const [tx, ty] = to(target.x, target.z);
    ctx.strokeStyle = 'rgba(227,183,142,0.45)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]);
  }

  // подписи не должны налезать друг на друга: не влезла — остаётся точка
  const boxes = [];
  const fits = (x, y, w, h) => {
    for (const b of boxes) {
      if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return false;
    }
    boxes.push({ x, y, w, h });
    return true;
  };

  for (const p of mapPoints()) {
    const [x, y] = to(p.x, p.z);
    ctx.beginPath(); ctx.arc(x, y, p.ahola ? 3.4 : 4.4, 0, Math.PI * 2);
    ctx.fillStyle = p.done ? 'rgba(124,148,153,0.85)' : p.color;
    ctx.fill();
    const text = p.done ? `${p.short || p.label} ✓` : (p.short || p.label);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = p.done ? 'rgba(150,175,190,0.7)' : 'rgba(226,244,252,0.95)';
    for (const [ox, oy] of [[8, -6], [8, 12], [-w - 8, -6], [-w - 8, 12]]) {
      if (fits(x + ox, y + oy - 9, w, 12)) {
        ctx.fillText(text, x + ox, y + oy);
        break;
      }
    }
  }

  const [rx, ry] = to(rover.pos.x, rover.pos.z);
  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(-yawOf());
  ctx.fillStyle = '#b4ffee';
  ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(-5.5, -6); ctx.lineTo(0, -3); ctx.lineTo(5.5, -6); ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(160,180,190,0.9)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('N ↑', 12, 20);
  ctx.fillText(`контур — проходимая зона, ~${Math.round(ZONE_R * 2)} м`, 12, size - 14);
}

/** Путь по реальному (неровному) контуру зоны — им же пользуется мини-карта */
function zoneOutline(ctx, to, radius, seg) {
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const r = radius * zoneBulge(a);
    const [x, y] = to(Math.cos(a) * r, Math.sin(a) * r);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/* ================================================================ ЖУРНАЛ */
function openJournal() {
  audio.ui();
  mode = 'journal';
  const trinket = (id) => STORY.TRINKETS.find((t) => t.id === id);
  $('journalList').innerHTML = state.journal
    .map((id) => {
      if (id==='artifact' && templeReport(state.excavation)) return '<article><h4>'+STORY.LORE.artifact[0]+'</h4><p>'+STORY.LORE.artifact[1]+' '+templeReport(state.excavation)+'</p></article>';
      if (STORY.LORE[id]) return `<article><h4>${STORY.LORE[id][0]}</h4><p>${STORY.LORE[id][1]}</p></article>`;
      const tr = trinket(id);
      if (tr) return `<article class="trinket"><h4>◇ ${tr.name}</h4><p>${tr.text}</p></article>`;
      return '';
    })
    .join('');
  $('journal').classList.remove('hidden');
}

/* Миниигра «сигнал»: её состояние нужно и в паузе, и в обработчиках мыши */
let resumeSignal = false;
let signalPointer = false;

/* ================================================================ ПАУЗА */
function openPause(auto = false) {
  if (!auto) audio.ui();
  if (['ending', 'epilogue', 'menu', 'defeat'].includes(mode)) return;
  resumeSignal=mode==='signal';
  if(resumeSignal) { keys.Space=false; signalPointer=false; $('signal').classList.add('hidden'); }
  // в меню музыка молчит: трек ставится на паузу с того же места
  MUSIC.suspend();
  mode = 'pause';
  $('cursorPick').classList.add('hidden');
  $('pause').classList.remove('hidden');
  $('pauseNote').textContent = auto ? 'Буря остановлена: игра потеряла фокус' : 'Буря остановлена';
}

/* вид курсора: список прямо в паузе, выбор сразу применяется и запоминается */
function openCursorPick() {
  if (mode !== 'pause') return;
  audio.ui();
  if (window.AVARIS_CURSORS) window.AVARIS_CURSORS.renderPicker($('cursorList'));
  $('pause').classList.add('hidden');
  $('cursorPick').classList.remove('hidden');
}

function closeCursorPick() {
  audio.ui();
  $('cursorPick').classList.add('hidden');
  if (mode === 'pause') $('pause').classList.remove('hidden');
}

function closeTop() {
  audio.ui();
  if(mode==='pause' && resumeSignal) {
    resumeSignal=false; mode='signal'; $('pause').classList.add('hidden'); $('signal').classList.remove('hidden'); return;
  }
  $('excavation').classList.add('hidden');
  const wasArtifact = mode === 'artifact';
  // журнал/миниигра только что закрылись: Esc в ближайшие мгновения
  // и поздняя потеря захвата указателя не должны открывать паузу
  overlayClosedAt = performance.now();
  lockDropIgnore = performance.now() + 700;
  stopTyping();
  tr.reading = false;
  clearFocus();
  $('artifact').classList.add('hidden');
  $('lesson').classList.add('hidden');
  $('translate').classList.add('hidden');
  $('translate').classList.remove('focus');
  $('translate').classList.remove('reading');
  $('lesson').classList.remove('focus');
  $('signal').classList.add('hidden');
  $('map').classList.add('hidden');
  $('journal').classList.add('hidden');
  $('cursorPick').classList.add('hidden');
  $('pause').classList.add('hidden');
  const popEl = $('trPop');
  if (popEl) popEl.classList.add('hidden');
  if (mode !== 'ending' && mode !== 'defeat') mode = 'explore';
  // журнал открывали от механизма — возвращаем игрока к тому же механизму
  const back = tr.fromInspect;
  tr.fromInspect = null;
  if (back && back.group) {
    inspect.site = back;
    inspect.holding = false;
    rover.group.visible = false;
    focusFit(back.group, back.shot);
    snapToFocus();
    world.hideRocksBlocking(camera.position, back.pos || back.group.position, 2.6);
    mode = 'inspect';
    paintInspectPrompt();
    paintProgress();
    return;
  }
  // если наложение открыли прямо из осмотра механизма — вернуть всё как было,
  // иначе машина остаётся спрятанной и камера висит на механизме
  if (inspect.site || !rover.group.visible) {
    inspect.site = null;
    inspect.holding = false;
    rover.group.visible = true;
    ui.prompt.classList.remove('on');
    paintProgress();
  }
  // вернулись в езду — снова берём указатель, курсор не мозолит глаза
  requestLook();
  // осмотрели находку — в мире ключа больше нет (но только если он уже в сумке)
  if (state.artifact && world.phaseRevealed) world.takePhaseCore();
}

/* ================================================================ ФИНАЛ */
function finalDialogue() {
  say([{"who": "УСТРОЙСТВО", "text": "Доступ разрешён. Вы стоите в узле номер ноль. Две тысячи лет назад мы сами построили бурю — чтобы управлять небом. Сначала это работало."}, {"who": "УСТРОЙСТВО", "text": "Потом буря стала новой верой. Совет объявил её священной и запретил отключение. Инженеры успели построить ахолы — последний способ выиграть время для детей."}, {"who": "МИРА", "text": "То есть вы погибли не от бури. Вы погибли от собственного решения её не выключать."}, {"who": "ЛЕВ", "text": "Мира. Если отключить шпиль, небеса откроются. И всё, что здесь, обрушится, погребя нас."}, {"who": "УСТРОЙСТВО", "text": "Полное отключение уничтожит хранилище. Содержимое капсул можно передать вовне заранее. Для разгрузки нужны реакторы ровера и корабля — выжить в контуре невозможно."}, {"who": "МИРА", "text": "А если уйдём — буря останется, а спящие в хранилище так и не проснутся. Мы увезём их культуру, но сам Аварис останется в забвении. Решим вместе."}],'ending');
}

/* ------------------------------------------- ФИНАЛЬНЫЕ КАДРЫ (эпилог)
   Выбор концовки не переключает карточку сразу: сначала две минуты…
   точнее, восемнадцать секунд кино на живой сцене — шпиль рвётся и небо
   расчищается, либо модуль уходит к «Одиссею». Карточка финала появляется
   уже поверх доснятого кадра и позволяет пересмотреть его заново. */
let epilogue = null;
let cineCapTimer = 0;
let epilogueKind = 'free';

function cineCaption(text) {
  const box = $('cineCaption');
  if (!box) return;
  if (!text) { box.classList.remove('on'); return; }
  box.classList.remove('on');
  clearTimeout(cineCapTimer);
  cineCapTimer = setTimeout(() => {
    $('cineText').textContent = text;
    box.classList.add('on');
  }, 340);
}

function cineFlash(k) {
  const el = $('cineFlash');
  if (el) el.style.opacity = String(Math.max(0, Math.min(1, k)));
}

function startEpilogue(kind) {
  if (!epilogue) {
    epilogue = createEpilogue({ world, rover, camera, audio, setDaylight: applyDaylight,
      onCaption: cineCaption, onFlash: cineFlash });
  }
  $('ending').classList.add('hidden');
  $('epilogue').classList.remove('hidden');
  $('cineSkip').hidden = false;
  requestAnimationFrame(() => $('epilogue').classList.add('in'));
  document.body.classList.add('cinema');
  audio.init();
  audio.resume();
  epilogueKind = kind === 'leave' ? 'leave' : 'free';
  mode = 'epilogue';
  epilogue.start(epilogueKind);
}

function skipEpilogue() {
  if (mode !== 'epilogue' || !epilogue) return;
  epilogue.skip();
}

function finishEpilogue() {
  camera.fov = 58;
  camera.updateProjectionMatrix();
  document.body.classList.remove('cinema');
  $('epilogue').classList.remove('in');
  $('cineSkip').hidden = true;
  setTimeout(() => $('epilogue').classList.add('hidden'), 40);
  renderEnding(state.ending || epilogueKind);
  audio.endPad();
  MUSIC.kill();
}

function chooseEnding(kind) {
  // старый сейв мог привести к узлу без осмотра хранилища: финал всё равно
  // играем, иначе кнопка молча ничего не делает
  if (!STORY.finish(state, kind)) state.ending = kind;
  saveGame();
  startEpilogue(kind);
}

/** Карточка финала: используется и сразу, и при возврате в сохранённую игру */
function renderEnding(kind) {
  const free = kind === 'free';
  $('endingTitle').textContent = free ? 'ПО ТУ СТОРОНУ БУРИ' : 'ОБРАТНЫЙ КУРС';
  $('endingText').textContent = free ? "Мира кладёт ладонь на шпиль. Небо над Аварисом трескается и расходится — впервые за две тысячи лет планета видит свои звёзды.\n\n«Одиссей» фиксирует с орбиты всплеск энергии и последний пакет данных: полную историю ахол, совета и той ошибки. Трое остаются внизу. Их записи станут первым залом нового музея — и последним предупреждением.\n\nПеред запуском «Одиссей» отправляет ретранслятору всё: журнал, переводы и генетические архивы из хранилища. Через годы по ним вернут к жизни аварисцев — и на их планету придут люди.\n\nВ отчёте это назовут «освоением новых территорий». Согласия хозяев, разумеется, никто не спросит." : "Вы забираете артефакты и возвращаетесь на «Одиссей». Буря остаётся: спокойная и вечная.\n\nВ отчёте будет сказано: «Планета непригодна, сигнал имеет природное происхождение». Коллекция пополнится тремя предметами, а вопрос, зачем цивилизация сама заперла себя под бурей, останется без ответа.\n\nКапсулы остаются спать в хранилище под бурей. В музеях Земли встанут витрины с керамикой, ключом и пластинами — а хозяев этих вещей никто не разбудит. Это назовут «сохранением культурного наследия».";
  const report=templeReport(state.excavation);
  if(report) $('endingText').textContent+='\n\n'+report;
  $('endingChoices').innerHTML = '';
  const b = document.createElement('button');
  b.className = 'choice';
  b.innerHTML = '<b>Новая экспедиция</b><span>Начать заново</span>';
  b.onclick = newGame;
  $('endingChoices').append(b);
  const again = document.createElement('button');
  again.className = 'choice';
  again.innerHTML = '<b>Пересмотреть финал</b><span>Проиграть финальные кадры ещё раз</span>';
  again.onclick = () => startEpilogue(kind);
  $('endingChoices').append(again);
  mode = 'ending';
  // HUD под карточкой финала не нужен: остаётся только сцена
  document.body.classList.add('cinema');
  $('ending').classList.remove('hidden');
}

/* ================================================================ ПОРАЖЕНИЕ */
/* ==================================== ГИБЕЛЬ МИРА: туман до полной белизны
   Время вышло — но игра ничего не отбирает: управление остаётся, можно ехать
   куда угодно. Просто стена бури ползёт от края к центру, дымка сгущается,
   экран заволакивает всё плотнее и в конце заливает полной белизной.
   Никаких поломок и блокировок — только туман. */
const WHITE_TIME = 13;      // сколько длится гибель
let whiteT = -1;            // >= 0 — идёт гибель

function beginWhiteout() {
  if (whiteT >= 0) return;
  whiteT = 0;
  MUSIC.kill();                            // музыка умирает вместе с миром
  if (audio.ctx) audio.setStorm(1, true);  // ветер на полную
  audio.deathStart();                      // рёв бури и гул земли
  ui.prompt.classList.remove('on');
}

/** Наложить туман по текущей фазе: и в мире, и на экране */
function applyWhiteout() {
  const k = Math.max(0, Math.min(1, whiteT / WHITE_TIME));
  const s = k * k * (3 - 2 * k);

  // мир: стена подходит к центру, дымка сгущается
  world.setStormRing(Math.max(0, (FOG_HARD + 30) * (1 - s)), 0.6 + 0.4 * s);
  scene.fog.density = fogDay + s * 0.085;

  // экранная пелена пыли — слабая до середины и лишь за 0.55 набирает силу
  const veil = Math.max(0, (k - 0.4) / 0.6);
  ui.fog.style.opacity = String(Math.min(0.82, veil * veil * 0.9));

  // чистая белизна — только на последних секундах: до этого всё видно
  // и читается (кувыркание, вылет экипажа), экран не должен белеть раньше
  const w = Math.max(0, (k - 0.78) / 0.22);
  ui.whiteout.style.opacity = String(w * w * (3 - 2 * w));
}

/** Радар: пищит по закопанным письменам — чем ближе, тем чаще */
let radarNext = 0;
function updateRadar(dt) {
  if (mode !== 'explore') return;
  const caches = world.scrollCaches || [];
  let best = Infinity;
  for (const c of caches) {
    if (state.scrolls.includes(c.id)) continue;
    const d = Math.hypot(rover.pos.x - c.pos.x, rover.pos.z - c.pos.z);
    if (d < best) best = d;
  }
  if (!isFinite(best) || best > 90) { radarNext = 0; return; }
  radarNext -= dt;
  if (radarNext > 0) return;
  // 90–45 м — редкий, 45–25 — чаще, 25–12 — часто, ближе 12 — почти непрерывно
  const interval = best > 45 ? 1.5 : best > 25 ? 0.85 : best > 12 ? 0.45 : 0.22;
  radarNext = interval;
  // треугольник слышен поверх музыки там, где синус тонет в басу
  const near = best <= 25;
  audio.tone(near ? 1180 : 880, near ? 0.085 : 0.07, 'triangle', near ? 0.2 : 0.14);
}

function updateWhiteout(dt) {
  if (whiteT < 0 || whiteT >= WHITE_TIME) return;
  if (mode === 'pause') return;            // на паузе мир тоже замирает
  whiteT = Math.min(WHITE_TIME, whiteT + dt);
  applyWhiteout();
  // стена бури догнала машину — её опрокидывает
  const k = Math.max(0, Math.min(1, whiteT / WHITE_TIME));
  const s = k * k * (3 - 2 * k);
  const ring = Math.max(0, (FOG_HARD + 30) * (1 - s));
  // Кувыркание должно начаться задолго до белизны (она идёт с k = 0.78),
  // поэтому кроме «стена догнала» есть ещё порог k = 0.33.
  const caught = Math.hypot(rover.pos.x, rover.pos.z) >= ring - 3;
  if ((caught || k >= 0.33) && rover.startTumble()) {
    rover.dust.emit(rover.pos, 40, 9, 'clod');
    toast('Буря опрокинула машину');
  }
  audio.deathUpdate(Math.min(1, whiteT / WHITE_TIME));
  if (whiteT >= WHITE_TIME) endWhiteout();
}

function endWhiteout() {
  whiteT = WHITE_TIME;
  applyWhiteout();
  ui.fog.style.opacity = '1';
  ui.whiteout.style.opacity = '1';
  if (audio.ctx) audio.setStorm(0, false);
  audio.deathStop();
  mode = 'defeat';
  $('defeat').classList.remove('hidden');
  $('defeatRestart').focus();
}

/* ============================================================== УКАЗАТЕЛЬ */
const _wp = new THREE.Vector3();
const _wpCam = new THREE.Vector3();

function currentTarget() {
  if (navTarget) return navTarget;
  return STORY.objective(state, rover.pos).target;
}

function updateWaypoint() {
  const t = currentTarget();
  if (!t || t.x === undefined) { ui.waypoint.style.opacity = '0'; return; }
  ui.waypoint.style.opacity = '1';
  _wp.set(t.x, meshHeightAt(t.x, t.z) + 3.2, t.z);
  const dist = Math.hypot(rover.pos.x - _wp.x, rover.pos.z - _wp.z);
  ui.wpDist.textContent = dist > 999 ? `${(dist / 1000).toFixed(1)} км` : `${dist.toFixed(0)} м`;

  const p = _wp.clone().project(camera);
  const toT = _wp.clone().sub(camera.position);
  camera.getWorldDirection(_wpCam);
  const behind = toT.dot(_wpCam) <= 0;
  let x = p.x, y = p.y;
  if (behind) { x = -x; y = -y; }

  const w = innerWidth, h = innerHeight;
  const onScreen = !behind && Math.abs(x) < 0.86 && Math.abs(y) < 0.8;
  let px, py, rot;
  if (onScreen) { px = (x * 0.5 + 0.5) * w; py = (-y * 0.5 + 0.5) * h; rot = 180; }
  else {
    const a = Math.atan2(y, x);
    const rad = Math.min(w, h) * 0.34;
    px = w / 2 + Math.cos(a) * rad; py = h / 2 - Math.sin(a) * rad;
    rot = -a * 180 / Math.PI + 90;
  }
  ui.waypoint.style.transform = `translate(${clamp(px, 60, w - 60)}px, ${clamp(py, 100, h - 150)}px)`;
  ui.wpArrow.style.transform = `rotate(${rot}deg)`;
}

/* ================================================================ РАДАР */
const radarCanvas = $('radar');
const rctx = radarCanvas.getContext('2d');
let radarTimer = 0;

function drawRadar() {
  const size = radarCanvas.width;
  const cx = size / 2, cy = size / 2, Rr = size / 2 - 5;
  const right = new THREE.Vector3().crossVectors(rover.heading, rover.up).normalize();
  const fwd = rover.heading;
  const RANGE = 150;

  rctx.clearRect(0, 0, size, size);
  rctx.beginPath(); rctx.arc(cx, cy, Rr, 0, Math.PI * 2);
  rctx.fillStyle = 'rgba(7,20,29,0.62)'; rctx.fill();
  rctx.strokeStyle = 'rgba(96,186,220,0.38)'; rctx.lineWidth = 1; rctx.stroke();
  rctx.strokeStyle = 'rgba(96,186,220,0.13)';
  for (const f of [0.35, 0.68]) { rctx.beginPath(); rctx.arc(cx, cy, Rr * f, 0, Math.PI * 2); rctx.stroke(); }
  rctx.beginPath();
  rctx.moveTo(cx - Rr, cy); rctx.lineTo(cx + Rr, cy);
  rctx.moveTo(cx, cy - Rr); rctx.lineTo(cx, cy + Rr);
  rctx.stroke();

  const plot = (pos, color, r, glow = false) => {
    const dx = pos.x - rover.pos.x, dz = pos.z - rover.pos.z;
    const x = dx * right.x + dz * right.z;
    const y = dx * fwd.x + dz * fwd.z;
    if (Math.hypot(x, y) > RANGE) return;
    const px = cx + (x / RANGE) * Rr;
    const py = cy - (y / RANGE) * Rr;
    if (glow) {
      rctx.beginPath(); rctx.arc(px, py, r * 2.4, 0, Math.PI * 2);
      rctx.fillStyle = 'rgba(255,220,150,0.16)'; rctx.fill();
    }
    rctx.beginPath(); rctx.arc(px, py, r, 0, Math.PI * 2);
    rctx.fillStyle = color; rctx.fill();
  };

  for (const s of world.shards) if (!s.collected) plot(s.group.position, 'rgba(255,208,80,0.9)', 1.8);
  for (const a of world.artifactSites) if (!state.solved.includes(a.kind)) plot(a.pos, 'rgba(159,242,230,0.9)', 2.4);
  // маячки на радаре — только найденные схроны с текстами
  for (const sc of world.scrollCaches || []) {
    if (!state.scrolls.includes(sc.id)) plot(sc.pos, 'rgba(255,207,138,0.9)', 2.2);
  }
  for (const ah of P.aholas) {
    const b = world.beacons[ah.beacon];
    if (!b) continue;
    plot(b.pos, state.used.includes(ah.id) ? 'rgba(120,140,150,0.5)' : 'rgba(140,236,223,0.9)', 2.4);
  }
  if (!state.synced) plot(world.anomalies[P.anomaly.index].group.position, 'rgba(185,160,239,0.95)', 2.6);
  plot(world.vault.pos, state.synced ? 'rgba(255,150,70,1)' : 'rgba(140,120,180,0.7)', 3.2, state.synced);

  rctx.beginPath();
  rctx.moveTo(cx, cy - 4.5);
  rctx.lineTo(cx - 3.4, cy + 3.4);
  rctx.lineTo(cx + 3.4, cy + 3.4);
  rctx.closePath();
  rctx.fillStyle = '#eafcff';
  rctx.fill();
}

/* ================================================================== ЦИКЛ */
const clock = { last: performance.now() };
let acc = 0;
const FIXED = 1 / 90;
let elapsed = 0;
let steepTimer = 0;
let lastSteepHint = -99;

/**
 * Фазовый ключ: кольца-регуляторы крутятся в разные стороны, весь ключ
 * покачивается. Когда его заберут — та же сборка висит над ровером.
 */
let equippedKey=null;
function updatePhaseCore(dt) {
  const spin = (core, speed) => {
    if (!core) return;
    const g = core.group;
    g.rotation.y += dt * speed * 0.5;
    g.position.y += Math.sin(elapsed * 0.8) * dt * 0.05;
    core.rings.forEach((ring, i) => {
      const dir = i % 2 === 0 ? 1 : -1;
      ring.rotation.z += dt * speed * dir * (0.9 + i * 0.3);
      const notch = ring.userData.notch;
      if (notch) {
        const a = ring.rotation.z;
        notch.position.x = Math.cos(a) * ring.geometry.parameters.radius;
        notch.position.z = Math.sin(a) * ring.geometry.parameters.radius;
      }
    });
    if (core.orbits) {
      for (const o of core.orbits) o.rotation.y += dt * speed * o.userData.spin;
    }
  };
  if (world.phaseCore && world.phaseCore.group.visible) spin(world.phaseCore, 1);
  if(state.artifact && !state.synced && mode==='explore') {
    const distance=Math.hypot(rover.pos.x-P.anomaly.x,rover.pos.z-P.anomaly.z);
    if(distance<40) {
      if(!equippedKey) {
        equippedKey=buildPhaseCore();
        equippedKey.group.scale.setScalar(.44);
        equippedKey.group.position.set(0,roofHeight()+.3,0);
        rover.group.add(equippedKey.group);
      }
      equippedKey.group.visible=true;spin(equippedKey,1+(40-distance)*.1);
      if(!ui.keyResponse) {audio.tone(540,.35,'sine',.08,820);toast('Фазовый ключ отзывается на поле');}
      ui.keyResponse=true;
      const anomaly=world.anomalies[P.anomaly.index];
      if(anomaly) anomaly.boost=Math.max(anomaly.boost,(1-distance/42)*1.8);
    } else {ui.keyResponse=false;if(equippedKey) equippedKey.group.visible=false;}
  } else if(equippedKey) equippedKey.group.visible=false;
}

/** Высота крыши ровера над точкой опоры — считается один раз по габаритам модели. */
let _roofY = 0;
function roofHeight() {
  if (_roofY) return _roofY;
  const box = new THREE.Box3().setFromObject(rover.group);
  _roofY = Math.max(2.2, box.max.y - rover.pos.y);
  return _roofY;
}

function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - clock.last) / 1000;
  clock.last = now;
  const dt = Math.min(0.06, raw);
  elapsed += dt;
  const t = elapsed;
  // музыка живёт во всех режимах: на паузе и в наложениях её уровень уходит
  // в ноль (и трек встаёт на паузу), в езде — поднимается обратно
  MUSIC.update(dt);
  if (mode === 'epilogue') {
    // кадр живёт сам по себе: сцена идёт, камеру ведёт таймлайн,
    // HUD спрятан, паузы и ввод игрока в кадр не попадают
    const advance = document.hidden ? 0 : Math.min(raw, 0.1);
    world.update(t, dt, rover.pos);
    if (epilogue && epilogue.update(advance)) finishEpilogue();
    composer.render();
    return;
  }
  if(mode==='departure'){
    const advance=document.hidden?0:Math.min(raw,.20);
    departureTime=Math.min(departureDuration,departureTime+advance);
    animateDeparture(world.lander,rover,camera,departureTime,advance);
    audio.setEngine(advance && departureTime>1.72 && departureTime<6.85?3:0,false);
    updateDaylight();updateSunShadow();adaptQuality(raw);
    world.update(t,dt,rover.pos);composer.render();
    if(departureTime>=departureDuration) finishDeparture();
    return;
  }

  // страховка: вернулись в игру с любым наложением (журнал, пауза, карта) —
  // машина снова в кадре, подсказка осмотра убрана, иначе ровер «исчезает»
  if (mode === 'explore' && (!rover.group.visible || inspect.site)) {
    rover.group.visible = true;
    inspect.site = null;
    inspect.holding = false;
    ui.prompt.classList.remove('on');
  }
  // в наложениях курсор возвращается: указатель отпускаем сразу
  if (mode !== 'explore' && document.pointerLockElement) releaseLook();

  tickToast(dt);
  if (['excavation','signal','artifact','translate','journal','map','pause','ending','lesson','defeat'].includes(mode)) {
    audio.setEngine(0,false); audio.setRoll(0); audio.setStorm(0,false);
    if(mode==='artifact' && artBoot) artBoot.draw(dt,t);
    if(mode==='signal') {
      updateSignal(Math.min(raw,.25));
      drawWaves();
      // Show the changing curtain behind the instrument at a reduced rate.
      if(!sig.lastScene || now-sig.lastScene>=200) {
        world.update(t,.2,rover.pos); composer.render(); sig.lastScene=now;
      }
    }
    return;
  }
  updateHandDigs(dt);
  updateMound(dt);
  updateWhiteout(dt);
  updateRadar(dt);
  updateScrollDig(dt);
  if (motes) motes.update(dt, rover.pos, whiteT >= 0 ? Math.min(1, whiteT / WHITE_TIME) : 0);
  if (debris) {
    // пыль набирает силу по ходу гибели: к началу белизны (k ≈ 0.78)
    // в воздухе уже полно мусора — именно это и видно на экране
    const dk = whiteT >= 0 ? Math.min(1, whiteT / WHITE_TIME) : 0;
    const dp = dk <= 0 ? 0 : Math.min(1, dk * 1.3);
    // до первого кувырка ветер ещё не задан — гоним мусор к центру карты,
    // туда же, куда потом поедет и машина
    let wx = rover.wind.x, wz = rover.wind.z;
    if (Math.hypot(wx, wz) < 0.05) {
      const rr = Math.hypot(rover.pos.x, rover.pos.z) || 1;
      wx = -rover.pos.x / rr; wz = -rover.pos.z / rr;
    }
    debris.update(dt, rover.pos, dp, { x: wx, z: wz });
  }
  updateDaylight();
  updateSunShadow();
  adaptQuality(raw);
  updatePhaseCore(dt);
  if (mode !== 'explore') { audio.setEngine(0, false); audio.setRoll(0); }

  if (mode === 'explore') {
    const inp = readInput();
    const near = world.queryObstacles(rover.pos);
    acc += dt;
    let guard = 0;
    while (acc >= FIXED && guard < 8) {
      rover.step(FIXED, inp, near);
      acc -= FIXED;
      guard++;
    }
    if (guard >= 8) acc = 0;

    // отклик на столкновения: галька подбрасывает, камень на скорости бьёт
    if (rover.bump > 0.01) { audio.bumpStone(rover.bump); rover.bump = 0; }
    if (rover.impact > 0.01) { audio.impact(rover.impact); rover.impact = 0; }

    for (const s of world.shards) {
      if (s.collected) continue;
      if (rover.pos.distanceTo(s.group.position) < 5.2) {
        s.collected = true; s.t = 0;
        STORY.addStormSeconds(state, 6);
        rover.heal(5);
        audio.pickup();
        toast('+6 с бури · осколок памяти');
      }
    }

    audio.setEngine(rover.speed, rover.boosting);
    audio.setRoll(rover.speed);

    // упёрлись в крутизну без форсажа — подсказываем, но не навязчиво
    if (rover.tooSteep && rover.speed < 3) {
      steepTimer += dt;
      if (steepTimer > 0.8 && elapsed - lastSteepHint > 9) {
        lastSteepHint = elapsed;
        toast('Слишком круто для обычной тяги — держите Shift (форсаж)');
        steepTimer = 0;
      }
    } else {
      // не сбрасываем в ноль: на грани уклона флаг мигает и таймер не набирался
      steepTimer = Math.max(0, steepTimer - dt * 1.5);
    }

    if (rover.shake > 0.4 && Math.random() < 0.03) audio.crash();

    if (rover.fog > 0.01) {
      rover.damage(rover.fog * 17 * dt, 'туман');
      if (!ui._fogWarned && rover.fog > 0.2) {
        ui._fogWarned = true;
        say([{ who: 'ЛЕВ', text: STORY_TEXT.fog }], 'explore');
        audio.crash();
      }
    } else if (rover.fog < 0.005) ui._fogWarned = false;
    if (rover.hp <= 0) emergencyRepair();

    // аномалия без фазового ключа режет обшивку
    if (!state.artifact) {
      const an = world.anomalies[P.anomaly.index];
      const d = Math.hypot(rover.pos.x - an.group.position.x, rover.pos.z - an.group.position.z);
      if (d < 42) {
        rover.damage(28 * (1 - d / 42) * dt, 'аномалия');
        if (!ui._anomWarned) {
          ui._anomWarned = true;
          say([{ who: 'НИНА', text: 'Не подъезжай! Без ключа эта штука режет обшивку.' }], 'explore');
          audio.crash();
        }
      } else if (d > 52) ui._anomWarned = false;
    }

    if (STORY.tick(state, mode, dt)) beginWhiteout();
    saveTimer += dt;
    if (saveTimer > 10) { saveTimer = 0; saveGame(); }

    const lvl = STORY.stormLevel(state);
    if (lvl > 0.72 && STORY.stormSeconds(state) > 20 && !ui._stormWarned) {
      ui._stormWarned = true;
      say([{ who: 'МИРА', text: 'Буря ближе. Если рядом ахола — разряжай: у нас минуты, а не часы.' }], 'explore');
    } else if (lvl < 0.6) ui._stormWarned = false;

    updatePrompt();
    updateHud(dt);
    updateWaypoint();

    radarTimer += dt;
    if (radarTimer > 0.08) { radarTimer = 0; drawRadar(); }
  } else if (mode !== 'menu') {
    updateHud(dt);
  }

  // свет для ближайшего светящегося объекта
  let best = null, bestD = 70, bestColor = 0x66ddff;
  const poi = [
    { p: world.temple.pos, c: 0xffb45a },
    { p: world.vault.pos, c: state.synced ? 0x98dedc : 0x9c7edb },
    { p: world.anomalies[P.anomaly.index].group.position, c: 0xb9a0ef },
  ];
  for (const sc of world.scrollCaches || []) {
    if (!state.scrolls.includes(sc.id)) poi.push({ p: sc.pos, c: 0x8cecdf });
  }
  for (const s of poi) {
    const d = rover.pos.distanceTo(s.p);
    if (d < bestD) { bestD = d; best = s.p; bestColor = s.c; }
  }
  for (const b of world.beacons) {
    if (!b.lit) continue;
    const d = rover.pos.distanceTo(b.crystalPos);
    if (d < bestD) { bestD = d; best = b.crystalPos; bestColor = 0x3ad4ff; }
  }
  if (best) {
    poiLight.position.copy(best);
    poiLight.color.setHex(bestColor);
    poiLight.intensity = clamp((1 - bestD / 70) * 260, 0, 260);
  } else poiLight.intensity = 0;

  world.update(t, dt, rover.pos);
  // модель ровера: положение/наклон по рельефу, колёса, пыль
  rover.applyVisual(dt, t);
  audio.setStorm(STORY.stormLevel(state), mode === 'explore');

  if (mode === 'menu') {
    camera.position.set(rover.pos.x + 24, rover.pos.y + 12, rover.pos.z + 30);
    camera.lookAt(rover.pos.x, rover.pos.y + 4, rover.pos.z);
  } else {
    updateCamera(dt);
  }

  // рисует RenderPass внутри composer; прямой renderer.render здесь не нужен
  composer.render();
}

/* =============================================================== АВАРИЯ */
function emergencyRepair() {
  const rr = Math.hypot(rover.pos.x, rover.pos.z) || 1;
  const target = Math.min(FOG_START - 34, ZONE_R - 45);
  const k = Math.min(1, target / rr);
  const spot = world.freeSpot(rover.pos.x * k, rover.pos.z * k, 2);
  rover.placeAt(spot[0], spot[1]);
  rover.hp = 60;
  rover.fog = 0;
  rover.hitFlash = 1;
  audio.crash();
  say([{ who: 'НИНА', text: STORY_TEXT.repair }], 'explore');
  toast('Аварийный ремонт · прочность 60%');
}

/* ================================================================= СТАРТ */
let departureTime=0;
function finishDeparture(){
  if(mode!=='departure')return;
  animateDeparture(world.lander,rover,camera,departureDuration,0);
  const {exitX,exitZ}=LANDING_SITE;
  rover.placeAt(exitX,exitZ,[exitX+3,exitZ-4]);
  cam.pos.copy(camera.position);cam.target.copy(rover.pos);
  for(const key in keys) keys[key]=false;
  audio.setEngine(0,false);
  document.body.classList.remove('departing');
  $('skipDeparture').hidden=true;
  say([{who:'МИРА',text:STORY_TEXT.intro},
    {who:'НИНА',text:'Начнём со схронов. Веди на сигнал радара, у самой пластины нажми F.'}],'explore');
  saveGame();
}

function begin() {
  if (mode !== 'menu') return;
  const saved = readSave();
  $('intro').classList.add('hidden');
  audio.init();
  audio.resume();
  MUSIC.restart();
  // явно говорим, что звук идёт: иначе кажется, что игра запустилась немой
  toast(muted ? 'Звук выключен · N — включить' : 'Звук включён · N — выключить');
  // если прошлую экспедицию закончили выбросом экипажа — фигуры на места
  rover.restoreCrew();
  rover.group.visible = true;      // если прошлый раз закончили в осмотре механизма
  if (debris) debris.reset();
  if (saved) {
    applyState(saved);
    if (saved.ending) { renderEnding(saved.ending); return; }
    mode = 'explore';
    toast('Экспедиция продолжена');
  } else {
    applyState(state);
    mode='departure';departureTime=0;
    document.body.classList.add('departing');
    $('skipDeparture').hidden=false;
    animateDeparture(world.lander,rover,camera,0,0);
    return;
  }
  requestLook();
  saveGame();
}

function newGame() {
  try { localStorage.removeItem(STORY.SAVE_KEY); } catch { /* noop */ }
  location.reload();
}

/* ============================================================ ПРИВЯЗКА UI */
function bindUi() {
  $('skipDeparture').onclick=finishDeparture;
  $('sigPause').onclick=()=>openPause();
  $('sigFreq').oninput=e=>{sig.freq=Number(e.target.value);};
  $('sigPhase').oninput=e=>{sig.phase=Number(e.target.value);};
  const transmit=$('sigTransmit');
  transmit.onpointerdown=e=>{transmit.setPointerCapture(e.pointerId); signalPointer=true;};
  transmit.onlostpointercapture=transmit.onpointerup=transmit.onpointercancel=()=>{signalPointer=false;};

  $('startBtn').addEventListener('click', begin);
  $('trSubmit').addEventListener('click', () => {
    if (tr.typing) { finishTyping(); return; }
    if (tr.reading) { finishReading(); return; }
    submitTranslate();
  });
  $('trClose').addEventListener('click', closeTop);
  // журнал знаков: иконка-корешок внизу справа, крестик и клавиша K
  // окошко ввода значения у знака
  $('trPopSave').addEventListener('click', saveSignPop);
  $('trPopDel').addEventListener('click', () => {
    const g = $('trPop').dataset.glyph;
    if (g) deletePick(g);
  });
  $('trPopClose').addEventListener('click', closeSignPop);
  $('trPopInput').addEventListener('keydown', (e) => {
    if (e.code === 'Enter') { e.preventDefault(); saveSignPop(); }
    if (e.code === 'Escape') { e.preventDefault(); closeSignPop(); }
  });
  addEventListener('mousedown', (e) => {
    const pop = $('trPop');
    if (pop.classList.contains('hidden')) return;
    const inTarget = e.target.closest && e.target.closest('.tr-g, .tr-row[data-glyph]');
    if (pop.contains(e.target) || inTarget) return;
    closeSignPop();
  });
  $('lsSubmit').addEventListener('click', submitLesson);
  $('lsClose').addEventListener('click', closeTop);
  $('artClose').addEventListener('click', closeTop);
  $('mapClose').addEventListener('click', closeTop);
  $('journalClose').addEventListener('click', closeTop);
  $('pauseResume').addEventListener('click', closeTop);
  $('pauseCursor').addEventListener('click', openCursorPick);
  $('cursorDone').addEventListener('click', closeCursorPick);
  $('pauseSave').addEventListener('click', () => saveGame(true));
  $('pauseRestart').addEventListener('click', newGame);
  $('defeatRestart').addEventListener('click', newGame);
  $('endingLeave').addEventListener('click', () => chooseEnding('leave'));
  $('endingFree').addEventListener('click', () => chooseEnding('free'));
  $('cineSkip').addEventListener('click', skipEpilogue);
  $('mapCanvas').addEventListener('click', (e) => {
    const cv = $('mapCanvas');
    const rect = cv.getBoundingClientRect();
    const size = rect.width;
    const S = size / (ZONE_R * 2.25);
    const x = (e.clientX - rect.left - size / 2) / S;
    const z = (e.clientY - rect.top - size / 2) / S;
    let best = null, bestD = 34;
    for (const p of mapPoints()) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) {
      navTarget = { kind: best.id, x: best.x, z: best.z };
      toast(`Навигатор: ${best.label}`);
      audio.tone(660, 0.1, 'sine', 0.06);
      drawMap();
    }
  });
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloom.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    if (mode === 'map') drawMap();
  });
}

/* ================================================================ ЗАПУСК */
initUi();
bindUi();
applyState(state);
updateHud(1);
// игра открывается уже с готовой моделью ровера — без подмены на глазах
Promise.resolve(rover.modelReady).catch(() => {}).then(() => {
  $('loading').classList.add('hidden');
});
requestAnimationFrame(frame);

/* ------------------------------------------------------- отладочный API */
window.__avaris = {
  STORY, world, rover, cam, audio, MUSIC, errors, points: P, renderer, camera,
  // state пересоздаётся в applyState, поэтому отдаём его геттером, а не копией
  get state() { return state; },
  // графика: ручки для проверки теней/bloom/градации без перезагрузки
  gfx: {
    composer, bloom, gradePass, sun,
    shadows(on = true) { shadowsEnabled = !!on; return shadowsEnabled; },
    bloom(on = true) { bloom.enabled = !!on; return bloom.enabled; },
    grade(on = true) { gradePass.enabled = !!on; return gradePass.enabled; },
    exposure(v) { renderer.toneMappingExposure = v; return v; },
    // качество: 'low' | 'high' — вручную, без ожидания просадки
    quality(mode) {
      autoQuality = false;
      lowQuality = mode === 'low';
      applyQuality();
      return lowQuality ? 'low' : 'high';
    },
    auto(on = true) { autoQuality = !!on; return autoQuality; },
    get low() { return lowQuality; },
  },
  terrain: { heightAt, meshHeightAt },
  get state() { return state; },
  get mode() { return mode; },
  begin, saveGame, readSave,
  // финальные кадры: посмотреть концовку без прохождения
  playEnding(kind = 'free') { startEpilogue(kind); return mode; },
  skipEnding: skipEpilogue,
  get epilogue() { return epilogue; },
  handDig, handGrow,
  get whiteout() { return whiteT; },
  get debris() { return debris; },
  beginWhiteout,
  // свободный зум (та же комбинация, что Ctrl/Cmd+Shift+Z)
  farZoom(on = true) { if (!!on !== cam.far) toggleFreeZoom(); return cam.far; },
  setZoom(d) {
    cam.dist = clamp(d, ZOOM_NEAR, cam.far ? ZOOM_MAX : ZOOM_FAR);
    return +cam.dist.toFixed(1);
  },
  // отладка демонстрации: прыгнуть на нужную фазу тумана
  setWhiteout(t) { whiteT = t; applyWhiteout(); },
  get digLeft() { return STORY.handDigLeft(state); },
  teleport(name, offset = 26) {
    let tx = null, tz = null;
    if (name === 'tablet') { tx = P.tablet.x; tz = P.tablet.z; }
    else if (name === 'temple') { tx = P.temple.x; tz = P.temple.z; }
    else if (name === 'anomaly') { tx = P.anomaly.x; tz = P.anomaly.z; }
    else if (name === 'core') { tx = P.core.x; tz = P.core.z; }
    else if (typeof name === 'string' && P.artifacts.some((a) => a.id === name)) {
      const a = P.artifacts.find((x) => x.id === name); tx = a.x; tz = a.z;
    } else if (typeof name === 'string' && name.startsWith('ahola')) {
      const a = P.aholas.find((x) => x.id === name); if (a) { tx = a.x; tz = a.z; }
    } else if (Array.isArray(name)) { tx = name[0]; tz = name[1]; }
    if (tx === null || tx === undefined) return null;
    let x = tx, z = tz;
    if (offset > 0) {
      const a = Math.random() * Math.PI * 2;
      x += Math.cos(a) * offset; z += Math.sin(a) * offset;
    }
    const rr = Math.hypot(x, z);
    if (rr > ZONE_R - 10) { x *= (ZONE_R - 10) / rr; z *= (ZONE_R - 10) / rr; }
    const spot = world.freeSpot(x, z, 1.5);
    rover.placeAt(spot[0], spot[1], [tx, tz]);
    cam.pos.copy(rover.pos);
    return { x: +spot[0].toFixed(1), z: +spot[1].toFixed(1) };
  },
  press(code, on = true) { keys[code] = on; },
  clear() { for (const k in keys) keys[k] = false; },
  sim(sec) {
    const inp = readInput();
    const steps = Math.round(sec / FIXED);
    for (let i = 0; i < steps; i++) rover.step(FIXED, inp, world.queryObstacles(rover.pos));
    rover.applyVisual(FIXED, 0);
    return { x: +rover.pos.x.toFixed(1), z: +rover.pos.z.toFixed(1), speed: +rover.speed.toFixed(1) };
  },
  interact() { tryInteract(); return mode; },
  seeArtifact(id) {
    const a = STORY.artifactById(id);
    STORY.seeState(state, id, a.off);
    STORY.seeState(state, id, a.on);
    return state.seen[id];
  },
  solveArtifact(id) {
    const a = STORY.artifactById(id);
    STORY.seeState(state, id, a.off);
    STORY.seeState(state, id, a.on);
    const vals = [a.off, a.on].map((k) => STORY.KEYS.find((x) => x.id === k).word);
    const ok = STORY.solveArtifact(state, id, vals);
    paintProgress();
    return ok;
  },
  decode() { return STORY.decode(state); },
  complete(stage) { return STORY.complete(state, stage); },
  moundDig,
  setStorm(sec) { state.deadline = state.clock + Math.max(0, sec) * STORY.PLANET_MIN_PER_SEC; },
  solveTranslate() {
    translate.slots = ['БУРЯ', 'АХОЛА', 'ГОРА'];
    $('trWords').querySelectorAll('select').forEach((sel, i) => { sel.value = translate.slots[i]; });
    submitTranslate();
  },
  setSignal(f, ph) { sig.freq = f; sig.phase = ph; },
  openMap, openJournal, openPause, closeTop, openArtifact,
};
