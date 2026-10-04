import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDossierOverview as overview } from './dossierOverview.js';

const now = Date.parse('2026-10-02T12:00:00Z');
const options = { now, can: () => true, client: { type: 'particulier', cp: '97400' } };
const receivedBox = poids => ({ dimL: 40, dimW: 30, dimH: 20, poids });
const reception = { id: 'dossier', ref: 'EXP-TEST', casier: '5C', statut: 'mesure', nbColis: 2,
  dateReception: '2026-09-28T10:00:00Z', dimsParColis: [receivedBox(1), receivedBox(2)],
  trackingsDetail: [{ number: 'TRACK-1', fournisseur: 'Amazon' }, { number: 'TRACK-2', fournisseur: 'Zara' }], factures: [],
};
const prepared = { ...reception, statut: 'en_preparation', feuVert: 'autorise', feuVertDate: '2026-09-29T10:00:00Z',
  preparationCompositionVersion: 2, finalMeasurementsVersion: 2, finalMeasurementsAt: '2026-09-30T10:00:00Z',
  outgoingParcelCount: 1, finalPackages: [{ dimL: 30, dimW: 20, dimH: 15, poids: 2.5 }],
  factures: [{ id: 'invoice', fichier: 'private/invoice.pdf', valide: true, montant: 40 }],
};
const quoted = { ...prepared, statut: 'devis_envoye', devisTotal: 100, quoteVersion: 1, devisBrouillon: false, devisEnvoyeLe: '2026-10-01T10:00:00Z' };
const paid = { ...quoted, statut: 'paye', paiementMontant: 100, paiementDate: '2026-10-02T09:00:00Z' };
const step = (model, id) => model.steps.find(item => item.id === id);

test('the permanent overview separates two received cartons from one certified optimized package', () => {
  const result = overview(paid, options);
  assert.equal(result.reference, 'EXP-TEST'); assert.equal(result.casier, '5C');
  assert.equal(result.received.count, 2); assert.equal(result.received.totalWeight, 3); assert.equal(result.received.complete, true);
  assert.deepEqual(result.received.boxes.map(box => [box.number, box.tracking, box.supplier, box.poids]), [[1, 'TRACK-1', 'Amazon', 1], [2, 'TRACK-2', 'Zara', 2]]);
  assert.equal(result.optimization.current, true); assert.equal(result.optimization.count, 1); assert.equal(result.optimization.totalWeight, 2.5);
  assert.equal(result.optimization.boxes[0].dimL, 30); assert.equal(result.received.boxes[0].dimL, 40);
  assert.deepEqual(result.steps.map(item => item.id), ['reception', 'accord', 'preparation', 'documents', 'devis', 'paiement', 'expedition', 'livraison']);
  assert.equal(result.currentTask, 'expedition'); assert.equal(step(result, 'expedition').current, true);
  assert.equal(step(result, 'livraison').state, 'upcoming'); assert.equal(result.delivery.date, null);
});

test('no receipt evidence fabricates neither one carton nor a recorded reception', () => {
  const result = overview({ statut: 'receptionne' }, options);
  assert.equal(result.received.count, null); assert.deepEqual(result.received.boxes, []);
  assert.equal(result.received.totalWeight, null); assert.equal(result.received.complete, false);
  assert.equal(step(result, 'reception').state, 'current');
  assert.equal(result.casier, null); assert.equal(result.reference, 'Référence à préciser');
});

test('missing legacy carton dimensions stay missing and a multi-carton total is never divided', () => {
  const result = overview({ ...reception, dimsParColis: [], poids: 3, dimL: 40, dimW: 30, dimH: 20, trackingsDetail: [null, { number: 'TRACK-2' }] }, options);
  assert.equal(result.received.count, 2); assert.equal(result.received.complete, false);
  assert.equal(result.received.totalWeight, null); assert.equal(result.received.boxes[0].poids, null);
  assert.equal(result.received.boxes[1].tracking, 'TRACK-2');
});

test('an unknown workflow status is explicit and has no invented next action', () => {
  const result = overview({ statut: 'unexpected' }, options);
  assert.equal(result.statusLabel, 'État à vérifier'); assert.equal(result.currentTask, null);
  assert.equal(result.steps.some(item => item.current), false);
  assert.equal(result.alerts[0].code, 'unknown-status');
});

test('payment and later transport statuses never certify missing earlier physical work', () => {
  const result = overview({ ...paid, nbColis: null, dimsParColis: [], trackingsDetail: [], finalPackages: [], finalMeasurementsVersion: null, factures: [] }, options);
  assert.equal(step(result, 'paiement').state, 'done');
  for (const id of ['reception', 'preparation', 'documents']) assert.equal(step(result, id).state, 'unknown');
  assert.equal(result.alerts[0].code, 'preparation-unconfirmed');
});

test('an unverified invoice kept after payment is never « À faire » (UX-R2-03)', () => {
  const late = { id: 'late', fichier: 'private/late.pdf', valide: false, montant: 0 };
  const documents = step(overview({ ...paid, factures: [...paid.factures, late] }, options), 'documents');
  assert.equal(documents.state, 'not_required'); assert.match(documents.summary, /^Factures figées · 1 facture non vérifiée conservée hors devis$/);
  assert.equal(step(overview({ ...quoted, factures: [...quoted.factures, late] }, options), 'documents').state, 'current');
});

test('a changed composition preserves previous optimized values as a reviewable draft', () => {
  for (const finalMeasurementsVersion of [1, null]) {
    const result = overview({ ...prepared, statut: 'mesure', feuVert: 'en_attente', finalMeasurementsVersion, finalMeasurementsAt: null, outgoingParcelCount: null }, options);
    assert.equal(result.optimization.current, false); assert.equal(result.optimization.state, 'review');
    assert.equal(result.optimization.count, 1); assert.equal(result.optimization.totalWeight, 2.5);
    assert.match(result.optimization.summary, /Anciennes mesures conservées/);
    assert.equal(step(result, 'preparation').state, 'review');
  }
});

test('an explicit empty optimized package list never revives old scalar measurements', () => {
  const result = overview({ ...prepared, finalPackages: [], finL: 10, finW: 20, finH: 30, finP: 99 }, options);
  assert.equal(result.optimization.current, false); assert.deepEqual(result.optimization.boxes, []);
  assert.equal(result.optimization.totalWeight, null); assert.equal(result.optimization.count, null);
});

test('only legacy null final packages may use independently saved final scalar measurements', () => {
  const result = overview({ ...prepared, finalPackages: null, finL: 10, finW: 20, finH: 30, finP: 2.5 }, options);
  assert.equal(result.optimization.current, true); assert.equal(result.optimization.totalWeight, 2.5);
  assert.equal(result.optimization.boxes[0].dimL, 10);
});

test('incomplete or uncertified final values are not a finished optimization', () => {
  for (const patch of [{ finalMeasurementsVersion: null, preparationCompositionVersion: null }, { outgoingParcelCount: 2 }, { finalPackages: [{ dimL: 30, dimW: 20, dimH: 15, poids: null }] }]) {
    const result = overview({ ...prepared, ...patch }, options);
    assert.equal(result.optimization.current, false); assert.equal(step(result, 'preparation').state, 'review');
  }
  assert.equal(overview({ ...prepared, finalPackages: [{ dimL: 30, dimW: 20, dimH: 15, poids: null }] }, options).optimization.totalWeight, null);
});

test('invoice counts exclude duplicates and replaced copies without losing pending or rejected originals', () => {
  const factures = [
    { id: 'old', fichier: 'old.pdf', valide: true },
    { id: 'replacement', replacesFactureId: 'old', fichier: 'new.pdf', valide: true, montant: 30 },
    { id: 'copy', duplicateOfId: 'replacement', fichier: 'copy.pdf', valide: true },
    { id: 'pending', fichier: 'pending.pdf', valide: false },
    { id: 'rejected', fichier: 'rejected.pdf', valide: true, rejetMotif: 'Document illisible' },
  ];
  const result = overview({ ...prepared, factures }, options);
  assert.equal(result.invoices.receivedCount, 3); assert.equal(result.invoices.validatedCount, 1);
  assert.equal(result.invoices.reviewCount, 1); assert.equal(result.invoices.rejectedCount, 1);
  assert.equal(result.invoices.excludedCount, 2); assert.equal(step(result, 'documents').state, 'review');
  // The same wording as the invoice workspace: counted invoices only, every open bucket named.
  assert.equal(result.invoices.summary, '1 sur 3 factures vérifiées · 1 à vérifier · 1 à corriger par le client');
  assert.equal(step(result, 'documents').summary, result.invoices.summary);
});

test('the overview never shows a second invoice total: same wording as the workspace in every state', () => {
  const at = day => `2026-09-0${day}T08:00:00Z`;
  const verified = day => ({ id: `v${day}`, createdAt: at(day), fichier: `v${day}.pdf`, valide: true, montant: 10 });
  const eight = [verified(1), verified(2), verified(3),
    { id: 't4', createdAt: at(4), fichier: 't4.pdf', valide: false }, { id: 't5', createdAt: at(5), fichier: 't5.pdf', valide: false }, { id: 't6', createdAt: at(6), fichier: 't6.pdf', valide: false },
    { id: 'r7', createdAt: at(7), fichier: 'r7.pdf', valide: false, rejetMotif: 'Floue' }, { id: 'm8', createdAt: at(8) },
    { id: 'copy', createdAt: at(9), fichier: 'c.pdf', valide: false, duplicateOfId: 'v1' }];
  const work = overview({ ...prepared, factures: eight }, options);
  assert.equal(work.invoices.summary, '3 sur 8 factures vérifiées · 3 à vérifier · 1 à corriger par le client · 1 document manquant');
  assert.doesNotMatch(work.invoices.summary, /reçue\(s\)|validée\(s\)|à retrouver/);
  const done = overview({ ...prepared, factures: [verified(1), verified(2), { id: 'copy', fichier: 'c.pdf', duplicateOfId: 'v1' }] }, options);
  assert.equal(done.invoices.summary, '2 factures · toutes vérifiées'); assert.equal(step(done, 'documents').state, 'done');
  const legacy = overview({ ...prepared, factures: [{ id: 'legacy', fichier: 'l.pdf', valide: true, montant: 0 }] }, options);
  assert.notEqual(step(legacy, 'documents').state, 'done', 'A validation without amount is not verified, as in the workspace.');
});

test('a conversation attachment left to sort keeps the overview in step with the workspace', () => {
  const verified = n => ({ id: `v${n}`, createdAt: `2026-09-0${n}T08:00:00Z`, fichier: `v${n}.pdf`, valide: true, montant: 10 });
  const factures = [verified(1), verified(2), verified(3)];
  const messages = [{ id: 'm1', type: 'client', attachmentPath: 'dossier/nouvelle.pdf' }, { id: 'm2', type: 'client', attachmentPath: 'v1.pdf' }];
  const result = overview({ ...prepared, factures, messages }, options);
  assert.equal(result.invoices.summary, '3 sur 3 factures vérifiées · 1 document reçu à trier');
  assert.notEqual(step(result, 'documents').state, 'done', 'Documents still to sort: the step is not finished.');
  const sorted = overview({ ...prepared, factures, messages: [messages[1]] }, options);
  assert.equal(sorted.invoices.summary, '3 factures · toutes vérifiées'); assert.equal(step(sorted, 'documents').state, 'done');
});

test('an invoice record with no file is never presented as a received validated document', () => {
  const result = overview({ ...prepared, factures: [{ id: 'missing', valide: true }] }, options);
  assert.equal(result.invoices.receivedCount, 0); assert.equal(result.invoices.validatedCount, 0);
  assert.equal(result.invoices.missingFileCount, 1); assert.equal(step(result, 'documents').state, 'unknown');
});

test('all real current invoices validated completes the document stage, including a retained duplicate', () => {
  const result = overview({ ...prepared, factures: [...prepared.factures, { id: 'duplicate', fichier: 'copy.pdf', duplicateOfId: 'invoice', valide: false }] }, options);
  assert.equal(result.invoices.receivedCount, 1); assert.equal(result.invoices.validatedCount, 1);
  assert.equal(result.invoices.excludedCount, 1); assert.equal(step(result, 'documents').state, 'done');
});

test('unloaded invoice data is not confused with an explicitly empty optional professional file list', () => {
  const pro = { ...options, client: { type: 'pro' } };
  const missing = overview({ ...prepared, factures: undefined }, pro);
  assert.equal(missing.invoices.receivedCount, null); assert.equal(step(missing, 'documents').state, 'unknown');
  assert.equal(step(overview({ ...prepared, factures: [] }, pro), 'documents').state, 'not_required');
});

test('invoice and finance permissions hide counts, money, dates and links independently', () => {
  const hidden = overview(paid, { ...options, can: () => false });
  assert.deepEqual(hidden.payment, { visible: false, requested: null, paid: null, remaining: null, sentAt: null, stateLabel: 'Accès réservé aux paiements' });
  for (const key of ['receivedCount', 'validatedCount', 'reviewCount', 'rejectedCount', 'excludedCount', 'missingFileCount']) assert.equal(hidden.invoices[key], null);
  for (const id of ['documents', 'devis', 'paiement']) {
    assert.equal(step(hidden, id).state, 'restricted'); assert.equal(step(hidden, id).canOpen, false); assert.equal(step(hidden, id).date, null);
  }
  assert.equal(step(hidden, 'reception').canOpen, true); assert.equal(step(hidden, 'expedition').canOpen, true);
  assert.equal(JSON.stringify(hidden).includes('private/invoice.pdf'), false);
  const documentsOnly = overview(paid, { ...options, can: permission => permission === 'perm_factures_valider' });
  assert.equal(documentsOnly.invoices.visible, true); assert.equal(documentsOnly.payment.visible, false);
  const financeOnly = overview(paid, { ...options, can: permission => permission === 'perm_finances_voir_total' });
  assert.equal(financeOnly.invoices.visible, false); assert.equal(financeOnly.payment.requested, 100);
});

test('a partial payment remains partial even when the status says paid', () => {
  const result = overview({ ...paid, paiementMontant: 30 }, options);
  assert.equal(result.payment.paid, 30); assert.equal(result.payment.remaining, 70);
  assert.equal(result.payment.stateLabel, 'Paiement partiel'); assert.notEqual(step(result, 'paiement').state, 'done');
  assert.equal(result.departure.readinessLabel, 'Paiement à compléter');
  assert.equal(result.alerts.some(alert => alert.code === 'payment-unconfirmed'), true);
});

test('a bare paid status, payment link, unknown amount or future payment date proves no full payment', () => {
  for (const patch of [{ paiementMontant: null }, { paiementDate: null }, { paiementDate: '2099-01-01' }]) {
    const result = overview({ ...paid, payplugPaymentUrl: 'https://payment.invalid', ...patch }, options);
    assert.notEqual(step(result, 'paiement').state, 'done'); assert.notEqual(result.payment.stateLabel, 'Payé');
  }
});

test('a quote recorded without a valid sent date does not claim to have been transmitted', () => {
  for (const devisEnvoyeLe of [null, '2099-01-01', 'invalid']) {
    const result = overview({ ...paid, devisEnvoyeLe }, options);
    assert.equal(result.payment.requested, 100); assert.equal(step(result, 'devis').state, 'unknown');
    assert.equal(step(result, 'devis').summary, 'Devis enregistré · envoi à vérifier'); assert.equal(step(result, 'devis').date, null);
  }
  assert.equal(step(overview(quoted, options), 'devis').state, 'done');
});

test('a reopened or invalidated quote never advertises its old amount as a current request', () => {
  const result = overview({ ...quoted, statut: 'mesure', feuVert: 'en_attente', quoteNeedsReview: true }, options);
  assert.equal(result.payment.requested, null); assert.equal(result.payment.remaining, null);
  assert.equal(step(result, 'devis').state, 'review'); assert.match(step(result, 'devis').summary, /Ancien devis/);
});

test('zero initial placeholders are unknown rather than a free fully paid shipment', () => {
  const empty = overview({ ...reception, devisTotal: 0, quoteVersion: 0 }, options);
  assert.equal(empty.payment.requested, null); assert.equal(empty.payment.remaining, null);
  assert.notEqual(step(empty, 'paiement').state, 'done');
  const realZero = overview({ ...quoted, devisTotal: 0, devisSnapshot: { amounts: { total: 0 } } }, options);
  assert.equal(realZero.payment.requested, 0); assert.notEqual(step(realZero, 'paiement').state, 'done');
});

test('a recorded refusal, voluntary waiting and approval each retain their actual date', () => {
  const refused = overview({ ...reception, statut: 'refuse_client', feuVert: 'refuse', feuVertDate: '2026-10-01T10:00:00Z' }, options);
  assert.equal(step(refused, 'accord').state, 'review'); assert.equal(step(refused, 'accord').date, '2026-10-01T10:00:00Z');
  const waiting = overview({ ...reception, statut: 'attente_feu_vert', demandeFeuVertEnvoyeeAt: '2026-09-29T10:00:00Z', attenteClientDate: '2026-10-01T10:00:00Z', attenteClientUntil: '2026-10-05' }, options);
  assert.equal(step(waiting, 'accord').state, 'waiting'); assert.equal(step(waiting, 'accord').date, '2026-10-01T10:00:00Z');
  assert.match(step(waiting, 'accord').summary, /05\/10\/2026/);
  assert.equal(step(overview(prepared, options), 'accord').date, prepared.feuVertDate);
});

test('a newer request or a reopened reception invalidates the earlier approval in the overview', () => {
  for (const patch of [{ statut: 'mesure' }, { demandeFeuVertEnvoyeeAt: '2026-10-01T10:00:00Z' }]) {
    const result = overview({ ...prepared, ...patch }, options);
    assert.equal(step(result, 'accord').state, 'review'); assert.equal(step(result, 'accord').summary, 'Accord précédent à renouveler');
  }
  assert.match(step(overview({ ...reception, consentRequestVersion: 3 }, options), 'accord').summary, /Nouvelle demande/);
});

test('the actual assigned future departure remains planned after its loading cutoff and never predicts delivery', () => {
  const envois = [{ id: 'assigned', date: '2026-10-10', destinationCode: '974', statut: 'planifie', loadingClosesAt: '2026-10-01T10:00:00Z' }];
  const result = overview({ ...paid, envoi: 'assigned' }, { ...options, envois });
  assert.equal(result.departure.date, '2026-10-10'); assert.equal(result.departure.confirmedAt, null);
  assert.match(step(result, 'expedition').summary, /Prévu le 10\/10\/2026/);
  assert.equal(step(result, 'expedition').date, '2026-10-10'); assert.equal(step(result, 'expedition').state, 'current');
  assert.equal(result.delivery.date, null); assert.equal(result.delivery.state, 'upcoming');
});

test('unrelated planning never creates a dossier departure and unknown assignment is not silently replaced', () => {
  const envois = [{ id: 'other', date: '2026-10-10', destinationCode: '974', statut: 'planifie' }];
  assert.equal(overview(paid, { ...options, envois }).departure.date, null);
  const result = overview({ ...paid, envoi: 'missing' }, { ...options, envois });
  assert.equal(result.departure.date, null); assert.equal(result.departure.label, 'Départ à vérifier');
  assert.equal(step(result, 'expedition').state, 'unknown');
});

test('cancelled and past departure planning need review instead of claiming shipment', () => {
  for (const envoi of [{ id: 'assigned', date: '2026-10-10', statut: 'annule' }, { id: 'assigned', date: '2026-10-01', statut: 'planifie' }]) {
    const result = overview({ ...paid, envoi: 'assigned' }, { ...options, envois: [envoi] });
    assert.equal(step(result, 'expedition').state, 'review'); assert.equal(result.departure.confirmedAt, null);
    assert.equal(result.delivery.date, null);
  }
});

test('only saved departure evidence confirms shipping, never a status or a future timestamp', () => {
  const uncertain = overview({ ...paid, statut: 'transit' }, options);
  assert.equal(step(uncertain, 'expedition').state, 'unknown');
  const future = overview({ ...paid, dateExpedition: '2099-01-01' }, options);
  assert.notEqual(step(future, 'expedition').state, 'done'); assert.equal(future.departure.confirmedAt, null);
  const recorded = overview({ ...paid, statut: 'transit', dateExpedition: '2026-10-01T12:00:00Z' }, options);
  assert.equal(step(recorded, 'expedition').state, 'done'); assert.equal(recorded.departure.confirmedAt, '2026-10-01T12:00:00Z');
  const manifest = overview({ ...paid, envoi: 'assigned' }, { ...options, envois: [{ id: 'assigned', manifestVersion: 1 }] });
  assert.equal(step(manifest, 'expedition').state, 'done'); assert.equal(manifest.departure.confirmedAt, null);
});

test('arrival is not delivery and a delivered label without evidence leaves confirmation unknown', () => {
  const arrived = overview({ ...paid, statut: 'arrive' }, options);
  assert.equal(arrived.delivery.state, 'current'); assert.equal(arrived.delivery.date, null);
  assert.match(arrived.delivery.summary, /livraison à organiser/);
  const missing = overview({ ...paid, statut: 'livre' }, options);
  assert.equal(missing.delivery.state, 'unknown'); assert.equal(missing.currentTask, null);
  const delivered = overview({ ...paid, statut: 'livre', dateLivraison: '2026-10-02T11:00:00Z' }, options);
  assert.equal(delivered.delivery.state, 'done'); assert.equal(step(delivered, 'livraison').date, '2026-10-02T11:00:00Z');
});

test('archived or cancelled dossiers retain confirmed history with no future action expected', () => {
  for (const patch of [{ archive: true }, { statut: 'annule' }]) {
    const result = overview({ ...reception, ...patch }, options);
    assert.equal(result.currentTask, null); assert.equal(step(result, 'reception').state, 'done');
    assert.equal(result.steps.some(item => ['current', 'waiting', 'upcoming'].includes(item.state)), false);
    assert.equal(step(result, 'livraison').state, 'not_required');
    assert.equal(step(result, 'reception').canOpen, true); assert.match(result.delivery.summary, /aucune action attendue/);
  }
});

test('the model is pure, bounded in alerts and changes no dossier, documents or departure', () => {
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const input = freeze(structuredClone({ ...paid, finalMeasurementsVersion: null, paiementMontant: 30 }));
  const config = freeze({ ...options, envois: [{ id: 'departure', date: '2026-10-10' }] });
  const before = JSON.stringify(input); const result = overview(input, config);
  assert.equal(JSON.stringify(input), before); assert.equal(result.alerts.length, 2);
  assert.deepEqual(overview(input, config), result);
});

test('overview shows each proven carton arrival and leaves unknown dates explicit without dating optimized packages', () => {
  const model = overview({ ...paid, receptionDates: [{ receivedAt: '2026-09-30T21:30:00Z', source: 'server' }, null] }, options);
  assert.equal(model.received.boxes[0].receivedAt, '2026-09-30T21:30:00Z');
  assert.equal(model.received.boxes[1].receivedAt, null); assert.equal(model.received.datesComplete, false);
  assert.equal(model.received.datedCount, 1); assert.equal(model.received.latestDate, '2026-09-30T21:30:00Z');
  assert.equal(model.received.date, reception.dateReception);
  assert.equal('receivedAt' in model.optimization.boxes[0], false);
});
