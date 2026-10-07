import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote } from './quote.js';
import { buildCommercialInvoice, commercialInvoiceBasis, commercialInvoiceFileName, invoiceConsigneeName, invoiceDayLabel, invoiceIssueLabel } from './commercialInvoice.js';

const cents = values => values.reduce((sum, value) => sum + Math.round(value * 100), 0);
const categories = [
  { id: 'cat-cuir', label: 'Cuir', codeHs: '4205', taux: { 974: { om: 5, omr: 2.5 } } },
  { id: 'cat-plastique', label: 'Vaisselle plastique', codeHs: '39241000', taux: { 974: { om: 5, omr: 2.5 } } },
  { id: 'cat-cafe', label: 'Café', codeHs: '0901210000', taux: { 974: { om: 0, omr: 0 } } },
  { id: 'cat-porcelaine', label: 'Porcelaine', codeHs: '6911100000', taux: { 974: { om: 10, omr: 2.5 } } },
  { id: 'cat-sans-code', label: 'Luminaires', codeHs: '', taux: { 974: { om: 10, omr: 2.5 } } },
];
const envoi = { id: 'env-36', ref: 'ENV-2026-036', date: '2026-10-15', destinationCode: '974', modeTransport: 'aerien' };
const flavie = { id: 'c-flavie', type: 'particulier', nom: 'Hoarau Flavie', nomFamille: 'Hoarau', prenom: 'Flavie', cp: '97400' };
const anli = { id: 'c-anli', type: 'particulier', nom: 'Madi Anli', nomFamille: 'Madi', prenom: 'Anli', cp: '97400' };
const lagon = { id: 'c-lagon', type: 'pro', nom: 'Payet Jean', nomFamille: 'Payet', prenom: 'Jean', raisonSociale: 'Lagon Services SARL', cp: '97410', methodePaiement: 'virement' };
const box = (dimL, dimW, dimH, poids) => ({ dimL, dimW, dimH, poids });
const line = (id, desc, qte, prix, cat, factureId = 'f1') => ({ id, factureId, desc, qte, prix, cat });

/** A dossier paid with its quote saved by the real engine, as the departure reads it. */
function paidDossier(fields, client, tarif = { base: 25, parKg: 5 }) {
  const colis = {
    statut: 'en_preparation', fraisDivers: [], preparationCompositionVersion: 1, finalMeasurementsVersion: 1,
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
  const invoice = buildCommercialInvoice({ envoi, items: [{ colis: troisArticles(), client: anli }, { colis: scelleuse(), client: flavie }], categories, issuedAt: '2026-10-07T22:30:00Z' });
  assert.equal(invoice.ok, true, JSON.stringify(invoice.errors));
  assert.deepEqual(invoice.errors, []);
  assert.deepEqual(invoice.excluded, []);
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
  assert.deepEqual(invoice.meta, { number: 'ENV-2026-036', date: '2026-10-08', departureDate: '2026-10-15', destination: 'La Réunion', mode: 'Aérien', dossiers: 2, parcels: 2, weight: 2.9, basis: 'loading', issuedAt: '2026-10-07T22:30:00.000Z' },
    'The issue day is the Paris day (00:30 on 8 October in Paris).');
});

test('a professional declares its own articles, without those of rejected, replaced or duplicate invoices', () => {
  const colis = professional(proLines, proInvoices);
  assert.equal(colis.devisSnapshot.amounts.taxLines.length, 0, 'A professional quote has no article.');
  const invoice = buildCommercialInvoice({ envoi, items: [{ colis, client: lagon }], categories, issuedAt: '2026-10-07T10:00:00Z' });
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
  const fromManifest = buildCommercialInvoice({ envoi, items: [{ colis: { ...colis, lignes: [] }, client: lagon, lignes: proLines }], categories, issuedAt: '2026-10-07T10:00:00Z' });
  assert.deepEqual(fromManifest.rows, invoice.rows);
});

test('a professional without any article line blocks the invoice', () => {
  const invoice = buildCommercialInvoice({ envoi, items: [{ colis: professional([], []), client: lagon }], categories });
  assert.equal(invoice.ok, false);
  assert.deepEqual(invoice.errors, [{ ref: 'EXP-PRO001', colisId: 'p3', kind: 'articles', task: 'documents', message: 'EXP-PRO001 : aucun article à déclarer' }]);
  // Lines whose value is nothing cannot carry the transport: never a lost share.
  const free = buildCommercialInvoice({ envoi, items: [{ colis: professional([line('lp-0', 'Échantillon', 1, 0, 'cat-cafe', 'fp1')], proInvoices.slice(0, 2)), client: lagon }], categories });
  assert.deepEqual(free.errors.map(error => error.message), ['EXP-PRO001 : valeur des articles nulle : le transport ne peut pas être réparti']);
});

test('a missing HS code blocks the invoice: never an empty or invented code (D33)', () => {
  const lampe = paidDossier({ id: 'p4', ref: 'EXP-LAMPE1', finalPackages: [box(30, 30, 30, 2)], lignes: [line('l-6', 'Lampe de chevet', 2, 19.9, 'cat-sans-code'), line('l-7', 'Abat-jour', 1, 12, 'cat-cuir')] }, flavie);
  const invoice = buildCommercialInvoice({ envoi, items: [{ colis: lampe, client: flavie }, { colis: scelleuse(), client: flavie }], categories });
  assert.equal(invoice.ok, false);
  assert.deepEqual(invoice.errors, [{ ref: 'EXP-LAMPE1', colisId: 'p4', kind: 'hs-code', task: 'devis', category: 'Luminaires', message: 'EXP-LAMPE1 : code SH manquant pour « Lampe de chevet » (catégorie « Luminaires »)' }],
    'The category whose customs code is missing is named.');
  assert.ok(invoice.rows.every(row => row.ref !== 'EXP-LAMPE1' && row.hsCode), 'The blocked dossier gives no row, and no row has an empty code.');
  // The category completed afterwards (Paramètres › Catégories et taxes) unblocks it.
  const completed = categories.map(category => (category.id === 'cat-sans-code' ? { ...category, codeHs: '9405210000' } : category));
  const fixed = buildCommercialInvoice({ envoi, items: [{ colis: lampe, client: flavie }], categories: completed });
  // Transport 25 + 5,4 kg (volumetric, the heavier) × 5 = 52,00 €, shared by value (39,80 € and 12,00 €).
  assert.equal(lampe.devisSnapshot.amounts.transport, 52);
  assert.equal(fixed.ok, true, JSON.stringify(fixed.errors));
  assert.deepEqual(fixed.rows.map(row => [row.hsCode, row.value, row.transport]), [['9405210000', 39.8, 39.95], ['4205', 12, 12.05]]);
  assert.equal(cents(fixed.rows.map(row => row.transport)), Math.round(lampe.devisSnapshot.amounts.transport * 100));
  // A professional's articles are those of its invoices: the dossier opens on them, where a category is chosen.
  const uncoded = professional([line('lp-9', 'Lampadaire', 1, 80, 'cat-sans-code', 'fp1'), line('lp-10', 'Ampoules', 2, 5, null, 'fp1')], proInvoices.slice(0, 2));
  assert.deepEqual(buildCommercialInvoice({ envoi, items: [{ colis: uncoded, client: lagon }], categories }).errors.map(error => [error.kind, error.task, error.category, error.message]), [
    ['hs-code', 'documents', 'Luminaires', 'EXP-PRO001 : code SH manquant pour « Lampadaire » (catégorie « Luminaires »)'],
    ['hs-code', 'documents', null, 'EXP-PRO001 : code SH manquant pour « Ampoules » (sans catégorie)'],
  ], 'Without a category, there is no category code to complete: one is to be chosen.');
  // The porcelain of 7 October: the category without its code is the one to complete.
  const porcelaine = categories.map(category => (category.id === 'cat-porcelaine' ? { ...category, codeHs: '' } : category));
  assert.deepEqual(buildCommercialInvoice({ envoi, items: [{ colis: professional(proLines, proInvoices), client: lagon }], categories: porcelaine }).errors.map(error => error.message),
    ['EXP-PRO001 : code SH manquant pour « Tasses en porcelaine » (catégorie « Porcelaine »)']);
  // A quote whose category is gone since names the one saved with it.
  assert.deepEqual(buildCommercialInvoice({ envoi, items: [{ colis: lampe, client: flavie }], categories: categories.filter(category => category.id !== 'cat-sans-code') }).errors.map(error => [error.category, error.message]),
    [['Luminaires', 'EXP-LAMPE1 : code SH manquant pour « Lampe de chevet » (catégorie « Luminaires »)']]);
});

test('HS codes stay text: leading zeros are kept', () => {
  const invoice = buildCommercialInvoice({ envoi, items: [{ colis: professional(proLines.slice(0, 1), proInvoices.slice(0, 2)), client: lagon }], categories });
  assert.equal(invoice.rows[0].hsCode, '0901210000');
  assert.equal(typeof invoice.rows[0].hsCode, 'string');
});

test('before the departure, only the dossiers ready to load are included; the others are listed with their reason', () => {
  const unpaid = { ...scelleuse(), id: 'p5', ref: 'EXP-ATTENTE', statut: 'attente_paiement', paiementDate: null };
  const outdated = { ...troisArticles(), id: 'p6', ref: 'EXP-CARTON', preparationCompositionVersion: 2 };
  const items = [{ colis: unpaid, client: flavie }, { colis: scelleuse(), client: flavie }, { colis: outdated, client: anli }];
  const invoice = buildCommercialInvoice({ envoi, items, categories });
  assert.equal(invoice.ok, true, JSON.stringify(invoice.errors));
  assert.deepEqual(invoice.excluded, [
    { ref: 'EXP-ATTENTE', colisId: 'p5', task: 'paiement', reason: 'Paiement non confirmé' },
    { ref: 'EXP-CARTON', colisId: 'p6', task: 'preparation', reason: 'Mesures à revoir après modification des cartons' },
  ]);
  assert.deepEqual([...new Set(invoice.rows.map(row => row.ref))], ['EXP-2YE537']);
  assert.deepEqual([invoice.meta.dossiers, invoice.meta.parcels, invoice.meta.weight], [1, 1, 1.9]);
  // Nothing ready: the invoice says why instead of an empty document.
  const none = buildCommercialInvoice({ envoi, items: [{ colis: unpaid, client: flavie }], categories });
  assert.equal(none.ok, false);
  assert.deepEqual(none.errors, [{ ref: null, colisId: null, kind: 'empty', task: null, message: 'Aucun dossier prêt à charger : la facture reprend les dossiers payés et préparés de ce départ.' }]);
  assert.equal(buildCommercialInvoice({ envoi, items: [], categories }).ok, false);
});

test('after the departure, every dossier of the frozen manifest is included', () => {
  const shipped = { ...scelleuse(), statut: 'expedie', dateExpedition: '2026-10-15T06:00:00Z' };
  assert.deepEqual(buildCommercialInvoice({ envoi, items: [{ colis: shipped, client: flavie }], categories }).excluded.map(item => item.reason), ['Paiement non confirmé']);
  const invoice = buildCommercialInvoice({ envoi, items: [{ colis: shipped, client: flavie }], categories, issuedAt: '2026-10-15T06:00:00Z', confirmed: true });
  assert.equal(invoice.ok, true, JSON.stringify(invoice.errors));
  assert.deepEqual(invoice.excluded, []);
  assert.equal(invoice.rows.length, 2);
  assert.equal(invoice.meta.date, '2026-10-15');
  assert.deepEqual([invoice.meta.basis, invoice.meta.issuedAt], ['manifest', '2026-10-15T06:00:00.000Z']);
  assert.equal(buildCommercialInvoice({ envoi, items: [], categories, confirmed: true }).errors[0].message, 'Aucun dossier embarqué dans ce manifeste : aucun article à déclarer.');
});

test('a dossier without saved quote or without consignee name blocks the invoice', () => {
  const withoutQuote = { ...scelleuse(), devisSnapshot: null };
  assert.deepEqual(buildCommercialInvoice({ envoi, items: [{ colis: withoutQuote, client: flavie }], categories }).errors.map(error => error.message), ['EXP-2YE537 : aucun devis enregistré']);
  // An older quote saved without its transport: never a transport of 0,00 € on a customs document.
  const legacy = professional(proLines, proInvoices);
  legacy.devisSnapshot = { ...legacy.devisSnapshot, amounts: { total: legacy.devisSnapshot.amounts.total } };
  const withoutTransport = buildCommercialInvoice({ envoi, items: [{ colis: legacy, client: lagon }], categories });
  assert.equal(withoutTransport.ok, false);
  assert.deepEqual(withoutTransport.errors, [{ ref: 'EXP-PRO001', colisId: 'p3', kind: 'quote', task: 'devis', message: 'EXP-PRO001 : montant du transport absent du devis enregistré' }]);
  assert.deepEqual(withoutTransport.rows, []);
  assert.deepEqual(buildCommercialInvoice({ envoi, items: [{ colis: scelleuse(), client: null }], categories }).errors.map(error => error.message), ['EXP-2YE537 : nom du destinataire manquant']);
  // A frozen classification that must be checked again (pro line) is never printed.
  const stale = [{ ...proLines[0], customDuty: { code: '0901110000', stale: true } }];
  assert.deepEqual(buildCommercialInvoice({ envoi, items: [{ colis: professional(stale, proInvoices.slice(0, 2)), client: lagon }], categories }).errors.map(error => error.message), ['EXP-PRO001 : classement douanier à vérifier pour « Café torréfié 1 kg »']);
});

test('names, days and file names', () => {
  assert.equal(invoiceConsigneeName(flavie), 'Hoarau Flavie');
  assert.equal(invoiceConsigneeName(lagon), 'Lagon Services SARL', 'A professional is named by its company.');
  assert.equal(invoiceConsigneeName({ ...lagon, raisonSociale: ' ' }), 'Payet Jean');
  assert.equal(invoiceConsigneeName({}), null);
  assert.equal(invoiceDayLabel('2026-10-07'), '07/10/2026');
  assert.equal(invoiceDayLabel(null), null);
  const invoice = buildCommercialInvoice({ envoi: { ...envoi, modeTransport: null, destinationCode: null }, items: [{ colis: scelleuse(), client: flavie }], categories });
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
  const loading = buildCommercialInvoice({ envoi, items, categories, issuedAt: Date.parse('2026-10-07T12:32:00Z') });
  const manifest = buildCommercialInvoice({ envoi, items: items.slice(0, 1), categories, issuedAt: '2026-10-07T14:05:00Z', confirmed: true });
  assert.equal(loading.ok && manifest.ok, true);
  assert.deepEqual([loading.meta.number, loading.meta.date], [manifest.meta.number, manifest.meta.date], 'One departure, one number, one day.');
  assert.notEqual(loading.totals.total, manifest.totals.total, 'Their content differs.');
  assert.deepEqual([loading.meta.basis, loading.meta.issuedAt], ['loading', '2026-10-07T12:32:00.000Z']);
  assert.deepEqual([manifest.meta.basis, manifest.meta.issuedAt], ['manifest', '2026-10-07T14:05:00.000Z']);
  assert.equal(commercialInvoiceBasis(loading.meta), 'Établie avant la confirmation du départ, d’après les dossiers prêts à charger le 07/10/2026 à 14 h 32 (heure de Paris).');
  assert.equal(commercialInvoiceBasis(manifest.meta), 'Établie d’après le manifeste du départ confirmé le 07/10/2026 à 16 h 05 (heure de Paris).');
  assert.deepEqual([commercialInvoiceFileName(loading), commercialInvoiceFileName(manifest)], ['facture-commerciale-ENV-2026-036-avant-depart', 'facture-commerciale-ENV-2026-036']);
  // Without a known instant (a manifest without its confirmation time), no time is invented.
  const undated = buildCommercialInvoice({ envoi, items, categories, issuedAt: null, confirmed: true });
  assert.deepEqual([undated.meta.date, undated.meta.issuedAt], [null, null]);
  assert.equal(commercialInvoiceBasis(undated.meta), 'Établie d’après le manifeste du départ confirmé.');
  assert.equal(commercialInvoiceBasis({ basis: 'loading', issuedAt: null }), 'Établie avant la confirmation du départ, d’après les dossiers prêts à charger.');
  const dayOnly = buildCommercialInvoice({ envoi, items, categories, issuedAt: '2026-10-07' });
  assert.deepEqual([dayOnly.meta.date, dayOnly.meta.issuedAt], ['2026-10-07', null], 'A day alone keeps its day, without a time.');
});
