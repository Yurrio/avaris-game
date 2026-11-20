/* ============================================================================
   XR-7 · ровер: модель, аркадная физика по высотному полю, пыль из-под колёс.
   ========================================================================== */
import * as THREE from 'three';
import {
  meshHeightAt, meshNormalAt, meshPlaneAt, fogAt, fogHardAt, clamp,
} from './terrain.js';
import { loadRoverModel } from './rover-model.js';

const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------- настройки */
// Скорости пересчитаны под уменьшенный ровер: раньше 27 м/с при вдвое
// меньшей машине читались как «летим» (11 корпусов в секунду).
const P = {
  GRAV: 26,
  ACCEL: 17,
  ACCEL_BOOST: 27,
  REV_ACCEL: 10,
  MAX_SPEED: 16,
  MAX_BOOST: 23,
  MAX_REVERSE: 7.5,
  TURN: 2.1,
  GRIP: 8.0,
  ROLL: 0.34,
  AIR: 0.0012,
  CLIMB_SHIFT: 0.58,   // круче этого уклона подъём только на форсаже
  BOOST_DRAIN: 55,     // %/с — полного бака НЕ хватает: нужен привал у камня
  BOOST_REGEN: 8,      // %/с — восстановление
  RADIUS: 1.55,        // реальный габарит модели 3.25×4.16 м — радиус по корпусу
  CLEAR: 0.06,
  SCALE: 0.5,          // масштаб модели (габариты, не физика)
  HP_MAX: 100,
  FALL_SPEED: 16,     // с какой скорости удара начинается урон
  FALL_DMG: 2.4,      // hp на каждый м/с сверх порога
  // мелкая галька — трамплин: ниже этой скорости просто переваливает
  BUMP_MIN: 3.5,
  BUMP_UP: 3.2,       // минимальный подброс, м/с
  BUMP_UP_MAX: 6.6,   // добавка на полном форсаже
  // жёсткий удар о камень/кристалл: обычной скорости (16) НЕ хватает,
  // а форсаж (23) влетает с уроном
  IMPACT_SPEED: 17.5,
  IMPACT_DMG: 3.2,    // hp на каждый м/с сверх порога
  IMPACT_MAX: 38,     // потолок урона за один удар
  IMPACT_COOLDOWN: 0.5,
  // трение покоя: ниже этого уклона шины держат, выше — машина съезжает
  SLIDE_SLOPE: 0.22,
  SLIDE_DRAG: 1.4,      // гашение разгона при съезде без газа (1/с)
  // сглаживание наклона: у земли плоские треугольники, и нормаль на ребре
  // прыгает — без сглаживания ровер рывком выравнивался по новому углу
  UP_SMOOTH: 12,
  // прижим к спуску: допуск на шаг растёт с пройденным путём — до этого
  // уклона машина едет по склону, а с обрыва летит
  STICK_MIN: 0.06,     // швы сетки и кочки, м на шаг
  STICK_SLOPE: 0.85,   // до 0.85 м перепада на метр пути (~40°): круче — полёт
  // буря: машина катится через крышу, как перекати-поле — без прыжков
  TUMBLE_R: 1.15,      // радиус качения (полувысота кувыркающегося корпуса)
  TUMBLE_PUSH: 30,     // разгон ветром, м/с² (шины тормозят параллельно)
  TUMBLE_MAX: 22,      // с какой скоростью ветер перестаёт разгонять
  TUMBLE_MIN: 6,       // ниже этого клубок не замедляется — его всё равно несёт
  TUMBLE_DRAG: 0.15,   // сопротивление качению (1/с)
  // прижим работает только пока падение медленное: быстрее — это уже падение
  // с высоты, его должен обработать блок приземления (с уроном)
  STICK_FALL: 6,       // м/с
  // выше этого над препятствием машина его перелетает (в прыжке)
  CLEAR_OVER: 2.6,
};

/* ---------------------------------------------------------------- модель */
function buildModel() {
  const g = new THREE.Group();
  // корпус в отдельной группе — после загрузки GLB эту оболочку просто прячем
  const body = new THREE.Group();
  g.add(body);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdfe5ec, flatShading: true, metalness: 0.35, roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x272c33, flatShading: true, metalness: 0.6, roughness: 0.42 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x15181d, flatShading: true, roughness: 1.0 });
  const accMat = new THREE.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0xff4a08, emissiveIntensity: 2.2, flatShading: true });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x4fd0ff, emissive: 0x1a6f9a, emissiveIntensity: 1.0, flatShading: true,
    transparent: true, opacity: 0.88, metalness: 0.4, roughness: 0.15,
  });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x9fe4ff, emissive: 0x7fd8ff, emissiveIntensity: 3.0, flatShading: true });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.66, 4.7), bodyMat);
  chassis.position.y = 1.15; body.add(chassis);

  const rear = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.62, 1.6), darkMat);
  rear.position.set(0, 1.79, -1.62);      // 1.48..2.10 — ровно стоит на шасси
  body.add(rear);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.98, 1.85), darkMat);
  cabin.position.set(0, 1.92, 0.55); body.add(cabin);

  // светлая крыша — иначе сверху ровер читается как чёрное пятно
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.12, 1.7), bodyMat);
  roof.position.set(0, 2.45, 0.55); body.add(roof);
  for (const z of [0.05, 1.05]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.05, 0.16), accMat);
    stripe.position.set(0, 2.53, z);
    body.add(stripe);
  }

  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.62, 0.13), glassMat);
  glass.position.set(0, 2.02, 1.48);
  glass.rotation.x = -0.08;
  body.add(glass);

  for (const x of [-1.05, 1.05]) {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.52, 1.35), glassMat);
    sw.position.set(x, 1.98, 0.55); body.add(sw);
  }

  // солнечная панель — плоская плита СВЕРХУ отсека, с зазором 1 см
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.07, 1.42), new THREE.MeshStandardMaterial({
    color: 0x33475c, flatShading: true, metalness: 0.6, roughness: 0.35,
  }));
  panel.position.set(0, 2.145, -1.62);      // 2.11..2.18 над отсеком (2.10)
  body.add(panel);

  for (const x of [-0.92, 0.92]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.15), glowMat);
    lamp.position.set(x, 1.24, 2.38);
    body.add(lamp);
  }

  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.34, 0.24), darkMat);
  bumper.position.set(0, 0.95, 2.42);
  body.add(bumper);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5), darkMat);
  mast.position.set(-0.95, 3.05, -0.65); body.add(mast);
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), accMat);
  beacon.position.set(-0.95, 4.28, -0.65); body.add(beacon);

  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.2), bodyMat
  );
  dish.position.set(0.95, 2.8, -0.8);
  dish.rotation.x = -0.5;
  body.add(dish);

  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.6, 12);
  const hubGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.64, 6);
  const spokeGeo = new THREE.BoxGeometry(0.1, 1.3, 0.09);
  const suspMat = new THREE.MeshStandardMaterial({ color: 0x4a5160, flatShading: true, metalness: 0.7, roughness: 0.35 });

  for (const x of [-1.5, 1.5]) {
    for (const z of [-1.5, 1.5]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.8, z);

      const tire = new THREE.Mesh(wheelGeo, tireMat);
      tire.rotation.z = Math.PI / 2;
      pivot.add(tire);

      const hub = new THREE.Mesh(hubGeo, bodyMat);
      hub.rotation.z = Math.PI / 2;
      pivot.add(hub);

      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Mesh(spokeGeo, darkMat);
        sp.rotation.z = Math.PI / 2;
        sp.rotation.x = (k / 3) * Math.PI;
        hub.add(sp);
      }

      const steerGroup = new THREE.Group();
      steerGroup.add(pivot);
      body.add(steerGroup);

      wheels.push({ pivot, steerGroup, front: z > 0 });

      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.25, 5), suspMat);
      arm.position.set(x * 0.7, 1.12, z);
      arm.rotation.z = Math.PI / 2;
      body.add(arm);
    }
  }

  const headlight = new THREE.SpotLight(0xc8f0ff, 220, 60, Math.PI / 5, 0.55, 1.6);
  headlight.position.set(0, 1.5, 2.4);
  headlight.target.position.set(0, 0.2, 28);
  g.add(headlight);
  g.add(headlight.target);

  // весь ровер вдвое меньше: точка контакта (y = 0) остаётся на земле
  g.scale.setScalar(P.SCALE);

  return { group: g, body, wheels, beacon, headlight };
}

/* ------------------------------------------------------------ пыль */
/* ------------------------------------------------- частицы из-под колёс */
/* Вид частиц зависит от поверхности: песок — мелкая светлая пыль, земля —
   тяжёлые комья, камень — серая взвесь, снег — искры. */
const SURFACE_DUST = {
  sand: 'sand',
  oasis: 'soil',
  stone: null,      // по каменным грядам песок не летит
  snow: 'snow',
  edge: 'sand',
};

const DUST_KINDS = {
  // песок: почти белая взвесь — на жёлтом грунте (0xefd081) её видно
  sand: { c: [0.98, 0.97, 0.93], size: 1.30, life: [0.6, 1.3], up: 0.80, spread: 2.9, grav: 1.1, drag: 0.93 },
  // земля: тёмные комья, летят по дуге
  soil: { c: [0.26, 0.19, 0.13], size: 1.80, life: [1.1, 2.0], up: 1.5, spread: 3.4, grav: 8.0, drag: 0.97 },
  rock: { c: [0.55, 0.57, 0.60], size: 1.00, life: [0.6, 1.2], up: 0.50, spread: 2.8, grav: 2.6, drag: 0.92 },
  // снег: голубоватая искра, иначе сливается с белым настом
  snow: { c: [0.78, 0.87, 0.97], size: 0.95, life: [1.2, 2.2], up: 1.10, spread: 2.2, grav: 0.4, drag: 0.95 },
  clod: { c: [0.30, 0.22, 0.15], size: 2.30, life: [1.0, 1.8], up: 2.20, spread: 3.8, grav: 9.5, drag: 0.98 },
};

class Dust {
  constructor(scene) {
    const N = 420;
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.alpha = new Float32Array(N);
    this.size = new Float32Array(N);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.maxLife = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: /* glsl */`
        attribute float alpha;
        attribute vec3 color;
        attribute float size;
        varying float vA;
        varying vec3 vC;
        void main() {
          vA = alpha;
          vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 76.0 * size * alpha / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        varying vec3 vC;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.05, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a * 0.80);
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** p — точка выброса, kind — sand | soil | rock | snow | clod */
  emit(p, count, spread = null, kind = 'sand') {
    const k = DUST_KINDS[kind] || DUST_KINDS.sand;
    const sp = spread === null ? k.spread : spread;
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.N;
      this.pos[idx * 3] = p.x + (Math.random() - 0.5) * 0.7;
      this.pos[idx * 3 + 1] = p.y + (Math.random() - 0.5) * 0.4;
      this.pos[idx * 3 + 2] = p.z + (Math.random() - 0.5) * 0.7;

      this.vel[idx * 3] = (Math.random() - 0.5) * sp;
      this.vel[idx * 3 + 1] = Math.random() * k.up + k.up * 0.35;
      this.vel[idx * 3 + 2] = (Math.random() - 0.5) * sp;

      const jitter = 0.85 + Math.random() * 0.3;
      this.col[idx * 3] = k.c[0] * jitter;
      this.col[idx * 3 + 1] = k.c[1] * jitter;
      this.col[idx * 3 + 2] = k.c[2] * jitter;

      this.size[idx] = k.size * (0.7 + Math.random() * 0.7);
      this.grav[idx] = k.grav;
      this.drag[idx] = k.drag;
      this.life[idx] = this.maxLife[idx] = k.life[0] + Math.random() * (k.life[1] - k.life[0]);
      this.alpha[idx] = 1;
    }
  }

  update(dt) {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;      // комья летят по дуге
      const dr = this.drag[i];
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] *= dr;
      this.vel[i * 3 + 2] *= dr;
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

/* ================================================================== ROVER */
export class Rover {
  constructor(scene) {
    const model = buildModel();
    this.group = model.group;
    this.wheels = model.wheels;
    this.beacon = model.beacon;
    this.headlight = model.headlight;     // фара: ночью светит, днём погашена
    this._bodyPlaceholder = model.body;   // старая оболочка, пока грузится GLB
    this.wheelRadius = 0.8 * P.SCALE;     // радиус колеса в мире — для прокрутки
    this._glbModel = null;
    scene.add(this.group);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.grounded = true;
    this.energy = 100;
    this.hp = P.HP_MAX;
    this.hpMax = P.HP_MAX;
    this.hitFlash = 0;
    this.fog = 0;
    this.lastHit = null;
    this.boosting = false;
    this.wheelSpin = 0;
    this.steerVisual = 0;
    this.speed = 0;
    this.airTime = 0;
    this.shake = 0;
    this.groundY = 0;
    // события кадра для звука в main.js (кто прочитал — обнуляет)
    this.bump = 0;        // 0..1 — наехали на гальку и подлетели
    this.impact = 0;      // 0..1 — влетели в камень/кристалл на скорости
    this.impactCd = 0;    // чтобы один удар не считался каждый кадр
    this.bumpCd = 0;

    this.dust = new Dust(scene);

    this._n = new THREE.Vector3();
    this._g = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._sideVec = new THREE.Vector3();
    this.surface = 'sand';      // задаётся из main.js по биому под колёсами
    // буря опрокидывает машину: пока флаг стоит, управление не слушается
    this.tumble = false;
    this.tumbleT = 0;
    this.tumbleAngle = 0;         // накопленный угол качения
    this.tumbleKind = null;       // 'fatal' — финал, 'knock' — отбросило от стены
    this.tumbleDur = 0;           // сколько длится отбрасывание
    this.knockCd = 0;             // пауза между отбрасываниями у стены
    this.crew = [];               // фигуры в салоне из GLB
    this.crewBodies = [];         // выброшенные фигуры в свободном полёте
    this._ejectPlan = null;       // углы качения, на которых вылетает каждый
    this._ejectedCount = 0;       // сколько фигур уже вылетело
    this.tumbleRadius = P.TUMBLE_R; // радиус «клубка»: машина катится, а не едет
    this.wind = new THREE.Vector3();
    this._tumbleAxis = new THREE.Vector3(1, 0, 0.35).normalize();
    this._rollQ = new THREE.Quaternion();
    this._basis = new THREE.Matrix4();
    this.enableShadow();

    // «Кочевник-03» грузится в фоне: пока модели нет, её не показываем вовсе
    if (this._bodyPlaceholder) this._bodyPlaceholder.visible = false;
    this.modelReady = loadRoverModel()
      .then((m) => this.useRoverModel(m))
      .catch((e) => {
        console.warn('[XR-7] модель ровера не загрузилась:', e);
        // если модели нет совсем, возвращаем старую оболочку
        if (this._bodyPlaceholder) this._bodyPlaceholder.visible = true;
        return false;
      });
  }

  /** Подменить процедурную оболочку на модель из GLB */
  useRoverModel(m) {
    if (!m || this._glbModel) return false;
    this._glbModel = m;
    if (this._bodyPlaceholder) this._bodyPlaceholder.visible = false;
    // группа уже отмасштабирована на P.SCALE — компенсируем, чтобы модель
    // получила свой собственный масштаб в метрах
    m.group.scale.setScalar(m.scale / P.SCALE);
    this.group.add(m.group);
    this.wheels = m.wheels;
    this.wheelRadius = m.wheelRadius;
    this.crew = m.crew || [];
    this._glbRoot = m.group;
    this.applyVisual(0, 0);
    this.enableShadow();
    return true;
  }

  /** Ровер — единственное, что ездит: тень обязательна (и для оболочки, и для GLB) */
  enableShadow() {
    this.group.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) o.castShadow = true;
    });
    return this;
  }

  heightOf(pos) { return meshHeightAt(pos.x, pos.z); }

  /** Урон прочности (туман, удары). Возвращает, сколько реально снято */
  damage(amount, reason = '') {
    if (!(amount > 0) || this.hp <= 0) return 0;
    const before = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    const dealt = before - this.hp;
    if (dealt > 0.05) {
      this.hitFlash = Math.min(1, this.hitFlash + dealt / 12);
      this.lastHit = { amount: +dealt.toFixed(2), reason };
    }
    return dealt;
  }

  heal(amount) {
    this.hp = Math.min(this.hpMax, this.hp + amount);
  }

  /** Мягко опустить на текущую землю (после изменения рельефа) */
  snapToGround() {
    const g = meshHeightAt(this.pos.x, this.pos.z) + P.CLEAR;
    this.pos.y = g;
    this.groundY = g;
    if (this.vel.y < 0) this.vel.y = 0;
    this.grounded = true;
    this.airTime = 0;
  }

  /** Ставит ровер в точку (x, z) */
  placeAt(x, z, faceTo = null) {
    this.pos.set(x, meshHeightAt(x, z) + P.CLEAR, z);
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.wheelSpin = 0;
    meshNormalAt(x, z, this.up);
    if (faceTo) {
      this.heading.set(faceTo[0] - x, 0, faceTo[1] - z);
    } else {
      this.heading.set(Math.sin(x * 0.13), 0, Math.cos(x * 0.13));
    }
    if (this.heading.lengthSq() < 1e-4) this.heading.set(0, 0, 1);
    this.heading.normalize();
    // сразу кладём нос в плоскость склона: иначе на первом шаге машина
    // разово доворачивается на угол уклона — заметный рывок
    this.heading.addScaledVector(this.up, -this.heading.dot(this.up));
    if (this.heading.lengthSq() < 1e-6) this.heading.set(0, 0, 1);
    this.heading.normalize();
    this.applyVisual(0, 0);
  }

  /* ------------------------------------------------------------------ шаг */
  /** Буря добралась: машину переворачивает на крышу и гонит ветром */
  startTumble() {
    if (this.tumble) return false;
    this.tumble = true;
    this.tumbleKind = 'fatal';
    this.tumbleT = 0;
    this.tumbleAngle = 0;
    this.ejectCrew();             // только план: фигуры вылетают по одной
    // стена бури идёт к центру карты — ветер гонит туда же
    const w = this._tmp.set(-this.pos.x, 0, -this.pos.z);
    if (w.lengthSq() < 1e-4) w.set(0, 0, 1);
    this.wind.copy(w).normalize();
    // ось качения горизонтальна и поперёк ветра: катимся вперёд, через крышу
    this._tumbleAxis.set(this.wind.z, 0, -this.wind.x).normalize();
    // не подброс, а срыв с места: лёгкий клевок вверх и сразу под ветер
    this.vel.y = Math.max(this.vel.y, 2.2);
    this.vel.x = this.wind.x * 5.5 + this.vel.x * 0.3;
    this.vel.z = this.wind.z * 5.5 + this.vel.z * 0.3;
    this.grounded = false;
    this.airTime = 0;
    this.shake = Math.max(this.shake, 1);
    return true;
  }

  /**
   * Влез в бурю по краю карты. Не телепорт: машину катит по дуге и выбрасывает
   * за границу тумана — в ближайшую точку, где буря уже не держит.
   * inward — единичный горизонтальный вектор «от стены к центру».
   */
  startKnockback(inward) {
    if (this.tumble) return false;
    this.tumble = true;
    this.tumbleKind = 'knock';
    this.tumbleT = 0;
    this.tumbleAngle = 0;
    this.wind.copy(inward).setY(0).normalize();
    this._tumbleAxis.set(this.wind.z, 0, -this.wind.x).normalize();

    // Цель: идём по лучу к центру, пока туман не станет нулевым, и отступаем
    // ещё на 8 м, чтобы приземлиться уже вне бури.
    const outX = -this.wind.x, outZ = -this.wind.z;
    const r0 = Math.hypot(this.pos.x, this.pos.z);
    let safeR = Math.max(0, r0 - 30);
    for (let r = r0; r > 0; r -= 3) {
      if (fogAt(outX * r, outZ * r) <= 0.01) { safeR = r; break; }
    }
    safeR = Math.max(0, safeR - 8);

    this._blowFrom = { x: this.pos.x, z: this.pos.z };
    this._blowTo = { x: outX * safeR, z: outZ * safeR };
    this._blowDist = Math.hypot(this._blowTo.x - this.pos.x, this._blowTo.z - this.pos.z);
    // длительность — по расстоянию: короткий бросок не станет вялым
    this.tumbleDur = Math.min(2.4, Math.max(0.75, this._blowDist / 11));

    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.airTime = 0;
    this.shake = Math.max(this.shake, 0.9);
    this.damage(4, 'буря');
    return true;
  }

  /** Финал: экипаж выбрасывает не сразу — сначала машина делает обороты.
      План: i-я фигура вылетает после 1 + 0.7·i оборота качения. */
  ejectCrew() {
    if (!this.crew || !this.crew.length) return false;
    if (!this.group.parent) return false;
    this._ejectPlan = this.crew.map((_, i) => Math.PI * 2 * (1 + i * 0.7));
    this._ejectedCount = 0;
    this.crewBodies = [];
    return true;
  }

  /** Выбросить одну фигуру: летит туда же, куда катится машина, но в свою
      сторону — медленно, по дуге, как сама машина, а не выстрелом. */
  ejectOne(idx) {
    const c = this.crew[idx];
    const scene = this.group.parent;
    if (!c || !scene) return false;
    const g = c.group;
    if (!g.parent) return false;
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    g.getWorldPosition(wp);
    g.getWorldQuaternion(wq);
    scene.add(g);                // вынимаем из ровера, сохраняя мировое место
    g.position.copy(wp);
    g.quaternion.copy(wq);

    // Направление и скорость берём у машины в этот момент: фигура не
    // выстреливает, а вылетает вместе с ней и плавно догоняет землю.
    const dir = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (dir.lengthSq() < 1e-4) dir.copy(this.wind);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const sideV = new THREE.Vector3(-dir.z, 0, dir.x);
    const carSpeed = Math.hypot(this.vel.x, this.vel.z);
    const speed = Math.min(16, Math.max(7.5, carSpeed));
    const side = (idx % 2 === 0 ? 1 : -1) * (2.2 + idx * 1.1);
    const vel = new THREE.Vector3().addScaledVector(dir, speed).addScaledVector(sideV, side);
    vel.y = 3.4 + idx * 0.7;     // подброс вверх: фигура летит долго и машет

    this.crewBodies.push({
      obj: g,
      vel,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 2.0, (Math.random() - 0.5) * 2.0, (Math.random() - 0.5) * 2.0,
      ),
      rest: 0,
      r: 0.5,
      glide: true,               // ослабленная гравитация: летит медленно
      limbs: c.limbs || null,    // руки/ноги — машут, пока фигура в воздухе
      flail: 0,
      phase: Math.random() * Math.PI * 2,
    });
    this.dust.emit(wp, 8, 2.6, 'soil');
    return true;
  }

  /** Вернуть фигуры на сиденья (новая экспедиция) */
  restoreCrew() {
    if (!this.crew || !this.crew.length) return false;
    const root = this._glbRoot;
    if (!root) return false;
    for (const c of this.crew) {
      if (c.group.parent !== root) root.add(c.group);
      c.group.position.copy(c.home);
      c.group.quaternion.identity();
      if (c.limbs) for (const k in c.limbs) c.limbs[k]?.rotation.set(0, 0, 0);
    }
    this.crewBodies = [];
    this._ejectPlan = null;
    this._ejectedCount = 0;
    return true;
  }

  /** Полёт выброшенных фигур: гравитация, отскок, трение о грунт */
  updateCrewBodies(dt) {
    if (!this.crewBodies || !this.crewBodies.length) return;
    for (const b of this.crewBodies) {
      if (b.rest > 1.2) continue;
      const o = b.obj, v = b.vel;
      // выброшенный фигура падает медленно, как машина: ослабленная тяжесть
      v.y -= P.GRAV * (b.glide ? 0.16 : 1) * dt;
      if (b.glide) {
        const air = 1 - Math.min(1, 0.4 * dt);   // воздух плавно тормозит полёт
        v.x *= air; v.z *= air;
        // ветер тянет фигуру туда же, куда катится машина
        v.x += this.wind.x * 2.6 * dt;
        v.z += this.wind.z * 2.6 * dt;
      }
      o.position.addScaledVector(v, dt);
      const gy = meshHeightAt(o.position.x, o.position.z) + b.r;
      if (o.position.y <= gy) {
        o.position.y = gy;
        if (v.y < 0) v.y = -v.y * 0.26;
        if (Math.abs(v.y) < 0.7) v.y = 0;
        const fr = 1 - Math.min(1, 3.4 * dt);
        v.x *= fr; v.z *= fr;
        b.spin.multiplyScalar(1 - Math.min(1, 4.5 * dt));
        b.rest += dt;
      }
      o.rotateX(b.spin.x * dt);
      o.rotateY(b.spin.y * dt);
      o.rotateZ(b.spin.z * dt);
      // руки и ноги болтаются в воздухе и затихают, когда фигура легла
      if (b.limbs) {
        b.flail += dt;
        const calm = b.rest > 0 ? Math.max(0, 1 - b.rest * 1.6) : 1;
        const a = b.flail, ph = b.phase;
        const L = b.limbs;
        if (L.armL) L.armL.rotation.set(
          Math.sin(a * 7.3 + ph) * 0.95 * calm,
          Math.sin(a * 3.1 + ph) * 0.35 * calm,
          (0.35 + Math.sin(a * 5.7 + ph) * 0.75) * calm,
        );
        if (L.armR) L.armR.rotation.set(
          Math.sin(a * 6.6 + ph + 2.1) * 0.95 * calm,
          Math.sin(a * 2.7 + ph + 1.3) * 0.35 * calm,
          -(0.35 + Math.sin(a * 5.1 + ph + 0.7) * 0.75) * calm,
        );
        if (L.legL) L.legL.rotation.set(
          Math.sin(a * 5.2 + ph + 0.9) * 0.7 * calm,
          0,
          Math.sin(a * 3.6 + ph) * 0.4 * calm,
        );
        if (L.legR) L.legR.rotation.set(
          Math.sin(a * 4.7 + ph + 2.6) * 0.7 * calm,
          0,
          Math.sin(a * 3.1 + ph + 1.9) * 0.4 * calm,
        );
      }
    }
  }

  /** Отбрасывание закончилось: ставим машину на колёса, управление возвращается */  endTumble() {
    this.tumble = false;
    this.tumbleKind = null;
    this.tumbleAngle = 0;
    this.tumbleT = 0;
    this._ejectPlan = null;
    this._ejectedCount = 0;
    this.vel.set(0, 0, 0);
    this.shake = Math.max(this.shake, 0.35);
    this.snapToGround();
    return true;
  }

  step(dt, inp, obstacles) {
    const p = this.pos, v = this.vel;
    const touchingBefore = this.touching;   // камень держал в прошлом кадре
    this.touching = false;
    this.impactCd = Math.max(0, this.impactCd - dt);
    this.bumpCd = Math.max(0, this.bumpCd - dt);
    this.knockCd = Math.max(0, this.knockCd - dt);
    this.bump = Math.max(0, this.bump - dt * 6);
    this.impact = Math.max(0, this.impact - dt * 6);
    const n = this._n;
    meshNormalAt(p.x, p.z, n);
    // Нормаль сглаживаем: земля собрана из плоских треугольников, и на каждом
    // ребре нормаль меняется скачком. Если брать её как есть, ровер дёргается
    // и резко разворачивается, чтобы встать под новый угол.
    this.up.lerp(n, 1 - Math.exp(-P.UP_SMOOTH * dt));
    if (this.up.lengthSq() < 1e-8) this.up.copy(n);
    this.up.normalize();

    // нос — в плоскость склона (по сглаженному наклону — тогда плавно)
    this.heading.addScaledVector(this.up, -this.heading.dot(this.up));
    if (this.heading.lengthSq() < 1e-6) this.heading.set(0, 0, 1);
    this.heading.normalize();
    const hx = this.heading.x, hz = this.heading.z;

    const fwdSpeed = v.x * hx + v.z * hz;

    /* --- рельеф под колёсами ------------------------------------------- */
    const g = meshPlaneAt(p.x, p.z);
    const gl = Math.hypot(g.gx, g.gz);   // полная крутизна склона — для сползания
    // Крутизна ВДОЛЬ ХОДА: в гору > 0, под гору < 0, поперёк ≈ 0.
    // Именно она решает, хватает ли тяги без форсажа: ехать вбок по горе
    // можно спокойно, тяжело только лезть вверх.
    const gFwd = g.gx * hx + g.gz * hz;
    this.gradeFwd = gFwd;

    /* --- руль ---------------------------------------------------------- */
    const st = this.tumble ? 0 : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const steer = st;
    const authority = Math.min(1, Math.abs(fwdSpeed) / 7)
      * (1 - Math.min(0.42, Math.abs(fwdSpeed) / 70)) + 0.12;
    const dirSign = fwdSpeed < -0.6 ? -1 : 1;
    if (steer !== 0) {
      this.heading.applyAxisAngle(n, -steer * P.TURN * authority * dirSign * dt).normalize();
    }
    this.steerVisual += (steer * 0.42 - this.steerVisual) * Math.min(1, dt * 9);

    /* --- двигатель и энергия ------------------------------------------- */
    const throttle = this.tumble ? 0 : (inp.fwd ? 1 : 0) - (inp.back ? 1 : 0);
    this.boosting = !this.tumble && !!inp.boost && throttle > 0 && this.energy > 0.5;

    let accel = 0;
    if (throttle > 0) accel = this.boosting ? P.ACCEL_BOOST : P.ACCEL;
    else if (throttle < 0) accel = -P.REV_ACCEL;
    // «пониженная передача»: обычные склоны берутся и без форсажа
    if (throttle > 0 && gFwd > 0.18) {
      const steep = Math.min(1, (gFwd - 0.18) / 0.45);
      accel *= 1.9 + steep * 1.3;
    }
    // а вот подъём круче CLIMB_SHIFT — только на форсаже:
    // обычной тяги не хватает, и машина сползает вниз
    this.tooSteep = false;
    if (throttle > 0 && gFwd > P.CLIMB_SHIFT) {
      const over = Math.min(1, (gFwd - P.CLIMB_SHIFT) / 0.25);
      if (this.boosting) {
        accel *= 1 + over * 0.55;      // форсаж на крутизне берёт с запасом
        this.tooSteep = false;
      } else {
        accel *= 1 - over;
        this.tooSteep = over > 0.5;
      }
    } else {
      this.tooSteep = false;
    }
    // в тумане двигатель задыхается
    if (this.fog > 0) accel *= Math.max(0.12, 1 - this.fog * 0.9);
    v.x += this.heading.x * accel * dt;
    v.z += this.heading.z * accel * dt;

    if (this.boosting) this.energy = Math.max(0, this.energy - P.BOOST_DRAIN * dt);
    else this.energy = Math.min(100, this.energy + P.BOOST_REGEN * dt);

    /* --- уклон --------------------------------------------------------- */
    // скат ограничен: на крутизне машина ползёт медленнее, но не встаёт намертво.
    const hsNow = Math.hypot(v.x, v.z);
    // упёрлись в камень — он держит машину на склоне, пока ждём заряд
    const heldByRock = touchingBefore && hsNow < 4;
    this.heldByRock = heldByRock;
    // шины держат только на относительно ровном месте и только без газа:
    // с нажатым газом трение покоя гасило бы сам разгон (машина не могла тронуться)
    const staticHold = gl < P.SLIDE_SLOPE && hsNow < 2.2 && throttle === 0;
    this.sliding = !staticHold && !heldByRock && gl >= P.SLIDE_SLOPE && throttle === 0;
    if (this.grounded && gl > 1e-4) {
      // на форсаже шины держат, без него — сползает тем сильнее, чем круче
      const grade = Math.min(this.boosting ? 0.45 : 0.95, gl);
      const push = (staticHold || heldByRock) ? 0 : P.GRAV * grade * dt;
      v.x -= (g.gx / gl) * push;
      v.z -= (g.gz / gl) * push;
    }
    // трение покоя: на ровном месте машина стоит, на склоне съезжает
    if (this.grounded && staticHold && !inp.brake) { v.x = 0; v.z = 0; }
    // съезжая без газа, гасим разгон — плавный скат, а не свободное падение
    if (this.grounded && throttle === 0 && !inp.brake && !heldByRock
        && gl >= P.SLIDE_SLOPE) {
      const dec = Math.min(1, P.SLIDE_DRAG * dt);
      v.x -= v.x * dec; v.z -= v.z * dec;
    }

    /* --- трение -------------------------------------------------------- */
    if (this.grounded) {
      const fwd = v.x * hx + v.z * hz;
      const latX = v.x - hx * fwd;
      const latZ = v.z - hz * fwd;
      const grip = inp.brake ? 2.2 : P.GRIP;
      const k = Math.min(1, grip * dt);
      v.x -= latX * k;
      v.z -= latZ * k;

      const roll = inp.brake ? 5.5 : P.ROLL;
      const rf = 1 - Math.min(0.85, roll * dt);
      v.x *= rf; v.z *= rf;
      if (!throttle && !inp.brake && Math.hypot(v.x, v.z) < 1.2) { v.x *= 0.9; v.z *= 0.9; }
    }

    /* --- стояночный тормоз ---------------------------------------------- */
    // Space держит на любом склоне; без него машина на уклоне скатывается
    if (this.grounded && inp.brake && Math.hypot(v.x, v.z) < 3.5) { v.x = 0; v.z = 0; }

    /* --- пределы скорости ---------------------------------------------- */
    const hs = Math.hypot(v.x, v.z);
    // пока машину катит буря, ни пределы скорости, ни вязкость тумана на неё
    // не действуют: иначе отбрасывание тут же гаснет на месте
    const fogK = this.tumble ? 1 : 1 - this.fog * 0.72;
    const maxH = (this.boosting ? P.MAX_BOOST : P.MAX_SPEED) * fogK;
    if (hs > maxH) { const k = maxH / hs; v.x *= k; v.z *= k; }
    // вязкое сопротивление тумана
    if (this.fog > 0.02 && !this.tumble) {
      const drag = 1 - Math.min(0.85, this.fog * this.fog * 9 * dt);
      v.x *= drag; v.z *= drag;
    }
    const fwd2 = v.x * hx + v.z * hz;
    if (fwd2 < -P.MAX_REVERSE) {
      const add = (-P.MAX_REVERSE - fwd2);
      v.x += hx * add; v.z += hz * add;
    }
    v.x *= 1 - Math.min(0.4, P.AIR * hs * dt);
    v.z *= 1 - Math.min(0.4, P.AIR * hs * dt);

    /* --- гравитация и интегрирование ----------------------------------- */
    v.y -= P.GRAV * dt;
    p.addScaledVector(v, dt);

    /* --- столкновения --------------------------------------------------- */
    let launched = false;   // подбросило галькой — земляной контакт в этом кадре не глушим
    if (obstacles) {
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        // Препятствия — вертикальные цилиндры, а не шары: раньше сравнение
        // шло по 3D-расстоянию, и на подъёме в гору камень выше ровера просто
        // не считался препятствием — машина проезжала сквозь него.
        const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
        const dy = p.y - o.pos.y;
        const rr = o.r + P.RADIUS;
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        // в прыжке над невысоким препятствием не задеваем
        if (dy > P.CLEAR_OVER && !o.bump) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = 0, nz = dz / d;

        /* --- галька: не держит, а подбрасывает ---------------------- */
        if (o.bump) {
          const hsp = Math.hypot(v.x, v.z);
          if (this.grounded && this.bumpCd <= 0 && hsp > P.BUMP_MIN) {
            const k = Math.min(1, hsp / P.MAX_BOOST);
            v.y = Math.max(v.y, P.BUMP_UP + k * P.BUMP_UP_MAX);
            v.x *= 0.95; v.z *= 0.95;
            this.grounded = false;
            this.airTime = 0;
            this.bump = Math.max(this.bump, 0.35 + k * 0.65);
            this.bumpCd = 0.22;
            launched = true;
            // брызги камня из-под колёс
            this._tmp.copy(p).setY(p.y - 0.32);
            this.dust.emit(this._tmp, 6 + Math.round(k * 9), 3.4, 'rock');
          }
          continue;
        }

        this.touching = true;
        // Выталкиваем только по горизонтали, и не за один кадр: на спуске с горы
        // машина за кадр уходит на пару метров и оказывается глубоко в камне —
        // мгновенный «выстрел» на поверхность цилиндра выглядел как телепорт.
        // Поэтому выталкиваем не больше, чем машина проехала за 1.5 кадра.
        const need = rr - d;
        const maxPush = Math.max(0.12, Math.hypot(v.x, v.z) * dt * 1.5);
        const push = Math.min(need, maxPush);
        p.x += nx * push;
        p.z += nz * push;
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) {
          v.x -= nx * vn * 1.35;
          v.z -= nz * vn * 1.35;
          if (vn < -4) { v.x *= 0.88; v.z *= 0.88; }

          /* --- удар «в лоб» на большой скорости --------------------- */
          const closing = -vn;
          if (closing > P.IMPACT_SPEED && this.impactCd <= 0) {
            const over = closing - P.IMPACT_SPEED;
            const what = o.kind === 'crystal' ? 'кристалл'
              : o.kind === 'tree' ? 'ствол' : 'камень';
            this.damage(Math.min(P.IMPACT_MAX, over * P.IMPACT_DMG), what);
            this.shake = 1;
            this.impact = Math.min(1, 0.35 + over / 8);
            this.impactCd = P.IMPACT_COOLDOWN;
            // машину отбросило: скорость гасится, а не просто отскакивает
            v.x *= 0.40; v.z *= 0.40;
            this._tmp.copy(p);
            this.dust.emit(this._tmp, 14, 4.6, o.kind === 'tree' ? 'soil' : 'rock');
          }

          // если упёрлись «в лоб» и почти стоим — мягко подруливаем вдоль препятствия
          const hsp = Math.hypot(v.x, v.z);
          const headOn = Math.abs(this.heading.x * nx + this.heading.z * nz);
          if (hsp < 4 && headOn > 0.55) {
            const tx = -nz, tz = nx;
            const dotT = this.heading.x * tx + this.heading.z * tz;
            const side = dotT >= 0 ? 1 : -1;
            this.heading.x += tx * side * 0.35 * dt;
            this.heading.z += tz * side * 0.35 * dt;
            this.heading.normalize();
          }
        }
        if (vn < -8) this.shake = Math.min(1, this.shake + 0.5);
      }
    }

    /* --- контакт с землёй ---------------------------------------------- */
    const ground = meshHeightAt(p.x, p.z);
    this.groundY = ground + P.CLEAR;
    // Прижимаем к склону: на крутом спуске машина иначе «парит» над откосом,
    // контакт не засчитывается и разгон по уклону не работает — не скатывается.
    // Но прижим ограничен тем, что машина успевает «съесть» за шаг: допуск
    // растёт с пройденным путём (уклон до ~42°), поэтому с обрыва ровер летит,
    // а не телепортируется на дно, и трамплин с камня не обрезается.
    const stepDist = Math.hypot(v.x, v.z) * dt;
    const stickMax = P.STICK_MIN + stepDist * P.STICK_SLOPE;
    // airTime здесь не проверяем: после короткого подскока на спуске машина
    // обязана снова взяться за грунт, иначе она «летит» вдоль склона и не едет
    if (!this.grounded && !launched && v.y > -P.STICK_FALL && v.y < 1.5
        && p.y > this.groundY && p.y - this.groundY < stickMax) {
      p.y = this.groundY;
      if (v.y < 0) v.y = 0;
      this.grounded = true;
      this.airTime = 0;
    }
    if (p.y <= this.groundY && !launched) {
      if (v.y < -14) this.shake = Math.min(1, this.shake + 0.22);
      // жёсткое приземление бьёт по прочности
      if (v.y < -P.FALL_SPEED) {
        const hit = Math.min(62, (-v.y - P.FALL_SPEED) * P.FALL_DMG);
        this.damage(hit, 'падение');
        this.shake = Math.min(1, this.shake + 0.3);
      }
      p.y = this.groundY;
      if (v.y < 0) v.y = 0;
      this.grounded = true;
      this.airTime = 0;
    } else {
      this.grounded = false;
      this.airTime += dt;
    }

    /* --- кувыркание: ветер несёт и катит через крышу -------------------- */
    if (this.tumble) {
      if (this.tumbleKind === 'knock') {
        // Сценарий выброса: летим по дуге от точки входа в бурю до ближайшей
        // безопасной точки. Никаких импульсов — траектория задана и всегда
        // заканчивается вне тумана.
        this.tumbleT += dt;
        const t = Math.min(1, this.tumbleT / this.tumbleDur);
        const e = t * t * (3 - 2 * t);          // разгон-торможение пути
        const fx = this._blowFrom.x, fz = this._blowFrom.z;
        p.x = fx + (this._blowTo.x - fx) * e;
        p.z = fz + (this._blowTo.z - fz) * e;

        // Последняя треть пути — «успокоение»: докручиваемся ровно до целого
        // оборота и опускаем корпус с радиуса качения до клиренса. Без этого
        // в конце был рывок: корпус мгновенно вставал по базису.
        const settleFrom = 0.68;
        let e2 = 0;
        if (t > settleFrom) {
          const k = (t - settleFrom) / (1 - settleFrom);
          e2 = k * k * (3 - 2 * k);
        }
        const rawAngle = (this._blowDist * e) / P.TUMBLE_R;
        const wholeTurn = Math.round(rawAngle / (Math.PI * 2)) * Math.PI * 2;
        this.tumbleAngle = rawAngle + (wholeTurn - rawAngle) * e2;

        const gT = meshHeightAt(p.x, p.z);
        const rideH = P.TUMBLE_R + (P.CLEAR - P.TUMBLE_R) * e2;
        const hop = Math.sin(Math.PI * t) * 1.2 * (1 - e2);
        this.groundY = gT + P.CLEAR;
        p.y = gT + rideH + hop;
        v.set(0, 0, 0);
        this.speed = (this._blowDist / this.tumbleDur) * (1 - e2);
        if (t >= 1) this.endTumble();
      } else {
        const w = this.wind;
        const push = P.TUMBLE_PUSH * dt;
        v.x += w.x * push;
        v.z += w.z * push;
        const drag = 1 - Math.min(0.5, P.TUMBLE_DRAG * dt);
        v.x *= drag; v.z *= drag;
        const hs = Math.hypot(v.x, v.z);
        if (hs > P.TUMBLE_MAX) {
          const c = P.TUMBLE_MAX / hs;
          v.x *= c; v.z *= c;
        } else if (hs < P.TUMBLE_MIN) {
          // трение шин гасит качение — поддерживаем минимум, иначе клубок встаёт
          const c = P.TUMBLE_MIN / (hs || 1);
          v.x *= c; v.z *= c;
        }
        // катимся без проскальзывания: угол = путь / радиус
        this.tumbleAngle += (Math.hypot(v.x, v.z) * dt) / P.TUMBLE_R;
        this.tumbleT += dt;
        // экипаж вылетает по одному — только после первого оборота
        if (this._ejectPlan && this._ejectedCount < this._ejectPlan.length) {
          while (this._ejectedCount < this._ejectPlan.length
            && this.tumbleAngle >= this._ejectPlan[this._ejectedCount]) {
            this.ejectOne(this._ejectedCount);
            this._ejectedCount += 1;
          }
        }
        // корпус катится по земле, поэтому центр держится на радиусе над грунтом
        const gT = meshHeightAt(p.x, p.z) + P.TUMBLE_R;
        this.groundY = gT;
        if (p.y < gT) {
          p.y = gT;
          if (v.y < 0) v.y = 0;
          this.grounded = true;
          this.airTime = 0;
        }
      }
    }

    /* --- туман: край мира ------------------------------------------- */
    const rr = Math.hypot(p.x, p.z);
    this.fog = fogAt(p.x, p.z);
    this.nearFog = this.fog > 0.02;

    /* --- влез в бурю по краю карты: выбрасывает внутрь с кувырканием ---
       В плотном тумане разгон и так почти нулевой, поэтому смотрим не на
       геометрическую стену, а на плотность: как только машина всерьёз
       увязает в буре, её отбрасывает обратно и ставит на колёса. */
    if (!this.tumble && this.knockCd <= 0 && this.fog > 0.45 && rr > 1) {
      this._tmp.set(-p.x / rr, 0, -p.z / rr);
      if (this.startKnockback(this._tmp)) {
        this.knockCd = 3.0;
        this._tmp.copy(p);
        this.dust.emit(this._tmp, 22, 5.6, 'soil');
      }
    }
    const wall = fogHardAt(p.x, p.z);   // стена идёт по неровному контуру
    // пока машину катит буря, стена её больше не держит: иначе она упирается
    // в сжимающееся кольцо и замирает вместо кувыркания
    if (!this.tumble && rr > wall) {
      const nx = p.x / rr, nz = p.z / rr;
      p.x = nx * wall;
      p.z = nz * wall;
      const vr = v.x * nx + v.z * nz;
      // влетел в стену — отбрасывает внутрь с кувырканием.
      // Порог низкий: в тумане машина еле ползёт, до стены доезжаешь шагом
      if (vr > 2.0 && this.knockCd <= 0) {
        this._tmp.set(-nx, 0, -nz);
        if (this.startKnockback(this._tmp)) {
          this.knockCd = 3.0;
          this._tmp.copy(p);
          this.dust.emit(this._tmp, 18, 5.2, 'soil');
        }
      } else if (vr > 0) {
        v.x -= nx * vr * 1.5;
        v.z -= nz * vr * 1.5;
      }
    }
    this.nearWall = this.fog > 0.02;

    // медленный ремонт вне тумана
    if (this.fog < 0.01 && this.grounded && this.hp < this.hpMax && this.hp > 0) {
      this.hp = Math.min(this.hpMax, this.hp + 1.1 * dt);
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt * 1.7);


    // нос снова в плоскость склона
    this.heading.addScaledVector(this.up, -this.heading.dot(this.up)).normalize();

    this.speed = Math.hypot(v.x, v.z);
    this.wheelSpin += (v.x * this.heading.x + v.z * this.heading.z) * dt / this.wheelRadius;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.updateCrewBodies(dt);
  }

  /* ------------------------------------------------------------- визуал */
  applyVisual(dt, t) {
    const up = this.up;
    const head = this._fwd.copy(this.heading);
    head.addScaledVector(up, -head.dot(up));
    if (head.lengthSq() < 1e-6) head.copy(this.heading);
    head.normalize();

    // правый базис: X = up × forward, Y = up, Z = forward (det = +1)
    this._right.crossVectors(up, head);
    if (this._right.lengthSq() < 1e-8) this._right.crossVectors(up, new THREE.Vector3(1, 0, 0));
    this._right.normalize();
    this._basis.makeBasis(this._right, up, head);
    this.group.quaternion.setFromRotationMatrix(this._basis);
    this.group.position.copy(this.pos);

    // кувыркание: катимся вокруг оси ветра, корпус проходит через крышу
    if (this.tumble) {
      this._rollQ.setFromAxisAngle(this._tumbleAxis, this.tumbleAngle);
      this.group.quaternion.premultiply(this._rollQ);
    }

    this.group.rotateZ(this.steerVisual * Math.min(1, this.speed / 20) * 0.10);

    for (const w of this.wheels) {
      w.pivot.rotation.x = this.wheelSpin;
      if (w.front) w.steerGroup.rotation.y = -this.steerVisual;
    }
    if (this.beacon) this.beacon.rotation.y += dt * 3.2;

    const surface = this.surface || 'sand';
    const kind = Object.prototype.hasOwnProperty.call(SURFACE_DUST, surface)
      ? SURFACE_DUST[surface] : 'sand';
    if (kind && this.speed > 3 && this.grounded && dt > 0) {
      const k = Math.min(1, this.speed / P.MAX_BOOST);
      const n = 1 + Math.round(k * 3.2) + (this.boosting ? 1 : 0);
      const side = this._sideVec.crossVectors(up, head).normalize();
      for (const sgn of [-1, 1]) {
        const p = this._tmp.copy(this.pos)
          .addScaledVector(head, -0.95)
          .addScaledVector(side, sgn * 0.42)
          .addScaledVector(up, 0.08);
        this.dust.emit(p, n, 2.0 + k * 2.4, kind);
      }
    }
    this.dust.update(dt);
  }
}

export { P as ROVER_TUNING };
