// Code 128 of the parcel labels: the symbol table, the check symbol, the choice between Code Sets B and C, and a
// decoder written here, independent of the encoder, that reads every barcode back from its bar widths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE128, CODE128_MIN_MODULE_MM, CODE128_PATTERNS, CODE128_QUIET_ZONE, code128Checksum, drawCode128, encodeCode128 } from '../src/expedile/utils/code128.js';

/** Reads widths (quiet zones included) back to text, checking start, check symbol and stop on the way. */
function decode(widths) {
  assert.ok(widths[0] >= 10 && widths[widths.length - 1] >= 10, 'quiet zones of ten modules');
  const elements = widths.slice(1, -1);
  const byPattern = new Map(CODE128_PATTERNS.map((pattern, value) => [pattern, value]));
  const symbols = [];
  for (let index = 0; index < elements.length;) {
    const size = elements.length - index === 7 ? 7 : 6;
    const pattern = elements.slice(index, index + size).join('');
    assert.ok(byPattern.has(pattern), `unknown pattern ${pattern}`);
    symbols.push(byPattern.get(pattern));
    index += size;
  }
  assert.equal(symbols.pop(), 106, 'stop pattern');
  const check = symbols.pop();
  // The check symbol, recomputed here: start value + Σ position × value, modulo 103.
  let weighted = symbols[0];
  for (let position = 1; position < symbols.length; position += 1) weighted += position * symbols[position];
  assert.equal(check, weighted % 103, 'check symbol');
  let set = { 104: 'B', 105: 'C' }[symbols[0]];
  assert.ok(set, 'start B or C');
  let text = '';
  for (const value of symbols.slice(1)) {
    if (set === 'B' && value === 99) set = 'C';
    else if (set === 'C' && value === 100) set = 'B';
    else if (set === 'B') { assert.ok(value <= 94, `printable value ${value}`); text += String.fromCharCode(value + 32); }
    else { assert.ok(value <= 99, `digit pair ${value}`); text += String(value).padStart(2, '0'); }
  }
  return text;
}

/** The fewest data symbols for `text`, by exhaustive search over the B/C choices (short texts only). */
function fewestSymbols(text) {
  const memo = new Map();
  const isPair = index => /^\d\d$/.test(text.slice(index, index + 2));
  const cost = (index, set) => {
    if (index === text.length) return 0;
    const key = `${index}:${set}`;
    if (memo.has(key)) return memo.get(key);
    const options = [];
    if (set === 'B') options.push(1 + cost(index + 1, 'B'));
    if (set === 'C' && isPair(index)) options.push(1 + cost(index + 2, 'C'));
    if (set === 'B' && isPair(index)) options.push(2 + cost(index + 2, 'C'));
    if (set === 'C') options.push(2 + cost(index + 1, 'B'));
    const best = Math.min(...options);
    memo.set(key, best);
    return best;
  };
  return Math.min(cost(0, 'B'), isPair(0) ? cost(0, 'C') : Infinity);
}

test('the symbol table: 106 symbols of 11 modules with an even bar width, and the 13-module stop', () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  for (const [value, pattern] of CODE128_PATTERNS.slice(0, 106).entries()) {
    assert.match(pattern, /^[1-4]{6}$/, `value ${value}`);
    const widths = [...pattern].map(Number);
    assert.equal(widths.reduce((sum, width) => sum + width, 0), 11, `value ${value} is 11 modules wide`);
    assert.equal((widths[0] + widths[2] + widths[4]) % 2, 0, `value ${value}: its bars cover an even number of modules`);
  }
  assert.equal(new Set(CODE128_PATTERNS).size, 107, 'every pattern is distinct');
  assert.equal(CODE128_PATTERNS[106], '2331112', 'stop: 2 3 3 1 1 1 2');
  // Anchors of the table: space (0), « A » (33), CODE C (99), CODE B (100), FNC1 (102), START A, B and C.
  assert.deepEqual([0, 33, 99, 100, 102, 103, 104, 105].map(value => CODE128_PATTERNS[value]), ['212222', '111323', '113141', '114131', '411131', '211412', '211214', '211232']);
});

test('the check symbol: weighted sum modulo 103, as in the worked examples of the standard', () => {
  // ISO/IEC 15417 example « AIM1234 »: START B, A, I, M, CODE C, 12, 34 → check symbol 87.
  assert.equal(code128Checksum([104, 33, 41, 45, 99, 12, 34]), 87);
  // « PJJ123C » in Code Set A: START A, P, J, J, 1, 2, 3, C → 54.
  assert.equal(code128Checksum([103, 48, 42, 42, 17, 18, 19, 35]), 54);
  assert.throws(() => code128Checksum([]), TypeError);
});

test('Code Set C packs digits only where the barcode gets shorter', () => {
  // The standard's example is encoded exactly as it shows it.
  assert.deepEqual(encodeCode128('AIM1234').values, [104, 33, 41, 45, 99, 12, 34, 87, 106]);
  assert.deepEqual(encodeCode128('1234').values.slice(0, 3), [105, 12, 34], 'four digits start in Code Set C');
  assert.deepEqual(encodeCode128('123').values.slice(0, 4), [104, 17, 18, 19], 'three digits stay in Code Set B');
  // A parcel code: 14 characters in Code Set B, the 3 digits of 537 being too short for Code Set C.
  const parcel = encodeCode128('EXP-2YE537-1-2');
  assert.equal(parcel.values.length, 1 + 14 + 2);
  assert.ok(!parcel.values.includes(99));
  // Six digits inside a reference switch to Code Set C and back.
  assert.deepEqual(encodeCode128('EXP-123456-1-2').values.slice(0, 9), [104, 37, 56, 48, 13, 99, 12, 34, 56]);
  assert.equal(encodeCode128('EXP-123456-1-2').values[9], 100, 'CODE B before « -1-2 »');
});

test('every encoding is as short as an exhaustive search finds', () => {
  const alphabet = ['0', '1', 'A'];
  for (let length = 1; length <= 8; length += 1) {
    for (let number = 0; number < alphabet.length ** length; number += 1) {
      let rest = number;
      let text = '';
      for (let position = 0; position < length; position += 1) { text += alphabet[rest % 3]; rest = Math.floor(rest / 3); }
      const { values } = encodeCode128(text);
      assert.equal(values.length - 3, fewestSymbols(text), text);
      assert.equal(decode(encodeCode128(text).widths), text, text);
    }
  }
});

test('every printable character and every digit pair reads back, with quiet zones and the exact width', () => {
  const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join('');
  const pairs = Array.from({ length: 100 }, (_, index) => String(index).padStart(2, '0')).join('');
  for (const text of [printable, pairs, 'EXP-2YE537-1-2', 'EXP-2YE537 · Colis 1/2'.replace('·', '.'), 'EXP-1042-10-12', '0', '00', 'A1B22C333D4444E']) {
    const encoded = encodeCode128(text);
    assert.equal(decode(encoded.widths), text);
    assert.equal(encoded.widths[0], CODE128_QUIET_ZONE);
    assert.equal(encoded.widths[encoded.widths.length - 1], CODE128_QUIET_ZONE);
    assert.equal(encoded.modules, 2 * CODE128_QUIET_ZONE + 11 * (encoded.values.length - 1) + 13);
    assert.equal(encoded.widths.length, 2 + 6 * (encoded.values.length - 1) + 7, 'space, then bar and space by turns');
  }
  // All 103 data values, the starts B and C and the stop appear in these barcodes, the check symbols included.
  const used = new Set([printable, pairs, 'AIM1234', 'EXP-123456-1-2'].flatMap(text => encodeCode128(text).values));
  for (let value = 0; value <= 99; value += 1) assert.ok(used.has(value), `value ${value}`);
});

test('anything outside printable ASCII is refused, never approximated', () => {
  for (const text of ['', 'é', 'EXP-2YE537\n', 'Colis 1/2 ·', '\u0000', '😀']) assert.throws(() => encodeCode128(text), RangeError, JSON.stringify(text));
  assert.throws(() => encodeCode128(null), RangeError);
});

test('the drawing: one filled rectangle per bar, modules of at least 0.3 mm, centred, refused when too narrow', () => {
  const rects = [];
  const doc = { setFillColor: (...color) => rects.push({ color }), rect: (x, y, width, height, style) => rects.push({ x, y, width, height, style }) };
  const drawn = drawCode128(doc, 'EXP-2YE537-1-2', { x: 4, y: 117, height: 20, moduleWidth: 0.375, maxWidth: 92 });
  assert.deepEqual(rects[0], { color: [0, 0, 0] });
  const bars = rects.slice(1);
  const encoded = encodeCode128('EXP-2YE537-1-2');
  assert.equal(bars.length, (encoded.widths.length - 1) / 2);
  assert.ok(bars.every(bar => bar.style === 'F' && bar.y === 117 && bar.height === 20));
  assert.equal(drawn.moduleWidth, 0.375);
  assert.ok(Math.abs(drawn.x - (4 + (92 - drawn.width) / 2)) < 1e-9, 'centred in the available width');
  // The bars read back from the drawing itself: widths from the rectangles and the gaps between them.
  const widths = [Math.round((bars[0].x - drawn.x) / drawn.moduleWidth)];
  bars.forEach((bar, index) => {
    widths.push(Math.round(bar.width / drawn.moduleWidth));
    const next = bars[index + 1];
    widths.push(Math.round(((next ? next.x : drawn.x + drawn.width) - bar.x - bar.width) / drawn.moduleWidth));
  });
  assert.equal(decode(widths), 'EXP-2YE537-1-2');
  // A narrower space shrinks the modules, down to 0.3 mm and never below.
  const fitted = drawCode128({ setFillColor() {}, rect() {} }, 'EXP-2YE537-1-2', { x: 0, y: 0, height: 10, maxWidth: 65 });
  assert.ok(fitted.moduleWidth < 0.375 && fitted.moduleWidth >= CODE128_MIN_MODULE_MM && fitted.width <= 65 + 1e-9);
  assert.throws(() => drawCode128({ setFillColor() {}, rect() {} }, 'EXP-2YE537-1-2', { x: 0, y: 0, height: 10, maxWidth: 55 }), RangeError);
  assert.equal(CODE128.STOP, 106);
});
