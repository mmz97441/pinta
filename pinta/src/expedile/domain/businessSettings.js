/** app_settings.business as edited in Paramètres › Stockage et rappels.
 *
 * Only three values are editable. The stored object holds other keys (time
 * zone, reminder cadences, activation dates…): a save always starts from the
 * stored object and never drops one of them. */
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
