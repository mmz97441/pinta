// The destination taxes of a quote, in the « prix » regime decided by the direction on 10 October 2026
// (docs/facturation-conformite.md T16, D3, I7, I16; docs/facturation-evoliz-conception.md § 6.2, point 1).
//
// The quote engine (domain/quote.js, save_quote) still computes an octroi de mer, an OMR and a « TVA »
// on transport + OM + OMR. These amounts are an ESTIMATE of the import taxes due at destination, paid on
// arrival and included in Expedîle's price: a client-facing quote document or message words them with
// the functions below, never as a tax collected by Expedîle France (no « TVA (8,5 %) » line, no « Octroi
// de mer » line of the price). The amounts are those of the saved quote, read as they are: nothing here
// recalculates them. A professional quote has no taxes.
//
// The message wording ({{estimation_taxes}}) has an Edge copy, supabase/functions/_shared/importTaxes.ts,
// kept identical by tests/import-taxes.test.mjs.

/** « à La Réunion » (where the taxes are paid) and « de La Réunion » (whose taxes they are). */
export const IMPORT_TAX_PLACES = Object.freeze({
  974: Object.freeze({ at: 'à La Réunion', of: 'de La Réunion' }),
  976: Object.freeze({ at: 'à Mayotte', of: 'de Mayotte' }),
  971: Object.freeze({ at: 'en Guadeloupe', of: 'de la Guadeloupe' }),
  972: Object.freeze({ at: 'en Martinique', of: 'de la Martinique' }),
});
// A destination known only by its name (an old dossier); an unknown one is never given a wrong article.
const CODES_BY_NAME = Object.freeze({ 'la réunion': '974', réunion: '974', mayotte: '976', guadeloupe: '971', martinique: '972' });
const ELSEWHERE = Object.freeze({ at: 'à destination', of: 'à destination' });

/** The wording of the destination, from its code, else its name; « à destination » when unknown. */
export function importTaxPlace(destination) {
  const code = String(destination?.code ?? '').trim() || CODES_BY_NAME[String(destination?.nom || destination?.label || '').trim().toLowerCase()];
  return IMPORT_TAX_PLACES[code] || ELSEWHERE;
}

/** What the estimate is: paid on arrival, part of the price (never a tax added by Expedîle). */
export const IMPORT_TAX_NOTE = 'payées à l’arrivée, comprises dans le prix';
export const importTaxHeading = destination => `Estimation des taxes à l’importation ${importTaxPlace(destination).at}`;
/** « Estimation des taxes à l’importation à La Réunion (payées à l’arrivée, comprises dans le prix) ». */
export const importTaxLabel = destination => `${importTaxHeading(destination)} (${IMPORT_TAX_NOTE})`;

// The three amounts of the engine, in the order of the quote, with the name of the tax they estimate.
const PARTS = Object.freeze([['om', 'octroi de mer'], ['omr', 'octroi de mer régional'], ['tva', 'TVA à l’importation']]);
const cents = value => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? Math.round(number * 100) : 0;
};

/**
 * The estimate of a quote's import taxes: { heading, note, label, place, total, lines }, each line
 * { key, label: « dont estimation octroi de mer de La Réunion », amount }, only for a positive amount
 * (never a « 0,00 € » line). `lines` is empty when no tax is estimated. Null for a professional quote.
 */
export function importTaxEstimate(amounts, destination, { professional = false } = {}) {
  if (professional) return null;
  const place = importTaxPlace(destination);
  const lines = PARTS.map(([key, name]) => ({ key, name, value: cents(amounts?.[key]) }))
    .filter(line => line.value > 0)
    .map(({ key, name, value }) => ({ key, label: `dont estimation ${name} ${place.of}`, amount: value / 100 }));
  const total = lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100;
  return { heading: importTaxHeading(destination), note: IMPORT_TAX_NOTE, label: importTaxLabel(destination), place, total, lines };
}

/**
 * The {{estimation_taxes}} block of a message, in plain text, in both versions: the estimate and its
 * detail when the quote has one, otherwise the sentence that says why there is none (quote still to
 * calculate, no tax estimated). Empty for a professional (no taxes). `money` formats an amount as the
 * message renderers do (« 52.56 € »).
 */
export function importTaxMessage({ om, omr, tva, total } = {}, destination, { professional = false, money }) {
  if (professional) return '';
  if (!(Number(total) > 0)) return 'Estimation des taxes à l’importation : à calculer avec le devis.';
  const estimate = importTaxEstimate({ om, omr, tva }, destination);
  if (!estimate.lines.length) return `Aucune taxe à l’importation n’est estimée ${estimate.place.at} pour ce devis.`;
  return [`${estimate.label} : ${money(estimate.total)}`, ...estimate.lines.map(line => `• ${line.label} : ${money(line.amount)}`)].join('\n');
}

// ── Saved message templates written before 10 October 2026 ─────────────────
// Their lines « 📊 TVA ({{taux_tva}}) : {{tva}} », « OM : {{om}} », « 🏛️ Taxes : {{taxes}} » present these
// amounts as taxes of the price. They keep working as saved (never rewritten): Paramètres › Modèles de
// messages names them, with these lines, so that the team replaces them with {{estimation_taxes}}.
export const LEGACY_TAX_VARIABLES = Object.freeze(['om', 'omr', 'taxes', 'tva', 'taux_tva']);
const LEGACY_VARIABLE = new RegExp(`\\{\\{(?:${LEGACY_TAX_VARIABLES.join('|')})\\}\\}`);
// A line whose label (before « : ») names the tax itself: « TVA », « OM », « OMR », « Octroi de mer », « Taxes ».
const TAX_LABEL = /^(?:dont\s+)?(?:TVA|OMR?|Octroi de mer|Taxes)(?![\p{L}\d])/iu;
const ESTIMATE_WORDING = /estim|importation/i;

/** The lines of a message body that still present these amounts as taxes of the price ([] when none). */
export function legacyTaxLines(body) {
  return String(body ?? '').split('\n').map(line => line.trim()).filter(Boolean).filter(line => {
    if (/\bTVA\s*\(/i.test(line)) return true;
    if (ESTIMATE_WORDING.test(line)) return false;
    const label = line.split(/\s:|:\s|\.{3,}/)[0].replace(/^[^\p{L}{]+/u, '');
    return LEGACY_VARIABLE.test(line) || TAX_LABEL.test(label);
  });
}

/** The saved templates ({ '<key>_<canal>': body }) whose body still has such lines, in the given key order:
 *  [{ bodyKey, key, canal, lines }]. Only saved bodies count: the defaults use {{estimation_taxes}}. */
export function savedTemplatesWithLegacyTaxes(saved, keys = []) {
  const order = key => { const index = keys.indexOf(key); return index < 0 ? keys.length : index; };
  return Object.entries(saved || {}).map(([bodyKey, body]) => {
    const match = /^(.+)_(telegram|email)$/.exec(bodyKey);
    return match ? { bodyKey, key: match[1], canal: match[2], lines: legacyTaxLines(body) } : null;
  }).filter(item => item && item.lines.length && (!keys.length || keys.includes(item.key)))
    .sort((a, b) => (order(a.key) - order(b.key)) || (a.canal === b.canal ? 0 : a.canal === 'telegram' ? -1 : 1));
}
