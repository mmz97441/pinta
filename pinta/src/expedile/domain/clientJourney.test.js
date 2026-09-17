import test from 'node:test';
import assert from 'node:assert/strict';
import { cartonManifest, clientJourney, quotePresentation, publicJourney, outgoingTracking, latestLogisticsEvent } from './clientJourney.js';

test('consent counts received cartons even with missing or duplicate tracking references', () => {
  assert.deepEqual(cartonManifest({ id: 'p', ref: 'EXP', nbColis: 3, trackings: [' ONE ', '', 'ONE'], updatedAt: 'version' }), { id: 'p', ref: 'EXP', count: 3, trackings: ['ONE'], updatedAt: 'version' });
  assert.equal(cartonManifest({ id: 'p', dimsParColis: [{}, {}] }).count, 2);
});

test('a deliberate pause is not an overdue agreement and no status implies today', () => {
  const now = Date.parse('2026-09-10T10:00:00Z');
  assert.equal(clientJourney({ statut: 'attente_feu_vert', attenteClientDate: '2026-09-08', attenteClientUntil: '2026-09-12' }, now).waiting, true);
  assert.equal(clientJourney({ statut: 'attente_feu_vert', attenteClientDate: '2026-09-08', attenteClientUntil: '2026-09-09' }, now).waiting, true);
  assert.equal(clientJourney({ statut: 'attente_feu_vert', attenteClientDate: '2026-09-08', attenteClientUntil: '2026-09-09' }, now).reviewDue, true);
  assert.equal(clientJourney({ statut: 'en_preparation' }).label, 'Préparation en cours');
  assert.doesNotMatch(clientJourney({ statut: 'livraison' }).next, /aujourd’hui|aujourd'hui/);
  assert.equal(clientJourney({ statut: 'livre' }).actor, null);
});

test('latest dated business event ignores edits, invalid dates and future dates', () => {
  const journey = clientJourney({ statut: 'paye', dateReception: '2026-09-01', devisEnvoyeLe: '2026-09-04', paiementDate: '2026-09-07', dateExpedition: '2026-09-12', updatedAt: '2026-09-10' }, Date.parse('2026-09-10'));
  assert.equal(journey.event.label, 'Paiement reçu');
  assert.equal(clientJourney({ statut: 'mesure', dateReception: 'invalid' }).event, null);
});

test('published price uses frozen fee, rate and payment terms across later configuration changes', () => {
  const input = { devisTotal: 900, fraisDivers: [{ libelle: 'Modifié', montant: 90 }], modePaiementPro: 'especes', devisSnapshot: { version: 4, inputs: { client: { type: 'pro' }, destination: { tva: 8.5 }, fees: [{ libelle: 'Emballage convenu', montant: 3 }], paymentTerms: { mode: '30_jours' }, finalBox: {} }, amounts: { transport: 40, total: 43, tva: 0 }, before: { transport: 50 }, savings: 10 } };
  const before = JSON.stringify(input);
  const view = quotePresentation(input, { type: 'particulier' }, { tva: 20 });
  assert.equal(view.colis.devisTotal, 43);
  assert.equal(view.colis.fraisDivers[0].libelle, 'Emballage convenu');
  assert.equal(view.destination.tva, 8.5);
  assert.equal(view.paymentMode, '30_jours');
  assert.equal(view.client.type, 'pro');
  assert.equal(JSON.stringify(input), before);
  assert.equal(quotePresentation({ devisTotal: 43 }, {}, { tva: 20 }).destination.tva, null);
});

test('a withdrawn quote belongs to the team and cannot request a payment', async () => {
  const { clientWorkState } = await import('./clientJourney.js');
  const parcel = { statut: 'devis_envoye', devisBrouillon: true, devisTotal: null };
  assert.equal(clientWorkState(parcel).section, 'team');
  assert.equal(clientJourney(parcel).quoteNeedsReview, true);
  assert.match(clientJourney(parcel).next, /Aucun règlement/);
});

test('a corrected rejected invoice does not ask the client to upload the old document again', async () => {
  const { clientWorkState } = await import('./clientJourney.js');
  const parcel = { statut: 'en_preparation', factures: [{id:'old',rejetMotif:'Illisible'}, {id:'new',replacesFactureId:'old'}] };
  assert.equal(clientWorkState(parcel).section, 'team');
  parcel.factures[1].rejetMotif = 'Page absente';
  assert.equal(clientWorkState(parcel).section, 'todo');
});


test('public readers are never instructed to authorize preparation or make a private payment', () => {
  const payment = publicJourney({ statut: 'attente_paiement', quoteNeedsReview: false });
  assert.equal(payment.label, 'Règlement attendu du client');
  assert.doesNotMatch(payment.next + payment.actor, /À vous|Payer|Autoriser/);
  assert.equal(publicJourney({ statut: 'attente_feu_vert' }).label, 'Accord du client attendu');
  assert.match(publicJourney({ statut: 'attente_feu_vert', attenteClientDate: '2026-09-10' }).next, /accord du client/);
});

test('outgoing tracking never substitutes a supplier reception number', () => {
  const parcel = { envoiId: 'departure', trackings: ['INBOUND-1', 'INBOUND-2'] };
  assert.equal(outgoingTracking(parcel), '');
  assert.equal(outgoingTracking(parcel, [{id:'other', trackingPrincipal:'OTHER'}]), '');
  assert.equal(outgoingTracking(parcel, [{id:'departure', trackingPrincipal:'OUTBOUND'}]), 'OUTBOUND');
  assert.equal(outgoingTracking({...parcel, outgoingTracking:'SECURE-PROJECTION'}), 'SECURE-PROJECTION');
});

test('payment dates do not imply a logistics update or delivery commitment', () => {
  const parcel = { statut:'transit', dateReception:'2026-09-01', paiementDate:'2026-09-15', updatedAt:'2026-09-17' };
  assert.deepEqual(latestLogisticsEvent(parcel), { label:'Réception enregistrée', date:'2026-09-01' });
  assert.equal(latestLogisticsEvent({...parcel, dateReception:'invalid'}), null);
});
