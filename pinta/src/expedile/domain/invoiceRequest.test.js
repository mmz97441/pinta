import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceRequestState, invoiceRequestText } from './invoiceRequest.js';
import { clientWorkState } from './clientJourney.js';

test('a received unreviewed invoice is not requested again', () => {
  const colis = { factures: [{ id: 'received', fichier: 'dossier/achat.pdf', valide: false }] };
  assert.equal(invoiceRequestState(colis).requested, false);
  assert.match(invoiceRequestText(colis), /reçus et attendent notre vérification/);
});
test('only missing current documents or an unreplaced rejection request client documents', () => {
  assert.equal(invoiceRequestState({ factures: [] }).requested, true);
  assert.equal(invoiceRequestState({ factures: [{ id: 'bad', rejetMotif: 'Illisible' }] }).correction, true);
  assert.equal(invoiceRequestState({ factures: [{ id: 'bad', rejetMotif: 'Illisible' }, { id: 'new', replacesFactureId: 'bad', fichier: 'dossier/new.pdf' }] }).requested, false);
  assert.equal(invoiceRequestState({ factures: [{ id: 'good', valide: true }, { id: 'copy', duplicateOfId: 'good', rejetMotif: 'Ancien commentaire' }] }).requested, false);
});
test('legacy ambiguity never claims a document was received or asks for a duplicate', () => {
  const colis = { factures: [{ id: 'legacy', valide: false }] };
  assert.equal(invoiceRequestState(colis).requested, false);
  assert.match(invoiceRequestText(colis), /justificatifs enregistrés/);
  assert.doesNotMatch(invoiceRequestText(colis), /reçus|Aucun nouvel envoi/);
  assert.equal(invoiceRequestState({ factures: [{ id: 'legacy-approved', valide: true }] }).requested, false);
});
test('client priorities ask for one decision, then documents; pauses remain deliberate', () => {
  assert.equal(clientWorkState({ statut: 'attente_feu_vert', factures: [] }).kind, 'agreement');
  assert.equal(clientWorkState({ statut: 'autorise', factures: [] }).kind, 'documents');
  assert.equal(clientWorkState({ statut: 'attente_feu_vert', attenteClientDate: '2026-09-01', factures: [] }).kind, 'none');
  assert.equal(clientWorkState({ statut: 'en_preparation', factures: [{ id: 'pending' }] }).kind, 'none');
});
test('a withdrawn quote and completed payment never request payment or document replacement', () => {
  assert.equal(clientWorkState({ statut: 'devis_envoye', devisBrouillon: true, devisTotal: null }).kind, 'none');
  assert.equal(clientWorkState({ statut: 'paye', factures: [{ id: 'legacy', rejetMotif: 'Ancien commentaire' }] }).kind, 'none');
  assert.equal(clientWorkState({ statut: 'devis_envoye', devisBrouillon: false, devisTotal: 120 }, { type: 'pro' }).kind, 'payment');
  assert.equal(clientWorkState({ statut: 'en_preparation', factures: [{ id: 'pending' }], conversationStatut: 'attente_client' }).kind, 'messages');
});
