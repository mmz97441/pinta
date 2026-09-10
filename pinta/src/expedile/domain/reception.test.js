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
