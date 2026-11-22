/* ============================================================================
   АВАРИС · финальные кадры.
   Две концовки снимаются на живой сцене — теми же моделями, светом и туманом,
   что и вся игра. Камера ведётся по заранее собранным ключам, события идут по
   таймлайну, подписи и вспышка живут в HTML поверх кадра.

   «По ту сторону бури»: шпиль вспыхивает, осколки остывают, завеса уходит,
   небо расчищается до звёзд, камера поднимается над мёртвым городом.
   «Обратный курс»: рампа закрывается, двигатели поднимают модуль, пыль
   остаётся на грунте, камера провожает корабль к звёздам над стеной бури.
   ========================================================================== */
import * as THREE from 'three';
import { meshHeightAt } from './terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const mix = (a, b, k) => a + (b - a) * k;

const DURATION = { free: 18.0, leave: 17.0 };
const FREE_OPEN = 1.84;      // угол открытой рампы (см. lander.js)

/** Мягкое пятно для вспышки: canvas вместо внешней текстуры */
function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(232,250,255,.85)');
  grad.addColorStop(0.5, 'rgba(150,225,240,.32)');
  grad.addColorStop(1, 'rgba(90,170,210,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

/** Ключ кадра: время и смещения от опорной точки */
function sampleKeys(keys, t) {
  if (t <= keys[0][0]) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b[0]) {
      const k = smooth(a[0], b[0], t);
      return [t, mix(a[1], b[1], k), mix(a[2], b[2], k), mix(a[3], b[3], k), mix(a[4], b[4], k)];
    }
  }
  return keys[keys.length - 1];
}

export function createEpilogue({ world, rover, camera, audio, setDaylight, onCaption, onFlash }) {
  const scene = world.scene;

  /* ---------- общие для обеих концовок эффекты ---------- */
  const flashRingMat = new THREE.MeshBasicMaterial({
    color: 0xdff8ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const flashRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 128), flashRingMat);
  flashRing.rotation.x = -Math.PI / 2;
  flashRing.visible = false;
  flashRing.renderOrder = 4;
  scene.add(flashRing);

  const shardMat = new THREE.MeshBasicMaterial({
    color: 0xffe3b4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false,
  });
  const shardGeo = new THREE.OctahedronGeometry(2.3, 0);
  const shards = [];

  // «звезда» на конце шпиля: разгорается при разряде и остаётся в небе
  const flareMat = new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const flare = new THREE.Sprite(flareMat);
  flare.scale.setScalar(30);
  flare.visible = false;
  scene.add(flare);

  // факел двигателей посадочного модуля
  const plumeMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const plume = new THREE.Mesh(new THREE.ConeGeometry(3.1, 22, 12, 1, true), plumeMat);
  plume.rotation.x = Math.PI;
  plume.position.y = -11;
  plume.visible = false;
  const engineLight = new THREE.PointLight(0xffb066, 0, 240, 2);
  engineLight.position.set(0, -6, 0);

  const snap = { shipY: 0, hinge: 0, flood: 0, floodVisible: false,
    tipScale: 1, tipVisible: true, glow: 0, fov: camera.fov, roverX: 0, roverZ: 0, roverPlaced: false };

  const free = {
    vp: new THREE.Vector3(), back: new THREE.Vector3(), side: new THREE.Vector3(),
  };
  const leave = {
    site: new THREE.Vector3(), fwd: new THREE.Vector3(), side: new THREE.Vector3(),
  };

  let active = false;
  let kind = null;
  let t = 0;
  let duration = 0;
  let finished = false;
  let burst = false;
  let captionIndex = -1;
  let ship = null;

  const CAPTIONS = {
    free: [
      [1.2, 'Мира кладёт ладонь на шпиль.'],
      [7.4, 'Небо над Аварисом трескается и расходится.'],
      [12.6, 'Впервые за две тысячи лет планета видит свои звёзды.'],
    ],
    leave: [
      [1.0, 'Рампа поднимается. Ровер остаётся на грунте.'],
      [6.8, 'Модуль уходит к «Одиссею» сквозь стену бури.'],
      [12.0, 'Буря остаётся: спокойная и вечная.'],
    ],
  };

  function clearShards() {
    for (const s of shards) scene.remove(s.mesh);
    shards.length = 0;
  }

  function reset() {
    clearShards();
    flashRing.visible = false;
    flashRingMat.opacity = 0;
    shardMat.opacity = 0;
    flare.visible = false;
    flareMat.opacity = 0;
    if (onFlash) onFlash(0);
    camera.fov = snap.fov;
    camera.updateProjectionMatrix();
    world.setStormRing(0, 0);
    const v = world.vault;
    if (v && v.tip) {
      v.tip.visible = snap.tipVisible;
      v.tip.scale.setScalar(snap.tipScale);
      v.tip.position.y = 64;
    }
    if (v && v.tipMat) {
      v.tipMat.color.setHex(0xffd7a0);
      v.tipMat.emissive.setHex(0xffa040);
      v.tipMat.emissiveIntensity = 2.2;
    }
    if (v && v.glow) v.glow.material.opacity = snap.glow;
    if (v && v.beamMat) v.beamMat.color.setHex(0xffa040);
    // шпиль и луч возвращаются в скрытую процедурную постройку
    if (v && v.fallback) {
      if (v.spire) v.fallback.add(v.spire);
      if (v.beam) v.fallback.add(v.beam);
    }
    if (snap.roverPlaced) {
      rover.placeAt(snap.roverX, snap.roverZ);
      snap.roverPlaced = false;
    }
    if (ship) {
      ship.root.position.y = snap.shipY;
      ship.root.rotation.z = 0;
      ship.hinge.rotation.x = snap.hinge;
      ship.floodlight.intensity = snap.flood;
      ship.floodlight.visible = snap.floodVisible;
      if (plume.parent) plume.parent.remove(plume);
      if (engineLight.parent) engineLight.parent.remove(engineLight);
    }
    plume.visible = false;
    plumeMat.opacity = 0;
    engineLight.intensity = 0;
  }

  function start(which) {
    reset();
    kind = which === 'leave' ? 'leave' : 'free';
    t = 0;
    finished = false;
    burst = false;
    captionIndex = -1;
    duration = DURATION[kind];

    ship = world.lander;
    snap.shipY = ship.root.position.y;
    snap.hinge = ship.hinge.rotation.x;
    snap.flood = ship.floodlight.intensity;
    snap.floodVisible = ship.floodlight.visible;
    snap.roverX = rover.pos.x;
    snap.roverZ = rover.pos.z;
    snap.roverPlaced = false;
    snap.fov = camera.fov;
    snap.tipScale = world.vault.tip ? world.vault.tip.scale.x : 1;
    snap.tipVisible = world.vault.tip ? world.vault.tip.visible : true;
    snap.glow = world.vault.glow ? world.vault.glow.material.opacity : 0;

    camera.fov = 47;
    camera.updateProjectionMatrix();
    // к финалу завеса давно снята (иначе до узла не добраться) — но кадр
    // обязан сниматься чистым даже из отладочного запуска
    world.setBarrier(true);

    if (kind === 'free') {
      // город из набора скрывает процедурную постройку вместе со шпилем —
      // на финал поднимаем шпиль и его луч обратно в видимую группу
      const v = world.vault;
      if (v.spire) { v.group.add(v.spire); v.spire.visible = true; }
      if (v.beam) { v.group.add(v.beam); v.beam.visible = true; }
      const vp = world.vault.pos;
      const from = world.citySite ? world.citySite.from : { x: vp.x, z: vp.z + 40 };
      free.vp.copy(vp);
      free.back.set(from.x - vp.x, 0, from.z - vp.z);
      if (free.back.lengthSq() < 1) free.back.set(0, 0, 1);
      free.back.normalize();                       // от города к подъезду
      free.side.set(-free.back.z, 0, free.back.x); // поперёк взгляда
      audio.tone(196, 2.8, 'sine', 0.07, 210);
    } else {
      leave.site.copy(ship.root.position);
      leave.fwd.set(Math.sin(ship.root.rotation.y), 0, Math.cos(ship.root.rotation.y));
      leave.side.set(-leave.fwd.z, 0, leave.fwd.x);
      // рампа ещё открыта: закрываем её в кадре
      ship.hinge.rotation.x = FREE_OPEN;
      ship.floodlight.visible = true;
      // ровер стоит у модуля: экипаж уже внутри, машина остаётся на грунте
      const rx = leave.site.x + leave.fwd.x * 15 + leave.side.x * 10;
      const rz = leave.site.z + leave.fwd.z * 15 + leave.side.z * 10;
      rover.placeAt(rx, rz, [leave.site.x, leave.site.z]);
      snap.roverPlaced = true;
      audio.creak();
    }
    active = true;
    return kind;
  }

  /* ---------------------------------------------------- камера: «свобода» */
  function freeCamera(tt, pos, look) {
    const keys = [
      // время, отступ назад, сдвиг вбок, высота камеры, высота взгляда
      [0.0, 98, -15, 10, 44],
      [4.6, 80, -8, 14, 52],
      [7.8, 64, 5, 22, 68],
      [12.0, 92, 20, 40, 46],
      [18.0, 150, 38, 72, 14],
    ];
    const [, back, side, h, lh] = sampleKeys(keys, tt);
    pos.copy(free.vp).addScaledVector(free.back, back).addScaledVector(free.side, side);
    pos.y = free.vp.y + h;
    look.copy(free.vp);
    look.y = free.vp.y + lh;
    // камера «дышит»: чуть плывёт, пока идёт долгий кадр
    pos.x += Math.sin(tt * 0.33) * 0.6;
    pos.y += Math.sin(tt * 0.47 + 1.1) * 0.35;
  }

  /* ---------------------------------------------------- камера: «уходим» */
  function leaveCamera(tt, pos, look) {
    const keys = [
      [0.0, 25, 13, 5.5, 3.0],
      [4.2, 27, 14, 7.5, 3.6],
      [8.4, 36, 18, 17, 4.0],
      [13.0, 92, 42, 50, 4.0],
      [17.0, 156, 70, 112, 2.0],
    ];
    const [, fwd, side, h, lh] = sampleKeys(keys, tt);
    pos.copy(leave.site).addScaledVector(leave.fwd, fwd).addScaledVector(leave.side, side);
    pos.y = leave.site.y + h;
    look.copy(ship.root.position);
    look.y += lh;
    pos.x += Math.sin(tt * 0.29 + 0.6) * 0.5;
  }

  /* --------------------------------------------------- события таймлайна */
  function spawnShards(at) {
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(shardGeo, shardMat);
      mesh.position.copy(at);
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 6 + Math.random() * 13;
      mesh.userData = {
        vel: new THREE.Vector3(Math.cos(a) * sp, 5 + Math.random() * 12, Math.sin(a) * sp),
        spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
        sc: 0.5 + Math.random() * 1.1,
      };
      mesh.scale.setScalar(mesh.userData.sc);
      scene.add(mesh);
      shards.push({ mesh, life: 0 });
    }
  }

  const _tip = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _look = new THREE.Vector3();

  function update(dt) {
    if (!active) return false;
    t += Math.max(0, Math.min(dt, 0.1));
    const v = world.vault;

    if (kind === 'free') {
      freeCamera(t, _pos, _look);

      // шпиль заряжается: наконечник разгорается всё ярче
      const charge = smooth(3.4, 6.0, t);
      if (v.tip && v.tip.visible) {
        v.tipMat.emissiveIntensity = mix(2.2, 11, charge);
        const s = mix(1, 1.45, charge);
        v.tip.scale.setScalar(s * snap.tipScale);
        v.tip.position.y = 64 + Math.sin(t * 9) * 0.12 * charge;
      }
      if (v.glow) v.glow.material.opacity = mix(0.1, 0.85, charge);
      if (v.beamMat) v.beamMat.opacity = mix(0.02, 0.3, charge);

      // разряд
      if (!burst && t >= 6.0) {
        burst = true;
        v.tip.updateWorldMatrix(true, false);
        _tip.setFromMatrixPosition(v.tip.matrixWorld);
        flashRing.position.copy(_tip);
        flashRing.visible = true;
        flare.position.copy(_tip);
        flare.visible = true;
        spawnShards(_tip);
        if (onFlash) onFlash(0.6);
        audio.rumble(2.6, 0.24);
        audio.whoosh();
        audio.tone(120, 3.2, 'sine', 0.1, 38);
      }
      if (burst) {
        // наконечник не гаснет, а становится первой звездой: поднимается
        // на несколько метров и остаётся белой точкой над городом
        if (v.tip) {
          const up = smooth(6.0, 8.6, t);
          v.tip.visible = true;
          v.tip.scale.setScalar(mix(1.45, 0.55, up) * snap.tipScale);
          v.tip.position.y = 64 + up * 9;
          v.tipMat.emissiveIntensity = mix(11, 3.2, up);
          v.tipMat.emissive.setHex(up > 0.5 ? 0xdff8ff : 0xffd7a0);
          v.tipMat.color.setHex(up > 0.5 ? 0xdff8ff : 0xffd7a0);
        }
        if (v.beam) {
          v.beamMat.color.setHex(t < 8.2 ? 0xdff8ff : 0x9fe8ff);
          v.beamMat.opacity = (1 - smooth(6.0, 9.5, t)) * 0.75;
        }
        if (v.glow) v.glow.material.opacity = 0.9 * (1 - smooth(6.0, 10.5, t));
        // ореол: вспышка, потом тихая звезда
        const dull = smooth(6.0, 11.5, t);
        flareMat.opacity = mix(0.85, 0.6, dull);
        flare.scale.setScalar(mix(72, 26, smooth(6.0, 8.8, t)));
        const k = smooth(6.0, 9.4, t);
        const r = mix(2, 96, k);
        flashRing.scale.setScalar(r);
        flashRingMat.opacity = (1 - k) * 0.75;
        if (k >= 1) flashRing.visible = false;
        // осколки остывают на баллистических дугах
        for (const s of shards) {
          s.life += dt;
          const u = s.mesh.userData;
          u.vel.y -= 22 * dt;
          s.mesh.position.addScaledVector(u.vel, dt);
          s.mesh.rotation.x += u.spin.x * dt;
          s.mesh.rotation.y += u.spin.y * dt;
          s.mesh.scale.setScalar(u.sc * Math.max(0, 1 - s.life / 3.4));
        }
        const fade = smooth(6.2, 11, t);
        shardMat.opacity = 0.95 * (1 - fade);
        if (fade > 0.99) clearShards();
        if (onFlash) onFlash(0.6 * (1 - smooth(6.0, 6.7, t)) ** 2);
        // ореол висит на поднявшемся наконечнике
        if (v.tip) {
          v.tip.updateWorldMatrix(true, false);
          flare.position.setFromMatrixPosition(v.tip.matrixWorld);
        }
      }

      // буря распадается, небо расчищается до звёзд
      const burn = smooth(6.0, 11.8, t);
      setDaylight(mix(1.0, 0.0, burn));
      if (scene.fog) scene.fog.density = mix(0.0034, 0.0010, burn);
      // стена бури не «появляется», а расходится от города и тает
      world.setStormRing(300 + 1300 * burn,
        Math.max(0, 1 - burn) * smooth(0.02, 0.18, burn));
      // подъём камеры: мир становится всё шире
      rover.headlight.intensity *= 1 - 0.65 * smooth(8, 16, t);
    } else {
      // рампа закрывается, двигатели разгораются
      const close = smooth(0, 3.0, t);
      ship.hinge.rotation.x = FREE_OPEN * (1 - close);
      ship.floodlight.intensity = snap.flood * (1 - smooth(3.2, 6.0, t));

      const lift = Math.max(0, t - 4.6);
      const thrust = smooth(4.4, 6.2, t);
      if (thrust > 0) {
        if (!plume.parent) {
          ship.root.add(plume, engineLight);
          plume.visible = true;
        }
        const flick = 0.82 + Math.sin(t * 37) * 0.1 + Math.sin(t * 19.3) * 0.08;
        plumeMat.opacity = 0.72 * thrust * flick;
        plume.scale.set(1 + Math.sin(t * 21) * 0.05, 0.65 + thrust * 0.75, 1 + Math.cos(t * 17) * 0.05);
        engineLight.intensity = 340 * thrust * flick;
        // пыль из-под сопел, пока модуль у земли
        if (t < 8.2) {
          const gp = _pos.copy(ship.root.position);
          gp.x += (Math.random() - 0.5) * 7;
          gp.z += (Math.random() - 0.5) * 7;
          gp.y = meshHeightAt(gp.x, gp.z) + 0.4;
          rover.dust.emit(gp, 3, 5.0 + Math.random() * 3, 'soil');
        }
        audio.setEngine(thrust * 0.55, true);
      }
      const h = 0.42 * Math.pow(lift, 2.15);
      ship.root.position.y = snap.shipY + h;
      ship.root.rotation.z = 0.055 * smooth(4.8, 8, t);
      rover.applyVisual(dt, t);      // доживает пыль

      leaveCamera(t, _pos, _look);

      // стена бури проступает на горизонте, когда корабль ушёл выше
      const wall = smooth(9.5, 14, t);
      world.setStormRing(330, wall * 0.85);
      const night = smooth(5.5, 14.5, t);
      setDaylight(mix(1.0, 0.12, night));
      if (scene.fog) scene.fog.density = mix(0.0034, 0.0015, night);
    }

    // камера: не залезать под грунт
    const gh = meshHeightAt(_pos.x, _pos.z) + 2.6;
    if (_pos.y < gh) _pos.y = gh;
    camera.position.copy(_pos);
    camera.up.copy(UP);
    camera.lookAt(_look);
    if (burst && kind === 'free' && t < 7.4) {
      const sh = (1 - smooth(6.0, 7.4, t)) * 0.45;
      camera.position.x += (Math.random() - 0.5) * sh;
      camera.position.y += (Math.random() - 0.5) * sh;
    }

    // подписи
    const lines = CAPTIONS[kind];
    if (captionIndex + 1 < lines.length && t >= lines[captionIndex + 1][0]) {
      captionIndex++;
      if (onCaption) onCaption(lines[captionIndex][1], captionIndex);
    }

    if (t >= duration) {
      if (!finished) {
        finished = true;
        if (onCaption) onCaption('', -1);
        if (onFlash) onFlash(0);
        if (kind === 'leave') audio.setEngine(0, false);
      }
      return true;
    }
    return false;
  }

  /** Пропустить остаток кадра: следующий update дорисует финальное состояние */
  function skip() {
    if (!active) return false;
    t = duration;      // следующий update сразу закроет кадр
    return true;
  }

  return {
    start,
    update,
    skip,
    reset,
    get active() { return active; },
    get kind() { return kind; },
    get time() { return t; },
    get duration() { return duration; },
    close() { active = false; reset(); },
  };
}
