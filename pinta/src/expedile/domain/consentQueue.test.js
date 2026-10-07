/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_STAGE_LABELS, CONSENT_WAIT_OVER_LABEL, CONSENT_LABELS, CANCELLED_RELANCE_LABEL, CANCELLED_SEND_LABEL, consentQueueFilter, consentStage, consentState, consentWaitLabel, consentSummary, consentRelance } from './consentQueue.js';

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
  const now = Date.parse('2026-10-06T08:00:00Z');
  assert.deepEqual(consentState(dossier('w', 'attente_feu_vert', { attenteClientDate: '2026-10-03T08:00:00Z', attenteClientUntil: '2026-10-25T08:00:00Z' }), now), { stage: 'client_waiting', label: 'Le client attend', until: '2026-10-25T08:00:00Z', over: false });
  assert.deepEqual(consentState(dossier('x', 'attente_feu_vert', { attenteClientDate: '2026-10-04T08:00:00Z' }), now), { stage: 'client_waiting', label: 'Le client attend', until: null, over: false });
  assert.deepEqual(consentState(dossier('y', 'attente_feu_vert', { attenteClientUntil: 'pas une date', attenteClientDate: '2026-10-04T08:00:00Z' }), now).until, null);
  assert.deepEqual(consentState(dossier('z', 'mesure', { attenteClientUntil: '2026-10-25T08:00:00Z' }), now), { stage: 'to_submit', label: 'À soumettre', until: null, over: false });
  assert.equal(consentState(dossier('paid', 'paye')), null);
});

test('a dated wait whose day has passed reads « Attente terminée », to re-examine, and stays the client’s wait', () => {
  const waited = dossier('w', 'attente_feu_vert', { attenteClientDate: '2026-10-03T08:00:00Z', attenteClientUntil: '2026-10-25T08:00:00Z' });
  const after = Date.parse('2026-10-26T08:00:00Z');
  assert.deepEqual(consentState(waited, after), { stage: 'client_waiting', label: 'Attente terminée', until: '2026-10-25T08:00:00Z', over: true });
  // The end instant itself is over, as the server task « Réexaminer l’attente client » starts then.
  assert.equal(consentState(waited, Date.parse('2026-10-25T08:00:00Z')).over, true);
  assert.equal(consentState(waited, new Date('2026-10-25T07:59:00Z')).over, false);
  // A wait without a date never ends by itself.
  assert.equal(consentState(dossier('x', 'attente_feu_vert', { attenteClientDate: '2026-10-04T08:00:00Z' }), after).over, false);
  assert.equal(consentWaitLabel('2026-10-25T08:00:00Z', { over: true }), 'le 25/10 · à réexaminer');
  assert.equal(consentSummary(consentState(waited, after)), 'Attente terminée le 25/10 · à réexaminer');
  assert.equal(consentSummary(consentState(waited, Date.parse('2026-10-06T08:00:00Z'))), 'Le client attend · jusqu’au 25/10');
  assert.equal(consentSummary(consentState(dossier('s', 'mesure'))), 'À soumettre');
  assert.equal(consentSummary(null), '');
  // The « Accord » filter offers every wording, the ended wait included.
  assert.deepEqual(CONSENT_LABELS, [...Object.values(CONSENT_STAGE_LABELS), CONSENT_WAIT_OVER_LABEL]);
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
  ])), { at: '2026-10-05T09:30:00Z', delivered: true, cancelled: false, deliveryLabel: null });
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
  assert.deepEqual(latest({ statut: 'envoi' }), { at: '2026-10-06T07:00:00Z', delivered: false, cancelled: false, deliveryLabel: 'En attente de livraison' });
  assert.deepEqual(latest({ statut: 'echec' }), { at: '2026-10-06T07:00:00Z', delivered: false, cancelled: false, deliveryLabel: 'Envoi non confirmé' });
  assert.deepEqual(latest({ statut: 'envoi', canal: 'email' }), { at: '2026-10-06T07:00:00Z', delivered: false, cancelled: false, deliveryLabel: 'Brouillon manuel' });
  for (const statut of ['envoye', 'distribue', 'lu']) assert.deepEqual(latest({ statut }), { at: '2026-10-06T07:00:00Z', delivered: true, cancelled: false, deliveryLabel: null }, statut);
});

test('a relance still queued when the client chose to wait was cancelled: it never reads « En attente de livraison »', () => {
  // client_decision('wait') cancels the pending and blocked relance_feu_vert deliveries.
  const relance = changes => message('relance_feu_vert', '2026-10-04T09:00:00Z', changes);
  const waiting = (changes, attenteClientDate = '2026-10-05T08:00:00Z') => consentRelance(dossier('r', 'attente_feu_vert', { attenteClientDate, messages: [message('demande_feu_vert', '2026-10-02T09:00:00Z'), relance(changes)] }));
  assert.deepEqual(waiting({ statut: 'envoi' }), { at: '2026-10-04T09:00:00Z', delivered: false, cancelled: true, deliveryLabel: CANCELLED_RELANCE_LABEL });
  assert.equal(CANCELLED_RELANCE_LABEL, 'Annulée · attente du client');
  assert.notEqual(waiting({ statut: 'envoi' }).deliveryLabel, 'En attente de livraison');
  // A failed send and a manual e-mail draft keep their own state; a delivered relance stays delivered.
  assert.equal(waiting({ statut: 'echec' }).deliveryLabel, 'Envoi non confirmé');
  assert.equal(waiting({ statut: 'envoi', canal: 'email' }).deliveryLabel, 'Brouillon manuel');
  assert.deepEqual(waiting({ statut: 'envoye' }), { at: '2026-10-04T09:00:00Z', delivered: true, cancelled: false, deliveryLabel: null });
  // A relance queued after the client's choice was not cancelled by it.
  assert.equal(waiting({ statut: 'envoi' }, '2026-10-03T08:00:00Z').deliveryLabel, 'En attente de livraison');
  // Without a wait, a queued relance is still on its way.
  assert.equal(consentRelance(dossier('r', 'attente_feu_vert', { messages: [relance({ statut: 'envoi' })] })).cancelled, false);
});

test('the delivery row decides: a relance the database cancelled or failed never reads « En attente de livraison »', () => {
  const latest = (changes, extra = {}) => consentRelance(dossier('r', 'attente_feu_vert', { ...extra, messages: [message('demande_feu_vert', '2026-10-02T09:00:00Z'), message('relance_feu_vert', '2026-10-05T09:00:00Z', changes)] }));
  // Cancelled by the server before it left (the dossier or the request changed): its message stays « envoi ».
  assert.deepEqual(latest({ statut: 'envoi', outboxStatus: 'cancelled' }), { at: '2026-10-05T09:00:00Z', delivered: false, cancelled: true, deliveryLabel: CANCELLED_SEND_LABEL });
  assert.equal(CANCELLED_SEND_LABEL, 'Envoi annulé');
  // Cancelled because the client chose to wait after it was queued.
  assert.equal(latest({ statut: 'envoi', outboxStatus: 'cancelled' }, { attenteClientDate: '2026-10-05T10:00:00Z' }).deliveryLabel, CANCELLED_RELANCE_LABEL);
  // dispatchOutbox's cancellation also marks the message « echec »: still a cancelled send.
  assert.equal(latest({ statut: 'echec', outboxStatus: 'cancelled' }).deliveryLabel, CANCELLED_SEND_LABEL);
  // Failed (the stale-send sweep leaves the message « envoi »).
  assert.deepEqual(latest({ statut: 'envoi', outboxStatus: 'failed' }), { at: '2026-10-05T09:00:00Z', delivered: false, cancelled: false, deliveryLabel: 'Envoi non confirmé' });
  for (const outboxStatus of ['cancelled', 'failed']) assert.notEqual(latest({ statut: 'envoi', outboxStatus }).deliveryLabel, 'En attente de livraison', outboxStatus);
  // Still to deliver (queued, blocked, rescheduled, being sent, or a retry after a failure): awaiting delivery.
  for (const [statut, outboxStatus] of [['envoi', 'pending'], ['envoi', 'blocked'], ['envoi', 'sending'], ['echec', 'pending']])
    assert.deepEqual(latest({ statut, outboxStatus }), { at: '2026-10-05T09:00:00Z', delivered: false, cancelled: false, deliveryLabel: 'En attente de livraison' }, `${statut}/${outboxStatus}`);
  // Delivered: dated by its delivery when known (a relance rescheduled by the 24-hour client rule leaves later).
  assert.deepEqual(latest({ statut: 'envoye', outboxStatus: 'sent', outboxSentAt: '2026-10-06T07:00:00Z' }), { at: '2026-10-06T07:00:00Z', delivered: true, cancelled: false, deliveryLabel: null });
  assert.deepEqual(latest({ statut: 'envoye', outboxStatus: 'sent', outboxSentAt: null }), { at: '2026-10-05T09:00:00Z', delivered: true, cancelled: false, deliveryLabel: null }, 'A portal message has no delivery instant.');
  // An e-mail draft stays a draft.
  assert.equal(latest({ statut: 'envoi', canal: 'email', outboxStatus: 'manual' }).deliveryLabel, 'Brouillon manuel');
});

test('only the team’s messages are relances: a client message with a consent template is ignored', () => {
  const client = (template, createdAt) => ({ id: `client-${createdAt}`, type: 'client', canal: 'portal', template, statut: null, createdAt });
  const awaited = messages => consentRelance(dossier('r', 'attente_feu_vert', { messages }));
  assert.equal(awaited([message('demande_feu_vert', '2026-10-02T09:00:00Z'), client('relance_feu_vert', '2026-10-06T07:00:00Z')]), null);
  assert.equal(awaited([message('relance_feu_vert', '2026-10-04T09:00:00Z'), client('demande_feu_vert', '2026-10-05T09:00:00Z')]).at, '2026-10-04T09:00:00Z', 'A client « request » does not hide the current relance.');
});
