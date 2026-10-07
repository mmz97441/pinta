import { DESTINATIONS } from '../constants/index.js';

// The information required for a client account (decision of 7 October 2026):
// the creation form, the import and the database (trigger on clients, SQLSTATE
// 23514) refuse a client without it. An older record that still misses some of
// it can be completed step by step, but a filled value can never be emptied.
// `param` is the value of `/clients/:id?completer=` that opens the field.
export const REQUIRED_CLIENT_FIELDS = [
  { key: 'prenom', param: 'prenom', noun: 'prénom', subject: 'Le prénom' },
  { key: 'nom', param: 'nom', noun: 'nom', subject: 'Le nom' },
  { key: 'email', param: 'email', noun: 'email', subject: 'L’email' },
  { key: 'tel', param: 'telephone', noun: 'téléphone', subject: 'Le téléphone' },
  { key: 'adresseLigne1', param: 'adresse', noun: 'adresse', subject: 'L’adresse', feminine: true },
  { key: 'cp', param: 'cp', noun: 'code postal', subject: 'Le code postal' },
  { key: 'ville', param: 'ville', noun: 'ville', subject: 'La ville', feminine: true },
];
export const REQUIRED_CLIENT_KEYS = REQUIRED_CLIENT_FIELDS.map(field => field.key);
/** `completer` value → form field: prenom, nom, email, telephone, adresse, cp, ville. */
export const COMPLETION_FIELDS = Object.fromEntries(REQUIRED_CLIENT_FIELDS.map(field => [field.param, field.key]));
const FIELD = Object.fromEntries(REQUIRED_CLIENT_FIELDS.map(field => [field.key, field]));
const SERVED = Object.values(DESTINATIONS).map(destination => `${destination.nom} (${destination.code})`);

export const filled = value => String(value ?? '').trim() !== '';
/** « Téléphone » is the mobile, else the landline: either one satisfies the requirement (as in the database rule). */
export const phoneOf = values => filled(values?.tel) ? values.tel : values?.telFixe ?? '';
const requiredValue = (values, key) => key === 'tel' ? phoneOf(values) : values?.[key];
const digitCount = value => (String(value ?? '').match(/\d/g) || []).length;
const frenchList = items => items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}` : items.join('');

/** The served destination of a postal code: five digits whose first three are a destination. */
export function servedDestination(cp) {
  const value = String(cp ?? '').replace(/\s/g, '');
  return /^\d{5}$/.test(value) ? DESTINATIONS[value.slice(0, 3)] || null : null;
}

/** Why a filled required value is refused, or '' when it is valid. */
export function requiredFieldFormatError(key, value) {
  const text = String(value ?? '').trim();
  if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'Indiquez un email valide.';
  // Spaces, dots, dashes and a leading + are accepted around at least 9 digits.
  if (key === 'tel' && (!/^\+?[\d\s.-]+$/.test(text) || digitCount(text) < 9)) return 'Indiquez un numéro d’au moins 9 chiffres (espaces, points, tirets et + initial acceptés).';
  if (key === 'cp' && !servedDestination(text)) return /^\d{5}$/.test(text.replace(/\s/g, ''))
    ? `Ce code postal n’est pas une destination desservie : ${frenchList(SERVED)}.`
    : 'Indiquez un code postal à 5 chiffres.';
  return '';
}

/** A missing field: « Le prénom est obligatoire. » */
export const missingMessage = key => `${FIELD[key].subject} est obligatoire.`;
/** A filled field being emptied: « L’adresse est obligatoire : elle ne peut pas être effacée. » */
export const blankingMessage = key => `${FIELD[key].subject} est obligatoire : ${FIELD[key].feminine ? 'elle ne peut pas être effacée' : 'il ne peut pas être effacé'}.`;

/** The errors of a new client's required fields, by form key (missing or invalid). */
export function newClientErrors(values) {
  const errors = {};
  for (const { key } of REQUIRED_CLIENT_FIELDS) {
    const value = requiredValue(values, key);
    const error = filled(value) ? requiredFieldFormatError(key, value) : missingMessage(key);
    if (error) errors[key] = error;
  }
  return errors;
}

/** The value of a required field on a loaded client (the address may still be in its former column). */
export const clientRequiredValue = (client, key) => key === 'adresseLigne1' ? client?.adresseLigne1 || client?.adresse || '' : key === 'tel' ? phoneOf(client) : client?.[key] ?? '';

/** The required fields an existing client still misses (older records), in form order. */
export function missingRequiredFields(client) {
  return REQUIRED_CLIENT_KEYS.filter(key => !filled(clientRequiredValue(client, key)));
}

/**
 * Why an imported row is refused: « téléphone manquant », « prénom et ville
 * manquants », « email invalide ». '' when the row can be imported.
 */
export function importRowIssue(row) {
  const missing = REQUIRED_CLIENT_FIELDS.filter(({ key }) => !filled(requiredValue(row, key)));
  const invalid = REQUIRED_CLIENT_FIELDS.filter(({ key }) => filled(requiredValue(row, key)) && requiredFieldFormatError(key, requiredValue(row, key)));
  const parts = [];
  if (missing.length) {
    const feminine = missing.every(field => field.feminine);
    parts.push(`${frenchList(missing.map(field => field.noun))} ${missing.length > 1 ? (feminine ? 'manquantes' : 'manquants') : (feminine ? 'manquante' : 'manquant')}`);
  }
  // Five digits outside the served destinations read « non desservi », any other format « invalide ».
  for (const field of invalid) parts.push(field.key === 'cp' && /^\d{5}$/.test(String(row.cp).replace(/\s/g, '')) ? 'code postal non desservi' : `${field.noun} invalide`);
  return parts.join(', ');
}
