import test from 'node:test';
import assert from 'node:assert/strict';
import { receptionCartons, receptionMeasurements, receptionMeasurementIssues, receptionCartonManifest, hasCompleteReceptionMeasurements, mergeReceptionCartons, removeReceptionCarton } from './reception.js';
const lines = [{ fournisseur: ' Amazon ', tracking: ' A ' }, { fournisseur: 'Zara', tracking: '' }, { fournisseur: '', tracking: '' }];
const dimensions = { 0: { dimL: '20', dimW: '30', dimH: '40', poids: '2' }, 1: { dimL: '10', dimW: '10', dimH: '10', poids: '0.5' } };
test('a physical carton without tracking counts, but the empty scanner line does not', () => {
  assert.deepEqual(receptionCartons(lines), [{ index: 0, fournisseur: 'Amazon', tracking: 'A' }, { index: 1, fournisseur: 'Zara', tracking: '' }]);
  assert.equal(receptionMeasurements(lines, dimensions).poids, 2.5);
  assert.equal(receptionMeasurements(lines, dimensions).dimsParColis.length, 2);
});
test('removing a carton preserves the measurements belonging to subsequent cartons', () => {
  const form = removeReceptionCarton({ trackingLines: lines, multiDims: dimensions }, 0);
  assert.equal(form.trackingLines[0].fournisseur, 'Zara');
  assert.deepEqual(form.multiDims[0], dimensions[1]);
  assert.equal(receptionMeasurements(form.trackingLines, form.multiDims).poids, 0.5);
});
test('incomplete, zero or invalid measurements never mark receipt as measured', () => {
  assert.equal(receptionMeasurements(lines, { 0: dimensions[0] }), null);
  assert.equal(receptionMeasurements([lines[0]], { 0: { ...dimensions[0], poids: '0' } }), null);
  assert.equal(receptionMeasurements([lines[0]], { 0: { ...dimensions[0], dimL: 'infinity' } }), null);
  assert.equal(receptionMeasurements([], {}), null);
});
test('a measured carton needs no invented supplier or tracking; an empty scanner line is ignored', () => {
  const blank = [{ fournisseur: '', tracking: '' }, { fournisseur: '', tracking: '' }];
  assert.equal(receptionCartons(blank, { 0: dimensions[0] }).length, 1);
  assert.equal(receptionMeasurements(blank, { 0: dimensions[0] }).dimsParColis.length, 1);
  assert.deepEqual(receptionMeasurementIssues(blank, { 0: dimensions[0] }), []);
  assert.deepEqual(receptionMeasurementIssues(blank, { 0: { poids: '1' } }).map(issue => issue.key), ['dimL', 'dimW', 'dimH']);
});
test('adding a measured carton preserves old measurements and does not assign final dimensions', () => {
  const original = { nbColis: 1, trackings: ['OLD'], dimL: 20, dimW: 30, dimH: 40, poids: 2, finL: 5 };
  const merged = mergeReceptionCartons(original, [lines[1]], { 0: dimensions[1] });
  assert.equal(merged.nbColis, 2);
  assert.deepEqual(merged.dimsParColis[0], { dimL: 20, dimW: 30, dimH: 40, poids: 2 });
  assert.deepEqual(merged.trackingsDetail, [{ number: 'OLD', fournisseur: '' }, { number: '', fournisseur: 'Zara' }]);
  assert.equal(merged.poids, 2.5);
  assert.equal('finL' in merged, false);
  assert.equal(hasCompleteReceptionMeasurements(merged), true);
});
test('legacy multiple cartons keep unknown slots and never share one aggregate measurement', () => {
  const original = { nbColis: 2, trackings: ['OLD-1', 'OLD-2'], dimL: 20, dimW: 30, dimH: 40, poids: 2 };
  const merged = mergeReceptionCartons(original, [lines[0]], { 0: dimensions[0] });
  assert.equal(merged.nbColis, 3);
  assert.deepEqual(merged.trackingsDetail.map(line => line.number), ['OLD-1', 'OLD-2', 'A']);
  assert.deepEqual(merged.dimsParColis.slice(0, 2), Array.from({ length: 2 }, () => ({ dimL: null, dimW: null, dimH: null, poids: null })));
  assert.equal(merged.poids, null);
  assert.equal(hasCompleteReceptionMeasurements(merged), false);
  assert.equal(hasCompleteReceptionMeasurements({ ...original, nbColis: 1, trackings: [], dimsParColis: [null] }), false);
  assert.equal(receptionCartonManifest({ ...original, nbColis: 1 }).nbColis, 2);
});

test('append gates paid, archived, transported and active checkout dossiers with a useful reason', async () => {
  const { receptionAppendBlockReason } = await import('./reception.js');
  for (const statut of ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement']) assert.equal(receptionAppendBlockReason({ statut }), '');
  assert.match(receptionAppendBlockReason({ statut: 'mesure', archive: true }), /archivé/);
  assert.match(receptionAppendBlockReason({ statut: 'autorise', paiementDate: '2026-10-01' }), /paiement/i);
  assert.match(receptionAppendBlockReason({ statut: 'attente_paiement', payplugPaymentId: 'pay_fixture' }), /Corrigez le devis/);
  assert.match(receptionAppendBlockReason({ statut: 'expedie' }), /ne peut plus/);
});

test('append impact explains renewed consent, preparation and quote only when affected', async () => {
  const { receptionAppendImpact } = await import('./reception.js');
  assert.equal(receptionAppendImpact({ statut: 'mesure' }), '');
  assert.match(receptionAppendImpact({ statut: 'autorise' }), /redemander l’accord/);
  assert.match(receptionAppendImpact({ statut: 'en_preparation' }), /vérifier la préparation/);
  assert.match(receptionAppendImpact({ statut: 'mesure', devisTotal: 50 }), /refaire le devis/);
  assert.match(receptionAppendImpact({ statut: 'devis_envoye' }), /historique/);
});


test('opening the saved dossier unwraps the original filtered list instead of linking back to itself', async () => {
  const { receptionDossierReturn } = await import('./reception.js');
  const list = '/colis?sort=client&dir=desc&work=reception';
  assert.equal(receptionDossierReturn(`/colis/uuid?${new URLSearchParams({ returnTo: list })}`), list);
  assert.equal(receptionDossierReturn(list), list);
  assert.equal(receptionDossierReturn('/colis/uuid'), '/colis');
  assert.equal(receptionDossierReturn('//untrusted.example'), '/colis');
  assert.equal(receptionDossierReturn('/reception?dossier=uuid'), '/colis');
});

test('carton arrival dates never spread a dossier date over appended or unknown cartons', async () => {
  const { receptionDateSummary } = await import('./reception.js');
  const now = Date.parse('2026-10-03T12:00:00Z');
  const model = receptionDateSummary({ nbColis: 3, dateReception: '2026-09-01T10:00:00Z', receptionDates: [
    { receivedAt: '2026-09-30T21:30:00Z', source: 'server' }, null,
    { receivedAt: '2026-10-02T11:00:00Z', source: 'append_receipt' },
  ] }, { now });
  assert.equal(model.knownCount, 2); assert.equal(model.totalCount, 3); assert.equal(model.complete, false);
  assert.equal(model.dates[1], null); assert.equal(model.lastReceivedAt, '2026-10-02T11:00:00Z');
  assert.equal(receptionDateSummary({ nbColis: 2, dateReception: '2026-09-01T10:00:00Z' }, { now }).knownCount, 0);
});
test('invalid, future and unproven dates remain unknown and ledger error stays explicit', async () => {
  const { receptionDateSummary } = await import('./reception.js');
  const model = receptionDateSummary({ nbColis: 4, receptionDatesError: true, receptionDates: [
    { receivedAt: '2026-02-30T00:00:00Z', source: 'server' },
    { receivedAt: '2026-10-05T00:00:00Z', source: 'server' },
    { receivedAt: '2026-10-01T00:00:00Z', source: 'guess' },
    { receivedAt: '2026-10-01', source: 'server' },
  ] }, { now: Date.parse('2026-10-03T00:00:00Z') });
  assert.equal(model.knownCount, 0); assert.equal(model.lastReceivedAt, null); assert.equal(model.error, true);
});
