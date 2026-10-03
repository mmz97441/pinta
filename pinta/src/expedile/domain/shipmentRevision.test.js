import test from 'node:test';
import assert from 'node:assert/strict';
import { shipmentRevisionBoxes, sameRevisionBoxes, normalizedRevisionBoxes, revisionMeasurementIssues, revisionLockedReason, revisionHasQuote } from './shipmentRevision.js';

const box = { dimL: 40, dimW: 30, dimH: 20, poids: 2.5 };
const colis = { statut: 'en_preparation', feuVert: 'autorise', nbColis: 2, dimsParColis: [box, { ...box, poids: 4 }], finalPackages: [{ dimL: 35, dimW: 20, dimH: 15, poids: 5 }] };

test('revising receipt and prepared measurements preserves the distinct physical manifests', () => {
  assert.deepEqual(shipmentRevisionBoxes(colis, 'reception'), colis.dimsParColis);
  assert.deepEqual(shipmentRevisionBoxes(colis, 'preparation'), colis.finalPackages);
  assert.equal(shipmentRevisionBoxes({ ...colis, dimsParColis: [] }, 'reception')[1].poids, '');
  assert.deepEqual(shipmentRevisionBoxes({ finL: 20, finW: 10, finH: 5, finP: 1 }, 'preparation'), [{ dimL: 20, dimW: 10, dimH: 5, poids: 1 }]);
});

test('an explicit empty or invalid prepared manifest cannot revive old scalar measurements', () => {
  const previous = { ...colis, finL: 100, finW: 80, finH: 60, finP: 90 };
  assert.deepEqual(shipmentRevisionBoxes({ ...previous, finalPackages: [] }, 'preparation'), []);
  assert.deepEqual(shipmentRevisionBoxes({ ...previous, finalPackages: {} }, 'preparation'), []);
  assert.deepEqual(shipmentRevisionBoxes({ ...previous, finalPackages: null }, 'preparation'), [{ dimL: 100, dimW: 80, dimH: 60, poids: 90 }]);
  assert.deepEqual(shipmentRevisionBoxes(previous, 'reception'), colis.dimsParColis);
  assert.deepEqual(shipmentRevisionBoxes(previous, 'preparation'), colis.finalPackages);
});

test('equivalent decimal edits are no-ops but dimension and composition changes are not', () => {
  const typed = { dimL: '40.00', dimW: '30', dimH: '20', poids: '2,50' };
  assert.equal(sameRevisionBoxes([box], [typed]), true);
  assert.deepEqual(normalizedRevisionBoxes([typed]), [box]);
  assert.equal(sameRevisionBoxes([box], [{ ...box, poids: 2.6 }]), false);
  assert.equal(sameRevisionBoxes([box], [box, box]), false);
  assert.equal(sameRevisionBoxes([box], [{ ...box, poids: '' }]), false);
});

test('measure validation targets the exact field and cannot change receipt carton count', () => {
  assert.deepEqual(revisionMeasurementIssues([box], 'reception', 1), []);
  assert.equal(revisionMeasurementIssues([box], 'reception', 2).length, 1);
  assert.deepEqual(revisionMeasurementIssues([box, box], 'preparation', 1), []);
  for (const invalid of ['', null, 0, -2, '1,2,3', Infinity]) {
    const [issue] = revisionMeasurementIssues([box, { ...box, poids: invalid }], 'preparation');
    assert.equal(issue.index, 1); assert.equal(issue.key, 'poids');
  }
});

test('paid, shipped, archived or cancelled dossiers remain read-only; preparation needs consent', () => {
  assert.equal(revisionLockedReason(colis, 'reception'), '');
  assert.equal(revisionLockedReason(colis, 'preparation'), '');
  for (const changes of [{ archive: true }, { paiementDate: '2026-09-20' }, ...['paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre', 'annule'].map(statut => ({ statut }))]) {
    for (const phase of ['reception', 'preparation']) assert.notEqual(revisionLockedReason({ ...colis, ...changes }, phase), '');
  }
  assert.notEqual(revisionLockedReason({ ...colis, feuVert: 'attente' }, 'preparation'), '');
  assert.equal(revisionLockedReason({ ...colis, feuVert: 'attente' }, 'reception'), '');
  assert.match(revisionLockedReason({ ...colis, produitInterdit: true }, 'preparation'), /produit interdit/);
  assert.equal(revisionLockedReason({ ...colis, produitInterdit: true }, 'reception'), '');
});

test('any recorded amount or recorded departure locks corrections even if the displayed status is stale', () => {
  for (const changes of [{ paiementMontant: 20 }, { paiementMontant: '0.01' }, { paiementMontant: 0 }, { dateExpedition: '2026-10-02T10:00:00Z' }]) {
    for (const phase of ['reception', 'preparation']) assert.notEqual(revisionLockedReason({ ...colis, ...changes }, phase), '');
  }
  assert.match(revisionLockedReason({ ...colis, paiementMontant: 20 }, 'reception'), /paiement/);
  assert.match(revisionLockedReason({ ...colis, dateExpedition: '2026-10-02T10:00:00Z' }, 'preparation'), /transport/);
  assert.equal(revisionLockedReason({ ...colis, paiementMontant: null, paiementDate: null }, 'preparation'), '');
});

test('unknown states and stale consent cannot offer a correction that its server command forbids', () => {
  for (const statut of ['unknown', undefined, 'pret']) {
    for (const phase of ['reception', 'preparation']) assert.notEqual(revisionLockedReason({ ...colis, statut }, phase), '');
  }
  assert.notEqual(revisionLockedReason({ ...colis, statut: 'mesure', feuVert: 'autorise' }, 'preparation'), '');
  assert.equal(revisionLockedReason({ ...colis, statut: 'mesure', feuVert: 'autorise' }, 'reception'), '');
  assert.equal(revisionLockedReason({ ...colis, statut: 'autorise' }, 'preparation'), '');
});

test('an unpaid payment link still permits the explicit guarded correction flow', () => {
  const awaiting = { ...colis, statut: 'attente_paiement', payplugPaymentId: 'pay_existing', payplugPaymentUrl: 'https://payment.invalid', paiementDate: null, paiementMontant: null };
  assert.equal(revisionLockedReason(awaiting, 'reception'), '');
  assert.equal(revisionLockedReason(awaiting, 'preparation'), '');
  assert.equal(revisionHasQuote(awaiting), true);
});

test('quote impact includes a saved draft, sent quote and active payment link', () => {
  assert.equal(revisionHasQuote(colis), false);
  for (const changes of [{ devisSnapshot: { inputs: {} } }, { devisSnapshot: { amounts: { total: 50 } } }, { devisTotal: 50, devisBrouillon: true }, { devisTotal: 0, quoteVersion: 1 }, { payplugPaymentUrl: 'https://example.invalid/pay' }, { statut: 'devis_envoye' }]) assert.equal(revisionHasQuote({ ...colis, ...changes }), true);
});

test('initial zero, preparation draft flag and retired quote stamps do not invent a quote impact', () => {
  for (const changes of [{ devisTotal: 0, quoteVersion: 0 }, { devisTotal: null, devisBrouillon: true }, { devisTotal: null, devisSnapshot: { createdAt: '2026-10-02', version: 3 }, quoteVersion: 3, devisBrouillon: true }, { devisSnapshot: {} }])
    assert.equal(revisionHasQuote({ ...colis, ...changes }), false);
});
