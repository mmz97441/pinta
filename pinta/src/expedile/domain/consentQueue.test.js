/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_STAGE_LABELS, consentQueueFilter, consentStage, consentState, consentWaitLabel, consentRelance } from './consentQueue.js';

const dossier = (id, statut, changes = {}) => ({ id, ref: `EXP-${id}`, statut, archive: false, ...changes });
const message = (template, createdAt, changes = {}) => ({ id: `${template}-${createdAt}`, type: 'staff', canal: 'telegram', template, statut: 'envoye', createdAt, ...changes });
const ALL_STATUSES = ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'refuse_client', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre', 'annule'];

test('« Accords clients » keeps only the received, measured and awaiting dossiers, without archives, in their order', () => {
  const rows = ALL_STATUSES.map(statut => dossier(statut, statut));
  const kept = consentQueueFilter([...rows, dossier('archived', 'attente_feu_vert', { archive: true }), null]);
  assert.deepEqual(kept.map(item => item.id), ['receptionne', 'mesure', 'attente_feu_vert']);
  assert.deepEqual(consentQueueFilter([rows[2], rows[0]]).map(item => item.id), ['attente_feu_vert', 'receptionne'], 'The incoming order is kept.');
  assert.equal(kept[0], rows[0], 'The dossiers themselves are returned, never copies.');
  const frozen = Object.freeze(rows.map(row => Object.freeze(row)));
  assert.doesNotThrow(() => consentQueueFilter(frozen));
  assert.deepEqual(consentQueueFilter(), []);assert.deepEqual(consentQueueFilter(null), []);
});

test('three states: to submit, answer awaited, the client waits — and none outside the queue', () => {
  assert.deepEqual(CONSENT_STAGE_LABELS, { to_submit: 'À soumettre', awaiting_reply: 'Réponse attendue', client_waiting: 'Le client attend' });
  assert.equal(consentStage(dossier('a', 'receptionne')), 'to_submit');
  assert.equal(consentStage(dossier('b', 'mesure')), 'to_submit');
  assert.equal(consentStage(dossier('c', 'attente_feu_vert', { demandeFeuVertEnvoyeeAt: '2026-10-02T09:00:00Z' })), 'awaiting_reply');
  assert.equal(consentStage(dossier('d', 'attente_feu_vert', { attenteClientDate: '2026-10-03T08:00:00Z' })), 'client_waiting');
  for (const statut of ALL_STATUSES.slice(3)) assert.equal(consentStage(dossier(statut, statut)), null, statut);
  assert.equal(consentStage(dossier('archived', 'mesure', { archive: true })), null);
  assert.equal(consentStage(null), null);
  // A wait date only matters for the client's own wait.
  assert.deepEqual(consentState(dossier('w', 'attente_feu_vert', { attenteClientDate: '2026-10-03T08:00:00Z', attenteClientUntil: '2026-10-25T08:00:00Z' })), { stage: 'client_waiting', label: 'Le client attend', until: '2026-10-25T08:00:00Z' });
  assert.deepEqual(consentState(dossier('x', 'attente_feu_vert', { attenteClientDate: '2026-10-04T08:00:00Z' })), { stage: 'client_waiting', label: 'Le client attend', until: null });
  assert.deepEqual(consentState(dossier('y', 'attente_feu_vert', { attenteClientUntil: 'pas une date', attenteClientDate: '2026-10-04T08:00:00Z' })).until, null);
  assert.deepEqual(consentState(dossier('z', 'mesure', { attenteClientUntil: '2026-10-25T08:00:00Z' })), { stage: 'to_submit', label: 'À soumettre', until: null });
  assert.equal(consentState(dossier('paid', 'paye')), null);
});

test('« jusqu’au 25/10 » reads the end of the wait on the table calendar', () => {
  assert.equal(consentWaitLabel('2026-10-25T08:00:00Z'), 'jusqu’au 25/10');
  // The portal saves the chosen day at midnight UTC: the same day in Réunion and in Paris.
  assert.equal(consentWaitLabel('2026-10-25T00:00:00Z'), 'jusqu’au 25/10');
  assert.equal(consentWaitLabel('2026-12-31T22:30:00Z'), 'jusqu’au 01/01');
  for (const invalid of [null, undefined, '', 'demain', 42]) assert.equal(consentWaitLabel(invalid), null);
});

test('the last relance is the latest of the current request, while the answer is awaited', () => {
  const awaited = messages => dossier('r', 'attente_feu_vert', { messages });
  assert.deepEqual(consentRelance(awaited([
    message('demande_feu_vert', '2026-10-02T09:00:00Z'),
    message('relance_feu_vert', '2026-10-05T09:30:00Z'),
    message('relance_feu_vert', '2026-10-04T09:00:00Z'),
    message(null, '2026-10-06T09:00:00Z'),
  ])), { at: '2026-10-05T09:30:00Z', delivered: true, deliveryLabel: null });
  // A relance of an older request (before the latest demande) no longer counts.
  assert.equal(consentRelance(awaited([message('relance_feu_vert', '2026-09-30T09:00:00Z'), message('demande_feu_vert', '2026-10-01T09:00:00Z')])), null);
  // Without any request message (older data), every relance counts.
  assert.equal(consentRelance(awaited([message('relance_feu_vert', '2026-10-03T09:00:00Z', { statut: 'lu' })])).at, '2026-10-03T09:00:00Z');
  assert.equal(consentRelance(awaited([])), null);assert.equal(consentRelance(dossier('none', 'attente_feu_vert')), null);
  // Only while the answer is awaited: a dossier to submit has no current request.
  for (const statut of ['receptionne', 'mesure', 'autorise']) assert.equal(consentRelance(dossier(statut, statut, { messages: [message('relance_feu_vert', '2026-10-05T09:30:00Z')] })), null, statut);
  assert.equal(consentRelance(dossier('archived', 'attente_feu_vert', { archive: true, messages: [message('relance_feu_vert', '2026-10-05T09:30:00Z')] })), null);
  // Unreadable dates are ignored, never sorted first.
  assert.equal(consentRelance(awaited([message('relance_feu_vert', 'hier'), message('relance_feu_vert', '2026-10-04T09:00:00Z')])).at, '2026-10-04T09:00:00Z');
});

test('a relance not yet confirmed says where it stands instead of reading as sent', () => {
  const latest = changes => consentRelance(dossier('r', 'attente_feu_vert', { messages: [message('relance_feu_vert', '2026-10-04T09:00:00Z'), message('relance_feu_vert', '2026-10-06T07:00:00Z', changes)] }));
  assert.deepEqual(latest({ statut: 'envoi' }), { at: '2026-10-06T07:00:00Z', delivered: false, deliveryLabel: 'En attente de livraison' });
  assert.deepEqual(latest({ statut: 'echec' }), { at: '2026-10-06T07:00:00Z', delivered: false, deliveryLabel: 'Envoi non confirmé' });
  assert.deepEqual(latest({ statut: 'envoi', canal: 'email' }), { at: '2026-10-06T07:00:00Z', delivered: false, deliveryLabel: 'Brouillon manuel' });
  for (const statut of ['envoye', 'distribue', 'lu']) assert.deepEqual(latest({ statut }), { at: '2026-10-06T07:00:00Z', delivered: true, deliveryLabel: null }, statut);
});
