import test from 'node:test';
import assert from 'node:assert/strict';
import { departureReadiness } from '../src/expedile/domain/departureReadiness.js';
const box = poids => ({ dimL: 20, dimW: 30, dimH: 40, poids });
test('loading summary uses all prepared packages and identifies distinct blockers', () => {
  const dossier = { statut: 'paye', outgoingParcelCount: 2, finalPackages: [box(3), box(5)], finP: 3 };
  assert.equal(departureReadiness(dossier).weights.realWeight, 8);
  assert.equal(departureReadiness(dossier).eligible, true);
  const blocked = departureReadiness({ ...dossier, statut: 'pret', finalPackages: [box(3), box(null)] });
  assert.deepEqual(blocked.reasons.map(r => r.task), ['paiement', 'preparation']);
  assert.equal(departureReadiness({ ...dossier, preparationCompositionVersion: 2, finalMeasurementsVersion: 1 }).eligible, false);
  assert.equal(departureReadiness({ ...dossier, outgoingParcelCount: 1 }).eligible, false);
});
test('legacy single-package loading remains an explicit physical confirmation', () => {
  const result = departureReadiness({ statut: 'paye', finL: 20, finW: 30, finH: 40, finP: 3 });
  assert.equal(result.legacySingle, true); assert.equal(result.count, 1); assert.equal(result.eligible, true);
});
