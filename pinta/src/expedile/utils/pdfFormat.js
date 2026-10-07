// Text and French numbers of the PDF documents (quote, commercial invoice).
//
// The standard PDF fonts (Helvetica, WinAnsiEncoding) cannot draw a character outside this set: jsPDF then writes
// the whole line as unreadable spaced glyphs (« Paris → DOM-TOM » in the footer). Every text is mapped onto it first.
const WIN_ANSI_EXTRA = new Set([0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013, 0x2014,
  0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122]);
const encodable = code => code === 10 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(code);
const SUBSTITUTES = { '\r': '', '\t': ' ', '\u2192': '\u2013', '\u2190': '\u2013', '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2212': '-', '\u2015': '\u2014' };

/** Text the standard font can draw: French narrow spaces become no-break spaces, accents outside the set are dropped
 *  from their letter, pictographs disappear, anything else becomes « ? » without damaging the rest of the line. */
export function pdfText(value) {
  return Array.from(String(value ?? '').normalize('NFC')).map((char) => {
    const code = char.codePointAt(0);
    if (encodable(code)) return char;
    if (char in SUBSTITUTES) return SUBSTITUTES[char];
    if (/\s/u.test(char)) return '\u00a0';
    const plain = char.normalize('NFKD').replace(/\p{M}/gu, '');
    if (plain && Array.from(plain).every(part => encodable(part.codePointAt(0)))) return plain;
    return /\p{Extended_Pictographic}|\p{M}|[\u200b-\u200d\ufe0e\ufe0f]/u.test(char) ? '' : '?';
  }).join('');
}

// French formats: « 1 234,50 € », « 6,2 kg », « 8,5 % » (no-break space before the unit).
const MONEY = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** « 1 234,50 € »; a missing amount reads « 0,00 € » (never « -0,00 € »). */
export const pdfMoney = value => pdfText(`${MONEY.format(Number(value) || 0)}\u00a0€`);
/** « 6,2 », « 1 250 »: at most two decimals. */
export const pdfNumber = value => pdfText(NUMBER.format(Number(value)));
/** « 6,2 kg », « 8,5 % ». */
export const pdfUnit = (value, name) => pdfText(`${NUMBER.format(Number(value))}\u00a0${name}`);
