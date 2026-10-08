// Who sends and who receives a departure, as the commercial invoice prints them at its top
// (decided with the user on 2026-10-08): the exporter is Expedîle, with its address and
// identifiers set in Paramètres; the consignee is set per destination (La Réunion, Mayotte,
// Guadeloupe, Martinique), falling back to a default one. Stored in
// app_settings.business.factureCommerciale; the labels print the same exporter as sender.

export const PARTY_FIELDS = Object.freeze(['nom', 'adresse', 'complement', 'codePostal', 'ville', 'pays', 'telephone', 'email', 'siret', 'eori', 'tva']);
export const REQUIRED_PARTY_FIELDS = Object.freeze(['nom', 'adresse', 'codePostal', 'ville', 'pays']);
export const PARTY_LABELS = Object.freeze({
  nom: 'Nom ou raison sociale', adresse: 'Adresse', complement: 'Complément d’adresse', codePostal: 'Code postal', ville: 'Ville', pays: 'Pays',
  telephone: 'Téléphone', email: 'Email', siret: 'SIRET', eori: 'Numéro EORI', tva: 'Numéro de TVA',
});
export const DEFAULT_EXPORTER_NAME = 'Expedîle';
/** 'defaut' first, then the destinations in the order of the app (constants DESTINATIONS). */
export const CONSIGNEE_KEYS = Object.freeze(['defaut', '974', '976', '971', '972']);

const plainObject = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** One party with every field as a trimmed string. */
export function normalizeParty(value) {
  const source = plainObject(value);
  return Object.fromEntries(PARTY_FIELDS.map(key => [key, clean(source[key])]));
}

/** At least one field filled: an empty consignee of a destination falls back to the default one. */
export function partyFilled(party) {
  return Boolean(party) && PARTY_FIELDS.some(key => party[key]);
}

/** The stored identity, normalised: { expediteur, destinataires: { defaut, '974', '976', '971', '972' } }.
 * The exporter's name defaults to Expedîle. */
export function invoiceIdentity(business) {
  const stored = plainObject(plainObject(business).factureCommerciale);
  const expediteur = normalizeParty(stored.expediteur);
  if (!expediteur.nom) expediteur.nom = DEFAULT_EXPORTER_NAME;
  const consignees = plainObject(stored.destinataires);
  const destinataires = Object.fromEntries(CONSIGNEE_KEYS.map(key => [key, normalizeParty(consignees[key])]));
  return { expediteur, destinataires };
}

/** The consignee of a destination: its own when filled, otherwise the default one; null when neither is set. */
export function consigneeFor(identity, destinationCode) {
  const own = identity?.destinataires?.[String(destinationCode ?? '')];
  if (partyFilled(own)) return { ...own, source: 'destination' };
  const fallback = identity?.destinataires?.defaut;
  return partyFilled(fallback) ? { ...fallback, source: 'defaut' } : null;
}

/** The required fields a party lacks, as their French labels ([] when complete). */
export function missingPartyFields(party) {
  return REQUIRED_PARTY_FIELDS.filter(key => !party?.[key]).map(key => PARTY_LABELS[key].toLowerCase());
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIRET = /^\d{14}$/;
const EORI = /^[A-Z]{2}[A-Z0-9]{1,15}$/;

function partyErrors(party, prefix, { required }) {
  const errors = {};
  if (required || partyFilled(party)) {
    for (const key of REQUIRED_PARTY_FIELDS) if (!party[key]) errors[`${prefix}.${key}`] = `Indiquez ${key === 'adresse' ? 'l’adresse' : key === 'nom' ? 'le nom ou la raison sociale' : key === 'codePostal' ? 'le code postal' : key === 'ville' ? 'la ville' : 'le pays'}.`;
  }
  if (party.email && !EMAIL.test(party.email)) errors[`${prefix}.email`] = 'Indiquez une adresse email valide, par exemple contact@exemple.fr.';
  if (party.siret && !SIRET.test(party.siret.replace(/\s/g, ''))) errors[`${prefix}.siret`] = 'Un SIRET compte 14 chiffres.';
  if (party.eori && !EORI.test(party.eori.replace(/\s/g, '').toUpperCase())) errors[`${prefix}.eori`] = 'Un numéro EORI commence par deux lettres (FR…) suivies de 15 caractères au plus.';
  return errors;
}

/**
 * Validates the form of Paramètres › Facture commerciale: { value, errors }. The exporter must
 * be complete; a consignee is either empty (the default one is used) or complete. `value` is
 * what to store under business.factureCommerciale (SIRET and EORI without spaces, EORI upper case).
 */
export function validateInvoiceIdentity(input) {
  const source = plainObject(input);
  const expediteur = normalizeParty(source.expediteur);
  if (!expediteur.nom) expediteur.nom = DEFAULT_EXPORTER_NAME;
  const destinataires = Object.fromEntries(CONSIGNEE_KEYS.map(key => [key, normalizeParty(plainObject(source.destinataires)[key])]));
  const errors = { ...partyErrors(expediteur, 'expediteur', { required: true }) };
  for (const key of CONSIGNEE_KEYS) Object.assign(errors, partyErrors(destinataires[key], `destinataires.${key}`, { required: false }));
  const tidy = party => ({ ...party, siret: party.siret.replace(/\s/g, ''), eori: party.eori.replace(/\s/g, '').toUpperCase() });
  const value = { expediteur: tidy(expediteur), destinataires: Object.fromEntries(CONSIGNEE_KEYS.filter(key => partyFilled(destinataires[key])).map(key => [key, tidy(destinataires[key])])) };
  return { value, errors };
}

/** The lines a document prints for a party: name, address, postcode and town, country, contacts, identifiers. */
export function partyLines(party) {
  if (!party) return [];
  return [
    party.nom,
    party.adresse,
    party.complement,
    [party.codePostal, party.ville].filter(Boolean).join(' '),
    party.pays,
    [party.telephone && `Tél. ${party.telephone}`, party.email].filter(Boolean).join(' · '),
    [party.siret && `SIRET ${party.siret}`, party.eori && `EORI ${party.eori}`, party.tva && `TVA ${party.tva}`].filter(Boolean).join(' · '),
  ].filter(Boolean);
}
