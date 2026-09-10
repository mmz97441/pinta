import test from 'node:test';
import assert from 'node:assert/strict';
import { queueContext, queueRows, urgency, priorityScore, matchesOwner, nextAction } from './workQueues.js';
import { operationalMetrics } from './operations.js';
const now = Date.parse('2026-09-10T12:00:00Z');
const clients = [{ id: 'customer', type: 'pro', cp: '97400' }];
const ctx = queueContext({ clients, now, tarifs: { '974': { base: 20, parKg: 2 } } });
const dossier = (id, changes = {}) => ({ id, clientId: 'customer', statut: 'en_preparation', conversationStatut: 'termine', ...changes });
const data = [
  dossier('read-message', { conversationStatut: 'a_traiter', messages: [{ type: 'client', lu: true }] }),
  dossier('closed-message', { messages: [{ type: 'client', lu: false }] }),
  dossier('decision', { statut: 'attente_feu_vert' }),
  dossier('paused', { statut: 'attente_feu_vert', attenteClientDate: '2026-09-01', attenteClientUntil: '2026-09-15', nextActionAt: '2026-09-02', nextActionSource: 'manual' }),
  dossier('pause-due', { statut: 'attente_feu_vert', attenteClientDate: '2026-09-01', attenteClientUntil: '2026-09-09' }),
  dossier('due', { nextActionAt: '2026-09-09', nextActionSource: 'manual' }),
  dossier('ready', { finL: 20, finW: 20, finH: 20, finP: 2 }),
  dossier('archived', { archive: true, conversationStatut: 'a_traiter' }),
];
test('queue membership reflects treatment, decision, active pauses and actual quote readiness', () => {
  const expected = { messages: ['read-message'], decision: ['decision'], waiting: ['paused', 'pause-due'], 'wait-review': ['pause-due'], overdue: ['due'], ready: ['ready'] };
  for (const [key, ids] of Object.entries(expected)) assert.deepEqual(queueRows(data, key, ctx).map(row => row.id), ids, key);
  const metrics = operationalMetrics({ data, clients, now, tarifs: ctx.tarifs });
  assert.deepEqual(metrics.conversations.map(row => row.id), expected.messages);
  assert.deepEqual(metrics.awaitingDecision.map(row => row.id), expected.decision);
  assert.deepEqual(metrics.voluntaryWait.map(row => row.id), expected.waiting);
  assert.deepEqual(metrics.ready.map(row => row.id), expected.ready);
});
test('missing destinations never become implicitly quote-ready', () => {
  const noDestination = queueContext({ clients: [{ id: 'customer', type: 'pro' }], tarifs: ctx.tarifs, now });
  assert.deepEqual(queueRows(data, 'ready', noDestination), []);
});
test('urgency uses current dated event instead of old reception and respects voluntary pause', () => {
  const fresh = dossier('fresh', { dateReception: '2020-01-01', statutUpdatedAt: '2026-09-10T08:00:00Z' });
  assert.equal(urgency(fresh, now).overdue, false);
  assert.equal(urgency(dossier('unknown', { dateReception: '2020-01-01' }), now).since, null);
  assert.equal(urgency(dossier('new-request', { statut: 'attente_feu_vert', dateReception: '2020-01-01', demandeFeuVertEnvoyeeAt: '2026-09-10T08:00:00Z' }), now).overdue, false);
  assert.equal(urgency(data.find(row => row.id === 'paused'), now).overdue, false);
  assert.equal(urgency(data.find(row => row.id === 'pause-due'), now).overdue, true);
});
test('owner and planned action are usable for distribution across the team', () => {
  const assigned = dossier('assigned', { responsibleStaffId: 'staff', nextAction: 'Vérifier le carton fragile' });
  assert.equal(matchesOwner(assigned, 'mine', 'staff'), true);
  assert.equal(matchesOwner(assigned, 'mine', 'other'), false);
  assert.equal(matchesOwner(assigned, 'unassigned', 'staff'), false);
  assert.equal(matchesOwner(dossier('none'), 'unassigned', 'staff'), true);
  assert.equal(nextAction(assigned, clients[0], now), 'Vérifier le carton fragile');
});
test('oldest unresolved conversation keeps priority when a new message arrives', () => {
  const older = dossier('older', { conversationStatut: 'a_traiter', conversationOpenedAt: '2026-09-01', conversationUpdatedAt: '2026-09-10' });
  const newer = dossier('newer', { conversationStatut: 'a_traiter', conversationOpenedAt: '2026-09-09' });
  assert.ok(priorityScore(older, clients[0], now) > priorityScore(newer, clients[0], now));
  assert.equal(urgency(older, now).overdue, true);
});

test('workflow timestamps are not staff deadlines, even when in the past', () => {
  assert.deepEqual(queueRows([dossier('automatic', { nextActionAt: '2026-09-01', nextActionSource: 'system', statutUpdatedAt: '2026-09-10' })], 'overdue', ctx), []);
});
test('an audit copy of a rejected invoice does not block its validated replacement', () => {
  const invoiceContext = queueContext({ clients: [{ id: 'customer', type: 'particulier', cp: '97400' }], now });
  const repaired = dossier('repaired', { factures: [{ rejetMotif: 'Illisible' }, { valide: true, montant: 50, fichier: 'facture.pdf' }] });
  assert.deepEqual(queueRows([repaired], 'documents', invoiceContext), []);
});
test('customer questions remain actionable during a pause and after delivery', () => {
  for (const changes of [{ statut: 'livre' }, { statut: 'attente_feu_vert', attenteClientDate: '2026-09-01', attenteClientUntil: '2026-09-15' }]) {
    const row = dossier('question', { ...changes, conversationStatut: 'a_traiter', conversationOpenedAt: '2026-09-01' });
    assert.equal(urgency(row, now).overdue, true);
    assert.equal(nextAction(row, clients[0], now), 'Répondre au client');
  }
});
