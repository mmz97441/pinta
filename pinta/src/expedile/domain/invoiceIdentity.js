// Who sends and who receives a departure, as the commercial invoice prints them at its top
// (decided with the user on 2026-10-08): the exporter is Expedîle, with its address and
// identifiers set in Paramètres; the consignee is set per destination (La Réunion, Mayotte,
// Guadeloupe, Martinique), falling back to a default one. Stored in
// app_settings.business.factureCommerciale; the labels print the same exporter as sender.

export const PARTY_FIELDS = Object.freeze(['nom', 'adresse', 'complement', 'codePostal', 'ville', 'pays', 'telephone', 'email', 'siret', 'eori', 'tva']);
export const REQUIRED_PARTY_FIELDS = Object.freeze(['nom', 'adresse', 'codePostal', 'ville', 'pays']);
// The exporter is also the issuer of the quotes, Expedîle France: its legal mentions (C. com. R123-237,
// docs/facturation-conformite.md F10 and I16) are its own fields, never a consignee's. Optional for the
// commercial invoice; the quote PDF prints the legal identity only once it is complete (quoteIssuerIdentity).
export const LEGAL_FIELDS = Object.freeze(['formeJuridique', 'capital', 'rcsVille']);
export const EXPORTER_FIELDS = Object.freeze([...PARTY_FIELDS, ...LEGAL_FIELDS]);
export const PARTY_LABELS = Object.freeze({
  nom: 'Nom ou raison sociale', adresse: 'Adresse', complement: 'Complément d’adresse', codePostal: 'Code postal', ville: 'Ville', pays: 'Pays',
  telephone: 'Téléphone', email: 'Email', siret: 'SIRET', eori: 'Numéro EORI', tva: 'Numéro de TVA',
  formeJuridique: 'Forme juridique', capital: 'Capital social (€)', rcsVille: 'Ville du greffe (RCS)',
});
export const DEFAULT_EXPORTER_NAME = 'Expedîle';
/** 'defaut' first, then the destinations in the order of the app (constants DESTINATIONS). */
export const CONSIGNEE_KEYS = Object.freeze(['defaut', '974', '976', '971', '972']);

const plainObject = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** One party with every field as a trimmed string (`fields`: EXPORTER_FIELDS for the exporter). */
export function normalizeParty(value, fields = PARTY_FIELDS) {
  const source = plainObject(value);
  return Object.fromEntries(fields.map(key => [key, clean(source[key])]));
}

/** At least one field filled: an empty consignee of a destination falls back to the default one. */
export function partyFilled(party) {
  return Boolean(party) && PARTY_FIELDS.some(key => party[key]);
}

/** The stored identity, normalised: { expediteur, destinataires: { defaut, '974', '976', '971', '972' } }.
 * The exporter's name defaults to Expedîle. */
export function invoiceIdentity(business) {
  const stored = plainObject(plainObject(business).factureCommerciale);
  const expediteur = normalizeParty(stored.expediteur, EXPORTER_FIELDS);
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
// « 10 000 », « 1 500,50 €», « 7500.00 »: euros, two decimals at most, more than zero.
const CAPITAL = /^\d+(?:[.,]\d{1,2})?$/;
const capitalDigits = value => String(value ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(/(?:€|EUR|euros?)$/i, '');
/** The capital as stored: digits and a decimal point (« 10000 », « 1500.50 »); '' when empty or not an amount. */
export function capitalValue(value) {
  const digits = capitalDigits(value);
  return CAPITAL.test(digits) && Number(digits.replace(',', '.')) > 0 ? digits.replace(',', '.') : '';
}
// « RCS Paris » typed in full keeps only the town: the PDF writes « RCS » itself.
const tidyRcs = value => value.replace(/^R\.?\s*C\.?\s*S\.?(?:\s+|$)/i, '').trim();
// The town alone: copied from a Kbis with its number (« Paris B 123 456 789 »), the quote would print the
// SIREN twice (« RCS Paris B 123 456 789 123 456 789 »). A town never has a digit: such a value is no town.
const rcsTown = value => { const town = tidyRcs(String(value ?? '')); return /\d/.test(town) ? '' : town; };

function partyErrors(party, prefix, { required }) {
  const errors = {};
  if (required || partyFilled(party)) {
    for (const key of REQUIRED_PARTY_FIELDS) if (!party[key]) errors[`${prefix}.${key}`] = `Indiquez ${key === 'adresse' ? 'l’adresse' : key === 'nom' ? 'le nom ou la raison sociale' : key === 'codePostal' ? 'le code postal' : key === 'ville' ? 'la ville' : 'le pays'}.`;
  }
  if (party.email && !EMAIL.test(party.email)) errors[`${prefix}.email`] = 'Indiquez une adresse email valide, par exemple contact@exemple.fr.';
  if (party.siret && !SIRET.test(party.siret.replace(/\s/g, ''))) errors[`${prefix}.siret`] = 'Un SIRET compte 14 chiffres.';
  if (party.eori && !EORI.test(party.eori.replace(/\s/g, '').toUpperCase())) errors[`${prefix}.eori`] = 'Un numéro EORI commence par deux lettres (FR…) suivies de 15 caractères au plus.';
  if (party.capital && !capitalValue(party.capital)) errors[`${prefix}.capital`] = 'Indiquez le capital social en euros, par exemple 10 000.';
  if (party.rcsVille && !tidyRcs(party.rcsVille)) errors[`${prefix}.rcsVille`] = 'Indiquez la ville du greffe, par exemple Paris.';
  else if (party.rcsVille && !rcsTown(party.rcsVille)) errors[`${prefix}.rcsVille`] = 'Indiquez la ville du greffe seule, sans numéro : le devis ajoute lui-même le SIREN.';
  return errors;
}

/**
 * Validates the form of Paramètres › Facture commerciale: { value, errors }. The exporter must
 * be complete; a consignee is either empty (the default one is used) or complete. `value` is
 * what to store under business.factureCommerciale (SIRET and EORI without spaces, EORI upper case).
 */
export function validateInvoiceIdentity(input) {
  const source = plainObject(input);
  const expediteur = normalizeParty(source.expediteur, EXPORTER_FIELDS);
  if (!expediteur.nom) expediteur.nom = DEFAULT_EXPORTER_NAME;
  const destinataires = Object.fromEntries(CONSIGNEE_KEYS.map(key => [key, normalizeParty(plainObject(source.destinataires)[key])]));
  const errors = { ...partyErrors(expediteur, 'expediteur', { required: true }) };
  for (const key of CONSIGNEE_KEYS) Object.assign(errors, partyErrors(destinataires[key], `destinataires.${key}`, { required: false }));
  const tidy = party => ({ ...party, siret: party.siret.replace(/\s/g, ''), eori: party.eori.replace(/\s/g, '').toUpperCase() });
  // The exporter's legal mentions: the capital as digits, the greffe's town without « RCS ».
  const tidyExporter = party => ({ ...tidy(party), capital: party.capital ? capitalValue(party.capital) || party.capital : '', rcsVille: tidyRcs(party.rcsVille) });
  const value = { expediteur: tidyExporter(expediteur), destinataires: Object.fromEntries(CONSIGNEE_KEYS.filter(key => partyFilled(destinataires[key])).map(key => [key, tidy(destinataires[key])])) };
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

// ── The issuer's legal identity on the quote (F10, I16) ───────────────────
// Raison sociale, forme juridique and capital, registered office, SIREN with « RCS » and the town of the
// greffe, SIRET, VAT number: the exporter's stored values, never a default nor an invented one (the name
// « Expedîle » the form proposes counts only once saved).
export const QUOTE_IDENTITY_FIELDS = Object.freeze(['nom', 'formeJuridique', 'capital', 'adresse', 'codePostal', 'ville', 'siret', 'rcsVille', 'tva']);
const QUOTE_IDENTITY_NAMES = Object.freeze({
  nom: 'raison sociale', formeJuridique: 'forme juridique', capital: 'capital social', adresse: 'adresse du siège', codePostal: 'code postal du siège',
  ville: 'ville du siège', siret: 'SIRET', rcsVille: 'ville du greffe (RCS)', tva: 'numéro de TVA',
});
const NB = '\u00a0';
// « 10 000 € », « 1 500,50 € »: cents only when the capital has some.
const CAPITAL_FORMATS = [0, 2].map(digits => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const capitalText = value => CAPITAL_FORMATS[Number.isInteger(value) ? 0 : 1].format(value);
const groups = (digits, sizes) => { let at = 0; return sizes.map(size => { const part = digits.slice(at, at + size); at += size; return part; }).filter(Boolean).join(' '); };

/**
 * What the quote PDF prints as its issuer: { complete, missing, lines }. `missing` names the fields still
 * to set in Paramètres › Facture commerciale; `lines` is empty until every field is set and valid.
 */
export function quoteIssuerIdentity(business) {
  const party = normalizeParty(plainObject(plainObject(business).factureCommerciale).expediteur, EXPORTER_FIELDS);
  const siret = party.siret.replace(/\s/g, '');
  const capital = capitalValue(party.capital);
  const valid = { ...party, siret: SIRET.test(siret) ? siret : '', capital, rcsVille: rcsTown(party.rcsVille) };
  const missing = QUOTE_IDENTITY_FIELDS.filter(key => !valid[key]).map(key => QUOTE_IDENTITY_NAMES[key]);
  if (missing.length) return { complete: false, missing, lines: [] };
  const seat = [valid.adresse, valid.complement, `${valid.codePostal} ${valid.ville}`, /^france$/i.test(valid.pays) ? '' : valid.pays].filter(Boolean).join(', ');
  return {
    complete: true, missing: [],
    lines: [
      `${valid.nom}, ${valid.formeJuridique} au capital de ${capitalText(Number(capital))}${NB}€`,
      `Siège social${NB}: ${seat}`,
      `RCS ${valid.rcsVille} ${groups(siret, [3, 3, 3])} · SIRET ${groups(siret, [3, 3, 3, 5])}`,
      `N° de TVA intracommunautaire${NB}: ${valid.tva}`,
    ],
  };
}
