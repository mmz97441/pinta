import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_FIELDS, INVOICE_IDENTITY_FIELD_ORDER, INVOICE_IDENTITY_NEEDS_BUSINESS, REMINDER_DEFAULTS, businessDraftValues, businessSettingsPayload, invoiceConsigneeStates, invoiceIdentityDraftValues, invoiceIdentitySettingsPayload, invoicePartyState, sameBusinessValues, sameStoredValue, validateBusinessValues } from './businessSettings.js';
import { CONSIGNEE_KEYS, EXPORTER_FIELDS, LEGAL_FIELDS, PARTY_FIELDS, invoiceIdentity, quoteIssuerIdentity, validateInvoiceIdentity } from './invoiceIdentity.js';

// The seed of app_settings.business (20260910000001_application_schema.sql) plus later keys.
const STORED = { fraisStockage: '1.50', stockageGratuit: '14', relancesFeuVert: 'J+2,J+5,J+7', relancesPaiement: 'J+3,J+7,J+14', diviseurVolumetrique: '5000', timezone: 'Europe/Paris', relancesActivesDepuis: '2026-09-01T00:00:00Z', futureKey: { nested: [1, 2] } };

test('only three values are editable; the form starts from the stored ones', () => {
  assert.deepEqual(BUSINESS_FIELDS, ['fraisStockage', 'stockageGratuit', 'diviseurVolumetrique']);
  assert.deepEqual(businessDraftValues(STORED), { fraisStockage: '1.50', stockageGratuit: '14', diviseurVolumetrique: '5000' });
  assert.deepEqual(businessDraftValues(null), { fraisStockage: '', stockageGratuit: '', diviseurVolumetrique: '' });
  assert.deepEqual(businessDraftValues({ fraisStockage: 0, stockageGratuit: 0, diviseurVolumetrique: 6000 }), { fraisStockage: '0', stockageGratuit: '0', diviseurVolumetrique: '6000' });
});

test('a save keeps every stored key it does not show, unchanged, and changes only the edited values', () => {
  const { values, errors } = validateBusinessValues({ fraisStockage: '2,5', stockageGratuit: '7', diviseurVolumetrique: '6000' });
  assert.deepEqual(errors, {});
  const payload = businessSettingsPayload(STORED, values);
  assert.deepEqual(payload, { ...STORED, fraisStockage: 2.5, stockageGratuit: 7, diviseurVolumetrique: 6000 });
  for (const key of Object.keys(STORED)) assert.ok(key in payload, `${key} is kept`);
  assert.equal(payload.relancesFeuVert, 'J+2,J+5,J+7', 'The reminder cadences are not rewritten.');
  assert.equal(payload.relancesPaiement, 'J+3,J+7,J+14');
  assert.deepEqual(payload.futureKey, { nested: [1, 2] });
  assert.notEqual(payload, STORED); assert.equal(STORED.fraisStockage, '1.50', 'The stored object is not mutated.');
});

test('the server still requires both reminder cadences: an absent one receives the former default', () => {
  const values = { fraisStockage: 1, stockageGratuit: 7, diviseurVolumetrique: 5000 };
  assert.deepEqual(businessSettingsPayload(null, values), { ...REMINDER_DEFAULTS, ...values });
  assert.deepEqual(businessSettingsPayload({ timezone: 'Europe/Paris', relancesFeuVert: '' }, values), { timezone: 'Europe/Paris', ...REMINDER_DEFAULTS, ...values });
  const pattern = /^J\+[0-9]+(, *J\+[0-9]+)*$/; // save_admin_setting
  for (const stored of [null, {}, STORED]) {
    const payload = businessSettingsPayload(stored, values);
    assert.match(payload.relancesFeuVert, pattern); assert.match(payload.relancesPaiement, pattern);
  }
});

test('each invalid value gets its own message; nothing is saved from an invalid form', () => {
  const { values, errors } = validateBusinessValues({ fraisStockage: '-1', stockageGratuit: '2.5', diviseurVolumetrique: '0' });
  assert.deepEqual(values, {});
  assert.deepEqual(Object.keys(errors), BUSINESS_FIELDS);
  assert.match(errors.fraisStockage, /montant positif ou nul/);
  assert.match(errors.stockageGratuit, /nombre entier de jours/);
  assert.match(errors.diviseurVolumetrique, /supérieur à zéro/);
  for (const empty of ['', ' ', null, undefined, 'abc']) assert.ok(validateBusinessValues({ fraisStockage: empty, stockageGratuit: '1', diviseurVolumetrique: '5000' }).errors.fraisStockage, `« ${empty} » is refused`);
  assert.deepEqual(validateBusinessValues({ fraisStockage: '0', stockageGratuit: '0', diviseurVolumetrique: '1' }), { values: { fraisStockage: 0, stockageGratuit: 0, diviseurVolumetrique: 1 }, errors: {} }, 'Zero storage is explicit, not missing.');
});

// ── Paramètres › Facture commerciale ───────────────────────────────────────
// The consignee of La Réunion as the user gave it on 2026-10-08; the exporter's address is not known
// yet: the one below is a test value only.
const REUNION = { nom: 'Expedîle', adresse: '5 Chemin Grand Canal', complement: 'Immeuble Thales', codePostal: '97490', ville: 'Sainte-Clotilde', pays: 'La Réunion (France)' };
const EXPORTER = { nom: 'Expedîle', adresse: '10 allée de l’Essai', codePostal: '95700', ville: 'Roissy-en-France', pays: 'France', email: 'contact@exemple.fr', siret: '123 456 789 00012', eori: 'fr12345678900012' };
const party = (values = {}, fields = PARTY_FIELDS) => Object.fromEntries(fields.map(key => [key, values[key] ?? '']));
// The exporter also holds the legal mentions of the quote (forme juridique, capital, ville du greffe).
const exporter = (values = {}) => party(values, EXPORTER_FIELDS);
const form = ({ expediteur = EXPORTER, destinataires = { 974: REUNION } } = {}) => ({ expediteur: exporter(expediteur), destinataires: Object.fromEntries(CONSIGNEE_KEYS.map(key => [key, party(destinataires[key])])) });

test('Facture commerciale: the save keeps every stored key and replaces factureCommerciale with the validated form', () => {
  const { payload, errors, blocked } = invoiceIdentitySettingsPayload(STORED, form());
  assert.deepEqual(errors, {}); assert.equal(blocked, null);
  assert.deepEqual(payload, { ...STORED, factureCommerciale: {
    expediteur: { ...exporter(EXPORTER), siret: '12345678900012', eori: 'FR12345678900012' },
    destinataires: { 974: party(REUNION) },
  } });
  for (const key of Object.keys(STORED)) assert.deepEqual(payload[key], STORED[key], `${key} is kept as stored`);
  assert.equal('factureCommerciale' in STORED, false, 'The stored object is not mutated.');
  // The same identity is read back as the form showed it, so the form can show the saved values.
  assert.deepEqual(invoiceIdentity(payload).destinataires['974'], party(REUNION));
});

test('Facture commerciale: an empty destination is not stored (the default consignee is used); other keys of the identity are kept', () => {
  const stored = { ...STORED, factureCommerciale: { mentionsDouane: 'Selon contrat', expediteur: { nom: 'Expedîle' }, destinataires: { 976: { nom: 'Ancien transitaire', adresse: '1 rue du Port', codePostal: '97600', ville: 'Mamoudzou', pays: 'Mayotte' }, 973: { nom: 'Guyane (réglage futur)' } } } };
  const fallback = { nom: 'Transitaire DOM (essai)', adresse: '1 rue de l’Essai', codePostal: '97400', ville: 'Saint-Denis', pays: 'La Réunion (France)' };
  const { payload } = invoiceIdentitySettingsPayload(stored, form({ destinataires: { defaut: fallback, 974: REUNION, 976: {} } }));
  assert.deepEqual(Object.keys(payload.factureCommerciale.destinataires).sort(), ['973', '974', 'defaut'], 'Mayotte emptied: removed; a destination the form does not show: kept.');
  assert.deepEqual(payload.factureCommerciale.destinataires['973'], { nom: 'Guyane (réglage futur)' });
  assert.equal(payload.factureCommerciale.mentionsDouane, 'Selon contrat');
  assert.equal(invoiceIdentity(payload).destinataires['976'].nom, '', 'Mayotte now falls back on the default consignee.');
});

test('Facture commerciale: an invalid form sends nothing and names each wrong field', () => {
  const { payload, errors } = invoiceIdentitySettingsPayload(STORED, form({ expediteur: { nom: 'Expedîle', email: 'contact', siret: '123', eori: '12' }, destinataires: { 971: { nom: 'Transit Antilles' } } }));
  assert.equal(payload, null);
  assert.deepEqual(Object.keys(errors).sort(), ['destinataires.971.adresse', 'destinataires.971.codePostal', 'destinataires.971.pays', 'destinataires.971.ville', 'expediteur.adresse', 'expediteur.codePostal', 'expediteur.email', 'expediteur.eori', 'expediteur.pays', 'expediteur.siret', 'expediteur.ville']);
});

test('Facture commerciale: the reminder cadences are completed; storage values missing block the save until Stockage et rappels is saved', () => {
  const { payload } = invoiceIdentitySettingsPayload({ fraisStockage: 1.5, stockageGratuit: 14, diviseurVolumetrique: 5000 }, form());
  assert.deepEqual([payload.relancesFeuVert, payload.relancesPaiement], [REMINDER_DEFAULTS.relancesFeuVert, REMINDER_DEFAULTS.relancesPaiement]);
  for (const stored of [null, {}, { ...STORED, diviseurVolumetrique: '' }]) {
    assert.deepEqual(invoiceIdentitySettingsPayload(stored, form()), { payload: null, errors: {}, blocked: INVOICE_IDENTITY_NEEDS_BUSINESS });
  }
  assert.match(INVOICE_IDENTITY_NEEDS_BUSINESS, /Stockage et rappels/);
});

test('Facture commerciale: the form keeps what is typed, spaces included, for every party and field', () => {
  const draft = invoiceIdentityDraftValues({ expediteur: { adresse: '5 Chemin ', codePostal: 97490 }, destinataires: { 974: { nom: 'Expedîle' } } });
  assert.equal(draft.expediteur.adresse, '5 Chemin ', 'A trailing space survives while typing.');
  assert.equal(draft.expediteur.codePostal, '97490');
  assert.deepEqual(Object.keys(draft.destinataires).sort(), [...CONSIGNEE_KEYS].sort());
  assert.deepEqual(Object.keys(draft.expediteur), EXPORTER_FIELDS, 'The exporter has its legal mentions too.');
  for (const value of Object.values(draft.destinataires)) assert.deepEqual(Object.keys(value), PARTY_FIELDS, 'A consignee has no legal mention of the quote.');
  assert.deepEqual(invoiceIdentityDraftValues(null), invoiceIdentityDraftValues({ expediteur: [], destinataires: 'x' }));
  assert.equal(invoiceIdentityDraftValues(null).expediteur.nom, '');
});

test('Facture commerciale: each party says whether it is set, incomplete, or falls back on the default consignee', () => {
  const fallback = party({ nom: 'Transitaire DOM (essai)', adresse: '1 rue de l’Essai', codePostal: '97400', ville: 'Saint-Denis', pays: 'La Réunion (France)' });
  assert.equal(invoicePartyState(party(REUNION)), 'set');
  assert.equal(invoicePartyState(party({ nom: 'Expedîle' })), 'incomplete');
  assert.equal(invoicePartyState(party({ ville: '  ' })), 'none', 'Spaces alone fill nothing.');
  assert.equal(invoicePartyState(party(), { fallback }), 'default');
  assert.equal(invoicePartyState(party(), { fallback: party() }), 'none', 'No default consignee either.');
  assert.equal(invoicePartyState(party({ nom: 'Expedîle' }), { fallback }), 'incomplete');
});

test('Facture commerciale: the default consignee row warns while a destination relies on it, and only then', () => {
  const fallback = party({ nom: 'Transitaire DOM (essai)', adresse: '1 rue de l’Essai', codePostal: '97400', ville: 'Saint-Denis', pays: 'La Réunion (France)' });
  const own = code => party({ nom: `Transitaire ${code} (essai)`, adresse: '1 quai de l’Essai', codePostal: `${code}00`, ville: 'Ville (essai)', pays: 'France' });
  // As seeded in production: La Réunion only. Mayotte, Guadeloupe and Martinique have no consignee: the default one is missing.
  assert.deepEqual(invoiceConsigneeStates(form().destinataires), { defaut: 'none', 974: 'set', 976: 'none', 971: 'none', 972: 'none' });
  // Every destination has its own: the default consignee is optional.
  const everyOwn = form({ destinataires: { 974: REUNION, 976: own('976'), 971: own('971'), 972: own('972') } }).destinataires;
  assert.deepEqual(invoiceConsigneeStates(everyOwn), { defaut: 'optional', 974: 'set', 976: 'set', 971: 'set', 972: 'set' });
  // One of them only started: it does not rely on the default consignee (it must be completed).
  assert.equal(invoiceConsigneeStates({ ...everyOwn, 972: party({ nom: 'Transit Martinique' }) }).defaut, 'optional');
  assert.equal(invoiceConsigneeStates({ ...everyOwn, 972: party() }).defaut, 'none', 'Martinique emptied relies on it again.');
  // Set, the default consignee says so, and the empty destinations use it.
  assert.deepEqual(invoiceConsigneeStates(form({ destinataires: { defaut: fallback, 974: REUNION } }).destinataires), { defaut: 'set', 974: 'set', 976: 'default', 971: 'default', 972: 'default' });
  assert.equal(invoiceConsigneeStates({ defaut: party({ nom: 'Transitaire' }) }).defaut, 'incomplete');
  assert.deepEqual(invoiceConsigneeStates(null), { defaut: 'none', 974: 'none', 976: 'none', 971: 'none', 972: 'none' });
});

test('Facture commerciale: the fields are ordered as the form reads, keyed as the validation keys its errors', () => {
  assert.equal(INVOICE_IDENTITY_FIELD_ORDER.length, EXPORTER_FIELDS.length + PARTY_FIELDS.length * CONSIGNEE_KEYS.length);
  assert.deepEqual(INVOICE_IDENTITY_FIELD_ORDER.slice(0, 3), ['expediteur.nom', 'expediteur.adresse', 'expediteur.complement']);
  assert.deepEqual(INVOICE_IDENTITY_FIELD_ORDER.slice(PARTY_FIELDS.length, EXPORTER_FIELDS.length), ['expediteur.formeJuridique', 'expediteur.capital', 'expediteur.rcsVille'], 'The legal mentions follow the exporter’s identifiers.');
  assert.deepEqual([...new Set(INVOICE_IDENTITY_FIELD_ORDER.slice(EXPORTER_FIELDS.length).map(key => key.split('.')[1]))], ['defaut', '974', '976', '971', '972']);
  const { errors } = validateInvoiceIdentity(form({ expediteur: { email: 'x' }, destinataires: Object.fromEntries(CONSIGNEE_KEYS.map(key => [key, { email: 'x' }])) }));
  for (const key of Object.keys(errors)) assert.ok(INVOICE_IDENTITY_FIELD_ORDER.includes(key), `${key} has a place in the form`);
});

test('stored values compare whatever the order of their keys (jsonb returns its own order)', () => {
  assert.equal(sameStoredValue({ a: 1, b: { c: [1, 2], d: null } }, { b: { d: null, c: [1, 2] }, a: 1 }), true);
  assert.equal(sameStoredValue({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(sameStoredValue({ destinataires: { 974: REUNION } }, { destinataires: { 974: { ...REUNION, complement: 'Bâtiment B' } } }), false);
  assert.equal(sameStoredValue(undefined, null), true);
  assert.equal(sameStoredValue(null, {}), false);
});

test('Stockage et rappels compares its three values only: an invoice identity saved meanwhile is no change of them', () => {
  assert.equal(sameBusinessValues(STORED, { ...STORED, factureCommerciale: { expediteur: EXPORTER }, timezone: 'UTC' }), true);
  assert.equal(sameBusinessValues(STORED, { ...STORED, fraisStockage: '2' }), false);
  assert.equal(sameBusinessValues(STORED, { ...STORED, fraisStockage: 1.5 }), false, 'Compared as stored: « 1.50 » and 1.5 differ, the save then expects the version it started from.');
  assert.equal(sameBusinessValues(null, STORED), false);
  assert.equal(sameBusinessValues(null, {}), true);
});

// ── The issuer's legal identity on the quote (F10, decision of 10 October 2026) ──
const LEGAL = { nom: 'Expedîle France (essai)', formeJuridique: 'SAS', capital: '10000', adresse: '10 allée de l’Essai', codePostal: '95700', ville: 'Roissy-en-France', pays: 'France', siret: '12345678900012', rcsVille: 'Pontoise', tva: 'FR00123456789' };

test('Facture commerciale: the legal mentions of the quote are the exporter’s own fields, checked and tidied, every stored key kept', () => {
  assert.deepEqual(LEGAL_FIELDS, ['formeJuridique', 'capital', 'rcsVille']);
  assert.deepEqual(EXPORTER_FIELDS, [...PARTY_FIELDS, ...LEGAL_FIELDS]);
  // « 10 000 € » and « RCS Pontoise » as typed: stored as digits and as the town alone.
  const { payload, errors } = invoiceIdentitySettingsPayload(STORED, form({ expediteur: { ...EXPORTER, formeJuridique: 'SAS', capital: '10 000 €', rcsVille: 'RCS Pontoise' } }));
  assert.deepEqual(errors, {});
  assert.deepEqual([payload.factureCommerciale.expediteur.formeJuridique, payload.factureCommerciale.expediteur.capital, payload.factureCommerciale.expediteur.rcsVille], ['SAS', '10000', 'Pontoise']);
  assert.equal(validateInvoiceIdentity(form({ expediteur: { ...EXPORTER, capital: '1 500,50' } })).value.expediteur.capital, '1500.50');
  // Optional for the commercial invoice: empty mentions never block a save.
  assert.deepEqual(validateInvoiceIdentity(form()).errors, {});
  // A wrong capital or a lone « RCS » is refused under its field.
  const wrong = validateInvoiceIdentity(form({ expediteur: { ...EXPORTER, capital: 'dix mille', rcsVille: 'RCS' } })).errors;
  assert.deepEqual(wrong, { 'expediteur.capital': 'Indiquez le capital social en euros, par exemple 10 000.', 'expediteur.rcsVille': 'Indiquez la ville du greffe, par exemple Paris.' });
  for (const value of ['0', '-5', '12,345', '10 000 000,001']) assert.ok(validateInvoiceIdentity(form({ expediteur: { ...EXPORTER, capital: value } })).errors['expediteur.capital'], `« ${value} » is refused`);
  // The mention copied from a Kbis with its number: the quote would print the SIREN twice, so the town alone is asked for.
  for (const value of ['RCS Paris B 123 456 789', 'Paris B 123456789', '123 456 789 RCS Paris'])
    assert.equal(validateInvoiceIdentity(form({ expediteur: { ...EXPORTER, rcsVille: value } })).errors['expediteur.rcsVille'], 'Indiquez la ville du greffe seule, sans numéro : le devis ajoute lui-même le SIREN.', value);
  for (const value of ['Paris', 'R.C.S. Créteil', 'Saint-Denis de La Réunion', 'Paris B']) assert.equal(validateInvoiceIdentity(form({ expediteur: { ...EXPORTER, rcsVille: value } })).errors['expediteur.rcsVille'], undefined, value);
  // A key stored on a party that this form does not show is kept (a later field, another version of the screen).
  const stored = { ...STORED, factureCommerciale: { expediteur: { ...EXPORTER, champFutur: 'gardé' }, destinataires: { 974: { ...REUNION, horaires: '8 h – 16 h' } } } };
  const saved = invoiceIdentitySettingsPayload(stored, form({ expediteur: { ...EXPORTER, formeJuridique: 'SAS' } })).payload.factureCommerciale;
  assert.equal(saved.expediteur.champFutur, 'gardé');
  assert.equal(saved.expediteur.formeJuridique, 'SAS');
  assert.equal(saved.destinataires['974'].horaires, '8 h – 16 h');
  // The commercial invoice reads the same identity: the mentions never reach a consignee.
  assert.deepEqual(Object.keys(invoiceIdentity(payload).expediteur), EXPORTER_FIELDS);
  assert.deepEqual(Object.keys(invoiceIdentity(payload).destinataires['974']), PARTY_FIELDS);
});

test('the quote prints the issuer’s legal identity only when complete, from stored values only', () => {
  const business = expediteur => ({ ...STORED, factureCommerciale: { expediteur } });
  assert.deepEqual(quoteIssuerIdentity(business(LEGAL)), { complete: true, missing: [], lines: [
    'Expedîle France (essai), SAS au capital de 10\u202f000\u00a0€',
    'Siège social\u00a0: 10 allée de l’Essai, 95700 Roissy-en-France',
    'RCS Pontoise 123 456 789 · SIRET 123 456 789 00012',
    'N° de TVA intracommunautaire\u00a0: FR00123456789',
  ] });
  // Nothing stored: every mention is named, nothing is printed (the name « Expedîle » the form proposes is not stored).
  const none = quoteIssuerIdentity({});
  assert.equal(none.complete, false); assert.deepEqual(none.lines, []);
  assert.deepEqual(none.missing, ['raison sociale', 'forme juridique', 'capital social', 'adresse du siège', 'code postal du siège', 'ville du siège', 'SIRET', 'ville du greffe (RCS)', 'numéro de TVA']);
  // The commercial invoice's exporter already set: only the three mentions and the VAT number are missing.
  assert.deepEqual(quoteIssuerIdentity(business({ ...EXPORTER, siret: '12345678900012' })).missing, ['forme juridique', 'capital social', 'ville du greffe (RCS)', 'numéro de TVA']);
  // A value that is not one counts as missing, never printed as is.
  assert.deepEqual(quoteIssuerIdentity(business({ ...LEGAL, siret: '123', capital: 'beaucoup' })).missing, ['capital social', 'SIRET']);
  // A greffe written with its number (stored by another screen or version) is no town: never « RCS Paris B 123 456 789 123 456 789 ».
  assert.deepEqual(quoteIssuerIdentity(business({ ...LEGAL, rcsVille: 'Pontoise B 123 456 789' })), { complete: false, missing: ['ville du greffe (RCS)'], lines: [] });
  assert.equal(quoteIssuerIdentity(business({ ...LEGAL, rcsVille: 'RCS Pontoise' })).lines[2], 'RCS Pontoise 123 456 789 · SIRET 123 456 789 00012');
  // A seat outside France says its country; complement printed with the address.
  assert.equal(quoteIssuerIdentity(business({ ...LEGAL, complement: 'Bâtiment C', pays: 'Belgique' })).lines[1], 'Siège social\u00a0: 10 allée de l’Essai, Bâtiment C, 95700 Roissy-en-France, Belgique');
  assert.equal(quoteIssuerIdentity(business({ ...LEGAL, capital: '1500.5' })).lines[0], 'Expedîle France (essai), SAS au capital de 1\u202f500,50\u00a0€');
});
