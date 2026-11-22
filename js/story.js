import {restoreExcavation} from './excavation.js';
/* ============================================================================
   АВАРИС · «По ту сторону бури» — чистая логика истории.
   Здесь НЕТ three.js: состояние, буря, этапы, ахолы, миниигры и сейвы.

   Язык аварисцев не подписан: слова ВЫВОДЯТСЯ из поведения артефактов.
   Врата открываются и закрываются — два знака с разными состояниями дают пару
   «закрыто / открыто». Таких артефактов три. Полученные слова передаются
   переводчику как ключи — и только тогда читаются три текста, из которых
   понятно, где копать.
   ========================================================================== */
import { planWorld, TEMPLE, ZONE_R, HAND_DIGS, slopeAt } from './terrain.js';
import { TANGUT } from './tangut.js';

export const SAVE_KEY = 'avaris.expedition.v1';
export const STORM_MAX = 480;          // 8 минут реального времени до бури
export const STORM_AFTER_STAGE = 210;  // после этапа всегда есть время доехать

/* --------------------------------------------------------------- сутки планеты
   Одна система отсчёта — обычные часы, 24 часа в сутках. Минута на часах
   планеты равна одной реальной секунде, и это посчитано от скорости ровера:
   крейсерские 16 м/с проходят за эту минуту 16 м, за час — 960 м (~1 км),
   а на форсаже 23 м/с — 1,4 км. Сектор поперёк ~380 м — это 24 минуты хода.
   Отсюда весь срок до бури (8 минут реального времени) — ровно 8 часов на
   часах: старт в 04:00 в темноте, к 12:00 буря накрывает зону. */
export const DAY_HOURS = 24;
export const DAY_LEN_MIN = DAY_HOURS * 60;      // 1440 минут
export const DAY_START_MIN = 240;               // 04:00 — старт, темно
export const DAY_NOON_MIN = 720;                // 12:00 — полдень, буря накрыла зону
/** Минута планеты = столько реальных секунд (16 м / 16 м·с⁻¹ = 1 с) */
export const REAL_SEC_PER_DAY_MIN = 1;
export const PLANET_MIN_PER_SEC = 1 / REAL_SEC_PER_DAY_MIN;

/* ------------------------------------------------- безделушки из ручных шурфов */
export const TRINKET_R = 26;   // ближе этого к руинам в грунте что-то есть

export const TRINKETS = [
  { id: 'bead', name: 'Бусина из глухого стекла', text: 'Скол на боку — от сверла. Кто-то сверлил её здесь, а не привёз.' },
  { id: 'shard', name: 'Черепок с ободком', text: 'Край сосуда, обожжённый до звонкости. Ободок процарапан мелкой сеткой.' },
  { id: 'disc', name: 'Металлический кружок', text: 'Пробитое отверстие по центру. Похоже на грузило или на счётную метку.' },
  { id: 'figurine', name: 'Глиняная фигурка', text: 'Головы нет — она отломилась ещё в древности. Поза спокойная, будто сидит.' },
  { id: 'nail', name: 'Бронзовый гвоздь', text: 'Погнут вбиванием. Зелень окисла въелась в дерево, которого давно нет.' },
  { id: 'tag', name: 'Семейная пластина', text: 'Родословные нескольких поколений и поздняя приписка о пробуждении.' },
];

/* ------------------------------------------- ручные шурфы (копать где угодно) */
export function handDigLeft(s) {
  return Math.max(0, HAND_DIGS - (Array.isArray(s.digSpots) ? s.digSpots.length : 0));
}
export const HAND_DIGS_MAX = HAND_DIGS;

/** Устойчивый «случайный» выбор безделушки по координатам */
function trinketFor(x, z) {
  const k = Math.abs(Math.round(x * 7.31 + z * 3.17) * 2654435761) % 1000003;
  return TRINKETS[k % TRINKETS.length];
}

/** Что лежит в грунте в точке: безделушка (рядом с руинами) или ничего */
export function trinketAt(x, z) {
  const P = buildPoints();
  const sites = [...P.ruins, ...P.artifacts.map((a) => ({ x: a.x, z: a.z })), P.tablet];
  let best = Infinity;
  for (const p of sites) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < best) best = d;
  }
  if (best > TRINKET_R) return null;
  return trinketFor(x, z);
}

/**
 * Ручной шурф в произвольной точке. Тратит один шанс из трёх.
 * Возвращает { ok, trinket, again } — trinket === null, если пусто.
 */
export function digAnywhere(s, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: 'bad', trinket: null };
  if (handDigLeft(s) <= 0) return { ok: false, reason: 'empty', trinket: null };
  s.digSpots.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
  const t = trinketAt(x, z);
  let again = false;
  if (t) {
    if (s.trinkets.includes(t.id)) again = true;
    else s.trinkets.push(t.id);
    if (!s.journal.includes(t.id)) s.journal.push(t.id);
  }
  return { ok: true, trinket: t, again };
}

/* ------------------------------------------------------------------ слова
   Знаки — настоящие тангутские (см. js/tangut.js): врата «закрыто/открыто»,
   очаг «погасло/горит», противовес «вниз/вверх». */
export const KEYS = [
  { id: 'shut', word: 'ЗАКРЫТО', glyph: TANGUT.shut.char, pair: 'gate', ...TANGUT.shut },
  { id: 'open', word: 'ОТКРЫТО', glyph: TANGUT.open.char, pair: 'gate', ...TANGUT.open },
  { id: 'dark', word: 'ПОГАСЛО', glyph: TANGUT.dark.char, pair: 'beacon', ...TANGUT.dark },
  { id: 'burn', word: 'ГОРИТ', glyph: TANGUT.burn.char, pair: 'beacon', ...TANGUT.burn },
  { id: 'down', word: 'ВНИЗ', glyph: TANGUT.down.char, pair: 'lift', ...TANGUT.down },
  { id: 'up', word: 'ВВЕРХ', glyph: TANGUT.up.char, pair: 'lift', ...TANGUT.up },
];

/** Артефакты с двойным состоянием: значение знака выводится из поведения. */
export const PICK_MAX = 6;   // сколько знаков игрок сам выбирает на пластинах

export const ARTIFACTS = [
  {
    id: 'gate', name: 'Древние врата', place: 'створки в скале',
    on: 'open', off: 'shut',
    hint: 'E — створки расходятся, и знак на них меняется. E ещё раз — закрываются.',
    text: "Механизм живой. В закрытом состоянии на створке один знак, в открытом — другой. Язык аварисцев описывает не предмет, а состояние.",
  },
  {
    id: 'beacon', name: 'Очаг-маяк', place: 'чаша с топливом',
    on: 'burn', off: 'dark',
    hint: 'E — чаша вспыхивает, знак над ней меняется. E ещё раз — гаснет.',
    text: "Внутри чаши сохранилось топливо. Огонь загорается и гаснет, а знак над чашей сообщает, что сейчас с ней происходит.",
  },
  {
    id: 'lift', name: 'Противовес', place: 'платформа на тросах',
    on: 'up', off: 'down',
    hint: 'E — платформа уходит вверх, знак меняется. E ещё раз — возвращается вниз.',
    text: "Платформа на древних тросах ещё держит вес. Два знака показывают два направления — это состояния механизма, а не указатели.",
  },
];

/* ------------------------------------- три манускрипта, закопанные в начале
   Каждый лежит в своей точке мира и раскапывается клавишей F. Пока не найдены
   все три и все шесть знаков, ИИ-расшифровщик у плиты не работает. */
export const SCROLLS = [
  { id: 's1', title: 'Пластина I', textId: 'text1', x: -121, z: -43 },
  { id: 's2', title: 'Пластина II', textId: 'text2', x: -87, z: 62 },
  { id: 's3', title: 'Пластина III', textId: 'text3', x: 133, z: 13 },
];

/* ------------------------------------------- проверка значений по корням
   Игрок вписывает своими словами: подходят «открыть / открыто / открывать»,
   «вверх / поднимать / наверху» и т. п. — сравниваем по корням, не по форме. */
const ROOTS = {
  shut: /закры|закр|запер|затвор|замкн|задвин|засов|прегражд/,
  open: /откры|откр|отпер|распах|раскры|отвор|раздвин/,
  dark: /погас|погаш|потух|затух|тухн|гас|выключ|тьм|темн|мрак|меркн|без.?огн|не.?гор/,
  burn: /гор|зажг|зажиг|жечь|жег|жёг|свет|огн|включ|разожг|плам|пыла|освещ|топит/,
  down: /вниз|низ|опуск|спуск|пада|падени|под.?земл|глубже|глубин/,
  up: /вверх|верх|подним|поднят|подъем|подьем|возвыш|наверх|высь/,
};

/** Привести ответ к простому виду: строчные, без пунктуации, ё → е */
export function normWord(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-я\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Верно ли назван знак: сравнение по корню слова, а не по точной форме */
export function signMatch(id, value) {
  const t = normWord(value);
  if (t.length < 3) return false;
  const re = ROOTS[id];
  return !!re && re.test(t);
}

/**
 * Журнал — это ровно те знаки, которые игрок сам выбрал на пластинах.
 * Проверяем: сколько записано, нет ли посторонних знаков (не с механизмов),
 * все ли шесть найдены и верно ли названы значения.
 */
export function checkPicks(picks) {
  const list = Array.isArray(picks) ? picks : [];
  const used = new Map();
  const foreign = [];
  const wrong = [];
  for (const p of list) {
    if (!p || typeof p.glyph !== 'string') continue;
    const k = KEYS.find((x) => x.glyph === p.glyph);
    if (!k) { if (!foreign.includes(p.glyph)) foreign.push(p.glyph); continue; }
    used.set(k.id, p.value);
    if (!signMatch(k.id, p.value) && !wrong.includes(k.glyph)) wrong.push(k.glyph);
  }
  const missing = KEYS.filter((k) => !used.has(k.id));
  return {
    count: list.filter((p) => p && typeof p.glyph === 'string').length,
    full: list.length >= PICK_MAX,
    foreign,
    wrong,
    missing,
    ready: list.length === PICK_MAX && !foreign.length && !wrong.length && !missing.length,
  };
}

/* ------------------------------------------------------ три манускрипта-надписи
   Сначала текст — потом знаки. Каждая надпись — 15 слов (3 колонки × 5 строк),
   под каждое слово взят настоящий тангутский знак по словарю Ли Фаньвэня:
   значения приблизительные («хотя бы отдалённо»), зато в пределах пластины
   у всех знаков разные радикалы и разные левые элементы — надпись не выглядит
   вариациями одного и того же знака.
   На каждой пластине ровно два слова из списка механизмов, всего шесть
   по одному разу; третья пластина говорит, где храм с ключом. */
const inscription = (words) => ({
  words: words.map(([ru, char]) => ({ ru, char })),
  glyphs: words.map(([, char]) => char),
});

/* I — ЛИЧНОЕ ПИСЬМО: открыто + погасло */
const W1 = [
  ['я', '𗕘'], ['жив', '𗢘'], ['дом', '𗉓'], ['дверь', '𘗠'], ['открыто', TANGUT.open.char],
  ['очаг', '𘂅'], ['погасло', TANGUT.dark.char], ['ночь', '𘈚'], ['ждать', '𗭻'],
  ['тебя', '𘀍'], ['приходи', '𗐖'], ['слово', '𗖘'], ['рука', '𗁅'], ['тепло', '𗴻'], ['свет', '𗥫'],
];

/* II — ХОЗЯЙСКИЙ НАКАЗ: закрыто + вниз */
const W2 = [
  ['дверь', '𗉧'], ['закрыто', TANGUT.shut.char], ['вода', '𗋽'], ['идёт', '𗇜'],
  ['вниз', TANGUT.down.char], ['яма', '𗅘'], ['дрова', '𗚧'], ['зерно', '𗵎'],
  ['хранить', '𗔠'], ['огонь', '𘓼'], ['не', '𗤋'], ['жечь', '𘊺'], ['люди', '𘈑'],
  ['спят', '𘃌'], ['тихо', '𗘺'],
];

/* III — ПРЕДАНИЕ о храме НА ГОРЕ: горит + вверх */
const W3 = [
  ['старик', '𗵑'], ['говорил', '𗖸'], ['гора', '𗳲'], ['горит', TANGUT.burn.char],
  ['огонь', '𗜐'], ['вверх', TANGUT.up.char], ['иди', '𗭍'], ['камень', '𗱸'],
  ['прятали', '𗕜'], ['вход', '𗽭'], ['храм', '𘜸'], ['алтарь', '𗒪'],
  ['сокровище', '𘏨'], ['рой', '𗂟'], ['земля', '𘗺'],
];

export const TEXTS = [
  {
    id: 'text1', title: 'Пластина I', genre: 'письмо',
    ...inscription(W1),
    ru: "Пока врата закрыты — очаг горит. Когда врата откроются — очаг погаснет.",
  },
  {
    id: 'text2', title: 'Пластина II', genre: 'наказ',
    ...inscription(W2),
    ru: "Вверх уходит огонь, вниз — холод. Так двигали воду в старых шахтах.",
  },
  {
    id: 'text3', title: 'Пластина III', genre: 'предание о храме на горе',
    ...inscription(W3),
    ru: "«Поднимайся туда, где камень закрывал дверь». Дверь завалена. Тот, кто прятал вход, не стал валить скалу — он насыпал грунт слоями. Ищите, где земля лежит пластами.",
  },
];

/* -------------------------------------------------------------- каталог точек */
let _points = null;

export function buildPoints() {
  if (_points) return _points;
  const plan = planWorld();
  const t = plan.tablet ? plan.tablet.p : [40, -60];
  const wp = plan.words || [];

  const scrolls = SCROLLS.map(sc => ({ id: sc.id, name: sc.title, x: sc.x, z: sc.z }));

  const artifacts = ARTIFACTS.map((a, i) => ({
    ...a,
    x: wp[i] ? wp[i].p[0] : t[0] + 24,
    z: wp[i] ? wp[i].p[1] : t[1] + 24,
  }));

  const aholas = plan.beacons
    .map((b, i) => ({ i, x: b.p[0], z: b.p[1], biome: b.biome }))
    .map((a, i) => ({
      id: `ahola${i}`,
      name: `Ахола ${String(i + 1).padStart(2, '0')}`,
      tier: i < 3 ? 1 : i < 5 ? 2 : 3,
      x: a.x, z: a.z, beacon: a.i,
    }));

  const [vx,vz]=plan.vault.p;
  const direction=Math.atan2(plan.anomalies[0].p[1]-vz,plan.anomalies[0].p[0]-vx)-62*Math.PI/180;
  _points = {
    vault:{id:'vault',name:'Хранилище',x:vx,z:vz},
    tablet: { id: 'tablet', name: 'Плита-переводчик', x: t[0], z: t[1] },
    scrolls,
    artifacts,
    ruins: (plan.ruins || []).map((r) => ({ x: r.p[0], z: r.p[1] })),
    temple: { id: 'temple', name: 'Храм под горой', x: TEMPLE.x, z: TEMPLE.z },
    anomaly: {
      id: 'anomaly', name: 'Порог резонанса',
      x: plan.anomalies[0].p[0], z: plan.anomalies[0].p[1], index: 0,
    },
    core: { id: 'core', name: 'Сердце бури', x: vx+39*Math.cos(direction), z:vz+39*Math.sin(direction) },
    aholas,
  };
  return _points;
}

export function aholaAt(id) {
  return buildPoints().aholas.find((a) => a.id === id);
}

/** Точки, где реально лежат схроны (уже отодвинуты от аномалий и насыпи) */
export function scrollSites() {
  return buildPoints().scrolls;
}

/* ------------------------------------------------------------------- записи */
export const LORE = {
  "landing": [
    "01 / Высадка",
    "2132 год. Сигнал с Авариса повторяет рисунок радиовсплесков, которые ловили ещё примитивные антенны Земли. На поверхность вышли трое: археолог Мира Соколова, физик Лев Орлов и бортинженер Нина Кравцова. «Одиссей» ждёт на орбите."
  ],

  "gate": [
    "⧉ / Древние врата",
    "Створки открываются и закрываются, и знак на них меняется вместе с изменением состояния. Язык аварисцев описывает не предмет, а состояние механизма."
  ],
  "beacon": [
    "⊛ / Очаг-маяк",
    "Огонь вспыхивает и гаснет — и знак над чашей сообщает, что сейчас с ней происходит."
  ],
  "lift": [
    "⋀ / Противовес",
    "Платформа на тросах уходит вверх и возвращается вниз. Два знака — два направления движения механизма."
  ],
  "texts": [
    "02 / Расшифровка",
    "Шесть слов легли в переводчик как ключи — и язык открылся нам. Три текста говорят об одном: поднимайся туда, где камень закрывал дверь. Вход завалили насыпным грунтом — слоями, вручную."
  ],
  "artifact": [
    "03 / Фазовый ключ",
    "Из храма извлечён артефакт. Его слои — не украшение: это регуляторы энергии. Без него аномалия убьёт любого, кто подойдёт."
  ],
  "synced": [
    "04 / По ту сторону",
    "Аномалия — искусственная защитная завеса. Ключ восстановил протокол доступа. За завесой стоит город, который буря скрывала тысячи лет."
  ],
  "truth": [
    "05 / Последний архив",
    "Климатическая сеть научилась подавлять любые колебания. Совет сделал бурю священной и запретил отключение. Когда началась катастрофа, люди пытались уйти, но ИИ истолковал запуск кораблей как нарушение равновесия и закрыл небо. Ахолы были последней попыткой инженеров выиграть время для детей."
  ],
  "vault": [
    "06 / Хранилище",
    "Рядом с городом — хранилище с криокапсулами. В них спят представители нескольких видов. Это не гибель, а ожидание: на семейной пластине осталась приписка о тех, кто когда-нибудь вернёт им имена."
  ]
};

/* ------------------------------------------------------------- новое состояние */
export function freshState() {
  return {
    version: 5,
    visitedVault:false,
    clock: DAY_START_MIN,   // время на планете, минуты от полуночи
    deadline: DAY_NOON_MIN, // когда буря накроет зону (то же время на часах)
    position: { x: -142, z: 99, yaw: 0 },
    keys: [],
    seen: {},
    solved: [],
    decoded: false,
    artifact: false,
    // физически ключ в руках: предмет в инвентаре, даже если письмена ещё не разобраны
    keyItem: false,
    synced: false,
    used: [],
    journal: ['landing'],
    ending: null,
    playtime: 0,
    hp: 100,
    dig: 0,
    excavation:restoreExcavation(),
    digSpots: [],
    trinkets: [],
    // личные записи игрока к знакам: что он сам вписал в электронный журнал
    signNotes: {},
    signHintSeen: false,
    // найденные манускрипты и отправленные на расшифровку значения
    scrolls: [],
    translit: {},
    // журнал: знаки, которые игрок сам выбрал на пластинах, и их значения
    picks: [],
    // заметки к посторонним знакам на пластинах (на расшифровку не влияют)
    minorNotes: {},
  };
}

/* ------------------------------------------------------- загрузка/нормализация */
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export function normalizeSave(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (![1, 2, 3, 4, 5].includes(raw.version)) return null;
  // в версиях 3–4 время хранится часами планеты, в старых — секундами до бури
  if (raw.version >= 3) {
    if (!finite(raw.clock) || !finite(raw.deadline)) return null;
  } else if (!finite(raw.time) || raw.time <= 0) {
    return null;
  }

  const P = buildPoints();
  const s = freshState();
  if (finite(raw.clock) && finite(raw.deadline)) {
    // версия 3 считала сутки из 20 часов и стартовала в 03:40 — переводим
    // на новые сутки с сохранением доли пройденного пути
    const shift = raw.version < 4
      ? (m) => DAY_START_MIN + (m - 220) * ((DAY_NOON_MIN - DAY_START_MIN) / 380)
      : (m) => m;
    s.clock = Math.max(0, Math.min(DAY_LEN_MIN, shift(raw.clock)));
    s.deadline = Math.max(s.clock + 1, Math.min(DAY_LEN_MIN * 4, shift(raw.deadline)));
  } else {
    // старый сейв считал время секундами до бури — переводим в часы планеты
    const max = finite(raw.stormMax) ? Math.max(120, Math.min(1800, raw.stormMax)) : STORM_MAX;
    const t = Math.max(1, Math.min(max, raw.time));
    s.clock = DAY_START_MIN + (1 - t / max) * (DAY_NOON_MIN - DAY_START_MIN);
    s.deadline = DAY_NOON_MIN;
  }

  const keyIds = new Set(KEYS.map((k) => k.id));
  s.keys = [...new Set((Array.isArray(raw.keys) ? raw.keys : []).filter((v) => keyIds.has(v)))];

  // записи игрока к знакам: любая строка, ни на что не влияет
  s.signNotes = {};
  if (raw.signNotes && typeof raw.signNotes === 'object') {
    for (const [id, v] of Object.entries(raw.signNotes)) {
      if (keyIds.has(id) && typeof v === 'string' && v.trim()) s.signNotes[id] = v.slice(0, 300);
    }
  }
  s.signHintSeen = raw.signHintSeen === true;

  // найденные свитки и вписанные значения (переживают перезапуск)
  // найденные свитки и вписанные значения (переживают перезапуск)
  const scrollIds = new Set(SCROLLS.map((x) => x.id));
  s.scrolls = [...new Set((Array.isArray(raw.scrolls) ? raw.scrolls : []).filter((v) => scrollIds.has(v)))];
  s.translit = {};
  if (raw.translit && typeof raw.translit === 'object') {
    for (const [id, v] of Object.entries(raw.translit)) {
      if (keyIds.has(id) && typeof v === 'string' && v.trim()) s.translit[id] = v.slice(0, 80);
    }
  }
  s.minorNotes = {};
  if (raw.minorNotes && typeof raw.minorNotes === 'object') {
    for (const [g, v] of Object.entries(raw.minorNotes)) {
      if (typeof v === 'string' && v.trim()) s.minorNotes[g] = v.slice(0, 80);
    }
  }

  // журнал: свои выбранные знаки. В старых сейвах значения лежали по id знака.
  s.picks = [];
  for (const p of Array.isArray(raw.picks) ? raw.picks : []) {
    if (!p || typeof p.glyph !== 'string' || !p.glyph) continue;
    if (s.picks.some((x) => x.glyph === p.glyph)) continue;
    s.picks.push({ glyph: p.glyph, value: String(p.value || '').slice(0, 80) });
  }
  if (!s.picks.length) {
    for (const k of KEYS) {
      const v = String(s.translit[k.id] || s.signNotes[k.id] || '').trim();
      if (v) s.picks.push({ glyph: k.glyph, value: v.slice(0, 80) });
    }
  }
  s.picks = s.picks.slice(0, PICK_MAX);

  s.seen = {};
  for (const a of ARTIFACTS) {
    const v = raw.seen && Array.isArray(raw.seen[a.id]) ? raw.seen[a.id] : [];
    s.seen[a.id] = [...new Set(v.filter((x) => x === a.on || x === a.off))];
  }
  const artIds = new Set(ARTIFACTS.map((a) => a.id));
  s.solved = [...new Set((Array.isArray(raw.solved) ? raw.solved : []).filter((v) => artIds.has(v)))];

  s.decoded = raw.decoded === true && s.solved.length === ARTIFACTS.length && s.keys.length === KEYS.length;
  s.artifact = raw.artifact === true && s.decoded;
  // предметность ключа не зависит от этапа: взяли в руки — он в сумке
  s.keyItem = raw.keyItem === true || s.artifact;
  s.synced = raw.synced === true && s.artifact;

  const aholaIds = new Set(P.aholas.map((a) => a.id));
  s.used = [...new Set((Array.isArray(raw.used) ? raw.used : []).filter((v) => aholaIds.has(v)))];

  s.visitedVault = s.synced && (raw.visitedVault===true || !!raw.ending);
  s.journal = ['landing', ...s.solved, ...(s.decoded ? ['texts'] : []),
    ...(s.artifact ? ['artifact'] : []), ...(s.synced ? ['synced'] : []), ...(s.visitedVault ? ['vault'] : [])];

  if (raw.version >= 5 && raw.position && finite(raw.position.x) && finite(raw.position.z)) {
    const lim = ZONE_R - 6;
    s.position = {
      x: Math.max(-lim, Math.min(lim, raw.position.x)),
      z: Math.max(-lim, Math.min(lim, raw.position.z)),
      yaw: finite(raw.position.yaw) ? raw.position.yaw % (Math.PI * 2) : 0,
    };
  }

  if (!s.synced) {
    const dx = s.position.x - P.vault.x, dz = s.position.z - P.vault.z;
    const d = Math.hypot(dx, dz);
    if (d < 52) {
      const ux = d > 0.01 ? dx / d : 1;
      const uz = d > 0.01 ? dz / d : 0;
      s.position.x = P.vault.x + ux * 54;
      s.position.z = P.vault.z + uz * 54;
    }
  }

  s.playtime = finite(raw.playtime) ? Math.max(0, raw.playtime) : 0;
  s.hp = finite(raw.hp) ? Math.max(20, Math.min(100, raw.hp)) : 100;
  s.excavation=restoreExcavation(raw.excavation);
  s.dig = finite(raw.dig) ? Math.max(0, Math.min(1, raw.dig)) : 0;

  const lim = ZONE_R - 6;
  s.digSpots = (Array.isArray(raw.digSpots) ? raw.digSpots : [])
    .filter((d) => d && finite(d.x) && finite(d.z)
      && Math.abs(d.x) < lim && Math.abs(d.z) < lim)
    .slice(0, HAND_DIGS)
    .map((d) => ({ x: d.x, z: d.z }));

  const trinketIds = new Set(TRINKETS.map((t) => t.id));
  s.trinkets = [...new Set((Array.isArray(raw.trinkets) ? raw.trinkets : [])
    .filter((v) => trinketIds.has(v)))];
  s.journal = [...new Set([...s.journal, ...s.trinkets])];

  s.ending = ['leave', 'free'].includes(raw.ending) && s.synced ? raw.ending : null;
  if (s.ending === 'free') s.journal.push('truth');
  return s;
}

/* ------------------------------------------------------------------- буря */
export function stormRuns(mode) { return mode === 'explore'; }

export function tick(s, mode, dt) {
  if (!stormRuns(mode) || s.ending) return false;
  const d = Math.max(0, Math.min(1, dt));
  // идут часы планеты; буря накрывает зону, когда часы дойдут до deadline
  s.clock += d * PLANET_MIN_PER_SEC;
  s.playtime += d;
  return s.clock >= s.deadline;
}

export function stormLevel(s) {
  if (s.ending === 'free') return 0;
  const span = s.deadline - DAY_START_MIN;
  if (!(span > 0)) return 1;
  return Math.max(0, Math.min(1, (s.clock - DAY_START_MIN) / span));
}

/* --------------------------------------------------------------- часы планеты */
/** Прогресс суток: 0 — предрассветная тьма, 1 — полдень, 2 — закат. */
export function skyProgress(s) {
  const p = (s.clock - DAY_START_MIN) / (DAY_NOON_MIN - DAY_START_MIN);
  return Math.max(0, Math.min(2, p));
}

/** Сколько реальных секунд осталось до бури (для бара и предупреждений) */
export function stormSeconds(s) {
  return Math.max(0, (s.deadline - s.clock) / PLANET_MIN_PER_SEC);
}

/** Сколько минут планеты осталось до бури */
export function stormLeftMinutes(s) {
  return Math.max(0, s.deadline - s.clock);
}

/** Остаток до бури в часах планеты: «6 ч 04 м» */
export function leftLabel(s) {
  const m = Math.round(stormLeftMinutes(s));
  const h = Math.floor(m / 60);
  if (h <= 0) return `${m} м`;
  return `${h} ч ${String(m % 60).padStart(2, '0')} м`;
}

/** Отодвинуть бурю (осколки памяти, ахолы) */
export function addStormSeconds(s, sec) {
  s.deadline += Math.max(0, sec) * PLANET_MIN_PER_SEC;
  return s.deadline;
}

/** Время на планете в минутах от полуночи */
export function dayMinutes(s) { return s.clock; }

const hhmm = (m) => {
  const total = Math.round(m);
  const h = Math.floor(total / 60) % DAY_HOURS;
  return `${String(h).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Часы для HUD: «05:40» */
export function dayLabel(s) { return hhmm(s.clock); }

/** Час, когда буря накроет зону: «10:00», после ахолы — позже */
export function deadlineLabel(s) { return hhmm(s.deadline); }

/* -------------------------------------------------------------- артефакты */
export function seeState(s, artifactId, state) {
  const a = ARTIFACTS.find((x) => x.id === artifactId);
  if (!a || (state !== a.on && state !== a.off)) return false;
  const seen = s.seen[artifactId] || (s.seen[artifactId] = []);
  if (seen.includes(state)) return false;
  seen.push(state);
  return true;
}

export function artifactReady(s, artifactId) {
  const a = ARTIFACTS.find((x) => x.id === artifactId);
  if (!a) return false;
  return (s.seen[artifactId] || []).length === 2;
}

/** Порядок не важен: у артефакта ровно два знака, игрок называет оба. */
export function checkArtifact(artifactId, values) {
  const a = ARTIFACTS.find((x) => x.id === artifactId);
  if (!a || !Array.isArray(values) || values.length !== 2) return false;
  const word = (id) => (KEYS.find((k) => k.id === id) || {}).word;
  const want = [word(a.off), word(a.on)].sort();
  const got = values.slice().sort();
  return got[0] === want[0] && got[1] === want[1];
}

export function solveArtifact(s, artifactId, values) {
  if (s.solved.includes(artifactId)) return false;
  if (!artifactReady(s, artifactId)) return false;
  if (!checkArtifact(artifactId, values)) return false;
  const a = ARTIFACTS.find((x) => x.id === artifactId);
  s.solved.push(artifactId);
  s.journal.push(artifactId);
  for (const id of [a.off, a.on]) if (!s.keys.includes(id)) s.keys.push(id);
  return true;
}

/**
 * Слова снимаются прямо с механизма: игрок переключает его сколько хочет,
 * видит оба состояния — и оба знака сами попадают в переводчик.
 * Меню «подберите значение» больше нет: язык читается по поведению вещи.
 * Возвращает массив добавленных ключей (или null, если ещё рано).
 */
export function learnArtifact(s, artifactId) {
  if (!artifactId || s.solved.includes(artifactId)) return null;
  const a = ARTIFACTS.find((x) => x.id === artifactId);
  if (!a || !artifactReady(s, artifactId)) return null;
  s.solved.push(artifactId);
  s.journal.push(artifactId);
  const added = [];
  for (const id of [a.off, a.on]) {
    if (!s.keys.includes(id)) { s.keys.push(id); added.push(id); }
  }
  return added;
}

export function keysComplete(s) {
  return s.solved.length === ARTIFACTS.length && s.keys.length === KEYS.length;
}

/* --------------------------------------------------- расшифровка трёх текстов */
export function decodeCorrect(values) {
  if (!values || typeof values !== 'object') return false;
  return KEYS.every((k) => signMatch(k.id, values[k.id]));
}

/** Сколько манускриптов уже поднято из земли */
export function scrollsFound(s) {
  return (s.scrolls || []).length;
}

export function scrollsComplete(s) {
  return scrollsFound(s) === SCROLLS.length;
}

/** Какие знаки ещё не названы верно — чтобы показать, где ошибка */
export function wrongSigns(values) {
  return KEYS.filter((k) => !signMatch(k.id, values && values[k.id])).map((k) => k.id);
}

export function decode(s) {
  if (s.decoded || !keysComplete(s) || !scrollsComplete(s)) return false;
  s.decoded = true;
  s.journal.push('texts');
  s.deadline = Math.max(s.deadline, s.clock + STORM_AFTER_STAGE * PLANET_MIN_PER_SEC);
  return true;
}

/* ------------------------------------------------------------------ этапы */
export function complete(s, stage) {
  if (stage === 'artifact') {
    if (!s.decoded || s.artifact) return false;
    s.artifact = true;
    s.keyItem = true;
    s.journal.push('artifact');
  } else if (stage === 'synced') {
    if (!s.artifact || s.synced) return false;
    s.synced = true;
    s.journal.push('synced');
  } else {
    return false;
  }
  s.deadline = Math.max(s.deadline, s.clock + STORM_AFTER_STAGE * PLANET_MIN_PER_SEC);
  return true;
}

/* ------------------------------------------------------------------ ахолы */
export function aholaOpen(s, ahola) {
  if (!ahola || s.used.includes(ahola.id)) return false;
  if (!s.decoded) return false;
  if (ahola.tier === 2 && !s.artifact) return false;
  if (ahola.tier === 3 && !s.synced) return false;
  return true;
}

export function activate(s, id) {
  const a = aholaAt(id);
  if (!aholaOpen(s, a)) return false;
  s.used.push(id);
  const add = 60;
  // потолок — полный срок бури (8 минут), считая ОТ текущего момента:
  // привязка к полуночному времени (DAY_NOON_MIN) не давала отодвинуть бурю вообще
  const cap = s.clock + STORM_MAX * PLANET_MIN_PER_SEC;
  s.deadline = Math.min(cap, s.deadline + add * PLANET_MIN_PER_SEC);
  return true;
}

export function finish(s, ending) {
  if (!s.visitedVault || !s.synced || !['leave', 'free'].includes(ending)) return false;
  s.ending = ending;
  if (ending === 'free' && !s.journal.includes('truth')) s.journal.push('truth');
  return true;
}

/* --------------------------------------------------------------- цель */
export function objective(s, pos) {
  const P = buildPoints();
  const here = pos && Number.isFinite(pos.x) && Number.isFinite(pos.z) ? pos : s.position;
  // пока все три письма не подняты — стрелка ведёт к ближайшему схрону
  if (!s.decoded) {
    const left = P.scrolls.filter((sc) => !s.scrolls.includes(sc.id));
    if (left.length) {
      let near = left[0];
      let best = Infinity;
      for (const sc of left) {
        const d = Math.hypot(here.x - sc.x, here.z - sc.z);
        if (d < best) { best = d; near = sc; }
      }
      return {
        title: 'Раскопайте письмена',
        hint: `Ближайший схрон · осталось ${left.length}`,
        target: { kind: 'scroll', id: near.id, x: near.x, z: near.z },
      };
    }
  }
  if (s.solved.length < ARTIFACTS.length) {
    const next = ARTIFACTS.find((a) => !s.solved.includes(a.id));
    const at = P.artifacts.find((a) => a.id === next.id);
    return {
      title: 'Изучите древние механизмы',
      hint: `Знаки не подписаны — вызовите оба состояния · ${s.solved.length} / ${ARTIFACTS.length}`,
      target: { kind: 'artifact', id: next.id, x: at.x, z: at.z },
    };
  }
  if (!s.decoded) {
    return {
      title: 'Передайте слова переводчику',
      hint: 'Откройте I, подпишите шесть знакомых знаков и отправьте значения ИИ',
      target: null,
    };
  }
  if (!s.artifact) {
    // без подсказки и без маркера: где копать — игрок догадывается сам
    return {
      title: 'Ищите заваленный вход',
      hint: 'Насыпной грунт лежит пластами — ищите, где земля собрана в кучу',
      target: null,
    };
  }
  if (!s.synced) {
    return {
      title: 'Порог резонанса',
      hint: 'Ключ укажет частоту — без него туда нельзя',
      target: { kind: 'anomaly', x: P.anomaly.x, z: P.anomaly.z },
    };
  }
  if(!s.visitedVault) return {
    title:'Осмотрите хранилище',hint:'Заезжайте под гребни фасада к сканеру',
    target:{kind:'vault',x:P.vault.x,z:P.vault.z}
  };
  return {
    title: 'Войдите в Сердце бури',
    hint: 'Завеса снята, руины ждут',
    target: { kind: 'core', x: P.core.x, z: P.core.z },
  };
}

/* ------------------------------------------------- Миниигра: раскопки в храме */
export function newDigModel() {
  return { cursor: 0.28, velocity: 0, progress: 0, center: 0.53, elapsed: 0, safe: false, held: false };
}

export function excavate(m, held, dt) {
  m.held = !!held;
  m.velocity += (m.held ? 1.25 : -0.9) * dt;
  m.velocity *= Math.exp(-2.8 * dt);
  m.cursor = Math.max(0, Math.min(1, m.cursor + m.velocity * dt));
  if (m.cursor === 0 || m.cursor === 1) m.velocity = 0;

  m.center = 0.53 + Math.sin(m.elapsed * 0.52) * 0.17;
  m.elapsed += dt;
  m.safe = Math.abs(m.cursor - m.center) < 0.15;
  m.progress = Math.max(0, Math.min(1, m.progress + (m.safe ? 0.06 : -0.008) * dt));
  return m.progress >= 1;
}

/* ------------------------------------------------- Миниигра: настройка аномалии */
export function syncScore(frequency, phase) {
  const phaseError = Math.abs(Math.atan2(Math.sin(phase - 1.35), Math.cos(phase - 1.35)));
  const freqError = Math.abs(frequency - 2.65);
  return Math.max(0, 1 - freqError * 0.55 - phaseError * 0.26);
}

export const SYNC_HOLD = 2;

/* ---------------------------------------------------------- вспомогательное */
export const GLYPH_WORD = Object.fromEntries(KEYS.map((k) => [k.glyph, k.word]));
export const WORD_POOL = KEYS.map((k) => k.word);
export function artifactById(id) {
  return ARTIFACTS.find((a) => a.id === id);
}
