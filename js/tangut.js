/* ============================================================================
   ШЕСТЬ ЗНАКОВ АВАРИСЦЕВ — настоящие тангутские иероглифы (西夏文).
   Это не выдуманные руны: знаки взяты из Unicode-блока Tangut и сверены по
   словарю Ли Фаньвэня «夏漢字典» (2008). Чтения — научная реконструкция
   (Xun Gong, tangut-pronunciation-db), в игре они не озвучиваются.

   Три механизма по два состояния:
     врата      — закрыто / открыто      𗼐 / 𗳋
     очаг-маяк  — погасло / горит        𗈞 / 𗻂
     противовес — вниз / вверх           𗭮 / 𗨁

   Набор подобран по разбору TangutIDS: у всех шести — свой радикал
   (262, 190, 28, 260, 162, 141) и НЕТ ни одного общего компонента,
   чтобы знаки не выглядели вариациями одного и того же элемента.

   Полный атлас всех 6 177 знаков: ~/python-practice/tangut (index.html).
   ========================================================================== */

export const TANGUT_FONT = 'TangutSign';

/** id ключа -> знак и его паспорт */
export const TANGUT = {
  shut: { char: '𗼐', code: 'U+17F10', reading: 'qwaa̱ṃ¹', gloss: 'to close' },
  open: { char: '𗳋', code: 'U+17CCB', reading: 'ge¹', gloss: 'to open' },
  dark: { char: '𗈞', code: 'U+1721E', reading: 'rdzar²', gloss: 'to extinguish' },
  burn: { char: '𗻂', code: 'U+17EC2', reading: 'nde²', gloss: 'to light a fire' },
  down: { char: '𗭮', code: 'U+17B6E', reading: 'źoṃ¹', gloss: 'down' },
  up: { char: '𗨁', code: 'U+17A01', reading: 'phu²', gloss: 'up' },
};

/** порядок знаков на плите и в HUD */
export const TANGUT_ORDER = ['shut', 'open', 'dark', 'burn', 'down', 'up'];

export const glyphOf = (id) => (TANGUT[id] || {}).char || '';

/** Шесть знаков одной строкой — для надписей и отладки */
export const TANGUT_LINE = TANGUT_ORDER.map(glyphOf).join('');

/**
 * Шрифт для canvas: там нет CSS-наследования, поэтому семейство подставляем
 * вручную. Вызывать только после document.fonts.load(...) — иначе нарисуются
 * «квадратики» (tofu), и текстура запомнит их навсегда.
 */
export const canvasFont = (px) => `${px}px ${TANGUT_FONT}, Georgia, serif`;
