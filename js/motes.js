/* ============================================================================
   Частицы земли в радиусе видимости.
   Оптимизация:
   • один THREE.Points и один draw call на весь эффект;
   • фиксированный пул, память не пересоздаётся;
   • позиции считаются по кругу, а буфер отправляется в GPU не чаще 20 раз в
     секунду и только для готовой части пула — на кадр приходится 1/6 работы;
   • число частиц в пуле зависит от качества: на низком остаётся 40 %;
   • за пределами радиуса частица не рисуется (гаснет по расстоянию в шейдере).
   ========================================================================== */
import * as THREE from 'three';

const MAX = 900;
const UPLOAD_HZ = 20;      // как часто буфер уезжает на видеокарту
const BATCH = 6;           // доля пула, обновляемая за одну отправку

export class GroundMotes {
  constructor(scene) {
    this.count = MAX;
    this.radius = 62;          // радиус «видимости» вокруг машины
    this.storm = 0;            // 0..1 — насколько близко буря
    this._acc = 0;
    this._cursor = 0;
    this._center = new THREE.Vector3();
    this._time = 0;

    this.pos = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.col = new Float32Array(MAX * 3);
    this.ang = new Float32Array(MAX);
    this.rad = new Float32Array(MAX);
    this.h = new Float32Array(MAX);
    this.rise = new Float32Array(MAX);
    this.spin = new Float32Array(MAX);

    const palette = [
      [0.62, 0.56, 0.44], [0.72, 0.66, 0.52], [0.54, 0.47, 0.38],
      [0.66, 0.60, 0.50], [0.78, 0.73, 0.60],
    ];
    for (let i = 0; i < MAX; i++) {
      this.ang[i] = Math.random() * Math.PI * 2;
      this.rad[i] = 3 + Math.sqrt(Math.random()) * this.radius;
      this.h[i] = Math.random() * 9;
      this.rise[i] = 0.25 + Math.random() * 1.1;
      this.spin[i] = (Math.random() - 0.5) * 0.22;
      this.size[i] = 0.5 + Math.random() * 1.3;
      const c = palette[(Math.random() * palette.length) | 0];
      const k = 0.85 + Math.random() * 0.3;
      this.col[i * 3] = c[0] * k;
      this.col[i * 3 + 1] = c[1] * k;
      this.col[i * 3 + 2] = c[2] * k;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('moteSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, this.count);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uRadius: { value: this.radius },
        uFade: { value: 1 },
      },
      vertexShader: /* glsl */`
        attribute float moteSize;
        attribute vec3 color;
        uniform float uRadius;
        varying float vA;
        varying vec3 vC;
        void main() {
          vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = length(mv.xyz);
          // гаснет к краю радиуса: дальше не рисуем заметные точки
          float far = 1.0 - smoothstep(uRadius * 0.55, uRadius, d);
          float near = smoothstep(0.6, 3.0, d);
          vA = far * near;
          gl_PointSize = 42.0 * moteSize / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        varying vec3 vC;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.12, length(c)) * vA * 0.55;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;   // всегда вокруг камеры — считать бокс незачем
    this.geo = geo;
    this.mat = mat;
    scene.add(this.points);
  }

  /** Низкое качество: пул втрое меньше, заодно реже обновляем */
  setQuality(low) {
    this.count = low ? Math.round(MAX * 0.4) : MAX;
    this.geo.setDrawRange(0, this.count);
  }

  /** center — машина, storm 0..1 — насколько близко стена бури */
  update(dt, center, storm = 0) {
    this._center.copy(center);
    this.storm = storm;
    this._time += dt;
    this._acc += dt;
    if (this._acc < 1 / UPLOAD_HZ) return;   // буфер не дёргаем каждый кадр
    this._acc = 0;

    const n = this.count;
    const step = Math.max(1, Math.ceil(n / BATCH));
    const from = this._cursor;
    const to = Math.min(n, from + step);

    const wind = 1.2 + storm * 9;
    const lift = 1 + storm * 2.2;
    const cx = this._center.x, cy = this._center.y, cz = this._center.z;

    for (let i = from; i < to; i++) {
      this.h[i] += dt * this.rise[i] * lift;
      if (this.h[i] > 9) this.h[i] -= 9;
      this.ang[i] += this.spin[i] * dt + (storm > 0.05 ? (wind * dt) / Math.max(4, this.rad[i]) : 0);
      const a = this.ang[i];
      const r = this.rad[i];
      this.pos[i * 3] = cx + Math.cos(a) * r;
      this.pos[i * 3 + 1] = cy + this.h[i] - 2.2;
      this.pos[i * 3 + 2] = cz + Math.sin(a) * r;
    }
    this._cursor = to >= n ? 0 : to;

    this.geo.attributes.position.needsUpdate = true;
  }

  /** После респауна машины: пересобрать облако вокруг новой точки */
  recenter(center) {
    this._center.copy(center);
    for (let i = 0; i < this.count; i++) {
      const a = this.ang[i], r = this.rad[i];
      this.pos[i * 3] = center.x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = center.y + this.h[i] - 2.2;
      this.pos[i * 3 + 2] = center.z + Math.sin(a) * r;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

/* ============================================================================
   Пыль финала. Пока экран не залило белым, мимо камеры должен лететь мусор:
   крупные хлопья и мелкий гравий, которые несёт ветер бури. Это делает
   последние секунды «грязными» и хорошо читаемыми — видно, как крутит машину
   и как из неё вылетают люди, а не просто белый экран.

   Двигаются относительно машины: пул точек живёт в кубе L×L и по выходу за
   грань заворачивается с другой стороны — частицы не рождаются и не умирают.
   ========================================================================== */
const DEBRIS_MAX = 720;
const DEBRIS_L = 74;          // сторона куба, в котором живёт пул
const DEBRIS_H = 16;          // высота слоя

export class StormDebris {
  constructor(scene) {
    this.count = DEBRIS_MAX;
    this.power = 0;             // 0..1 — насколько разыгралась буря
    this.radius = 40;
    this._center = new THREE.Vector3();
    this._wind = new THREE.Vector3(0, 0, -1);

    this.pos = new Float32Array(DEBRIS_MAX * 3);
    this.rel = new Float32Array(DEBRIS_MAX * 3);   // смещение от машины
    this.size = new Float32Array(DEBRIS_MAX);
    this.col = new Float32Array(DEBRIS_MAX * 3);
    this.alpha = new Float32Array(DEBRIS_MAX);
    this.spd = new Float32Array(DEBRIS_MAX);
    this.rise = new Float32Array(DEBRIS_MAX);

    const palette = [
      [0.60, 0.54, 0.42], [0.72, 0.66, 0.54], [0.50, 0.44, 0.35],
      [0.82, 0.78, 0.68], [0.66, 0.60, 0.48],
    ];
    for (let i = 0; i < DEBRIS_MAX; i++) {
      this.rel[i * 3] = (Math.random() - 0.5) * DEBRIS_L;
      this.rel[i * 3 + 1] = Math.random() * DEBRIS_H;
      this.rel[i * 3 + 2] = (Math.random() - 0.5) * DEBRIS_L;
      // крупные хлопья и мелкая крошка: два «размера мира» в одном пуле
      const big = Math.random() < 0.55;
      this.size[i] = big ? 1.4 + Math.random() * 2.4 : 0.35 + Math.random() * 0.5;
      this.spd[i] = big ? 9 + Math.random() * 9 : 16 + Math.random() * 16;
      this.rise[i] = big ? 0.4 + Math.random() * 1.6 : 0.1 + Math.random() * 0.6;
      this.alpha[i] = big ? 0.35 + Math.random() * 0.4 : 0.5 + Math.random() * 0.45;
      const c = palette[(Math.random() * palette.length) | 0];
      const k = 0.86 + Math.random() * 0.28;
      this.col[i * 3] = c[0] * k;
      this.col[i * 3 + 1] = c[1] * k;
      this.col[i * 3 + 2] = c[2] * k;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('moteSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('alphaMul', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, this.count);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uRadius: { value: this.radius },
        uPower: { value: 0 },
      },
      vertexShader: /* glsl */`
        attribute float moteSize;
        attribute vec3 color;
        attribute float alphaMul;
        uniform float uRadius;
        uniform float uPower;
        varying float vA;
        varying vec3 vC;
        void main() {
          vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = length(mv.xyz);
          float far = 1.0 - smoothstep(uRadius * 0.55, uRadius, d);
          float near = smoothstep(1.2, 4.5, d);   // не залепляем объектив
          vA = far * near * alphaMul * uPower;
          gl_PointSize = 130.0 * moteSize / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        varying vec3 vC;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.08, length(c)) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.geo = geo;
    this.mat = mat;
    scene.add(this.points);
  }

  setQuality(low) {
    this.count = low ? Math.round(DEBRIS_MAX * 0.45) : DEBRIS_MAX;
    this.geo.setDrawRange(0, this.count);
  }

  /** power 0 — пусто, 1 — стена мусора. wind — горизонтальный вектор ветра. */
  update(dt, center, power, wind = null) {
    this.power = Math.max(0, Math.min(1, power));
    this.points.visible = this.power > 0.01;
    if (!this.points.visible) return;

    this._center.copy(center);
    if (wind && (wind.x || wind.z)) this._wind.set(wind.x, 0, wind.z).normalize();
    const wx = this._wind.x, wz = this._wind.z;
    const half = DEBRIS_L / 2;
    const cx = center.x, cy = center.y, cz = center.z;
    const n = this.count;
    const gust = 0.75 + this.power * 0.75;      // ближе к финалу несёт сильнее

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const s = this.spd[i] * gust * dt;
      let x = this.rel[i3] + wx * s;
      let y = this.rel[i3 + 1] + this.rise[i] * gust * dt;
      let z = this.rel[i3 + 2] + wz * s;
      // заворот по граням куба — частицы не рождаются заново
      if (x > half) x -= DEBRIS_L; else if (x < -half) x += DEBRIS_L;
      if (z > half) z -= DEBRIS_L; else if (z < -half) z += DEBRIS_L;
      if (y > DEBRIS_H) y -= DEBRIS_H; else if (y < 0) y += DEBRIS_H;
      this.rel[i3] = x;
      this.rel[i3 + 1] = y;
      this.rel[i3 + 2] = z;
      this.pos[i3] = cx + x;
      this.pos[i3 + 1] = cy - 3 + y;
      this.pos[i3 + 2] = cz + z;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.mat.uniforms.uPower.value = Math.min(1, this.power * 1.25);
  }

  /** Новая экспедиция: мусор снова разбросан заново */
  reset() {
    this.power = 0;
    this.points.visible = false;
    this.mat.uniforms.uPower.value = 0;
    for (let i = 0; i < DEBRIS_MAX; i++) {
      this.rel[i * 3] = (Math.random() - 0.5) * DEBRIS_L;
      this.rel[i * 3 + 1] = Math.random() * DEBRIS_H;
      this.rel[i * 3 + 2] = (Math.random() - 0.5) * DEBRIS_L;
    }
  }
}
