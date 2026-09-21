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
});

test('quote impact includes a saved draft, sent quote and active payment link', () => {
  assert.equal(revisionHasQuote(colis), false);
  for (const changes of [{ devisSnapshot: {} }, { devisTotal: 0 }, { devisBrouillon: true }, { payplugPaymentUrl: 'https://example.invalid/pay' }, { statut: 'devis_envoye' }]) assert.equal(revisionHasQuote({ ...colis, ...changes }), true);
});
