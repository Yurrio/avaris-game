/* Курсоры игры «АВАРИС».
   Все варианты собраны здесь, видны на странице tools/cursor-preview.html.
   Выбор: открыть игру с ?cursor=<id> — вариант запомнится в localStorage
   (avaris.cursor) и будет применяться при следующих запусках.
   По умолчанию — первый вариант списка («Прицел»). */

(function () {
  'use strict';

  const MINT = '#9ff2e6';
  const AMBER = '#ff9f52';
  const WHITE = '#ffffff';
  const INK = '#0b1218';

  // SVG-тело курсора → готовая CSS-функция url("data:image/svg+xml,...")
  const svg = (body) =>
    `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>${body}</svg>`;
  const uri = (markup) =>
    `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}")`;

  const LIST = [
    {
      id: 'reticle',
      name: 'Прицел',
      note: 'как сейчас: четыре засечки, круг и янтарная точка',
      main: `<g fill='none' stroke='${MINT}' stroke-width='1.3' stroke-linecap='round'>
        <path d='M14 2.5v5.5M14 20v5.5M2.5 14H8M20 14h5.5'/>
        <circle cx='14' cy='14' r='7.2' opacity='.45'/></g>
        <circle cx='14' cy='14' r='1.9' fill='${AMBER}'/>`,
      hot: `<g fill='none' stroke-width='1.5' stroke-linecap='round'>
        <path d='M14 2v6M14 20v6M2 14h6M20 14h6' stroke='${WHITE}'/>
        <circle cx='14' cy='14' r='8' stroke='${MINT}'/></g>
        <rect x='12.4' y='12.4' width='3.2' height='3.2' transform='rotate(45 14 14)' fill='${AMBER}'/>`
    },
    {
      id: 'ring',
      name: 'Кольцо',
      note: 'тонкое кольцо со светящейся искрой внутри',
      main: `<circle cx='14' cy='14' r='8.2' fill='none' stroke='${MINT}' stroke-width='1.25' opacity='.8'/>
        <circle cx='14' cy='14' r='1.7' fill='${AMBER}'/>`,
      hot: `<circle cx='14' cy='14' r='9.6' fill='none' stroke='${WHITE}' stroke-width='1.4'/>
        <circle cx='14' cy='14' r='4' fill='none' stroke='${MINT}' stroke-width='1' opacity='.55'/>
        <circle cx='14' cy='14' r='2' fill='${AMBER}'/>`
    },
    {
      id: 'arrow',
      name: 'Стрелка',
      note: 'обычный указатель, только в цветах игры',
      hx: 5,
      hy: 2,
      main: `<path d='M5 2.2 L5 21.4 L10.1 16.6 L13.1 23 L16.3 21.5 L13.3 15.3 L20.4 14.5 Z'
        fill='${INK}' fill-opacity='.8' stroke='${MINT}' stroke-width='1.3' stroke-linejoin='round'/>`,
      hot: `<path d='M5 2.2 L5 21.4 L10.1 16.6 L13.1 23 L16.3 21.5 L13.3 15.3 L20.4 14.5 Z'
        fill='${INK}' fill-opacity='.9' stroke='${AMBER}' stroke-width='1.5' stroke-linejoin='round'/>`
    },
    {
      id: 'brackets',
      name: 'Захват',
      note: 'четыре уголка-скобки и точка по центру',
      main: `<g fill='none' stroke='${MINT}' stroke-width='1.4' stroke-linecap='round' opacity='.9'>
        <path d='M6 11.5V6h5.5M22 11.5V6h-5.5M6 16.5V22h5.5M22 16.5V22h-5.5'/></g>
        <circle cx='14' cy='14' r='1.6' fill='${AMBER}'/>`,
      hot: `<g fill='none' stroke='${WHITE}' stroke-width='1.5' stroke-linecap='round'>
        <path d='M6 11.5V6h5.5M22 11.5V6h-5.5M6 16.5V22h5.5M22 16.5V22h-5.5'/></g>
        <rect x='11.6' y='11.6' width='4.8' height='4.8' transform='rotate(45 14 14)' fill='${AMBER}'/>`
    },
    {
      id: 'cross',
      name: 'Крест',
      note: 'длинный тонкий крест с янтарной серединой',
      main: `<g stroke='${MINT}' stroke-width='1.2' stroke-linecap='round' opacity='.85'>
        <path d='M14 3.5v21M3.5 14h21'/></g>
        <circle cx='14' cy='14' r='1.5' fill='${AMBER}'/>`,
      hot: `<g stroke='${WHITE}' stroke-width='1.5' stroke-linecap='round'>
        <path d='M14 2.5v9M14 16.5v9M2.5 14h9M16.5 14h9'/></g>
        <circle cx='14' cy='14' r='2.4' fill='${AMBER}'/>`
    },
    {
      id: 'dot',
      name: 'Точка',
      note: 'мягкое свечение и точка — самый незаметный',
      main: `<circle cx='14' cy='14' r='5' fill='${MINT}' opacity='.14'/>
        <circle cx='14' cy='14' r='1.9' fill='${MINT}'/>
        <circle cx='14' cy='14' r='.8' fill='${AMBER}'/>`,
      hot: `<circle cx='14' cy='14' r='7.5' fill='${MINT}' opacity='.13'/>
        <circle cx='14' cy='14' r='4.2' fill='none' stroke='${WHITE}' stroke-width='1.2' opacity='.9'/>
        <circle cx='14' cy='14' r='2' fill='${AMBER}'/>`
    },
    {
      id: 'diamond',
      name: 'Ромб',
      note: 'ромб в духе тангутских печатей',
      main: `<rect x='5.9' y='5.9' width='16.2' height='16.2' transform='rotate(45 14 14)'
        fill='none' stroke='${MINT}' stroke-width='1.2' opacity='.65'/>
        <rect x='11.1' y='11.1' width='5.8' height='5.8' transform='rotate(45 14 14)'
        fill='none' stroke='${AMBER}' stroke-width='1.3'/>`,
      hot: `<rect x='5' y='5' width='18' height='18' transform='rotate(45 14 14)'
        fill='none' stroke='${WHITE}' stroke-width='1.3'/>
        <rect x='11' y='11' width='6' height='6' transform='rotate(45 14 14)' fill='${AMBER}'/>`
    }
  ];

  const VARIANTS = LIST.map((v) => ({
    id: v.id,
    name: v.name,
    note: v.note,
    mainSvg: svg(v.main),
    hotSvg: svg(v.hot),
    mainCss: `${uri(svg(v.main))} ${v.hx || 14} ${v.hy || 14}, default`,
    hotCss: `${uri(svg(v.hot))} ${v.hx || 14} ${v.hy || 14}, pointer`
  }));

  function apply(id) {
    const v = VARIANTS.find((x) => x.id === id) || VARIANTS[0];
    const root = document.documentElement.style;
    root.setProperty('--cursor-main', v.mainCss);
    root.setProperty('--cursor-hot', v.hotCss);
    API.current = v;
    return v;
  }

  function save(id) {
    try {
      localStorage.setItem('avaris.cursor', id);
    } catch (e) {
      /* приватный режим — выбор проживёт до перезагрузки */
    }
  }

  // Список для выбора прямо в игре: строки-кнопки с образцом и названием.
  function renderPicker(container, onPick) {
    if (!container) return;
    container.innerHTML = '';
    VARIANTS.forEach((v) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cur-row' + (v.id === API.current.id ? ' is-on' : '');
      row.dataset.id = v.id;
      row.innerHTML =
        `<span class="cur-pic">${v.mainSvg}</span>` +
        `<span class="cur-meta"><b>${v.name}</b><i>${v.note}</i></span>` +
        `<span class="cur-ok">✓</span>`;
      row.addEventListener('click', () => {
        apply(v.id);
        save(v.id);
        renderPicker(container, onPick);
        if (onPick) onPick(v);
      });
      container.appendChild(row);
    });
  }

  const API = { list: VARIANTS, apply: apply, save: save, current: VARIANTS[0], renderPicker: renderPicker };
  window.AVARIS_CURSORS = API;

  // Выбор варианта отключён (просьба владельца): в игре всегда «Точка».
  // Список, save() и renderPicker() оставлены рабочими: чтобы вернуть выбор,
  // достаточно сделать CURSOR_LOCK = null и убрать hidden у #pauseCursor в index.html.
  const CURSOR_LOCK = 'dot';
  let picked = CURSOR_LOCK;
  if (!picked) {
    try {
      picked = new URLSearchParams(location.search).get('cursor') ||
        localStorage.getItem('avaris.cursor');
    } catch (e) {
      /* приватный режим или нет URLSearchParams */
    }
  }
  apply(picked);
})();
