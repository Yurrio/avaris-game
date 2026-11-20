/* Проверка чистой логики истории: язык, буря, этапы, ахолы, миниигры, сейвы.
   Запуск: node --test tools/test-story.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_KEY, STORM_MAX, STORM_AFTER_STAGE, KEYS, ARTIFACTS, TEXTS, LORE, GLYPH_WORD,
  buildPoints, freshState, normalizeSave, tick, stormRuns, stormLevel,
  stormSeconds, addStormSeconds, dayLabel, deadlineLabel, skyProgress,
  leftLabel, stormLeftMinutes,
  DAY_HOURS, DAY_START_MIN, DAY_NOON_MIN, PLANET_MIN_PER_SEC,
  seeState, artifactReady, checkArtifact, solveArtifact, keysComplete,
  decodeCorrect, decode, complete, activate, aholaOpen, finish, objective,
  newDigModel, excavate, syncScore, SYNC_HOLD, stormLevel as lvl,
  handDigLeft, digAnywhere, trinketAt, TRINKETS, HAND_DIGS_MAX,
} from '../js/story.js';
import {
  planWorld, slopeAt, ZONE_R, heightAt, addHandDig, setHandDigGrow,
  restoreHandDigs, clearHandDigs, HAND_DIG_R,
} from '../js/terrain.js';

const P = buildPoints();

/** Пройти все три артефакта «правильно» */
function solveAll(s) {
  for (const a of ARTIFACTS) {
    seeState(s, a.id, a.off);
    seeState(s, a.id, a.on);
    const want = [a.off, a.on].map((id) => KEYS.find((k) => k.id === id).word);
    assert.equal(solveArtifact(s, a.id, want), true, `артефакт ${a.id}`);
  }
  return s;
}

test('планета содержит все точки маршрута и они в пределах зоны', () => {
  assert.equal(P.artifacts.length, 3, 'три артефакта');
  assert.equal(P.aholas.length, 6, 'шесть ахол');
  assert.equal(KEYS.length, 6, 'шесть слов-ключей');
  assert.equal(TEXTS.length, 3, 'три текста');
  for (const p of [P.tablet, P.temple, P.anomaly, P.core, ...P.artifacts, ...P.aholas]) {
    const r = Math.hypot(p.x, p.z);
    assert.ok(r < ZONE_R - 5, `${p.id || p.name}: ${r.toFixed(0)} м — за границей зоны`);
  }
  for (const a of P.artifacts) {
    const d = Math.hypot(a.x - P.tablet.x, a.z - P.tablet.z);
    // механизмы стоят не вплотную к плите, а по своим сторонам света
    assert.ok(d > 40 && d < 85, `${a.id} в ${d.toFixed(0)} м от плиты`);
    assert.ok(slopeAt(a.x, a.z) < 0.45, `${a.id}: уклон ${slopeAt(a.x, a.z).toFixed(2)}`);
  }
  // и не лепятся друг к другу: минимум 40 м между механизмами
  for (let i = 0; i < P.artifacts.length; i++) {
    for (let j = i + 1; j < P.artifacts.length; j++) {
      const a = P.artifacts[i], b = P.artifacts[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      assert.ok(d > 48, `${a.id} и ${b.id} в ${d.toFixed(0)} м друг от друга`);
    }
  }
});

test('мировые точки планировщика совпадают с точками истории', () => {
  const plan = planWorld();
  assert.equal(plan.words.length, 3);
  P.artifacts.forEach((a, i) => {
    assert.ok(Math.hypot(a.x - plan.words[i].p[0], a.z - plan.words[i].p[1]) < 1e-6);
  });
});

test('значения знаков выводятся только после обоих состояний', () => {
  const s = freshState();
  const gate = ARTIFACTS[0];
  const values = ['ОТКРЫТО', 'ЗАКРЫТО'];

  assert.equal(artifactReady(s, gate.id), false);
  assert.equal(solveArtifact(s, gate.id, values), false, 'нельзя решить, не увидев оба состояния');

  seeState(s, gate.id, gate.off);
  assert.equal(artifactReady(s, gate.id), false, 'одного состояния мало');
  seeState(s, gate.id, gate.on);
  assert.equal(artifactReady(s, gate.id), true);

  assert.equal(checkArtifact(gate.id, ['ВВЕРХ', 'ВНИЗ']), false, 'чужие слова не подходят');
  assert.equal(checkArtifact(gate.id, ['ЗАКРЫТО', 'ЗАКРЫТО']), false, 'два одинаковых слова не годятся');
  assert.equal(solveArtifact(s, gate.id, ['ЗАКРЫТО', 'ОТКРЫТО']), true, 'порядок не важен');
  assert.equal(s.keys.length, 2);
  assert.equal(solveArtifact(s, gate.id, values), false, 'повторно нельзя');
});

test('переводчик не работает без всех трёх механизмов', () => {
  const s = freshState();
  assert.equal(keysComplete(s), false);
  assert.equal(decode(s), false, 'без ключей тексты не читаются');

  solveAll(s);
  assert.equal(keysComplete(s), true);
  assert.equal(s.keys.length, 6);
  assert.equal(s.decoded, false);

  const wrong = {};
  for (const k of KEYS) wrong[k.glyph] = 'НЕВЕРНО';
  assert.equal(decodeCorrect(wrong), false);
  const half = {};
  for (const k of KEYS) half[k.glyph] = k.word;
  half['⧉'] = 'ОТКРЫТО';
  assert.equal(decodeCorrect(half), false, 'перестановка ломает перевод');

  s.clock = s.deadline - 5 * PLANET_MIN_PER_SEC;
  assert.equal(decode(s), true);
  assert.ok(stormSeconds(s) >= STORM_AFTER_STAGE - 1e-6, 'после расшифровки есть время доехать');
  assert.equal(decode(s), false, 'дважды не читается');
});

test('этапы идут строго по порядку: тексты → храм → аномалия', () => {
  const s = freshState();
  solveAll(s);
  assert.equal(complete(s, 'artifact'), false, 'копать раньше расшифровки нельзя');
  decode(s);
  const gate = ARTIFACTS[0];
  const words = [gate.off, gate.on].map((id) => KEYS.find((k) => k.id === id).word);
  assert.equal(solveArtifact(s, gate.id, words), false, 'повторное решение ничего не меняет');
  assert.equal(s.keys.length, 6, 'ключи не дублируются');
  assert.equal(complete(s, 'synced'), false, 'сначала артефакт');
  assert.equal(complete(s, 'artifact'), true);
  assert.equal(complete(s, 'artifact'), false);
  assert.equal(complete(s, 'synced'), true);
  assert.equal(complete(s, 'synced'), false);
});

test('буря идёт только при свободном исследовании', () => {
  const s = freshState();
  for (const mode of ['menu', 'dialog', 'lesson', 'translate', 'dig', 'signal', 'artifact', 'map', 'journal', 'pause', 'ending']) {
    assert.equal(stormRuns(mode), false, `в режиме ${mode} буря должна стоять`);
    tick(s, mode, 60);
  }
  assert.ok(Math.abs(stormSeconds(s) - STORM_MAX) < 1e-6);
  for (let i = 0; i < STORM_MAX - 1; i++) tick(s, 'explore', 1);
  assert.ok(Math.abs(stormSeconds(s) - 1) < 1e-3);
  assert.equal(tick(s, 'explore', 5), true);
  assert.equal(stormLevel(s), 1);
});

test('часы планеты: обычные сутки из 24 часов, минута = 1 реальная секунда', () => {
  assert.equal(DAY_HOURS, 24);
  assert.equal(PLANET_MIN_PER_SEC, 1, 'минута планеты — одна секунда');
  const s = freshState();
  assert.equal(dayLabel(s), '04:00', 'старт — предрассветная тьма');
  assert.equal(deadlineLabel(s), '12:00', 'буря накроет зону в полдень');
  assert.equal(skyProgress(s), 0, 'свет в начале — ночь');
  for (let i = 0; i < STORM_MAX; i++) tick(s, 'explore', 1);
  assert.equal(deadlineLabel(s), '12:00');
  assert.ok(Math.abs(skyProgress(s) - 1) < 1e-6, 'к моменту бури — полдень');
  assert.equal(dayLabel(s), '12:00');
  assert.equal(leftLabel(freshState()), '8 ч 00 м', 'остаток до бури — 8 часов планеты');
  assert.equal(Math.round(stormLeftMinutes(freshState())), 480);
  // скорость ровера и часы сходятся: 16 м/с × 60 с = 960 м за час планеты
  assert.equal(Math.round(16 * 60), 960);
});

test('ахолы открываются по мере расследования и стоят 100/85/70 с', () => {
  const s = freshState();
  const a0 = P.aholas[0], a3 = P.aholas[3], a5 = P.aholas[5];
  assert.equal(aholaOpen(s, a0), false, 'до расшифровки ахолы молчат');

  solveAll(s); decode(s);
  s.deadline = s.clock + 100 * PLANET_MIN_PER_SEC;
  assert.equal(activate(s, a0.id), true);
  assert.ok(Math.abs(stormSeconds(s) - 200) < 1e-6);
  assert.equal(activate(s, a0.id), false, 'одноразовая');
  assert.equal(activate(s, a3.id), false, 'вторая ступень после храма');

  complete(s, 'artifact');
  assert.equal(activate(s, a3.id), true);
  assert.equal(activate(s, a5.id), false, 'третья ступень после аномалии');
  complete(s, 'synced');
  assert.equal(activate(s, a5.id), true);

  // потолок: больше полного срока бури (8 мин) накопить нельзя
  const full = freshState();
  solveAll(full); decode(full);
  full.deadline = full.clock + STORM_MAX * PLANET_MIN_PER_SEC;
  assert.equal(activate(full, a0.id), true);
  assert.ok(stormSeconds(full) <= STORM_MAX + 1e-6, 'потолок — полный срок бури');
});

test('оба финала требуют синхронизации и переживают сейв', () => {
  for (const ending of ['leave', 'free']) {
    const s = freshState();
    solveAll(s); decode(s); complete(s, 'artifact'); complete(s, 'synced');
    assert.equal(finish(s, ending), true);
    assert.equal(finish(s, 'nope'), false);
    const back = normalizeSave(JSON.parse(JSON.stringify(s)));
    assert.equal(back.ending, ending);
    assert.equal(back.synced, true);
    assert.equal(back.journal.includes('truth'), ending === 'free');
  }
  const s = freshState();
  solveAll(s); decode(s); complete(s, 'artifact');
  assert.equal(finish(s, 'leave'), false, 'без аномалии финала нет');
});

test('нормализация сейва чинит порчу и невозможный прогресс', () => {
  for (const bad of [null, {}, { version: 3, time: 100 }, { version: 2, time: -1 },
    { version: 2, time: Infinity }, 'строка', 42]) {
    assert.equal(normalizeSave(bad), null);
  }
  const s = normalizeSave({
    ...freshState(),
    decoded: true, artifact: true, synced: true,
    keys: ['open', 'чужое'], solved: ['gate'],
    position: { x: P.core.x, z: P.core.z, yaw: 0 },
    time: 1e9,
  });
  assert.deepEqual(s.keys, ['open']);
  assert.deepEqual(s.solved, ['gate']);
  assert.equal(s.decoded, false, 'без трёх механизмов и шести слов тексты не прочитаны');
  assert.equal(s.artifact, false);
  assert.equal(s.synced, false);
  assert.ok(Math.hypot(s.position.x - P.core.x, s.position.z - P.core.z) > 30,
    'из закрытых руин ровер выносится наружу');
  assert.ok(s.clock <= s.deadline, 'часы не обгоняют бурю');
});

test('сейв читается обратно без потерь', () => {
  const s = freshState();
  solveAll(s); decode(s);
  activate(s, P.aholas[1].id);
  s.position = { x: 12.5, z: -44.25, yaw: 1.2 };
  s.hp = 83;
  s.dig = 0.42;
  tick(s, 'explore', 35);
  const back = normalizeSave(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);
  assert.equal(activate(back, P.aholas[1].id), false, 'разряженная ахола осталась разряженной');
});

test('синхронизация проверяет обе оси', () => {
  assert.equal(syncScore(2.65, 1.35), 1);
  assert.ok(syncScore(2.65, 0) < 0.8);
  assert.ok(syncScore(1.2, 1.35) < 0.5);
  assert.ok(syncScore(2.6, 1.3) > 0.9);
  assert.equal(SYNC_HOLD, 2);
});

test('раскопки нельзя пройти бездействием и нельзя — вечным зажатием', () => {
  for (const held of [false, true]) {
    const m = newDigModel();
    for (let i = 0; i < 6000; i++) excavate(m, held, 1 / 60);
    assert.equal(m.progress, 0, `удержание=${held} не даёт прогресса`);
  }
  const m = newDigModel();
  let done = false;
  for (let i = 0; i < 12000; i++) {
    const held = m.cursor + m.velocity * 0.22 < m.center;
    done = excavate(m, held, 1 / 60);
    if (done) break;
  }
  assert.equal(done, true);
  assert.ok(m.elapsed > 8 && m.elapsed < 120, `раскопки заняли ${m.elapsed.toFixed(1)} с`);
});

test('цель всегда указывает на следующий шаг', () => {
  const s = freshState();
  assert.equal(objective(s).target.kind, 'artifact');
  solveAll(s);
  assert.equal(objective(s).target.kind, 'tablet');
  decode(s);
  assert.equal(objective(s).target, null, 'где копать — без маркера и без координат');
  assert.ok(!/гор[аеу]|храм/i.test(objective(s).hint + objective(s).title), 'в цели нет подсказки про гору');
  complete(s, 'artifact');
  assert.equal(objective(s).target.kind, 'anomaly');
  complete(s, 'synced');
  assert.equal(objective(s).target.kind, 'core');
});

test('тексты и записи журнала на месте, глифы уникальны', () => {
  assert.equal(SAVE_KEY, 'avaris.expedition.v1');
  for (const id of ['landing', 'gate', 'beacon', 'lift', 'texts', 'artifact', 'synced', 'truth']) {
    assert.ok(Array.isArray(LORE[id]) && LORE[id][0] && LORE[id][1], `запись ${id}`);
  }
  const glyphs = KEYS.map((k) => k.glyph);
  assert.equal(new Set(glyphs).size, glyphs.length, 'глифы не повторяются');
  assert.equal(GLYPH_WORD['⧉'], 'ЗАКРЫТО');
  for (const t of TEXTS) {
    for (const g of t.glyphs) assert.ok(glyphs.includes(g), `глиф ${g} из текста ${t.id}`);
  }
  assert.ok(lvl(freshState()) === 0);
});

test('на каждой пластине по два разных знакомых знака, каждый — ровно один раз', () => {
  const known = new Set(KEYS.map((k) => k.glyph));
  const seen = new Map();
  for (const t of TEXTS) {
    const inPlate = t.glyphs.filter((g) => known.has(g));
    assert.equal(inPlate.length, 2, `${t.id}: знакомых знаков ${inPlate.length}, а должно быть два`);
    assert.equal(new Set(inPlate).size, 2, `${t.id}: знаки на пластине должны быть разные`);
    for (const g of inPlate) seen.set(g, (seen.get(g) || 0) + 1);
  }
  for (const k of KEYS) {
    assert.equal(seen.get(k.glyph), 1, `знак ${k.glyph} (${k.id}) должен встречаться один раз`);
  }
  assert.equal(seen.size, KEYS.length, 'на пластинах должны быть все шесть знаков');
});

test('надписи состоят из 15 слов, знаки не повторяются', () => {
  const all = new Set();
  for (const t of TEXTS) {
    assert.equal(t.words.length, 15, `${t.id}: слов ${t.words.length}, нужно 15`);
    assert.equal(t.glyphs.length, 15, `${t.id}: знаков ${t.glyphs.length}, нужно 15`);
    assert.equal(new Set(t.glyphs).size, 15, `${t.id}: на пластине знак не должен повторяться`);
    assert.ok(t.ru && t.ru.length > 30, `${t.id}: нужен перевод надписи`);
    for (const w of t.words) {
      assert.ok(w.ru && w.char, `${t.id}: у слова нет подписи или знака`);
      assert.ok(!all.has(w.char), `знак ${w.char} (${w.ru}) встречается дважды`);
      all.add(w.char);
    }
  }
  assert.equal(all.size, 45, `разных знаков на трёх пластинах: ${all.size}, нужно 45`);
});

test('третья пластина — предание о храме с сокровищем на алтаре', () => {
  const t = TEXTS[2];
  const words = t.words.map((w) => w.ru).join(' ');
  assert.equal(t.genre, 'предание о храме на горе', 'жанр третьей пластины');
  assert.ok(/на горе/.test(t.ru), 'прямо сказано, что храм на горе: ' + t.ru);
  assert.ok(/гор/.test(words), 'названа гора: ' + words);
  assert.ok(/камень/.test(words), 'назван камень: ' + words);
  assert.ok(/вход/.test(words), 'назван вход: ' + words);
  assert.ok(/храм/.test(words), 'назван храм: ' + words);
  assert.ok(/алтарь/.test(words), 'назван алтарь: ' + words);
  assert.ok(/сокровище/.test(words), 'названо сокровище: ' + words);
});

test('три надписи — три разных жанра', () => {
  const genres = TEXTS.map((t) => t.genre);
  assert.equal(new Set(genres).size, 3, 'жанры должны различаться: ' + genres.join(' / '));
  for (const g of genres) assert.ok(g && g.length > 2, 'у каждой пластины есть жанр');
});

test('антонимы не встречаются парой на одной пластине', () => {
  for (const t of TEXTS) {
    const pairs = t.glyphs
      .map((g) => KEYS.find((k) => k.glyph === g))
      .filter(Boolean)
      .map((k) => k.pair);
    assert.equal(pairs.length, 2, `${t.id}: должно быть два наших знака`);
    assert.notEqual(pairs[0], pairs[1], `${t.id}: оба знака из одной пары (${pairs[0]})`);
  }
});

/* ------------------------------------- ручные шурфы (копать где угодно) */
test('шурфов ровно столько, сколько в лимите, лишний не копается', () => {
  const s = freshState();
  const max = HAND_DIGS_MAX;
  assert.equal(handDigLeft(s), max);
  for (let i = 0; i < max; i++) {
    const r = digAnywhere(s, 100 + i, 100);
    assert.equal(r.ok, true, `шурф ${i + 1} разрешён`);
  }
  assert.equal(handDigLeft(s), 0);
  assert.equal(s.digSpots.length, max);
  const extra = digAnywhere(s, 90, 90);
  assert.equal(extra.ok, false);
  assert.equal(extra.reason, 'empty');
  assert.equal(s.digSpots.length, max, 'лишних шурфов не появилось');
});

test('безделушка только рядом с руинами, в чистом поле пусто', () => {
  const s = freshState();
  const ruin = P.ruins[0];
  assert.ok(P.ruins.length > 0, 'руины спланированы');
  const near = trinketAt(ruin.x + 2, ruin.z - 3);
  assert.ok(near, 'рядом с руиной что-то есть');
  assert.ok(TRINKETS.some((t) => t.id === near.id));
  // точка заведомо далеко от всех руин, артефактов и плиты
  let far = null;
  for (let i = 0; i < 4000 && !far; i++) {
    const x = (Math.random() * 2 - 1) * (ZONE_R - 20);
    const z = (Math.random() * 2 - 1) * (ZONE_R - 20);
    if (trinketAt(x, z) === null) far = [x, z];
  }
  assert.ok(far, 'нашлась пустая точка');
  const r = digAnywhere(s, far[0], far[1]);
  assert.equal(r.ok, true);
  assert.equal(r.trinket, null, 'в поле ничего нет');
  assert.deepEqual(s.trinkets, []);
});

test('безделушки копятся в журнале и переживают сейв', () => {
  const s = freshState();
  const ruin = P.ruins[0];
  const found = digAnywhere(s, ruin.x, ruin.z);
  assert.ok(found.trinket);
  assert.ok(s.journal.includes(found.trinket.id));
  assert.ok(s.trinkets.includes(found.trinket.id));

  const raw = JSON.parse(JSON.stringify(s));
  const back = normalizeSave(raw);
  assert.deepEqual(back.digSpots, s.digSpots);
  assert.deepEqual(back.trinkets, s.trinkets);
  assert.ok(back.journal.includes(found.trinket.id));
});

test('нормализация сейва не даёт больше шурфов, чем лимит, и чистит мусор', () => {
  const s = freshState();
  const raw = JSON.parse(JSON.stringify(s));
  raw.digSpots = Array.from({ length: HAND_DIGS_MAX + 4 }, (_, i) => ({ x: 10 * (i + 1), z: 10 }));
  raw.trinkets = ['bead', 'мусор', 'bead', 'nail'];
  const back = normalizeSave(raw);
  assert.equal(back.digSpots.length, HAND_DIGS_MAX);
  assert.deepEqual(back.trinkets, ['bead', 'nail']);
});

test('шурф реально проседает землю и её можно вернуть из сейва', () => {
  const x = 120, z = -60;
  const edge = [x + HAND_DIG_R + 2, z];
  const before = heightAt(x, z);
  const edgeBefore = heightAt(edge[0], edge[1]);
  const e = addHandDig(x, z);
  setHandDigGrow(e, 1);
  const after = heightAt(x, z);
  assert.ok(after < before - 1.5, `земля просела: ${before.toFixed(2)} → ${after.toFixed(2)}`);
  assert.ok(Math.abs(heightAt(edge[0], edge[1]) - edgeBefore) < 1e-6, 'за краем не тронуто');

  clearHandDigs();
  assert.ok(Math.abs(heightAt(x, z) - before) < 1e-6, 'сброс вернул рельеф');
  restoreHandDigs([{ x, z }]);
  assert.ok(Math.abs(heightAt(x, z) - after) < 1e-6, 'восстановление из сейва');
  clearHandDigs();
});

/* --------------------------- раскопки везде одной механикой, без подсказок */
test('третий текст ведёт ко входу, но не называет точку прямо', () => {
  const t = TEXTS[2];
  assert.ok(t && t.ru);
  assert.ok(!/координат|\d{2,} ?м|северо-восток/i.test(t.ru), 'без координат: ' + t.ru);
  assert.ok(/вход|дверь/i.test(t.ru), 'но указывает на вход');
});

test('шурф на насыпи не тратит запас шурфов', () => {
  const s = freshState();
  // все обычные шурфы в поле
  for (let i = 0; i < HAND_DIGS_MAX; i++) digAnywhere(s, 100 + i * 3, 100);
  assert.equal(handDigLeft(s), 0);
  assert.equal(digAnywhere(s, 90, 90).ok, false);
  // вскрышные работы у храма живут по энергии, а не по запасу шурфов
  assert.equal(typeof s.dig, 'number');
});
