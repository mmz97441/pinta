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

// The phone format of the database (guard_client_required_fields): digits, ASCII spaces, dots, dashes,
// parentheses and a leading +, with at least 9 digits. A no-break space or a + inside the number is refused there.
const PHONE_FORMAT = /^\+?[0-9 .()-]+$/;
export const PHONE_FORMAT_MESSAGE = 'Indiquez un numéro d’au moins 9 chiffres (espaces, points, tirets, parenthèses et + initial acceptés).';
/** A phone number the database accepts, once trimmed. */
export const validPhone = value => PHONE_FORMAT.test(String(value ?? '').trim()) && digitCount(value) >= 9;
/** The dialable form of a number for a tel: link (digits and a leading +), '' when it is not a valid phone. */
export const dialablePhone = value => validPhone(value) ? String(value).trim().replace(/(?!^\+)[^\d]/g, '') : '';

/**
 * The phone errors of a form holding a mobile (`tel`) and a landline (`telFixe`): one number is required,
 * and each number entered must be valid. The missing requirement is reported under the mobile.
 */
export function phoneErrors(values, { missing = missingMessage('tel'), invalid = PHONE_FORMAT_MESSAGE } = {}) {
  const errors = {};
  for (const key of ['tel', 'telFixe']) if (filled(values?.[key]) && !validPhone(values[key])) errors[key] = invalid;
  if (!filled(values?.tel) && !filled(values?.telFixe)) errors.tel = missing;
  return errors;
}

/** The served destination of a postal code: five digits whose first three are a destination. */
export function servedDestination(cp) {
  const value = String(cp ?? '').replace(/\s/g, '');
  return /^\d{5}$/.test(value) ? DESTINATIONS[value.slice(0, 3)] || null : null;
}

/** Why a filled required value is refused, or '' when it is valid. */
export function requiredFieldFormatError(key, value) {
  const text = String(value ?? '').trim();
  if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'Indiquez un email valide.';
  // The format of the database: spaces, dots, dashes, parentheses and a leading + around at least 9 digits.
  if (['tel', 'telFixe'].includes(key) && !validPhone(text)) return PHONE_FORMAT_MESSAGE;
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

/** « le prénom et l’adresse »: the required fields named in a sentence. */
export const requiredFieldsPhrase = keys => frenchList(keys.map(key => `${FIELD[key].subject.charAt(0).toLocaleLowerCase('fr')}${FIELD[key].subject.slice(1)}`));

// The columns a refusal of the database names (HINT client_required_fields:<columns>), as form fields.
const REFUSED_COLUMNS = { prenom: 'prenom', nom: 'nom', email: 'email', tel: 'tel', tel_fixe: 'telFixe', adresse: 'adresseLigne1', adresse_ligne1: 'adresseLigne1', cp: 'cp', ville: 'ville' };
const REFUSED_WORDS = [['prenom', /pr[ée]nom/], ['nom', /(^|[^a-zà-ÿ])nom([^a-zà-ÿ@]|$)/], ['email', /e-?mail|courriel/], ['tel', /t[ée]l[ée]phone/], ['adresseLigne1', /adresse/], ['cp', /code postal/], ['ville', /ville/]];
/**
 * The form fields a refusal of the client guard (SQLSTATE 23514) names, in form order: from its HINT
 * « client_required_fields:prenom,tel », otherwise from the words of its French message. [] when none is named.
 */
export function refusedClientFields(error) {
  const hint = /client_required_fields:([\w,]+)/.exec(String(error?.hint ?? ''));
  if (hint) return [...new Set(hint[1].split(',').map(column => REFUSED_COLUMNS[column]).filter(Boolean))];
  // An example address (« nom@domaine.fr ») never names a field.
  const text = String(error?.message ?? '').toLocaleLowerCase('fr').replace(/\S+@\S+/g, ' ');
  return REFUSED_WORDS.filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
}

/**
 * The errors of a new client's required fields, by form key, with the phone
 * rule of every creation path (staff form, reception, import): one number is
 * required, and each number entered (mobile `tel`, landline `telFixe`) must be
 * valid, so no client is created with a number that would then block the
 * saving of their own profile.
 */
export function newClientFieldErrors(values) {
  const errors = newClientErrors(values);
  delete errors.tel;
  return { ...errors, ...phoneErrors(values) };
}

/**
 * Why an imported row is refused: « téléphone manquant », « prénom et ville
 * manquants », « email invalide », « téléphone fixe invalide ». '' when the row
 * can be imported. Each number given (mobile, landline) must be valid.
 */
export function importRowIssue(row) {
  const missing = REQUIRED_CLIENT_FIELDS.filter(({ key }) => !filled(requiredValue(row, key)));
  const invalid = REQUIRED_CLIENT_FIELDS.filter(({ key }) => key !== 'tel' && filled(requiredValue(row, key)) && requiredFieldFormatError(key, requiredValue(row, key)));
  const parts = [];
  if (missing.length) {
    const feminine = missing.every(field => field.feminine);
    parts.push(`${frenchList(missing.map(field => field.noun))} ${missing.length > 1 ? (feminine ? 'manquantes' : 'manquants') : (feminine ? 'manquante' : 'manquant')}`);
  }
  const phones = phoneErrors(row);
  // Five digits outside the served destinations read « non desservi », any other format « invalide ».
  for (const field of REQUIRED_CLIENT_FIELDS) {
    if (field.key === 'tel') {
      if (filled(row?.tel) && phones.tel) parts.push('téléphone invalide');
      if (phones.telFixe) parts.push('téléphone fixe invalide');
    } else if (invalid.includes(field)) parts.push(field.key === 'cp' && /^\d{5}$/.test(String(row.cp).replace(/\s/g, '')) ? 'code postal non desservi' : `${field.noun} invalide`);
  }
  return parts.join(', ');
}
