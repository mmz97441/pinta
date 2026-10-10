import { CONSIGNEE_KEYS, EXPORTER_FIELDS, PARTY_FIELDS, missingPartyFields, normalizeParty, partyFilled, validateInvoiceIdentity } from './invoiceIdentity.js';

/** app_settings.business as edited in Paramètres › Stockage et rappels and
 * Paramètres › Facture commerciale.
 *
 * Stockage et rappels edits three values, Facture commerciale the identity of
 * the commercial invoice (factureCommerciale). The stored object holds other
 * keys (time zone, reminder cadences, activation dates…): a save always starts
 * from the stored object and never drops one of them. */
export const BUSINESS_FIELDS = ['fraisStockage', 'stockageGratuit', 'diviseurVolumetrique'];

// save_admin_setting still requires both reminder cadences (« J+2, J+5 »),
// although no screen or worker reads them any more. Stored values are kept as
// they are; an absent one receives the former default so a save stays valid.
export const REMINDER_DEFAULTS = Object.freeze({ relancesFeuVert: 'J+2, J+5', relancesPaiement: 'J+2, J+5' });

const plainObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** The editable values of a stored object, as form strings. */
export function businessDraftValues(stored) {
  const source = plainObject(stored);
  return Object.fromEntries(BUSINESS_FIELDS.map(key => [key, source[key] == null ? '' : String(source[key])]));
}

const MESSAGES = {
  fraisStockage: 'Indiquez un montant positif ou nul, par exemple 1,50.',
  stockageGratuit: 'Indiquez un nombre entier de jours, positif ou nul.',
  diviseurVolumetrique: 'Indiquez un diviseur supérieur à zéro, par exemple 5000.',
};

/** Per-field validation: { values } with numbers, or { errors } keyed by field. */
export function validateBusinessValues(input) {
  const values = {}, errors = {};
  for (const key of BUSINESS_FIELDS) {
    const raw = String(plainObject(input)[key] ?? '').trim().replace(',', '.');
    const number = raw === '' ? NaN : Number(raw);
    const valid = Number.isFinite(number) && number >= 0
      && (key !== 'diviseurVolumetrique' || number > 0)
      && (key !== 'stockageGratuit' || Number.isInteger(number));
    if (valid) values[key] = number; else errors[key] = MESSAGES[key];
  }
  return { values, errors };
}

/** The object to save: every stored key, then the edited values. */
export function businessSettingsPayload(stored, values) {
  const payload = { ...plainObject(stored) };
  for (const [key, fallback] of Object.entries(REMINDER_DEFAULTS)) {
    if (payload[key] == null || payload[key] === '') payload[key] = fallback;
  }
  for (const key of BUSINESS_FIELDS) if (key in plainObject(values)) payload[key] = values[key];
  return payload;
}

// Stored JSON compared whatever the order of its keys (jsonb returns them in its own order).
const canonical = value => JSON.stringify(value ?? null, (key, item) => (item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item));
/** Two stored values are the same, whatever the order of their keys. */
export const sameStoredValue = (a, b) => canonical(a) === canonical(b);

/** Both objects hold the same three values of Stockage et rappels, as its form shows them. */
export const sameBusinessValues = (a, b) => sameStoredValue(businessDraftValues(a), businessDraftValues(b));

// ── Paramètres › Facture commerciale ───────────────────────────────────────
// The identity printed at the top of the commercial invoice (invoiceIdentity.js),
// stored under business.factureCommerciale.

/** The form's values: every party and field as a string, as typed (spaces kept until the save tidies them). */
export function invoiceIdentityDraftValues(input) {
  const source = plainObject(input);
  const party = (value, fields = PARTY_FIELDS) => Object.fromEntries(fields.map(key => [key, String(plainObject(value)[key] ?? '')]));
  return { expediteur: party(source.expediteur, EXPORTER_FIELDS), destinataires: Object.fromEntries(CONSIGNEE_KEYS.map(key => [key, party(plainObject(source.destinataires)[key])])) };
}

/** What a party of the form amounts to: 'set' (complete), 'incomplete' (filled, a required field
 *  missing), otherwise 'default' (an empty destination uses the filled default consignee, as
 *  consigneeFor does) or 'none'. */
export function invoicePartyState(party, { fallback = null } = {}) {
  const value = normalizeParty(party);
  if (partyFilled(value)) return missingPartyFields(value).length ? 'incomplete' : 'set';
  return fallback && partyFilled(normalizeParty(fallback)) ? 'default' : 'none';
}

/** The state of each consignee row of the form, keyed as CONSIGNEE_KEYS: a destination as
 *  invoicePartyState with the default consignee as fallback; the default one as its own state,
 *  except that, not set, it is 'optional' (no warning) only once every destination has a consignee
 *  of its own — while one relies on it, its invoice is blocked and the default row says so ('none'). */
export function invoiceConsigneeStates(destinataires) {
  const consignees = plainObject(destinataires);
  const states = Object.fromEntries(CONSIGNEE_KEYS.filter(key => key !== 'defaut').map(key => [key, invoicePartyState(consignees[key], { fallback: consignees.defaut })]));
  const own = invoicePartyState(consignees.defaut);
  const relied = Object.values(states).some(state => state === 'none');
  return { defaut: own === 'none' && !relied ? 'optional' : own, ...states };
}

/** The form's fields in reading order (exporter, default consignee, then each destination),
 *  keyed as validateInvoiceIdentity keys its errors: the first wrong one takes the focus. */
export const INVOICE_IDENTITY_FIELD_ORDER = Object.freeze([
  ...EXPORTER_FIELDS.map(field => `expediteur.${field}`),
  ...CONSIGNEE_KEYS.flatMap(key => PARTY_FIELDS.map(field => `destinataires.${key}.${field}`)),
]);

// save_admin_setting validates the whole object, storage values included: they come from Stockage et rappels.
export const INVOICE_IDENTITY_NEEDS_BUSINESS = 'Les règles de « Stockage et rappels » sont incomplètes : enregistrez-les d’abord, car les réglages de la facture commerciale sont enregistrés avec elles.';

/**
 * The object to save from Paramètres › Facture commerciale: { payload, errors, blocked }.
 * `payload` is every stored key (reminder cadences completed as businessSettingsPayload does)
 * with factureCommerciale replaced by the validated form — its other keys and the consignees
 * of destinations the form does not show are kept. `errors` (keyed as the form's fields) or
 * `blocked` (the stored storage values are incomplete) leave nothing to send (payload null).
 */
export function invoiceIdentitySettingsPayload(stored, form) {
  const { value, errors } = validateInvoiceIdentity(form);
  if (Object.keys(errors).length) return { payload: null, errors, blocked: null };
  if (Object.keys(validateBusinessValues(businessDraftValues(stored)).errors).length) return { payload: null, errors: {}, blocked: INVOICE_IDENTITY_NEEDS_BUSINESS };
  const previous = plainObject(plainObject(stored).factureCommerciale);
  const others = Object.fromEntries(Object.entries(plainObject(previous.destinataires)).filter(([key]) => !CONSIGNEE_KEYS.includes(key)));
  // A party keeps the stored keys this form does not show (a field added later, by another screen or version).
  const kept = (before, party) => ({ ...plainObject(before), ...party });
  const destinataires = Object.fromEntries(Object.entries(value.destinataires).map(([key, party]) => [key, kept(plainObject(previous.destinataires)[key], party)]));
  const factureCommerciale = { ...previous, ...value, expediteur: kept(previous.expediteur, value.expediteur), destinataires: { ...others, ...destinataires } };
  return { payload: { ...businessSettingsPayload(stored, {}), factureCommerciale }, errors: {}, blocked: null };
}
