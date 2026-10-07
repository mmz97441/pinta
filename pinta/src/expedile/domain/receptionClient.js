import { missingMessage } from './clientRequirements.js';

// The quick new-client form of the reception page (ColisModal), in the order of
// its fields: the company name (pro), the identity, the phones, the email, then
// the address. As in every creation path (newClientFieldErrors), one number is
// required (reported under the mobile, `tel`) and each number entered, mobile or
// landline (`telFixe`), is checked under its own field.
const ORDER = ['raisonSociale', 'nom', 'prenom', 'tel', 'telFixe', 'email', 'adresseLigne1', 'cp', 'ville'];
const NOUNS = {
  raisonSociale: 'la raison sociale', nom: 'le nom', prenom: 'le prénom', tel: 'le téléphone', telFixe: 'le téléphone fixe', email: 'l’email',
  adresseLigne1: 'l’adresse', cp: 'le code postal', ville: 'la ville',
};
const frenchList = items => items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}` : items.join('');

/** The form field to bring into view first: the first refused one, in form order. */
export function firstNewClientField(errors = {}) {
  return ORDER.find(field => errors[field]) || null;
}

/**
 * The line next to the reception actions when the new client is refused:
 * « Fiche client incomplète : il manque le téléphone et l’adresse. »,
 * « Fiche client à corriger : le téléphone fixe est à corriger. », or both. ''
 * when the client can be created.
 */
export function newClientAlert(errors = {}) {
  const keys = ORDER.filter(key => errors[key]);
  if (!keys.length) return '';
  const missing = keys.filter(key => key === 'raisonSociale' || (key !== 'telFixe' && errors[key] === missingMessage(key)));
  const invalid = keys.filter(key => !missing.includes(key));
  const toFix = invalid.length ? `${frenchList(invalid.map(key => NOUNS[key]))} ${invalid.length > 1 ? 'sont' : 'est'} à corriger` : '';
  if (!missing.length) return `Fiche client à corriger : ${toFix}.`;
  return `Fiche client incomplète : il manque ${frenchList(missing.map(key => NOUNS[key]))}${toFix ? ` ; ${toFix}` : ''}.`;
}
