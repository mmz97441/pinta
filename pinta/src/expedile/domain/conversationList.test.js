import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationPreview, conversationSince, conversationOverdue, waitingAge, conversationTime, conversationDay, conversationClock, sortConversations, linkLabel, previewText, clientDisplayName, nameInitials } from './conversationList.js';

const now = Date.parse('2026-10-05T09:00:00Z'); // 11:00 in Paris
const client = (texte, createdAt, extra = {}) => ({ type: 'client', texte, createdAt, ...extra });
const staff = (texte, createdAt, extra = {}) => ({ type: 'staff', texte, createdAt, statut: 'envoye', auteur: 'Camille Martin', ...extra });

test('an open request previews the client question, other states the last exchange', () => {
  const messages = [client('Pouvez-vous attendre mon colis Amazon ?', '2026-10-05T06:00:00Z'), staff('Bonjour Flavie 👋\n\nNous attendons le colis.', '2026-10-05T07:00:00Z', { auteurId: 'me' })];
  assert.deepEqual(conversationPreview({ conversationStatut: 'a_traiter', messages }, { meId: 'me' }), { text: 'Pouvez-vous attendre mon colis Amazon ?', fromStaff: false });
  assert.deepEqual(conversationPreview({ conversationStatut: 'attente_client', messages }, { meId: 'me' }), { text: 'Vous : Nous attendons le colis.', fromStaff: true });
});

test('previews are one line, without addresses or a staff greeting', () => {
  const messages = [client('Voici le suivi :\n\nhttps://www.amazon.fr/progress-tracker/package?id=1   merci', '2026-10-05T06:00:00Z')];
  assert.equal(conversationPreview({ conversationStatut: 'a_traiter', messages }).text, 'Voici le suivi : (lien) merci');
  assert.equal(previewText('  Bonjour,\n  le lien https://x.test/a-test  '), 'Bonjour, le lien (lien)');
  // Only a staff template greeting on its own line is dropped; a client « Bonjour » stays.
  assert.equal(conversationPreview({ conversationStatut: 'a_traiter', messages: [client('Bonjour, quel est le délai ?', '2026-10-05T06:00:00Z')] }).text, 'Bonjour, quel est le délai ?');
  assert.equal(conversationPreview({ conversationStatut: 'termine', messages: [staff('Bonjour Jean 👋 votre devis est prêt.', '2026-10-05T06:00:00Z')] }).text, 'Camille : Bonjour Jean 👋 votre devis est prêt.');
});

test('staff previews name the author: you, a colleague’s first name or the team', () => {
  const sent = extra => ({ conversationStatut: 'termine', messages: [staff('Bonjour Flavie\nC’est noté.', '2026-10-05T06:00:00Z', extra)] });
  assert.equal(conversationPreview(sent({ auteurId: 'me' }), { meId: 'me' }).text, 'Vous : C’est noté.');
  assert.equal(conversationPreview(sent({ auteurId: 'madly', auteur: 'HOARAU' }), { meId: 'me', teamUsers: [{ authId: 'madly', prenom: 'Madly', nom: 'Hoarau' }] }).text, 'Madly : C’est noté.');
  assert.equal(conversationPreview(sent({ auteurId: 'other', auteur: 'Marie (Expedîle)' }), { meId: 'me' }).text, 'Marie : C’est noté.');
  for (const auteur of ['Système', 'Expedîle', '']) assert.equal(conversationPreview(sent({ auteur }), { meId: 'me' }).text, 'Équipe : C’est noté.');
});

test('empty texts keep the existing document wording', () => {
  assert.equal(conversationPreview({ conversationStatut: 'a_traiter', messages: [client('', '2026-10-05T06:00:00Z', { attachmentPath: 'p/facture.pdf' })] }).text, 'Document reçu');
  assert.equal(conversationPreview({ conversationStatut: 'a_traiter', messages: [] }).text, 'Documents reçus');
});

test('the wait starts at the opening, else at the first unanswered client message', () => {
  assert.equal(conversationSince({ conversationOpenedAt: '2026-10-01T08:00:00Z', messages: [client('Encore là ?', '2026-10-04T08:00:00Z')] }), '2026-10-01T08:00:00Z');
  const messages = [client('Première question', '2026-10-01T08:00:00Z'), staff('Réponse', '2026-10-02T08:00:00Z'), client('Nouvelle question', '2026-10-03T08:00:00Z'), client('Relance', '2026-10-04T08:00:00Z')];
  assert.equal(conversationSince({ messages }), '2026-10-03T08:00:00Z');
  // A reply that never reached the client does not end the wait; structured decisions are not questions.
  assert.equal(conversationSince({ messages: [client('Question', '2026-10-01T08:00:00Z'), staff('Brouillon', '2026-10-02T08:00:00Z', { statut: 'echec' })] }), '2026-10-01T08:00:00Z');
  assert.equal(conversationSince({ messages: [client('Accord', '2026-10-01T08:00:00Z', { template: 'client_decision_approve' })] }), null);
});

test('a reply is overdue after the same 7 days as the work queues', () => {
  assert.equal(conversationOverdue({ conversationStatut: 'a_traiter', conversationOpenedAt: '2026-09-27T09:00:00Z' }, now), true);
  assert.equal(conversationOverdue({ conversationStatut: 'a_traiter', conversationOpenedAt: '2026-10-03T09:00:00Z' }, now), false);
  assert.equal(conversationOverdue({ conversationStatut: 'attente_client', conversationOpenedAt: '2026-09-01T09:00:00Z' }, now), false);
});

test('waiting ages and list times are short, in Paris time', () => {
  assert.equal(waitingAge('2026-10-05T08:52:00Z', now), '8 min');
  assert.equal(waitingAge('2026-10-05T08:59:50Z', now), '1 min');
  assert.equal(waitingAge('2026-10-05T04:00:00Z', now), '5 h');
  assert.equal(waitingAge('2026-10-03T08:00:00Z', now), '2 j');
  assert.equal(waitingAge(null, now), '');
  assert.equal(conversationTime('2026-10-05T05:31:00Z', now), '07:31');
  // 22:30 UTC on 4 October is already 5 October in Paris.
  assert.equal(conversationTime('2026-10-04T22:30:00Z', now), '00:30');
  assert.equal(conversationTime('2026-10-04T12:00:00Z', now), 'hier');
  assert.equal(conversationTime('2026-10-01T12:00:00Z', now), '1 oct.');
  assert.equal(conversationTime('2025-12-24T12:00:00Z', now), '24 déc. 2025');
  assert.equal(conversationClock('2026-10-05T04:57:00Z'), '06:57');
});

test('day separators read « Aujourd’hui », « Hier » then the date', () => {
  assert.equal(conversationDay('2026-10-05T04:57:00Z', now), 'Aujourd’hui');
  assert.equal(conversationDay('2026-10-04T01:27:00Z', now), 'Hier');
  assert.equal(conversationDay('2026-10-03T01:27:00Z', now), 'Samedi 3 octobre');
  // 25 October 2026 lasts 25 hours in Paris: 00:10 that day is still « Hier » at 00:30 the next day.
  assert.equal(conversationDay('2026-10-24T22:10:00Z', Date.parse('2026-10-25T23:30:00Z')), 'Hier');
  assert.equal(conversationDay('2026-10-24T21:50:00Z', Date.parse('2026-10-25T23:30:00Z')), 'Samedi 24 octobre');
});

test('sections keep the oldest request first; a new message never moves it down', () => {
  const rows = sortConversations([
    { id: 'done', ref: 'EXP-4', conversationStatut: 'termine', conversationUpdatedAt: '2026-10-05T08:00:00Z' },
    { id: 'recent', ref: 'EXP-1', conversationStatut: 'a_traiter', conversationOpenedAt: '2026-10-04T08:00:00Z', conversationUpdatedAt: '2026-10-04T08:00:00Z' },
    { id: 'waiting-old', ref: 'EXP-5', conversationStatut: 'attente_client', conversationUpdatedAt: '2026-10-01T08:00:00Z' },
    { id: 'older', ref: 'EXP-2', conversationStatut: 'a_traiter', conversationOpenedAt: '2026-10-01T08:00:00Z', conversationUpdatedAt: '2026-10-05T08:30:00Z' },
    { id: 'waiting-new', ref: 'EXP-3', conversationStatut: 'attente_client', conversationUpdatedAt: '2026-10-04T08:00:00Z' },
  ]);
  assert.deepEqual(rows.map(row => row.id), ['older', 'recent', 'waiting-new', 'waiting-old', 'done']);
});

test('links read as host and path, without the protocol, shortened', () => {
  assert.equal(linkLabel('https://www.zalando.fr/myaccount/orders/10203040506070/invoice.pdf'), 'zalando.fr/myaccount/orders/10203040506…');
  assert.equal(linkLabel('https://www.vinted.fr/transaction/1/'), 'vinted.fr/transaction/1');
  assert.equal(linkLabel('https://t.me/Expedilebot?start=token'), 't.me/Expedilebot');
  assert.ok(linkLabel('https://example.test/' + 'a'.repeat(80)).length <= 40);
});

test('client names and initials follow the list wording', () => {
  assert.equal(clientDisplayName({ nom: 'Payet Flavie', nomFamille: 'Payet', prenom: 'Flavie' }), 'Flavie Payet');
  assert.equal(clientDisplayName({ nom: 'Boutique Kréol SARL', nomFamille: 'Boutique Kréol SARL', prenom: '' }), 'Boutique Kréol SARL');
  assert.equal(clientDisplayName(null), 'Client');
  assert.equal(nameInitials('Jean-Marc Hoarau'), 'JH');
  assert.equal(nameInitials('Client'), 'CL');
});
