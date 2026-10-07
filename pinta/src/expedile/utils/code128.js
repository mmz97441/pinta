// Code 128 (ISO/IEC 15417) for the outgoing parcel labels: « EXP-2YE537-1-2 » as bars
// that any handheld scanner reads. Pure module (no import): the label PDF draws it with
// jsPDF rectangles, the tests decode it back.
//
// Printable ASCII only (32 to 126). Code Set B carries every character; Code Set C packs
// two digits per symbol and is used wherever it makes the barcode shorter (four digits
// or more), which the encoder decides by counting symbols, never by a rule of thumb.

/**
 * The bar and space widths of each symbol value, in modules (narrowest element = 1).
 * Values 0 to 102 are data and function symbols, 103 to 105 the start codes A, B and C,
 * 106 the stop pattern (seven elements, the last one a bar). Each symbol starts with a
 * bar and is 11 modules wide; the stop is 13 modules wide.
 */
export const CODE128_PATTERNS = Object.freeze([
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]);

export const CODE128 = Object.freeze({ START_B: 104, START_C: 105, CODE_C: 99, CODE_B: 100, STOP: 106 });
/** The clear margin required on each side of the bars: ten modules. */
export const CODE128_QUIET_ZONE = 10;
/** The narrowest bar the labels accept, in millimetres: readable by any scanner once printed. */
export const CODE128_MIN_MODULE_MM = 0.3;

const B = 0;
const C = 1;
const isDigit = char => char >= '0' && char <= '9';

/** The check symbol: the start value plus each data symbol times its position, modulo 103. */
export function code128Checksum(values) {
  if (!Array.isArray(values) || !values.length) throw new TypeError('Code 128 : aucun symbole à contrôler.');
  return values.reduce((sum, value, position) => sum + value * Math.max(position, 1), 0) % 103;
}

/**
 * The shortest symbol sequence for `text`, start code included (without check and stop).
 * best[i][set] is the fewest symbols that encode text from position i while in `set`;
 * on a tie the encoder keeps its current set (fewer switches).
 */
function symbolValues(text) {
  const n = text.length;
  const pairAt = i => i + 1 < n && isDigit(text[i]) && isDigit(text[i + 1]);
  const best = Array.from({ length: n + 1 }, () => [0, 0]);
  const direct = (i, set) => set === B ? 1 + best[i + 1][B] : pairAt(i) ? 1 + best[i + 2][C] : Infinity;
  for (let i = n - 1; i >= 0; i -= 1) {
    best[i][B] = Math.min(direct(i, B), 1 + direct(i, C));
    best[i][C] = Math.min(direct(i, C), 1 + direct(i, B));
  }
  let set = best[0][C] < best[0][B] ? C : B;
  const values = [set === C ? CODE128.START_C : CODE128.START_B];
  for (let i = 0; i < n;) {
    const other = set === B ? C : B;
    if (direct(i, set) > 1 + direct(i, other)) {
      values.push(other === C ? CODE128.CODE_C : CODE128.CODE_B);
      set = other;
    }
    if (set === C) { values.push(Number(text.slice(i, i + 2))); i += 2; }
    else { values.push(text.charCodeAt(i) - 32); i += 1; }
  }
  return values;
}

/**
 * Encodes printable ASCII text:
 * - `values`: start, data symbols, check symbol and stop (symbol values);
 * - `checksum`: the check symbol value;
 * - `widths`: the element widths in modules, starting and ending with the quiet zone
 *   (a space); the elements alternate space, bar, space… so odd indices are bars;
 * - `modules`: the total width in modules, quiet zones included.
 * Throws a RangeError for an empty text or a character outside printable ASCII.
 */
export function encodeCode128(text, { quietZone = CODE128_QUIET_ZONE } = {}) {
  const value = String(text ?? '');
  if (!value) throw new RangeError('Code 128 : texte vide.');
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char.length !== 1 || code < 32 || code > 126) throw new RangeError(`Code 128 : caractère non imprimable « ${char} ».`);
  }
  const symbols = symbolValues(value);
  const checksum = code128Checksum(symbols);
  const values = [...symbols, checksum, CODE128.STOP];
  const widths = [quietZone];
  for (const symbol of values) for (const digit of CODE128_PATTERNS[symbol]) widths.push(Number(digit));
  widths.push(quietZone);
  return { text: value, values, checksum, widths, modules: widths.reduce((sum, width) => sum + width, 0) };
}

/**
 * Draws `text` as a Code 128 barcode with filled jsPDF rectangles (document unit:
 * millimetres), centred in `maxWidth` from `x` when given. The module width starts at
 * `moduleWidth` and shrinks to fit `maxWidth`, never below 0.3 mm: a barcode that would
 * need narrower bars throws instead of printing an unreadable code.
 * Returns the drawn geometry: { x, y, width, height, moduleWidth, modules } (x and width
 * include the quiet zones).
 */
export function drawCode128(doc, text, { x, y, height, moduleWidth = 0.375, maxWidth = Infinity, quietZone = CODE128_QUIET_ZONE } = {}) {
  const encoded = encodeCode128(text, { quietZone });
  const module = Math.min(moduleWidth, maxWidth / encoded.modules);
  if (!(module >= CODE128_MIN_MODULE_MM)) throw new RangeError(`Code 128 : « ${encoded.text} » ne tient pas dans ${maxWidth} mm avec des barres d’au moins ${CODE128_MIN_MODULE_MM} mm.`);
  const width = encoded.modules * module;
  const left = Number.isFinite(maxWidth) ? x + (maxWidth - width) / 2 : x;
  doc.setFillColor(0, 0, 0);
  let cursor = left;
  encoded.widths.forEach((elements, index) => {
    if (index % 2 === 1) doc.rect(cursor, y, elements * module, height, 'F');
    cursor += elements * module;
  });
  return { x: left, y, width, height, moduleWidth: module, modules: encoded.modules };
}
