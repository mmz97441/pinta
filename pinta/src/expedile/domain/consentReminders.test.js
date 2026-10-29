import test from 'node:test';
import assert from 'node:assert/strict';
import { autoReminderPlan, autoReminderSettings, autoReminderWording, destinationHour, openConversationClients, reminderDestinationCode, reminderSendingInstant } from './consentReminders.js';

// The settings the migration writes (20261029000001_consent_automation.sql): on, 48 h, then 24 h, two at most.
const SETTINGS = { relancesAccordAuto: { actif: true, depuis: '2026-10-29T06:00:00Z', premiereApresHeures: 48, suivanteApresHeures: 24, nombreMax: 2 } };
const client = { id: 'c-flavie', prenom: 'Flavie', cp: '97400', telegramChatId: '7001' };
const message = (template, createdAt, changes = {}) => ({ id: `m-${template}-${createdAt}`, type: 'staff', template, canal: 'telegram', createdAt, statut: 'envoye', outboxStatus: 'sent', outboxSentAt: createdAt, ...changes });
const waiting = (messages, changes = {}) => ({ id: 'd-1', clientId: client.id, statut: 'attente_feu_vert', archive: false, paiementDate: null, attenteClientDate: null, messages, ...changes });
// The request reached the client on Thursday 29 October 2026 at 10:00 UTC (14:00 at La Réunion).
const REQUEST = '2026-10-29T10:00:00Z';
const plan = (messages, options = {}, changes = {}) => autoReminderPlan(waiting(messages, changes), { client, settings: SETTINGS, now: Date.parse('2026-10-29T12:00:00Z'), ...options });

test('the settings: on, readable and within the server bounds, else nothing leaves on its own', () => {
  assert.deepEqual(autoReminderSettings(SETTINGS), { since: Date.parse('2026-10-29T06:00:00Z'), first: 48, next: 24, max: 2 });
  assert.deepEqual(autoReminderSettings({ relancesAccordAuto: { ...SETTINGS.relancesAccordAuto, premiereApresHeures: '36', nombreMax: '3' } }), { since: Date.parse('2026-10-29T06:00:00Z'), first: 36, next: 24, max: 3 });
  for (const changes of [{ actif: false }, { actif: 'true' }, { depuis: 'hier' }, { depuis: null }, { premiereApresHeures: 0 }, { suivanteApresHeures: -1 }, { suivanteApresHeures: 'x' },
    { nombreMax: 0 }, { nombreMax: 6 }, { nombreMax: 2.5 }]) assert.equal(autoReminderSettings({ relancesAccordAuto: { ...SETTINGS.relancesAccordAuto, ...changes } }), null, JSON.stringify(changes));
  for (const settings of [null, undefined, {}, { relancesAccordAuto: null }, { relancesAccordAuto: [] }, { relancesAccordAuto: 'oui' }]) assert.equal(autoReminderSettings(settings), null);
});

test('the wording of the schedule, as the screens say it', () => {
  assert.equal(autoReminderWording(SETTINGS), 'une relance part automatiquement 48 h après la demande, puis une seconde 24 h plus tard');
  assert.equal(autoReminderWording({ relancesAccordAuto: { ...SETTINGS.relancesAccordAuto, nombreMax: 1 } }), 'une relance part automatiquement 48 h après la demande');
  assert.equal(autoReminderWording({ relancesAccordAuto: { ...SETTINGS.relancesAccordAuto, nombreMax: 3, suivanteApresHeures: 12.5 } }), 'une relance part automatiquement 48 h après la demande, puis toutes les 12,5 h, 3 au plus');
  assert.equal(autoReminderWording({}), null);
});

test('a reminder leaves between 8 h and 20 h at the client’s destination, as the worker sends it', () => {
  assert.equal(reminderDestinationCode({ cp: '97 400' }), '974');
  assert.equal(reminderDestinationCode({ cp: null }), '');
  assert.equal(destinationHour('974', Date.parse('2026-10-31T04:00:00Z')), 8, '8 h at La Réunion (UTC+4)');
  assert.equal(destinationHour('972', Date.parse('2026-10-31T12:00:00Z')), 8, '8 h in Martinique (UTC-4)');
  // Within the hours: as due. At 23 h at La Réunion: the next morning at 8 h.
  assert.equal(new Date(reminderSendingInstant(Date.parse('2026-10-31T10:00:00Z'), '974')).toISOString(), '2026-10-31T10:00:00.000Z');
  assert.equal(new Date(reminderSendingInstant(Date.parse('2026-10-31T19:00:00Z'), '974')).toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(new Date(reminderSendingInstant(Date.parse('2026-10-31T15:59:00Z'), '974')).toISOString(), '2026-10-31T15:59:00.000Z', '19 h 59: still today');
  assert.equal(new Date(reminderSendingInstant(Date.parse('2026-10-31T16:00:00Z'), '974')).toISOString(), '2026-11-01T04:00:00.000Z', '20 h: tomorrow');
  assert.equal(new Date(reminderSendingInstant(Date.parse('2026-10-31T03:30:00Z'), '')).toISOString(), '2026-10-31T04:00:00.000Z', 'An unknown destination: La Réunion');
});

test('48 hours after the delivered request, then 24 hours after the first reminder, two at most (a relance of the team counts)', () => {
  const request = message('demande_feu_vert', REQUEST);
  assert.deepEqual(plan([request]), { sent: 0, max: 2, exhausted: false, nextAt: '2026-10-31T10:00:00.000Z', due: false, suspended: null });
  // Due already: it leaves at the worker's next run.
  assert.equal(plan([request], { now: Date.parse('2026-10-31T10:03:00Z') }).due, true);
  assert.equal(plan([request], { now: Date.parse('2026-10-31T10:03:00Z') }).nextAt, '2026-10-31T10:03:00.000Z');
  const first = message('relance_feu_vert', '2026-10-31T10:05:00Z', { auteurId: null });
  assert.deepEqual(plan([request, first], { now: Date.parse('2026-10-31T12:00:00Z') }), { sent: 1, max: 2, exhausted: false, nextAt: '2026-11-01T10:05:00.000Z', due: false, suspended: null });
  const second = message('relance_feu_vert', '2026-11-01T10:06:00Z');
  assert.deepEqual(plan([request, first, second], { now: Date.parse('2026-11-01T12:00:00Z') }), { sent: 2, max: 2, exhausted: true, nextAt: null, due: false, suspended: null });
  // The reminders count from their delivery, not their creation.
  const late = message('relance_feu_vert', '2026-10-31T10:05:00Z', { outboxSentAt: '2026-10-31T14:00:00Z' });
  assert.equal(plan([request, late], { now: Date.parse('2026-10-31T15:00:00Z') }).nextAt, '2026-11-01T14:00:00.000Z');
  // A relance delivered before the request (an older request) does not count.
  assert.equal(plan([message('relance_feu_vert', '2026-10-29T09:00:00Z'), request]).sent, 0);
});

test('nothing leaves on its own: settings off, no Telegram, a wait chosen, not delivered, delivered before the start, to deliver, failed', () => {
  const request = message('demande_feu_vert', REQUEST);
  assert.equal(autoReminderPlan(waiting([request]), { client, settings: {}, now: Date.parse(REQUEST) }), null, 'Settings off');
  for (const chat of [null, '', '   ']) assert.equal(plan([request], { client: { ...client, telegramChatId: chat } }), null, `chat ${JSON.stringify(chat)}`);
  for (const changes of [{ statut: 'mesure' }, { statut: 'autorise' }, { archive: true }, { paiementDate: '2026-10-29T11:00:00Z' }, { attenteClientDate: '2026-10-29T11:00:00Z' }])
    assert.equal(plan([request], {}, changes), null, JSON.stringify(changes));
  assert.equal(plan([message('demande_feu_vert', REQUEST, { canal: 'email', outboxStatus: 'manual', outboxSentAt: null })]), null, 'An e-mail request');
  assert.equal(plan([message('demande_feu_vert', REQUEST, { statut: 'envoi', outboxStatus: 'pending', outboxSentAt: null })]), null, 'Not delivered yet');
  assert.equal(plan([message('demande_feu_vert', '2026-10-28T10:00:00Z')]), null, 'Delivered before the settings’ start: never a reminder of the history');
  assert.equal(plan([request, message('relance_feu_vert', '2026-10-31T10:05:00Z', { statut: 'envoi', outboxStatus: 'blocked', outboxSentAt: null })]), null, 'A relance still to deliver');
  assert.equal(plan([request, message('relance_feu_vert', '2026-10-31T10:05:00Z', { statut: 'echec', outboxStatus: 'failed', outboxSentAt: null })]), null, 'A relance failed: the team checks it');
  assert.equal(plan([request, message('relance_feu_vert', '2026-10-31T10:05:00Z', { statut: 'envoi', outboxStatus: 'cancelled', outboxSentAt: null })]), null);
  // A newer request not delivered yet replaces the delivered one.
  assert.equal(plan([request, message('demande_feu_vert', '2026-10-30T10:00:00Z', { statut: 'envoi', outboxStatus: 'pending', outboxSentAt: null })]), null);
  // A message the client wrote is no request.
  assert.equal(plan([{ ...request, type: 'client' }]), null);
});

test('a conversation of the client waiting for the team suspends the reminders', () => {
  const request = message('demande_feu_vert', REQUEST);
  assert.equal(plan([request], { openConversationClients: new Set([client.id]) }).suspended, 'conversation');
  assert.equal(plan([request], { openConversationClients: new Set(['c-other']) }).suspended, null);
});

test('the clients whose conversation waits for the team: a dossier « à traiter », not archived', () => {
  const set = openConversationClients([
    { id: 'a', clientId: 'c-1', conversationStatut: 'a_traiter' },
    { id: 'b', clientId: 'c-2', conversationStatut: 'termine' },
    { id: 'c', clientId: 'c-3', conversationStatut: 'a_traiter', archive: true },
    { id: 'd', clientId: null, conversationStatut: 'a_traiter' },
    null,
  ]);
  assert.deepEqual([...set], ['c-1']);
  assert.equal(openConversationClients(undefined).size, 0);
});
