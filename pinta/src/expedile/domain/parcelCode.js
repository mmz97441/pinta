// The code printed on each outgoing parcel's label, as a QR code and a barcode:
// the dossier reference, the parcel's position and the number of parcels of the
// dossier, « EXP-2YE537-1-2 ». The count makes a label printed for an older
// preparation detectable: the dossier then has another number of parcels.

const REFERENCE = '(EXP-(?:[A-Z0-9]{6}|\\d{4,}))';
// The code, the label's readable line (« EXP-2YE537 · Colis 1/2 ») or a bare reference.
const CODE = new RegExp(`^${REFERENCE}(?:\\s*[-/·.\\s]\\s*(?:COLIS\\s*)?(\\d{1,3})\\s*[-/·.\\s]\\s*(\\d{1,3}))?$`);
const DASHES = /[‐-―−﹘﹣－]/g;
// A scanner set to an English (QWERTY) keyboard on a French (AZERTY) device types
// « EXP)éYE("è)&)é » for « EXP-2YE537-1-2 »: the keys are right, their characters are
// not. These are the characters it produces, mapped back to the code's own.
const AZERTY_FROM_QWERTY = { ')': '-', '&': '1', 'é': '2', 'É': '2', '"': '3', "'": '4', '(': '5', '-': '6', 'è': '7', 'È': '7', '_': '8', 'ç': '9', 'Ç': '9', 'à': '0', 'À': '0', Q: 'A', A: 'Q', W: 'Z', Z: 'W', '?': 'M' };

/** « EXP-2YE537-1-2 »: what the QR code and the barcode hold. */
export function formatParcelCode(ref, index, count) {
  return `${ref}-${index}-${count}`;
}

/** « EXP-2YE537 · Colis 1/2 »: the line printed under the barcode. */
export function parcelCodeText(ref, index, count) {
  return `${ref} · Colis ${index}/${count}`;
}

const clean = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

function read(text) {
  const match = CODE.exec(text.toUpperCase().replace(DASHES, '-'));
  if (!match) return null;
  const [, ref, index, count] = match;
  if (index === undefined) return { ref, index: null, count: null };
  const position = Number(index), total = Number(count);
  return position >= 1 && total >= 1 && position <= total ? { ref, index: position, count: total } : null;
}

/**
 * Reads a scanned or typed code:
 * - `{ ok: true, ref, index, count, layoutCorrected }` for a parcel code;
 * - `{ ok: true, ref, index: null, count: null, layoutCorrected }` for a bare reference;
 * - `{ ok: false, reason: 'empty' | 'unreadable' }` otherwise.
 * `layoutCorrected`: the text came from a scanner set to an English keyboard and was
 * restored; the screen can suggest switching the scanner to French (AZERTY).
 */
export function parseParcelCode(input) {
  const text = clean(input);
  if (!text) return { ok: false, reason: 'empty' };
  const direct = read(text);
  if (direct) return { ok: true, ...direct, layoutCorrected: false };
  if (/^EXP\)/i.test(text)) {
    const restored = Array.from(text, char => AZERTY_FROM_QWERTY[char] || char).join('');
    const corrected = read(restored);
    if (corrected) return { ok: true, ...corrected, layoutCorrected: true };
  }
  return { ok: false, reason: 'unreadable' };
}
