import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalMetrics } from './operations.js';

test('voluntary waits stay separate from clients without a decision, including expired pauses', () => {
  const metrics = operationalMetrics({ data: [
    { id: 'wait', statut: 'attente_feu_vert', attenteClientDate: '2026-09-01T00:00:00Z', attenteClientUntil: '2026-09-02T00:00:00Z' },
    { id: 'silence', statut: 'attente_feu_vert' }, { id: 'archive', statut: 'attente_feu_vert', archive: true },
  ], now: Date.parse('2026-09-10T00:00:00Z') });
  assert.equal(metrics.voluntaryWait.length, 1); assert.equal(metrics.awaitingDecision.length, 1); assert.equal(metrics.waitsToReview.length, 1);
});
test('decision duration requires real timestamps, excludes refusals and never invents zero time', () => {
  const metrics = operationalMetrics({ data: [
    { feuVert: 'autorise', demandeFeuVertEnvoyeeAt: '2026-09-01T00:00:00Z', feuVertDate: '2026-09-02T00:00:00Z' },
    { feuVert: 'autorise', demandeFeuVertEnvoyeeAt: '2026-09-01T00:00:00Z', feuVertDate: '2026-09-04T00:00:00Z' },
    { feuVert: 'autorise', feuVertDate: '2026-09-02T00:00:00Z' },
    { feuVert: 'refuse', demandeFeuVertEnvoyeeAt: '2026-09-01T00:00:00Z', feuVertDate: '2026-09-02T00:00:00Z' },
  ], now: Date.parse('2026-09-10T00:00:00Z') });
  assert.deepEqual(metrics.decisionHours, [24, 72]); assert.equal(metrics.medianDecisionHours, 48);
  assert.equal(operationalMetrics({}).medianDecisionHours, null);
});
test('customer unread counts are grouped by client; receiving a payment needs a date and amount', () => {
  const metrics = operationalMetrics({ data: [
    { id: 'first', clientId: 'client', messages: [{ type: 'client', lu: false }], paiementMontant: 15, paiementDate: '2026-09-01' },
    { id: 'second', clientId: 'client', messages: [{ type: 'client', lu: false }], paiementMontant: 40 },
  ] });
  assert.equal(metrics.unread.length, 2); assert.equal(metrics.unreadClientCount, 1); assert.equal(metrics.receipts, 15);
});
