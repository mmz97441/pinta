import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote } from './quote.js';
import { invoiceIdentity } from './invoiceIdentity.js';
import { buildCommercialInvoice, commercialInvoiceBasis, commercialInvoiceFileName, fixedInInvoiceSettings, invoiceConsigneeName, invoiceDayLabel, invoiceIssueLabel } from './commercialInvoice.js';

const cents = values => values.reduce((sum, value) => sum + Math.round(value * 100), 0);
const categories = [
  { id: 'cat-cuir', label: 'Cuir', codeHs: '4205', taux: { 974: { om: 5, omr: 2.5 } } },
  { id: 'cat-plastique', label: 'Vaisselle plastique', codeHs: '39241000', taux: { 974: { om: 5, omr: 2.5 } } },
  { id: 'cat-cafe', label: 'Café', codeHs: '0901210000', taux: { 974: { om: 0, omr: 0 } } },
  { id: 'cat-porcelaine', label: 'Porcelaine', codeHs: '6911100000', taux: { 974: { om: 10, omr: 2.5 } } },
  { id: 'cat-sans-code', label: 'Luminaires', codeHs: '', taux: { 974: { om: 10, omr: 2.5 } } },
];
const envoi = { id: 'env-36', ref: 'ENV-2026-036', date: '2026-10-15', destinationCode: '974', modeTransport: 'aerien' };
// Paramètres › Facture commerciale. The exporter's address is a test value (the real one is not known yet); the
// consignee of La Réunion is the one the user gave on 8 October; the default one serves the other destinations.
const EXPORTER = { nom: 'Expedîle', adresse: '12 rue des Entrepôts', codePostal: '93290', ville: 'Tremblay-en-France', pays: 'France', email: 'contact@expedile.fr', siret: '12345678900012', eori: 'FR12345678900012' };
const REUNION = { nom: 'Expedîle', adresse: '5 Chemin Grand Canal', complement: 'Immeuble Thales', codePostal: '97490', ville: 'Sainte-Clotilde', pays: 'La Réunion (France)' };
const FALLBACK = { nom: 'Expedîle Outre-mer', adresse: '1 avenue de la Mer', codePostal: '97400', ville: 'Saint-Denis', pays: 'France (DOM)' };
const identityOf = factureCommerciale => invoiceIdentity({ diviseurVolumetrique: 5000, factureCommerciale });
const identity = identityOf({ expediteur: EXPORTER, destinataires: { defaut: FALLBACK, 974: REUNION } });
/** The invoice with the parties set (the exporter and both consignees). */
const build = options => buildCommercialInvoice({ identity, ...options });
const flavie = { id: 'c-flavie', type: 'particulier', nom: 'Hoarau Flavie', nomFamille: 'Hoarau', prenom: 'Flavie', cp: '97400' };
const anli = { id: 'c-anli', type: 'particulier', nom: 'Madi Anli', nomFamille: 'Madi', prenom: 'Anli', cp: '97400' };
const lagon = { id: 'c-lagon', type: 'pro', nom: 'Payet Jean', nomFamille: 'Payet', prenom: 'Jean', raisonSociale: 'Lagon Services SARL', cp: '97410', methodePaiement: 'virement' };
const box = (dimL, dimW, dimH, poids) => ({ dimL, dimW, dimH, poids });
const line = (id, desc, qte, prix, cat, factureId = 'f1') => ({ id, factureId, desc, qte, prix, cat });

/** A dossier paid with its quote saved by the real engine, as the departure reads it. */
function paidDossier(fields, client, tarif = { base: 25, parKg: 5 }) {
  const colis = {
    statut: 'en_preparation', envoi: envoi.id, fraisDivers: [], preparationCompositionVersion: 1, finalMeasurementsVersion: 1,
    factures: [{ id: 'f1', montant: 1, valide: true, fichierUrl: 'f1.pdf' }], ...fields,
  };
  colis.outgoingParcelCount = colis.finalPackages.length;
  const quote = calculateQuote({ colis, client, destination: { code: '974', nom: 'La Réunion', tva: 8.5 }, tarif, categories, settings: { diviseurVolumetrique: 5000 }, mode: 'final' });
  assert.equal(quote.ok, true, JSON.stringify(quote.errors));
  return { ...colis, statut: 'paye', devisTotal: quote.amounts.total, paiementDate: '2026-10-06T10:00:00Z', devisSnapshot: quote.snapshot };
}

// The screen of 7 October: transport 39,00 € shared between two articles.
function scelleuse() {
  const colis = paidDossier({ id: 'p1', ref: 'EXP-2YE537', finalPackages: [box(40, 35, 10, 1.9)], lignes: [line('l-1', 'Mini scelleuse', 1, 16.64, 'cat-cuir'), line('l-2', 'Organisateur évier', 1, 9.92, 'cat-plastique')] }, flavie);
  // The first article was classified with the customs catalogue: its code is frozen with the quote.
  colis.devisSnapshot.amounts.taxLines[0].customDuty = { code: '42050090', label: 'Ouvrages en cuir', overrideReason: null };
  return colis;
}
// Three articles of the same value: 10,00 € of transport cannot be split into equal cents.
const troisArticles = () => paidDossier({ id: 'p2', ref: 'EXP-3TRIO1', finalPackages: [box(20, 20, 20, 1)], lignes: [line('l-3', 'Coque', 1, 5, 'cat-plastique'), line('l-4', 'Étui', 1, 5, 'cat-plastique'), line('l-5', 'Sacoche', 1, 5, 'cat-cuir')] }, anli, { base: 10, parKg: 0 });
// A professional: the quote has no article, the dossier's own lines are declared.
function professional(lignes, factures) {
  return paidDossier({ id: 'p3', ref: 'EXP-PRO001', finalPackages: [box(40, 30, 30, 12), box(30, 30, 20, 7.5)], lignes, factures }, lagon, { base: 20, parKg: 5 });
}
const proInvoices = [
  { id: 'fp1', montant: 105, valide: true, fichierUrl: 'fp1.pdf', replacesFactureId: 'fp-old' },
  { id: 'fp-old', montant: 50, valide: true, fichierUrl: 'old.pdf' },
  { id: 'fp-dup', montant: 105, valide: true, fichierUrl: 'dup.pdf', duplicateOfId: 'fp1' },
  { id: 'fp-rej', montant: 10, valide: false, fichierUrl: 'rej.pdf', rejetMotif: 'Illisible' },
];
const proLines = [
  line('lp-1', 'Café torréfié 1 kg', 4, 15, 'cat-cafe', 'fp1'),
  line('lp-2', 'Tasses en porcelaine', 6, 7.5, 'cat-porcelaine', 'fp1'),
  line('lp-old', 'Ancienne commande', 2, 25, 'cat-cafe', 'fp-old'),
  line('lp-dup', 'Café en double', 4, 15, 'cat-cafe', 'fp-dup'),
  line('lp-rej', 'Article refusé', 1, 10, 'cat-cafe', 'fp-rej'),
];

test('each article carries its dossier, its consignee, its frozen HS code and its share of the transport', () => {
  const invoice = build({ envoi, items: [{ colis: troisArticles(), client: anli }, { colis: scelleuse(), client: flavie }], categories, issuedAt: '2026-10-07T22:30:00Z' });
  assert.equal(invoice.ok, true, JSON.stringify(invoice.errors));
  assert.deepEqual(invoice.errors, []);
  assert.equal('excluded' in invoice, false, 'One invoice for the whole departure: no list of dossiers left out.');
  assert.deepEqual(invoice.rows.map(row => [row.ref, row.clientName, row.hsCode, row.description, row.quantity, row.unitPrice, row.value, row.transport, row.total]), [
    ['EXP-2YE537', 'Hoarau Flavie', '42050090', 'Mini scelleuse', 1, 16.64, 16.64, 24.43, 41.07],
    ['EXP-2YE537', 'Hoarau Flavie', '39241000', 'Organisateur évier', 1, 9.92, 9.92, 14.57, 24.49],
    ['EXP-3TRIO1', 'Madi Anli', '39241000', 'Coque', 1, 5, 5, 3.34, 8.34],
    ['EXP-3TRIO1', 'Madi Anli', '39241000', 'Étui', 1, 5, 5, 3.33, 8.33],
    ['EXP-3TRIO1', 'Madi Anli', '4205', 'Sacoche', 1, 5, 5, 3.33, 8.33],
  ], 'Dossiers in reference order, the frozen customs code before the category code.');
  // Per dossier, the shares add up exactly to the quote's transport (39 € and 10 €).
  assert.equal(cents(invoice.rows.filter(row => row.ref === 'EXP-2YE537').map(row => row.transport)), 3900);
  assert.equal(cents(invoice.rows.filter(row => row.ref === 'EXP-3TRIO1').map(row => row.transport)), 1000);
  assert.deepEqual(invoice.totals, { value: 41.56, transport: 49, total: 90.56 });
  assert.deepEqual(invoice.meta, {
    number: 'ENV-2026-036', date: '2026-10-08', departureDate: '2026-10-15', destination: 'La Réunion', mode: 'Aérien',
    exporter: identity.expediteur, consignee: { ...identity.destinataires['974'], source: 'destination' },
    dossiers: 2, parcels: 2, weight: 2.9, basis: 'loading', issuedAt: '2026-10-07T22:30:00.000Z',
  }, 'The issue day is the Paris day (00:30 on 8 October in Paris).');
});

test('at the top, the exporter Expedîle and the consignee of the departure’s destination, else the default one', () => {
  const items = [{ colis: scelleuse(), client: flavie }];
  const reunion = build({ envoi, items, categories });
  assert.equal(reunion.ok, true, JSON.stringify(reunion.errors));
  // The exporter also carries the quote's legal mentions (empty here): the commercial invoice does not print them.
  assert.deepEqual(reunion.meta.exporter, { nom: 'Expedîle', adresse: '12 rue des Entrepôts', complement: '', codePostal: '93290', ville: 'Tremblay-en-France', pays: 'France', telephone: '', email: 'contact@expedile.fr', siret: '12345678900012', eori: 'FR12345678900012', tva: '', formeJuridique: '', capital: '', rcsVille: '' });
  assert.deepEqual(reunion.meta.consignee, { nom: 'Expedîle', adresse: '5 Chemin Grand Canal', complement: 'Immeuble Thales', codePostal: '97490', ville: 'Sainte-Clotilde', pays: 'La Réunion (France)', telephone: '', email: '', siret: '', eori: '', tva: '', source: 'destination' },
    'La Réunion has its own consignee: Expedîle at Sainte-Clotilde.');
  // Mayotte has none of its own: the default consignee is printed, and said to be the default one.
  const mayotte = build({ envoi: { ...envoi, destinationCode: '976' }, items, categories });
  assert.equal(mayotte.ok, true, JSON.stringify(mayotte.errors));
  assert.deepEqual([mayotte.meta.destination, mayotte.meta.consignee.nom, mayotte.meta.consignee.ville, mayotte.meta.consignee.source], ['Mayotte', 'Expedîle Outre-mer', 'Saint-Denis', 'defaut']);
  // The consignee of La Réunion, once changed in Paramètres, is the one printed.
  const moved = build({ envoi, items, categories, identity: identityOf({ expediteur: EXPORTER, destinataires: { 974: { ...REUNION, adresse: '7 rue du Karting', complement: '' } } }) });
  assert.deepEqual([moved.meta.consignee.adresse, moved.meta.consignee.complement], ['7 rue du Karting', '']);
});

test('an incomplete exporter blocks the invoice, with what to complete in Paramètres › Facture commerciale', () => {
  const items = [{ colis: scelleuse(), client: flavie }];
  // The exporter's mainland address is not known yet: Expedîle alone is never printed as a complete exporter.
  const unset = build({ envoi, items, categories, identity: identityOf({ destinataires: { 974: REUNION } }) });
  assert.equal(unset.ok, false);
  assert.deepEqual(unset.errors, [{ ref: null, colisId: null, kind: 'exporter', task: null, missing: ['adresse', 'code postal', 'ville', 'pays'],
    message: 'Complétez l’expéditeur dans Paramètres › Facture commerciale : adresse, code postal, ville, pays.' }]);
  assert.equal(unset.meta.exporter.nom, 'Expedîle', 'The name defaults to Expedîle; no address is invented.');
  assert.deepEqual([unset.meta.exporter.adresse, unset.meta.exporter.ville], ['', '']);
  const partial = build({ envoi, items, categories, identity: identityOf({ expediteur: { ...EXPORTER, ville: '', pays: ' ' }, destinataires: { 974: REUNION } }) });
  assert.deepEqual(partial.errors.map(error => error.message), ['Complétez l’expéditeur dans Paramètres › Facture commerciale : ville, pays.']);
  assert.equal(fixedInInvoiceSettings(partial.errors[0]), true);
});

test('no consignee for the destination nor a default one blocks the invoice; an incomplete one is never printed', () => {
  const items = [{ colis: scelleuse(), client: flavie }];
  const exporterOnly = identityOf({ expediteur: EXPORTER });
  const none = build({ envoi, items, categories, identity: exporterOnly });
  assert.equal(none.ok, false);
  assert.deepEqual(none.errors, [{ ref: null, colisId: null, kind: 'invoice-consignee', task: null,
    message: 'Renseignez le destinataire de la facture pour La Réunion (ou le destinataire par défaut) dans Paramètres › Facture commerciale.' }]);
  assert.equal(none.meta.consignee, null, 'No consignee is invented.');
  // Another destination is named as such; a departure without destination can only take the default one.
  assert.equal(build({ envoi: { ...envoi, destinationCode: '971' }, items, categories, identity: exporterOnly }).errors[0].message,
    'Renseignez le destinataire de la facture pour la Guadeloupe (ou le destinataire par défaut) dans Paramètres › Facture commerciale.');
  assert.equal(build({ envoi: { ...envoi, destinationCode: null }, items, categories, identity: exporterOnly }).errors[0].message,
    'Renseignez le destinataire de la facture par défaut dans Paramètres › Facture commerciale.');
  // The consignee of another destination does not serve La Réunion.
  assert.equal(build({ envoi, items, categories, identity: identityOf({ expediteur: EXPORTER, destinataires: { 976: FALLBACK } }) }).ok, false);
  // A consignee stored partly (by hand) is completed, never printed partly.
  const partial = build({ envoi, items, categories, identity: identityOf({ expediteur: EXPORTER, destinataires: { 974: { ...REUNION, ville: '' } } }) });
  assert.deepEqual(partial.errors.map(error => [error.kind, error.missing, error.message]), [['invoice-consignee', ['ville'], 'Complétez le destinataire de la facture pour La Réunion dans Paramètres › Facture commerciale : ville.']]);
  const partialDefault = build({ envoi, items, categories, identity: identityOf({ expediteur: EXPORTER, destinataires: { defaut: { ...FALLBACK, codePostal: '' } } }) });
  assert.deepEqual(partialDefault.errors.map(error => error.message), ['Complétez le destinataire de la facture par défaut dans Paramètres › Facture commerciale : code postal.']);
  assert.ok([...none.errors, ...partial.errors].every(fixedInInvoiceSettings));
});

test('without the parties set, nothing is invented: both points come first, before those of the dossiers', () => {
  const withoutQuote = { ...troisArticles(), devisSnapshot: null };
  const invoice = buildCommercialInvoice({ envoi, items: [{ colis: withoutQuote, client: anli }, { colis: scelleuse(), client: flavie }], categories });
  assert.equal(invoice.ok, false);
  assert.deepEqual(invoice.errors.map(error => [error.kind, error.ref, fixedInInvoiceSettings(error)]), [
    ['exporter', null, true], ['invoice-consignee', null, true], ['quote', 'EXP-3TRIO1', false],
  ]);
  assert.equal(fixedInInvoiceSettings({ kind: 'hs-code', category: 'Cuir' }), false, 'A category code is completed in Catégories et taxes.');
  assert.equal(fixedInInvoiceSettings(null), false);
});

test('a professional declares its own articles, without those of rejected, replaced or duplicate invoices', () => {
  const colis = professional(proLines, proInvoices);
  assert.equal(colis.devisSnapshot.amounts.taxLines.length, 0, 'A professional quote has no article.');
  const invoice = build({ envoi, items: [{ colis, client: lagon }], categories, issuedAt: '2026-10-07T10:00:00Z' });
  assert.equal(invoice.ok, true, JSON.stringify(invoice.errors));
  // Transport 20 + 19,5 kg × 5 = 117,50 €, shared by value (60 € and 45 €), to the cent.
  assert.equal(colis.devisSnapshot.amounts.transport, 117.5);
  assert.deepEqual(invoice.rows.map(row => [row.clientName, row.hsCode, row.description, row.quantity, row.unitPrice, row.value, row.transport, row.total]), [
    ['Lagon Services SARL', '0901210000', 'Café torréfié 1 kg', 4, 15, 60, 67.14, 127.14],
    ['Lagon Services SARL', '6911100000', 'Tasses en porcelaine', 6, 7.5, 45, 50.36, 95.36],
  ]);
  assert.equal(cents(invoice.rows.map(row => row.transport)), 11750);
  assert.deepEqual(invoice.totals, { value: 105, transport: 117.5, total: 222.5 });
  assert.equal(invoice.meta.parcels, 2);
  assert.equal(invoice.meta.weight, 19.5);
  // The manifest gives the lines beside the dossier: the same result.
  const fromManifest = build({ envoi, items: [{ colis: { ...colis, lignes: [] }, client: lagon, lignes: proLines }], categories, issuedAt: '2026-10-07T10:00:00Z' });
  assert.deepEqual(fromManifest.rows, invoice.rows);
});

test('a professional without any article line blocks the invoice', () => {
  const invoice = build({ envoi, items: [{ colis: professional([], []), client: lagon }], categories });
  assert.equal(invoice.ok, false);
  assert.deepEqual(invoice.errors, [{ ref: 'EXP-PRO001', colisId: 'p3', kind: 'articles', task: 'documents', message: 'EXP-PRO001 : aucun article à déclarer' }]);
  // Lines whose value is nothing cannot carry the transport: never a lost share.
  const free = build({ envoi, items: [{ colis: professional([line('lp-0', 'Échantillon', 1, 0, 'cat-cafe', 'fp1')], proInvoices.slice(0, 2)), client: lagon }], categories });
  assert.deepEqual(free.errors.map(error => error.message), ['EXP-PRO001 : valeur des articles nulle : le transport ne peut pas être réparti']);
});

test('a missing HS code blocks the invoice: never an empty or invented code (D33)', () => {
  const lampe = paidDossier({ id: 'p4', ref: 'EXP-LAMPE1', finalPackages: [box(30, 30, 30, 2)], lignes: [line('l-6', 'Lampe de chevet', 2, 19.9, 'cat-sans-code'), line('l-7', 'Abat-jour', 1, 12, 'cat-cuir')] }, flavie);
  const invoice = build({ envoi, items: [{ colis: lampe, client: flavie }, { colis: scelleuse(), client: flavie }], categories });
  assert.equal(invoice.ok, false);
  assert.deepEqual(invoice.errors, [{ ref: 'EXP-LAMPE1', colisId: 'p4', kind: 'hs-code', task: 'devis', category: 'Luminaires', message: 'EXP-LAMPE1 : code SH manquant pour « Lampe de chevet » (catégorie « Luminaires »)' }],
    'The category whose customs code is missing is named.');
  assert.ok(invoice.rows.every(row => row.ref !== 'EXP-LAMPE1' && row.hsCode), 'The blocked dossier gives no row, and no row has an empty code.');
  // The category completed afterwards (Paramètres › Catégories et taxes) unblocks it.
  const completed = categories.map(category => (category.id === 'cat-sans-code' ? { ...category, codeHs: '9405210000' } : category));
  const fixed = build({ envoi, items: [{ colis: lampe, client: flavie }], categories: completed });
  // Transport 25 + 5,4 kg (volumetric, the heavier) × 5 = 52,00 €, shared by value (39,80 € and 12,00 €).
  assert.equal(lampe.devisSnapshot.amounts.transport, 52);
  assert.equal(fixed.ok, true, JSON.stringify(fixed.errors));
  assert.deepEqual(fixed.rows.map(row => [row.hsCode, row.value, row.transport]), [['9405210000', 39.8, 39.95], ['4205', 12, 12.05]]);
  assert.equal(cents(fixed.rows.map(row => row.transport)), Math.round(lampe.devisSnapshot.amounts.transport * 100));
  // A professional's articles are those of its invoices: the dossier opens on them, where a category is chosen.
  const uncoded = professional([line('lp-9', 'Lampadaire', 1, 80, 'cat-sans-code', 'fp1'), line('lp-10', 'Ampoules', 2, 5, null, 'fp1')], proInvoices.slice(0, 2));
  assert.deepEqual(build({ envoi, items: [{ colis: uncoded, client: lagon }], categories }).errors.map(error => [error.kind, error.task, error.category, error.message]), [
    ['hs-code', 'documents', 'Luminaires', 'EXP-PRO001 : code SH manquant pour « Lampadaire » (catégorie « Luminaires »)'],
    ['hs-code', 'documents', null, 'EXP-PRO001 : code SH manquant pour « Ampoules » (sans catégorie)'],
  ], 'Without a category, there is no category code to complete: one is to be chosen.');
  // The porcelain of 7 October: the category without its code is the one to complete.
  const porcelaine = categories.map(category => (category.id === 'cat-porcelaine' ? { ...category, codeHs: '' } : category));
  assert.deepEqual(build({ envoi, items: [{ colis: professional(proLines, proInvoices), client: lagon }], categories: porcelaine }).errors.map(error => error.message),
    ['EXP-PRO001 : code SH manquant pour « Tasses en porcelaine » (catégorie « Porcelaine »)']);
  // A quote whose category is gone since names the one saved with it.
  assert.deepEqual(build({ envoi, items: [{ colis: lampe, client: flavie }], categories: categories.filter(category => category.id !== 'cat-sans-code') }).errors.map(error => [error.category, error.message]),
    [['Luminaires', 'EXP-LAMPE1 : code SH manquant pour « Lampe de chevet » (catégorie « Luminaires »)']]);
});

test('HS codes stay text: leading zeros are kept', () => {
  const invoice = build({ envoi, items: [{ colis: professional(proLines.slice(0, 1), proInvoices.slice(0, 2)), client: lagon }], categories });
  assert.equal(invoice.rows[0].hsCode, '0901210000');
  assert.equal(typeof invoice.rows[0].hsCode, 'string');
});

test('before the departure, one invoice with every dossier assigned to it, paid and prepared or not', () => {
  // Awaiting payment, its preparation changed since: each has its saved quote, its articles and their HS codes.
  const unpaid = { ...scelleuse(), id: 'p5', ref: 'EXP-ATTENTE', statut: 'attente_paiement', paiementDate: null };
  const outdated = { ...troisArticles(), id: 'p6', ref: 'EXP-CARTON', preparationCompositionVersion: 2 };
  const items = [{ colis: unpaid, client: flavie }, { colis: scelleuse(), client: flavie }, { colis: outdated, client: anli }];
  const invoice = build({ envoi, items, categories });
  assert.equal(invoice.ok, true, JSON.stringify(invoice.errors));
  assert.deepEqual([...new Set(invoice.rows.map(row => row.ref))], ['EXP-2YE537', 'EXP-ATTENTE', 'EXP-CARTON'], 'Every assigned dossier, in reference order.');
  assert.equal(invoice.rows.length, 7);
  assert.deepEqual([invoice.meta.dossiers, invoice.meta.parcels, invoice.meta.weight], [3, 3, 4.8]);
  assert.deepEqual(invoice.totals, { value: 68.12, transport: 88, total: 156.12 });
  // Nothing assigned: the invoice says so instead of an empty document.
  const none = build({ envoi, items: [], categories });
  assert.equal(none.ok, false);
  assert.deepEqual(none.errors, [{ ref: null, colisId: null, kind: 'empty', task: null, message: 'Aucun dossier affecté à ce départ : aucun article à déclarer.' }]);
});

test('before the departure, an assigned dossier without saved quote blocks the invoice, named with what to do', () => {
  // Not paid nor prepared yet: no quote. It is quoted, or taken off the departure.
  const waiting = { ...troisArticles(), id: 'p7', ref: 'EXP-ATTENTE2', statut: 'autorise', devisSnapshot: null, finalPackages: [], outgoingParcelCount: null, preparationCompositionVersion: null, finalMeasurementsVersion: null };
  const invoice = build({ envoi, items: [{ colis: scelleuse(), client: flavie }, { colis: waiting, client: anli }], categories });
  assert.equal(invoice.ok, false);
  assert.deepEqual(invoice.errors, [{ ref: 'EXP-ATTENTE2', colisId: 'p7', kind: 'quote', task: 'devis', message: 'EXP-ATTENTE2 : devis non enregistré : enregistrez son devis ou retirez-le du départ.' }]);
  assert.deepEqual([...new Set(invoice.rows.map(row => row.ref))], ['EXP-2YE537'], 'The others keep their rows; the document is not generated.');
  // Its articles and their codes are required as for the others.
  const lampe = { ...paidDossier({ id: 'p8', ref: 'EXP-LAMPE2', finalPackages: [box(30, 30, 30, 2)], lignes: [line('l-8', 'Lampe de chevet', 1, 19.9, 'cat-sans-code')] }, flavie), statut: 'devis_envoye', paiementDate: null };
  assert.deepEqual(build({ envoi, items: [{ colis: lampe, client: flavie }], categories }).errors.map(error => error.message), ['EXP-LAMPE2 : code SH manquant pour « Lampe de chevet » (catégorie « Luminaires »)']);
});

test('before the departure, cancelled, archived and shipped dossiers and those of another departure are left out', () => {
  const kept = scelleuse();
  const items = [
    { colis: kept, client: flavie },
    { colis: { ...troisArticles(), id: 'p9', ref: 'EXP-ANNULE', statut: 'annule', devisSnapshot: null }, client: anli },
    { colis: { ...troisArticles(), id: 'p10', ref: 'EXP-ARCHIVE', archive: true, devisSnapshot: null }, client: anli },
    { colis: { ...troisArticles(), id: 'p11', ref: 'EXP-PARTI', statut: 'expedie', dateExpedition: '2026-10-08T06:00:00Z', devisSnapshot: null }, client: anli },
    { colis: { ...troisArticles(), id: 'p12', ref: 'EXP-LIVRE', statut: 'livre', devisSnapshot: null }, client: anli },
    { colis: { ...troisArticles(), id: 'p13', ref: 'EXP-AILLEURS', envoi: 'env-other', devisSnapshot: null }, client: anli },
  ];
  const invoice = build({ envoi, items, categories });
  assert.equal(invoice.ok, true, JSON.stringify(invoice.errors));
  assert.deepEqual([...new Set(invoice.rows.map(row => row.ref))], ['EXP-2YE537']);
  assert.deepEqual([invoice.meta.dossiers, invoice.meta.parcels], [1, 1], 'Nothing left out is counted.');
  // Only those: nothing assigned and loadable is left.
  assert.deepEqual(build({ envoi, items: items.slice(1), categories }).errors.map(error => error.kind), ['empty']);
});

test('the parcels and weight of a dossier not known: none is printed, never a partial total', () => {
  // A quote saved before its parcels were counted (no outgoing count on a listed preparation).
  const uncounted = { ...troisArticles(), outgoingParcelCount: null };
  const invoice = build({ envoi, items: [{ colis: scelleuse(), client: flavie }, { colis: uncounted, client: anli }], categories });
  assert.equal(invoice.ok, true, JSON.stringify(invoice.errors));
  assert.deepEqual([invoice.meta.dossiers, invoice.meta.parcels, invoice.meta.weight], [2, null, null]);
});

test('after the departure, every dossier of the frozen manifest is included', () => {
  const shipped = { ...scelleuse(), statut: 'expedie', dateExpedition: '2026-10-15T06:00:00Z' };
  // Before the confirmation, a shipped dossier is not the departure's to load.
  assert.deepEqual(build({ envoi, items: [{ colis: shipped, client: flavie }], categories }).errors.map(error => error.kind), ['empty']);
  const invoice = build({ envoi, items: [{ colis: shipped, client: flavie }], categories, issuedAt: '2026-10-15T06:00:00Z', confirmed: true });
  assert.equal(invoice.ok, true, JSON.stringify(invoice.errors));
  assert.equal(invoice.rows.length, 2);
  assert.equal(invoice.meta.date, '2026-10-15');
  assert.deepEqual([invoice.meta.basis, invoice.meta.issuedAt], ['manifest', '2026-10-15T06:00:00.000Z']);
  assert.deepEqual([invoice.meta.exporter.nom, invoice.meta.consignee.ville], ['Expedîle', 'Sainte-Clotilde'], 'The same parties at the top.');
  assert.equal(build({ envoi, items: [], categories, confirmed: true }).errors[0].message, 'Aucun dossier embarqué dans ce manifeste : aucun article à déclarer.');
  // A manifest dossier without its quote: nothing to take off any more.
  assert.deepEqual(build({ envoi, items: [{ colis: { ...shipped, devisSnapshot: null }, client: flavie }], categories, confirmed: true }).errors.map(error => error.message), ['EXP-2YE537 : aucun devis enregistré']);
});

test('a dossier without saved quote or without consignee name blocks the invoice', () => {
  const withoutQuote = { ...scelleuse(), devisSnapshot: null };
  assert.deepEqual(build({ envoi, items: [{ colis: withoutQuote, client: flavie }], categories }).errors.map(error => error.message), ['EXP-2YE537 : devis non enregistré : enregistrez son devis ou retirez-le du départ.']);
  // An older quote saved without its transport: never a transport of 0,00 € on a customs document.
  const legacy = professional(proLines, proInvoices);
  legacy.devisSnapshot = { ...legacy.devisSnapshot, amounts: { total: legacy.devisSnapshot.amounts.total } };
  const withoutTransport = build({ envoi, items: [{ colis: legacy, client: lagon }], categories });
  assert.equal(withoutTransport.ok, false);
  assert.deepEqual(withoutTransport.errors, [{ ref: 'EXP-PRO001', colisId: 'p3', kind: 'quote', task: 'devis', message: 'EXP-PRO001 : montant du transport absent du devis enregistré' }]);
  assert.deepEqual(withoutTransport.rows, []);
  assert.deepEqual(build({ envoi, items: [{ colis: scelleuse(), client: null }], categories }).errors.map(error => error.message), ['EXP-2YE537 : nom du destinataire manquant']);
  // A frozen classification that must be checked again (pro line) is never printed.
  const stale = [{ ...proLines[0], customDuty: { code: '0901110000', stale: true } }];
  assert.deepEqual(build({ envoi, items: [{ colis: professional(stale, proInvoices.slice(0, 2)), client: lagon }], categories }).errors.map(error => error.message), ['EXP-PRO001 : classement douanier à vérifier pour « Café torréfié 1 kg »']);
});

test('names, days and file names', () => {
  assert.equal(invoiceConsigneeName(flavie), 'Hoarau Flavie');
  assert.equal(invoiceConsigneeName(lagon), 'Lagon Services SARL', 'A professional is named by its company.');
  assert.equal(invoiceConsigneeName({ ...lagon, raisonSociale: ' ' }), 'Payet Jean');
  assert.equal(invoiceConsigneeName({}), null);
  assert.equal(invoiceDayLabel('2026-10-07'), '07/10/2026');
  assert.equal(invoiceDayLabel(null), null);
  const invoice = build({ envoi: { ...envoi, modeTransport: null, destinationCode: null }, items: [{ colis: scelleuse(), client: flavie }], categories });
  assert.deepEqual([invoice.meta.mode, invoice.meta.destination], [null, null], 'An unrecorded mode or destination is never guessed.');
  assert.equal(commercialInvoiceFileName(invoice), 'facture-commerciale-ENV-2026-036-avant-depart');
  assert.equal(commercialInvoiceFileName({ ...invoice, meta: { ...invoice.meta, basis: 'manifest' } }), 'facture-commerciale-ENV-2026-036');
  assert.equal(invoiceIssueLabel('2026-10-07T12:32:00Z'), '07/10/2026 à 14 h 32');
  assert.equal(invoiceIssueLabel('2026-10-07T14:05:00Z'), '07/10/2026 à 16 h 05', 'Minutes on two digits.');
  assert.equal(invoiceIssueLabel('2026-10-01T06:00:45Z'), '01/10/2026 à 8 h', 'A whole hour as the closings of the page: « 8 h ».');
  assert.equal(invoiceIssueLabel('2026-12-15T07:05:00Z'), '15/12/2026 à 8 h 05', 'Winter time: UTC+1.');
  for (const value of [null, '', 'pas une date', '2026-10-07']) assert.equal(invoiceIssueLabel(value), null, `${JSON.stringify(value)}: no instant`);
});

test('two editions of one departure: the same number and day, never the same file nor the same basis line', () => {
  const items = [{ colis: scelleuse(), client: flavie }, { colis: troisArticles(), client: anli }];
  // 14 h 32 in Paris: the dossiers ready to load; 16 h 05: the confirmed manifest, one dossier deferred.
  const loading = build({ envoi, items, categories, issuedAt: Date.parse('2026-10-07T12:32:00Z') });
  const manifest = build({ envoi, items: items.slice(0, 1), categories, issuedAt: '2026-10-07T14:05:00Z', confirmed: true });
  assert.equal(loading.ok && manifest.ok, true);
  assert.deepEqual([loading.meta.number, loading.meta.date], [manifest.meta.number, manifest.meta.date], 'One departure, one number, one day.');
  assert.notEqual(loading.totals.total, manifest.totals.total, 'Their content differs.');
  assert.deepEqual([loading.meta.basis, loading.meta.issuedAt], ['loading', '2026-10-07T12:32:00.000Z']);
  assert.deepEqual([manifest.meta.basis, manifest.meta.issuedAt], ['manifest', '2026-10-07T14:05:00.000Z']);
  assert.equal(commercialInvoiceBasis(loading.meta), 'Établie avant la confirmation du départ, d’après tous les dossiers affectés au départ le 07/10/2026 à 14 h 32 (heure de Paris).');
  assert.equal(commercialInvoiceBasis(manifest.meta), 'Établie d’après le manifeste du départ confirmé le 07/10/2026 à 16 h 05 (heure de Paris).');
  assert.deepEqual([commercialInvoiceFileName(loading), commercialInvoiceFileName(manifest)], ['facture-commerciale-ENV-2026-036-avant-depart', 'facture-commerciale-ENV-2026-036']);
  // Without a known instant (a manifest without its confirmation time), no time is invented.
  const undated = build({ envoi, items, categories, issuedAt: null, confirmed: true });
  assert.deepEqual([undated.meta.date, undated.meta.issuedAt], [null, null]);
  assert.equal(commercialInvoiceBasis(undated.meta), 'Établie d’après le manifeste du départ confirmé.');
  assert.equal(commercialInvoiceBasis({ basis: 'loading', issuedAt: null }), 'Établie avant la confirmation du départ, d’après tous les dossiers affectés au départ.');
  const dayOnly = build({ envoi, items, categories, issuedAt: '2026-10-07' });
  assert.deepEqual([dayOnly.meta.date, dayOnly.meta.issuedAt], ['2026-10-07', null], 'A day alone keeps its day, without a time.');
});
