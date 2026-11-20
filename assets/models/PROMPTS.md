# Промпты для ассетов Авариса

Документ в двух частях:

- **часть 1 — для генераторов картинок** (Midjourney и подобные): её и надо
  использовать, если генерируете изображения;
- **часть 2 (старая, ниже) — для text-to-3D** (Meshy, Tripo, Rodin): там важны
  габариты, единицы и требования к мешу.

---

# Часть 1. Для генератора картинок

Первая версия промптов давала не то, и вот почему (по присланному скриншоту):

1. **Модель нарисовала сцену, а не объект.** В промпте стояло «9 метров высотой и
   11 шириной» — для картинки это подсказка «покажи масштаб», и она дорисовала
   небо, траву, деревья и горизонт. Габариты нужны только когда модель ставят в
   игру, в промпт их не надо.
2. **Слово «sandstone» тянет фотореализм.** На «ash-grey sandstone» рисуется
   тёплый песчаник с фотографической крошкой. В игре песчаника нет: там
   оливково-серый камень с холодной пылью.
3. **Не был задан полигональный вид.** Вся игра — low-poly с плоскими гранями
   (`flatShading: true`), а промпт просил только «stylized realism». Отсюда
   гладкий фотореалистичный валун.
4. **`stylize 150` превращает в открытку.** Для ассетов `--s 50…100` и
   `--style raw`, иначе добавляется живописность.
5. **Не было запрета на окружение.** Без `--no` Midjourney всегда дорисует землю
   и небо.

## Палитра игры (взята пипеткой со скриншотов)

| Что | Цвет | Hex |
|---|---|---|
| камень, обломки в тени | тёмный оливково-серый | `#303018`, `#484830` |
| камень на свету | серо-оливковый, пыльный | `#606048`, `#787848` |
| песок дюн | хаки-охристый, приглушённый | `#786030`, `#907848` |
| пыль на поверхности | тёплый серо-коричневый | `#786048`, `#604830` |
| дымка, дальний план | холодный серо-голубой | `#8ba1b2`, `#a8c0c0` |
| силуэты, металл | почти чёрный графит | `#181818`, `#484848` |
| свечение-акцент | циан | `#53e0ff` |
| второй акцент | янтарный | `#ffa040` |

Вывод: **не «бежевый песчаник», а оливково-серый камень, приглушённый хаки и
холодная пыль**, всё матовое, без блеска. Яркого в игре почти нет — только
маленькие циановые и янтарные акценты.

## Основа промпта

Первые слова весят больше всего, поэтому стиль ставить в начало:

```
low poly game asset, single object, flat shaded faceted geometry, hard edges,
muted olive-khaki and ash grey palette, matte dusty stone, no surface textures,
isolated on flat neutral grey studio backdrop
```

Дальше — объект (2–4 строки про форму, без метров). Потом параметры:

```
--ar 1:1 --style raw --s 50 --no sky, ground, horizon, landscape, grass, tree,
dirt, sand floor, rocks around, human, text, letters, watermark, photorealistic,
sandstone, warm sunlight, glow lines, bloom, smooth plastic, chrome
```

- `--ar 1:1` — объект не растягивается под сцену;
- `--style raw` — снимает «открыточную» обработку;
- `--s 50` — минимум фантазии, максимум буквального чтения;
- `--no …` — земля, небо, трава, надписи; без этого они появляются всегда.

### Если стиль всё равно уезжает — задать референс

Надёжнее любых слов: приложить скриншот нужного места в игре как style reference.

```
<prompt объекта> --sref <ссылка на скриншот> --sw 120 --ar 1:1 --style raw --s 50
```

`--sw 120` — сила влияния (0…1000). Если важнее силуэт, чем мазок — приложить
скриншот как image prompt (`--iw 1.5`).

## Флора и минералы

`glass-thistle`:
```
clump of four or five thin curved bone-grey stems, each ending in a cracked hollow
seed head of smoky translucent mineral membrane, airy sparse silhouette, wide gaps
between stems
```

`salt-hand`:
```
low wide bush of chalk-white tapered salt spikes growing upward and outward from a
cracked charcoal mound, concentric salt crust layers, some spikes broken halfway,
eroded blunt tips
```

`wind-rib`:
```
tall dead plant of twelve to eighteen flat curved ribs sweeping up and arching
outward from a thin twisted trunk, some ribs snapped short, thin membrane remnants
between the lowest ones, open skeletal silhouette
```

`halite-bloom`:
```
cluster of seven to ten flat hexagonal crystal blades fanning out and leaning in
different directions, milky pale blue with darker frost veins, two blades broken
short, growing out of a dark blasted rock base
```

`cinder-geode`:
```
cracked mineral geode split open along one side, dull dark ash-grey shell with deep
sand-blast grooves, interior filled with dull amber-orange crystal teeth, pale grey
powder coating, heavy crouched silhouette
```

## Сооружения

`avaris-gate-frame`:
```
ancient alien gate frame: two chunky square stone posts with bevelled blocks and
chipped corners, one heavy lintel block across the top sagging slightly in the
middle, shallow angular grooves cut into the posts, empty opening in the middle
```

`avaris-gate-leaf`:
```
single flat heavy metal gate panel with a perfectly straight left edge and small
hinge knuckles top and bottom, three vertical plates with visible seams, one
horizontal rib across the middle, abstract angular grooves pressed in, rust at the
edges, no frame
```

`avaris-beacon`:
```
ancient alien beacon: wide stepped hexagonal stone base, three buttress ribs leaning
against a slender square obelisk that narrows to a blunt point, one dark metal band
two thirds up, small inward cup at the top
```

`avaris-hearth`:
```
ceremonial stone brazier: squat eight-sided stone altar base, heavy metal bowl with
a thick rolled rim on four short legs, interior fire-blackened and filled with grey
ash, shallow grooves down the base sides
```

`avaris-counterweight-frame`:
```
stone gantry: two square stone masts joined at the top by one crossbeam that
overhangs both sides, worn metal pulley housing under the crossbeam, vertical guide
rails grooved into the inner faces of the mast
```

`avaris-counterweight-deck`:
```
small suspended metal platform of riveted plates with a raised rim and one broken
corner, two straight taut cables rising from opposite corners, nothing else around
```

`avaris-shrine`:
```
circular ancient shrine platform: low six-sided base, wide flat floor ringed by a
broken stone parapet, inner ring of eight short broken columns, stepped altar block
in the middle with a shallow carved channel running to the edge, two curved horns
rising from the back, both snapped at different heights
```

Модульный набор руин (четыре отдельных промпта):
```
hexagonal stone platform paved with irregular fitted blocks, one side collapsed into
rubble, chipped sagging edges, flat top
```
```
square stone pillar with horizontal erosion bands, rounded corners, rough broken top
where a capital snapped off, shallow vertical groove on the front
```
```
broken square pillar stump, uneven raw break at the top with protruding block
fragments, leaning very slightly
```
```
single broken stone slab lying flat, one clean break edge, three eroded edges, one
shallow carved groove across the top
```

## Артефакты-находки

`relic-codex`:
```
small alien relic: tapered dark metal cylinder split lengthwise, thin pale crystalline
seam in the gap, flat carved stone disc capping one end, the other end snapped off
showing layered interior
```

`avaris-tablet`:
```
stone tablet standing at a slight backward lean, face covered with rows of incised
abstract geometric marks - short strokes, dots, hooked lines in even rows, NOT text,
two corners broken off, hairline crack across the lower third
```

## Что делать с готовыми картинками

- **Для 3D-модели:** загрузить картинку в image-to-3D вместе с той же
  формулировкой, вернув габарит из части 2 (единицы метры, начало координат —
  центр основания, GLB, без камер, света и запечённых теней).
- **Для текстур:** не нужно. Флора и минералы в игре вообще без текстур (цвет
  материала + подсветка кодом), у сооружений — плоские цвета материалов.
- **Для концепта в README** — годится как есть, только с плоским фоном.

## Ловушки, проверенные на практике

- «9 metres tall» в промпте → в кадр приедет пейзаж. Габариты — только в заметке
  для себя.
- «no readable symbols» модель игнорирует: если нужны руны, просить
  «abstract geometric grooves» и никогда «runes / ancient writing».
- Одно лишнее слово «stone» рядом с «desert» — и появляется песок под объектом;
  спасает только `--no sand floor`.
- Просить «texture detail» бессмысленно: стиль — плоские грани, любая фототекстура
  выбивается.
- Зелёный цвет в промпте (даже «muted green moss») сразу даёт траву — в Аварисе
  зелёных растений нет вовсе.

---

# Часть 2. Для text-to-3D редакторов

Готовые промпты для text-to-3D редакторов (Meshy, Tripo, Rodin, Spline AI). Каждый
промпт собирается из трёх частей: **стиль** → **объект** → **техника**. Вставлять
в таком порядке.

Почему по-английски: все эти редакторы лучше понимают английские описания формы и
материала, русский текст они часто игнорируют или переводят криво.

---

## 0. Стиль — вставлять в каждый объект первым

```
Game asset for a post-apocalyptic desert planet. Ancient alien civilization, dead
world, wind-eroded surfaces. Art direction: gritty stylized realism, muted
ash-grey stone with ochre dust, flat-shaded low-poly look, slightly irregular
handmade silhouettes, heavy abrasion and dust deposits on every surface, faint
horizontal sand-blast streaks. No clean edges, no smooth plastic, no sci-fi
panels, no neon, no grass, no bright green, no blue sky. Single object on a
neutral background, no scene, no props around it.
```

## 0.1 Негатив (поле negative prompt, если есть)

```
text, letters, words, runes readable as glyphs, logo, watermark, signature,
human, animal, character, sky, ground plane, shadow catcher, environment,
bloom, glow lines, hologram, neon sign, chrome, mirror finish, plastic,
cartoon cute, chibi, low contrast mess, extra objects, duplicated parts
```

## 0.2 Технические требования

| Категория | Треугольники | Материалы | Текстура | Как попадает в игру |
|---|---|---|---|---|
| Флора и минералы | 3 000–6 500 | 4–5 без текстур | нет (цвет материала) | `InstancedMesh`, сотни копий |
| Сооружения (врата, маяк, очаг, противовес) | 8 000–15 000 | 3–5 | можно 1024² | по одному объекту в сцене |
| Храм / алтарь (hero) | 20 000–35 000 | 5–6 | 2048² | один в мире |
| Мелкие артефакты | 1 500–3 000 | 2–3 | можно 512² | один в сцене, крупным планом |

Общее для всех:

- **единицы — метры**, масштаб из таблицы объекта ниже (редакторы любят отдавать
  «1 единица = 1 см», поэтому после генерации выставить точную высоту);
- **начало координат — центр основания на земле** (Y вверх), объект стоит на нуле,
  без поворота и наклона. В игре это контракт: `prop-models.js` считает радиус
  коллизии по нижним 30 % высоты от нуля;
- **экспорт GLB**, без камер, источников света и анимаций;
- флора и минералы — **без текстур**, только цвет материала (UV всё равно
  выбрасываются, а цвет в игре ещё и подкрашивается на каждый экземпляр);
- никаких запечённых теней и AO в цвете: свет в игре динамический, от солнца,
  запечённая тень даст вторую тень;
- свечение в текстуру не запекать — гало и подсветку в игре делает код
  (`setCrystalGlow`, огонь у очага).

---

## 1. Флора и минералы — массовые, инстансинг

### 1.1 `glass-thistle` · Стеклянный чертополох (трава)

**Габарит:** 1.2 м высотой, 0.9 м в ширину. **Роль:** трава, сквозь неё проезжают.

```
A small clump of dried alien thistle, 1.2 metres tall. Four to six thin curved
stems rising from a single point, each ending in a split hollow seed-head made of
translucent mineralized membrane, cracked and partially collapsed. Stems are
dusty bone-grey, heads pale smoky glass with ash residue inside. Ribs visible
through the membrane. Thin, sparse, airy silhouette - the space between stems is
mostly empty. No leaves, no flowers.
```

**Настройки редактора:** симметрия выключена, «thin parts» включены, remesh не
агрессивный (тонкие стебли исчезают при сильном упрощении).

### 1.2 `salt-hand` · Соляная рука (кустарник)

**Габарит:** 2.4 м высотой, 2.6 м в ширину. **Роль:** куст, коллайдер есть.

```
A low wide salt bush, 2.4 metres tall and 2.6 metres across. Fingers of
crystallised salt grow upward and outward from a cracked mound of dark soil,
like a frozen splash or a hand of grey-white spikes. Each finger is a rough
tapered column with concentric salt crust layers, some broken at half height,
tips eroded blunt. Base mound is charcoal-brown, spikes range from chalk white to
dusty grey-green. Wide and squat, not a tree.
```

### 1.3 `wind-rib` · Ветряное ребро (второе дерево)

**Габарит:** 3.4 м высотой, 2.6 м в ширину. **Роль:** дерево, высокое, с просветами.

```
A tall dead alien plant, 3.4 metres high, shaped like a bundle of curved ribs
standing on a thin twisted trunk. Twelve to eighteen long flat ribs sweep upward
and arch outward, some snapped short at different heights, tips slightly curled
by wind. Ribs are mineralized grey-brown with darker edges, thin membrane
remnants stretched between the lowest ones. Trunk leans slightly. Open,
skeletal, wind-shaped silhouette with a lot of empty space between ribs.
```

### 1.4 `halite-bloom` · Соляной цветок (голубой минерал)

**Габарит:** 2.2 м высотой, 1.6 м в ширину. **Роль:** холодный минерал, в игре
получает слабое гало от кода.

```
A cluster of pale blue crystalline blades growing out of a broken rock base,
2.2 metres tall. Seven to ten flat hexagonal blades fan out and lean in different
directions, translucent smoky blue with milky inclusions and darker frost-like
veins near the tips. Edges chipped, two blades short and broken. Rock base is
dark grey, blasted smooth by sand. Crystalline but weathered, not a jewellery
crystal.
```

### 1.5 `cinder-geode` · Зольная жеода (токсичный минерал)

**Габарит:** 1.8 м высотой, 1.4 м шириной. **Роль:** ядовито-яркий минерал, без гало.

```
A cracked mineral geode, 1.8 metres tall, split open along one side. The outer
shell is dull dark ash-grey with deep sand-blast grooves; the exposed interior is
a cluster of dull amber-orange crystal teeth pointing inward, some coated with
pale grey powder. The split reveals about a third of the interior. Heavy, low,
crouched silhouette, resting on the ground, not standing.
```

---

## 2. Сооружения аварисцев

Из одного и того же камня: `populated` камень серо-пепельный, металл —
тусклый синевато-серый. Рунные полосы — **абстрактные углублённые борозды**, не
буквы (иначе редактор нарисует абракадабру).

### 2.1 `avaris-gate-frame` · Рама врат (статичная часть)

**Габарит:** 11 м шириной, 9 м высотой, 2 м глубиной. Проём 4.6 × 5.2 м.

```
A freestanding ancient gate frame, 9 metres tall and 11 metres wide. Two massive
square stone posts with chipped edges and horizontal erosion bands, each topped
by a wider flat capstone. A single heavy lintel stone rests across the top, wider
than the posts, sagging slightly in the middle. Deep narrow grooves cut into the
posts in abstract repeating patterns - no readable symbols. Surface is ash-grey
sandstone, pitted, with dust collected in every groove and a dark weathered crust
near the base. Symmetrical, monumental, empty opening in the middle.
```

Отдельного промпта на створку не нужно — её делаем из той же генерации
(`avaris-gate-leaf`), см. ниже.

### 2.2 `avaris-gate-leaf` · Створка (одна, вторая зеркалится кодом)

**Габарит:** 2.3 м шириной, 5.2 м высотой, 0.4 м толщиной. Точка вращения — левый
край, по вертикальной оси, поэтому створка должна быть **плоской с ровным левым
краем**.

```
A single heavy metal gate leaf, 5.2 metres tall, 2.3 metres wide and 0.4 metres
thick, flat, with a perfectly straight left edge and a small hinge knuckle at top
and bottom of that edge. Panel is dull blue-grey metal, welded from three vertical
plates with visible seams, one horizontal rib across the middle. Abstract angular
grooves pressed into the panel, no readable symbols. Rusted brown at the edges,
sand filling the bottom seam. No frame around it, panel only.
```

### 2.3 `avaris-beacon` · Маяк (6 штук в мире)

**Габарит:** 4.6 м диаметр основания, 12 м высотой.

```
An ancient alien beacon tower, 12 metres tall. Wide hexagonal stone base with a
stepped rim, three buttress ribs leaning against the shaft, then a slender square
obelisk rising from the middle that narrows to a blunt point. A dark metal band
wraps the shaft at two thirds height, with a small inward-sloping cup at the very
top. Deep vertical erosion channels, ash-grey stone with darker metal fittings,
sand piled around the base. Monolithic, geometric, no glowing parts.
```

### 2.4 `avaris-hearth` · Очаг (чаша для огня)

**Габарит:** 7 м диаметр, 3.2 м высотой. Огонь — код, в модели его нет.

```
A ceremonial stone brazier, 3.2 metres tall and 7 metres wide. Broad
eight-sided stone base like a squat altar, above it a heavy metal bowl with a
thick rolled rim, the interior fire-blackened and filled with grey ash and
charred fragments. Four short stone legs lift the bowl above the base. Abstract
grooves run down the base sides, no readable symbols. Heavy, squat, obviously
built to hold fire for centuries.
```

### 2.5 `avaris-counterweight-frame` · Противовес: рама (статичная)

**Габарит:** 6.4 м шириной, 9 м высотой, 1.6 м глубиной.

```
A stone gantry frame, 9 metres tall. Two square stone masts with chipped
corners, connected at the top by a single crossbeam that extends slightly past
both masts. A worn metal pulley housing hangs from the centre of the crossbeam.
Two vertical guide rails run down the inner sides of the masts, grooved and
polished by long use. Ash-grey stone, dull grey metal fittings, dust in all
grooves. Symmetrical and strictly vertical, nothing hanging below the rails.
```

### 2.6 `avaris-counterweight-deck` · Площадка (двигается кодом)

**Габарит:** 4.4 × 0.5 × 3.4 м, плюс два троса вверх.

```
A small suspended metal platform, 4.4 metres long, 3.4 metres wide and 0.5
metres thick, hanging from two straight cables that rise 5.6 metres from its
left and right corners. Deck is dull blue-grey metal plates with a raised rim
and one broken corner, riveted seams, sand dust in the seams. Cables are thin,
taut, straight, ending in a small hook at the top. No frame, no mast - cables
and deck only.
```

### 2.7 `avaris-shrine` · Храм-алтарь на вершине (hero-объект)

**Габарит:** 14 м диаметр, 8 м высотой.

```
A circular ancient shrine platform, 14 metres across and 8 metres tall, built
from large fitted stone blocks. A low six-sided base, a wide flat floor ringed by
a stone parapet broken in several places, and an inner ring of eight short
broken columns. In the centre a stepped altar block with a shallow carved channel
running out to the floor edge. Two tall curved horns rise from the back of the
platform, both broken at different heights. Everything ash-grey and ochre,
erosion channels following the block seams, dust drifts against the parapet,
doorway gap in the parapet facing the viewer. Abstract geometric carvings only.
```

### 2.8 Модульный набор руин (4 промпта, ставить скопом)

`ruin-platform` — **12 м диаметр, 1.5 м высотой:**

```
A hexagonal stone platform, 12 metres across and 1.5 metres tall, paved with
irregular fitted blocks, one side collapsed into rubble, edges chipped and
sagging. Ash-grey sandstone, dust in every joint, deep erosion grooves. Flat top
surface, suitable as a floor.
```

`ruin-pillar-intact` — **1.5 м ширина, 8 м высотой:**

```
A square stone pillar, 8 metres tall, 1.5 metres thick, standing perfectly
straight on a slightly wider base block. Horizontal erosion bands, corners
rounded by sand, top surface rough where a capital broke off. One shallow
vertical groove on the front face in an abstract pattern.
```

`ruin-pillar-broken` — **1.5 м ширина, 3.5 м высотой:**

```
A broken square stone pillar stump, 3.5 metres tall and 1.5 metres thick. Top is
an uneven break with exposed rough interior and protruding block fragments,
leaning very slightly. Same weathering as a standing pillar: horizontal bands,
rounded corners, sand at the base.
```

`ruin-slab` — **2 × 0.6 × 2 м:**

```
A single broken stone slab from a collapsed wall, 2 metres wide, 2 metres deep
and 0.6 metres thick, lying flat. One edge is a clean break, the other three are
eroded. One shallow carved groove across the top.
```

---

## 3. Артефакты-находки

### 3.1 `relic-codex` · Реликварий (то, что находят раскопками)

**Габарит:** 0.35 м. Смотрится вблизи, поэтому детализация важнее габарита.

```
A small alien relic, 35 centimetres long, resting on its side. A tapered
cylindrical body of dark worn metal split lengthwise into two halves, the seam
filled with a thin pale crystalline line. One end is capped with a flat stone
disc carved with abstract concentric grooves, the other end is snapped off,
showing layered interior. Surface pitted and dusty, edges polished by handling.
No glowing parts, no gems, no symbols.
```

### 3.2 `avaris-tablet` · Табличка с письменами

**Габарит:** 1.6 × 2.2 × 0.25 м.

```
A stone tablet, 2.2 metres tall, 1.6 metres wide and 0.25 metres thick, standing
at a slight backward lean. Face is covered with rows of incised abstract
geometric marks - short strokes, dots and hooked lines arranged in even rows, NOT
readable letters, no letters, no words. Two corners broken off, a hairline crack
runs diagonally across the lower third, sand fills the incisions. Ash-grey stone
with darker cracks.
```

---

## 4. После генерации: как положить в игру

1. Экспорт GLB → `xr7-zone/assets/models/<id>.glb` (id латиницей, как в заголовках
   промптов выше).
2. Если это флора/минерал: добавить строку в `ENV_MODELS` (`js/prop-models.js`) —
   `{ scale, radius, kind: 'plant'|'crystal', role }` и, если нужно, в
   `pickPlantModel`. Масштаб подбирается так, чтобы получить габарит из промпта:
   `scale = нужная_высота / высота_модели`.
3. Если это одиночное сооружение: положить рядом `*.json` с размерами и
   треугольниками и добавить запись в `assets/models/env-manifest.json` (поля как
   у существующих пяти: `id`, `name`, `kind`, `zone`, `description`, `file`,
   `units`, `size`, `triangles`, `drawCalls`, `bytes`).
4. Проверки: `node --check js/prop-models.js`, открыть игру, убедиться, что модель
   стоит на земле (а не наполовину в ней) и что ровер не проходит сквозь неё там,
   где не должен.
5. Draw calls держать ≤ 5 на модель: каждый лишний материал — отдельный вызов
   отрисовки, а флора ещё и инстансится сотнями копий.

## 5. Порядок, если времени мало

| Приоритет | Что | Почему |
|---|---|---|
| 1 | `avaris-shrine`, `avaris-beacon` | их видно издалека, сейчас это набор коробок |
| 2 | `avaris-gate-frame` + `avaris-gate-leaf` | центральная механика, игрок подходит вплотную |
| 3 | `wind-rib`, `salt-hand` | флора повторяется и приедается |
| 4 | модульные руины | дают разнообразие бесплатно, скопом |
| 5 | `avaris-hearth`, `avaris-counterweight` | второстепенные механизмы |
| 6 | `relic-codex`, `avaris-tablet` | мелочь, но крупным планом |
