import test from 'node:test';
import assert from 'node:assert/strict';
import { cartonManifest, clientJourney, clientWorkState, clientShipmentPath, quotePresentation, publicJourney, outgoingTracking, latestLogisticsEvent,
  clientPhaseState, latestShipmentNews, clientDate, plannedDepartureMessage, plannedDepartureShown, cartonMeasures, measureText, clientTaskExplanation, PLANNED_DEPARTURE_STATUSES,
  clientDay, firstWaitDay, waitUntilInstant, publicDeparture } from './clientJourney.js';

test('reopened consent takes priority over the historical quote on staff and client projections', () => {
  for (const statut of ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'refuse_client']) {
    const dossier = { statut, devisEnvoyeLe: '2026-09-18', devisTotal: null, devisBrouillon: true, quoteNeedsReview: true };
    assert.equal(clientJourney(dossier).quoteNeedsReview, false);
    assert.doesNotMatch(clientJourney(dossier).label, /Devis/);
    assert.deepEqual(clientJourney(dossier, Date.parse('2026-09-21')).event, { label:'Ancien devis envoyé',date:'2026-09-18',historical:true });
    if (statut === 'attente_feu_vert') assert.equal(clientWorkState(dossier).kind, 'agreement');
  }
});

test('the current request replaces an older quote in the client summary after reopening', () => {
  const dossier={statut:'attente_feu_vert',devisEnvoyeLe:'2026-09-17',demandeFeuVertEnvoyeeAt:'2026-09-20',devisBrouillon:true,devisTotal:null};
  assert.deepEqual(clientJourney(dossier,Date.parse('2026-09-21')).event,{label:'Demande d’accord envoyée',date:'2026-09-20'});
  assert.equal(clientWorkState(dossier).kind,'agreement');
  assert.equal(clientJourney({...dossier,statut:'devis_envoye',devisTotal:80,devisBrouillon:false,devisEnvoyeLe:'2026-09-21'},Date.parse('2026-09-21')).event.label,'Devis envoyé');
});

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

test('a preparation pause keeps independent corrections and replies visible without giving consent', () => {
  const parcel = { id: 'p', statut: 'attente_feu_vert', attenteClientDate: '2026-09-19', feuVert: null,
    conversationStatut: 'attente_client', factures: [{ id: 'old', rejetMotif: 'Page manquante' }] };
  const before = JSON.stringify(parcel);
  assert.equal(clientWorkState(parcel).kind, 'documents');
  assert.equal(clientWorkState(parcel).journey.waiting, true);
  assert.equal(clientShipmentPath(parcel), '/colis/p?panel=documents');
  assert.equal(JSON.stringify(parcel), before);
  const corrected = { ...parcel, factures: [...parcel.factures, { id: 'new', replacesFactureId: 'old' }] };
  assert.equal(clientWorkState(corrected).kind, 'messages');
  assert.equal(clientShipmentPath(corrected), '/colis/p?panel=messages');
  const answered = { ...corrected, conversationStatut: 'a_repondre' };
  assert.equal(clientWorkState(answered).section, 'waiting');
  assert.equal(clientWorkState(answered).kind, 'none');
  assert.equal(clientWorkState(answered).journey.waiting, true);
  assert.equal(clientShipmentPath(answered), '/colis/p');
  assert.equal(answered.statut, 'attente_feu_vert');
  assert.equal(answered.feuVert, null);
});

test('old copies do not interrupt a preparation pause and closed dossiers remain read-only destinations', () => {
  const parcel = { id: 'p', statut: 'attente_feu_vert', attenteClientDate: '2026-09-19', factures: [
    { id: 'copy', duplicateOfId: 'current', rejetMotif: 'Ancienne demande' }, { id: 'current', valide: true },
  ] };
  assert.equal(clientWorkState(parcel).section, 'waiting');
  for (const closed of [{ archive: true }, { statut: 'annule' }, { statut: 'livre' }]) {
    const dossier = { ...parcel, ...closed, conversationStatut: 'attente_client' };
    assert.equal(clientWorkState(dossier).section, 'history');
    assert.equal(clientShipmentPath(dossier), '/colis/p');
  }
  assert.equal(clientShipmentPath({ id: 'p', statut: 'en_preparation', factures: [] }), '/colis/p?panel=documents');
  assert.equal(clientShipmentPath({ id: 'p', statut: 'attente_feu_vert', factures: [] }), '/colis/p');
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

test('a quote being updated after a late invoice never asks the client to pay', () => {
  const parcel = { id: 'p', statut: 'devis_envoye', devisTotal: 120, devisEnvoyeLe: '2026-10-01T08:00:00Z', quoteUpdatePending: true, payplugPaymentUrl: null, factures: [] };
  const state = clientWorkState(parcel);
  assert.deepEqual([state.section, state.kind, state.action], ['team', 'none', 'Suivre la mise à jour du devis']);
  assert.equal(state.journey.label, 'Devis en cours de mise à jour'); assert.equal(state.journey.actor, 'Notre équipe');
  assert.match(state.journey.next, /Aucun règlement n’est demandé/);
  assert.equal(state.journey.event?.historical, true, 'The withdrawn quote date is history, not the current step');
  assert.equal(clientWorkState({ ...parcel, statut: 'attente_paiement' }).kind, 'none');
  assert.equal(clientWorkState({ ...parcel, quoteUpdatePending: false }).kind, 'payment');
  assert.equal(clientWorkState({ ...parcel, statut: 'paye', paiementDate: '2026-10-02', paiementMontant: 120 }).journey.quoteUpdating, false);
  assert.doesNotMatch(publicJourney(parcel).label + publicJourney(parcel).next, /Règlement attendu/);
});

test('after the late-invoice withdrawal the quote stays « en cours de mise à jour » until the new quote is sent', () => {
  const parcel = { id: 'p', statut: 'en_preparation', devisBrouillon: true, devisTotal: null, devisEnvoyeLe: '2026-10-01T08:00:00Z', quoteUpdatePending: true, factures: [{ id: 'f', valide: false }] };
  const state = clientWorkState(parcel);
  assert.deepEqual([state.section, state.kind, state.action], ['team', 'none', 'Suivre la mise à jour du devis']);
  assert.equal(state.journey.label, 'Devis en cours de mise à jour'); assert.equal(state.journey.quoteUpdating, true);
  assert.equal(state.journey.event?.historical, true);
  assert.equal(clientWorkState({ ...parcel, quoteUpdatePending: false }).journey.label, 'Devis en cours de révision');
  assert.equal(clientWorkState({ ...parcel, statut: 'expedie', dateExpedition: '2026-10-02' }).journey.quoteUpdating, false);
  assert.equal(clientWorkState({ ...parcel, archive: true }).journey.quoteUpdating, false);
});

// ── Final review D (2026-10-07): client wording, timeline, latest news, planned departure, carton measures ──
const STATUSES = ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'refuse_client', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre', 'annule'];
// The reviewer's French typography audit: no plain space before « : ; ! ? », none after «, no straight apostrophe.
const typographyProblems = text => [/ [:;!?»]/.test(text) && 'space before punctuation', /« (?=\S)/.test(text) && 'space after «', /[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ]/.test(text) && 'straight apostrophe'].filter(Boolean);

test('every next step is a client sentence with its actor, never a bare infinitive', () => {
  for (const statut of STATUSES) {
    const { next } = clientJourney({ statut, devisTotal: 80, devisBrouillon: false, messages: [{ id: 'm' }] });
    assert.doesNotMatch(next, /^(Vous transmettre|Commencer|Organiser|Acheminer|Convenir|Livrer|Mesurer|Préparer|Terminer|Autoriser|Consulter) /, statut);
    assert.match(next, /(Notre équipe|Votre|Vous|vous|vos|Merci|Consultez|Donnez|écrivez)/, statut);
    assert.deepEqual(typographyProblems(next), [], statut);
  }
  assert.match(clientJourney({ statut: 'receptionne' }).next, /^Notre équipe mesure vos cartons\u00a0; vous recevrez ensuite la demande d’accord/);
  assert.match(clientJourney({ statut: 'autorise' }).next, /vous serez prévenu\(e\) dès que votre devis sera prêt\.$/);
  // Nothing promised that the application does not send: no delivery day, no « prévenu(e) à chaque étape ».
  for (const statut of STATUSES) assert.doesNotMatch(clientJourney({ statut }).next, /à chaque étape|aujourd’hui|demain/, statut);
});

test('the waiting state asks nothing now and never reads like a pending task', () => {
  const journey = clientJourney({ statut: 'attente_feu_vert', attenteClientDate: '2026-10-01T08:00:00Z' });
  assert.equal(journey.waiting, true);
  assert.doesNotMatch(journey.next, /^Autoriser|^Donnez/);
  assert.match(journey.next, /^Nous conservons vos cartons/);
  assert.match(journey.next, /Quand vous serez prêt\(e\), il vous suffira de donner votre accord/);
  assert.equal(clientWorkState({ statut: 'attente_feu_vert', attenteClientDate: '2026-10-01T08:00:00Z', factures: [{ id: 'f', valide: true }] }).kind, 'none');
});

test('a cancelled dossier points to the exchanges only when there are some', () => {
  assert.match(clientJourney({ statut: 'annule', messages: [{ id: 'm' }] }).next, /figurent dans vos échanges/);
  for (const messages of [[], undefined]) {
    const next = clientJourney({ statut: 'annule', messages }).next;
    assert.doesNotMatch(next, /Consultez les échanges|figurent dans vos échanges/);
    assert.match(next, /écrivez à notre équipe depuis «\u00a0Messages\u00a0»/);
  }
});

test('the shared page keeps a neutral observer wording, never « vous » or the client’s own label', () => {
  for (const statut of STATUSES) {
    const journey = publicJourney({ statut, devisTotal: 80, devisBrouillon: false, quoteNeedsReview: false });
    assert.doesNotMatch(journey.next, /\b(vous|votre|vos|Vous|Votre|Vos)\b/, statut);
    assert.doesNotMatch(journey.label, /^Votre/, statut);
    assert.notEqual(journey.actor, 'À vous', statut);
    assert.deepEqual(typographyProblems(journey.next), [], statut);
  }
  assert.equal(publicJourney({ statut: 'autorise' }).label, 'Accord du client enregistré');
  assert.equal(publicJourney({ statut: 'dedouanement' }).next, 'Formalités de douane en cours avant la livraison.');
});

test('a timeline step is done once its outcome is recorded', () => {
  assert.equal(clientPhaseState(7, 'livre'), 'done', 'a delivered dossier never shows « Livraison — Étape en cours »');
  assert.equal(clientPhaseState(7, 'livraison'), 'active');
  assert.equal(clientPhaseState(1, 'autorise'), 'done', 'the consent given');
  assert.equal(clientPhaseState(1, 'attente_feu_vert'), 'active');
  assert.equal(clientPhaseState(1, 'refuse_client'), 'active');
  assert.equal(clientPhaseState(3, 'paye'), 'done', 'the payment received');
  assert.equal(clientPhaseState(3, 'attente_paiement'), 'active');
  assert.equal(clientPhaseState(2, 'autorise'), 'future');
  assert.equal(clientPhaseState(1, 'en_preparation'), 'done');
  assert.equal(clientPhaseState(4, 'transit'), 'active');
});

test('the latest shipment news follows the last status change, never a stale expedition date', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const shipped = { dateReception: '2026-09-29T08:00:00Z', dateExpedition: '2026-10-03T06:00:00Z', paiementDate: '2026-10-02T19:00:00Z' };
  assert.deepEqual(latestShipmentNews({ ...shipped, statut: 'dedouanement', statutUpdatedAt: '2026-10-05T09:00:00Z' }, now), { label: 'Arrivée en douane', date: '2026-10-05T09:00:00Z' });
  assert.deepEqual(latestShipmentNews({ ...shipped, statut: 'arrive', statutUpdatedAt: '2026-10-06T09:00:00Z' }, now), { label: 'Arrivée au dépôt local', date: '2026-10-06T09:00:00Z' });
  assert.deepEqual(latestShipmentNews({ ...shipped, statut: 'transit' }, now), { label: 'Expédition enregistrée', date: '2026-10-03T06:00:00Z' }, 'without the status date, the latest logistics event');
  assert.deepEqual(latestShipmentNews({ ...shipped, statut: 'transit', statutUpdatedAt: '2026-10-09T09:00:00Z' }, now), { label: 'Expédition enregistrée', date: '2026-10-03T06:00:00Z' }, 'a future date is ignored');
  assert.deepEqual(latestShipmentNews({ statut: 'paye', statutUpdatedAt: '2026-10-06T09:00:00Z', paiementDate: '2026-10-06T09:00:00Z' }, now), null, 'a payment is not shipment news');
});

test('client dates read in French, with « 1er » and the year only when it changes', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  assert.equal(clientDate('2026-10-08', { weekday: true, now }), 'jeudi 8\u00a0octobre');
  assert.equal(clientDate('2026-10-01', { now }), '1er\u00a0octobre');
  assert.equal(clientDate('2026-10-01', { weekday: true, now }), 'jeudi 1er\u00a0octobre');
  assert.equal(clientDate('2027-01-11', { now }), '11\u00a0janvier 2027');
  assert.equal(clientDate('invalid', { now }), null);
  assert.equal(clientDate(null, { now }), null);
});

test('the planned departure has two versions and a failure is never read as « no date yet »', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  assert.deepEqual(PLANNED_DEPARTURE_STATUSES, ['autorise', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye', 'expedie']);
  assert.deepEqual(plannedDepartureMessage({ statut: 'paye' }, { state: 'ready', date: '2026-10-08' }, now),
    { kind: 'date', label: 'Départ prévu\u00a0:', day: 'jeudi 8\u00a0octobre', note: 'Il s’agit du départ, pas de la date de livraison.' });
  const pending = plannedDepartureMessage({ statut: 'autorise' }, { state: 'ready', date: null }, now);
  assert.equal(pending.kind, 'pending');
  assert.match(pending.text, /^Votre date de départ n’est pas encore fixée\u00a0: elle s’affichera ici dès que notre équipe l’aura confirmée\.$/);
  assert.doesNotMatch(pending.text, /\d/, 'no invented day');
  assert.equal(plannedDepartureMessage({ statut: 'paye' }, { state: 'error' }, now).kind, 'error');
  assert.equal(plannedDepartureMessage({ statut: 'paye' }, { state: 'loading' }, now).kind, 'loading');
  assert.equal(plannedDepartureMessage({ statut: 'paye' }, { state: 'idle' }, now), null);
  assert.equal(plannedDepartureMessage({ statut: 'expedie' }, { state: 'ready', date: '2026-10-03' }, now).label, 'Départ du');
  assert.equal(plannedDepartureMessage({ statut: 'expedie' }, { state: 'ready', date: null }, now), null, 'a departed dossier without its day says nothing');
  for (const statut of ['receptionne', 'mesure', 'attente_feu_vert', 'refuse_client', 'transit', 'livre', 'annule'])
    assert.equal(plannedDepartureMessage({ statut }, { state: 'ready', date: '2026-10-08' }, now), null, statut);
  assert.equal(plannedDepartureShown({ statut: 'paye', archive: true }), false);
  assert.equal(plannedDepartureShown(null), false);
});

test('carton measures speak of cartons and never show a multi-carton dossier as one fake box', () => {
  const two = cartonMeasures({ nbColis: 2, trackingsDetail: [{ number: 'A1' }, { number: '' }], dimsParColis: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3.4 }, { dimL: 35, dimW: 25, dimH: 25, poids: 2.8 }] });
  assert.equal(two.mode, 'cartons'); assert.equal(two.title, 'Mesures de vos 2 cartons');
  assert.deepEqual(two.cartons.map(carton => [carton.index, carton.number, measureText(carton.measures)]), [[1, 'A1', '40 × 30 × 20\u00a0cm · 3,4\u00a0kg'], [2, '', '35 × 25 × 25\u00a0cm · 2,8\u00a0kg']]);
  const global = cartonMeasures({ nbColis: 3, trackings: ['Z1', 'S2', 'S3'], dimsParColis: [], dimL: 40, dimW: 30, dimH: 25, poids: 6.2 });
  assert.equal(global.mode, 'global'); assert.equal(global.title, 'Mesures de vos 3 cartons'); assert.equal(global.cartons.length, 0);
  assert.equal(measureText(global.global), '40 × 30 × 25\u00a0cm · 6,2\u00a0kg');
  const single = cartonMeasures({ nbColis: 1, dimL: 40, dimW: 30, dimH: 25, poids: 6.2 });
  assert.equal(single.mode, 'cartons'); assert.equal(single.title, 'Mesures de votre carton');
  assert.equal(cartonMeasures({ nbColis: 2 }).mode, 'none');
  assert.equal(cartonMeasures({ nbColis: 2, dimsParColis: [{ dimL: 40, dimW: 30, dimH: 20, poids: 3 }, {}] }).cartons[1].measures, null);
});

test('a requested document says why it is needed and what follows', () => {
  const particulier = clientTaskExplanation({ statut: 'autorise', factures: [] }, { type: 'particulier' });
  // The invoice serves the estimate of the import taxes (decision of 10 October 2026), never « le calcul de l’octroi de mer ».
  assert.match(particulier, /établir votre devis/); assert.match(particulier, /pour l’estimation des taxes à l’importation\./); assert.doesNotMatch(particulier, /octroi de mer/i); assert.match(particulier, /notre équipe la vérifie puis prépare votre devis/);
  assert.match(clientTaskExplanation({ statut: 'receptionne', factures: [] }, { type: 'particulier' }), /demande d’accord pour préparer vos cartons/);
  const pro = clientTaskExplanation({ statut: 'autorise', factures: [] }, { type: 'pro' });
  assert.match(pro, /formalités de douane/); assert.doesNotMatch(pro, /octroi de mer/);
  assert.match(clientTaskExplanation({ statut: 'en_preparation', factures: [{ id: 'f', rejetMotif: 'Page manquante' }] }, {}), /la raison est indiquée dans «\u00a0Mes factures\u00a0»/);
  assert.match(clientTaskExplanation({ statut: 'en_preparation', conversationStatut: 'attente_client', factures: [{ id: 'f', valide: true }] }, {}), /^Notre équipe vous a posé une question/);
  assert.equal(clientTaskExplanation({ statut: 'paye', paiementDate: '2026-10-02', factures: [] }, {}), '');
  for (const text of [particulier, pro]) assert.deepEqual(typographyProblems(text), []);
});

/** Runs `run` with the device in another time zone (Node reads TZ again on each change). */
function inZone(zone, run) {
  const previous = globalThis.process.env.TZ;
  globalThis.process.env.TZ = zone;
  try { return run(); } finally { if (previous === undefined) delete globalThis.process.env.TZ; else globalThis.process.env.TZ = previous; }
}

test('a chosen day reads on that day in every territory, never one day early in the Antilles', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  for (const zone of ['America/Martinique', 'America/Guadeloupe', 'Indian/Reunion', 'Indian/Mayotte', 'Europe/Paris']) inZone(zone, () => {
    // « Attendre jusqu’au 20 octobre », kept by the server as its midnight UTC; a subscription end (date column).
    assert.equal(clientDay('2026-10-20T00:00:00+00:00', { now }), '20\u00a0octobre', zone);
    assert.equal(clientDay('2026-10-20', { now }), '20\u00a0octobre', zone);
    assert.equal(clientDay('2026-11-01', { now }), '1er\u00a0novembre', zone);
    assert.equal(clientDay('2027-01-01', { now }), '1er\u00a0janvier 2027', zone);
  });
  assert.equal(clientDay(null), null);
  assert.equal(clientDay(undefined), null, 'never « today » for a missing day');
  assert.equal(clientDay('pas une date'), null);
});

test('« Attendre jusqu’au » offers the first day the server accepts, never the device’s today', () => {
  // The server keeps the chosen day as its midnight UTC and refuses one that is not in the future.
  const accepted = (day, now) => Date.parse(waitUntilInstant(day)) > now;
  for (const zone of ['America/Martinique', 'Indian/Reunion', 'Europe/Paris']) inZone(zone, () => {
    for (const instant of ['2026-10-07T00:00:00Z', '2026-10-07T03:30:00Z', '2026-10-07T12:00:00Z', '2026-10-07T21:30:00Z', '2026-10-07T23:59:59Z']) {
      const now = Date.parse(instant);
      const first = firstWaitDay(now);
      assert.ok(accepted(first, now), `${zone} ${instant}: ${first} is accepted`);
      const local = new Date(now); const today = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
      assert.ok(first > today, `${zone} ${instant}: today (${today}) is never offered`);
      const before = new Date(Date.parse(`${first}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
      assert.ok(!accepted(before, now) || before <= today, `${zone} ${instant}: ${first} is the first such day`);
    }
  });
  assert.equal(waitUntilInstant('2026-10-20'), '2026-10-20T00:00:00Z');
  assert.equal(waitUntilInstant(''), null);
  assert.equal(waitUntilInstant('2026-02-30'), null);
});

test('the shared page never presents a past or completed departure as planned', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  assert.deepEqual(publicDeparture({ statut: 'paye', eta: '2026-10-14', envoiStatut: 'planifie' }, now), { label: 'Départ prévu\u00a0:', day: 'mercredi 14\u00a0octobre' });
  assert.deepEqual(publicDeparture({ statut: 'attente_paiement', eta: '2026-10-07' }, now), { label: 'Départ prévu\u00a0:', day: 'mercredi 7\u00a0octobre' }, 'today (Paris) is still to come');
  assert.equal(publicDeparture({ statut: 'paye', eta: '2026-10-01', envoiStatut: 'planifie' }, now), null, 'a past day');
  assert.equal(publicDeparture({ statut: 'paye', eta: '2026-10-09', envoiStatut: 'parti' }, now), null, 'a departure that left without this parcel');
  assert.equal(publicDeparture({ statut: 'paye', eta: '2026-10-09', envoiStatut: 'archive' }, now), null);
  assert.deepEqual(publicDeparture({ statut: 'expedie', eta: '2026-10-01', envoiStatut: 'parti' }, now), { label: 'Départ du', day: 'jeudi 1er\u00a0octobre' });
  assert.equal(publicDeparture({ statut: 'expedie', eta: '2026-10-03', envoiStatut: 'planifie' }, now), null, 'shipped, its departure not confirmed');
  for (const statut of ['receptionne', 'attente_feu_vert', 'transit', 'livre', 'annule']) assert.equal(publicDeparture({ statut, eta: '2026-10-14', envoiStatut: 'planifie' }, now), null, statut);
  assert.equal(publicDeparture({ statut: 'paye' }, now), null);
});

test('the portal names an expedition, never a « dossier »', () => {
  const texts = [];
  for (const statut of ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'refuse_client', 'en_preparation', 'devis_envoye', 'paye', 'expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre', 'annule', 'inconnu']) {
    const journey = clientJourney({ statut, messages: [] });
    texts.push(journey.label, journey.next);
    const task = clientWorkState({ statut, factures: [{ id: 'f', valide: true }] });
    texts.push(task.action, clientTaskExplanation({ statut }, {}, task));
    const observer = publicJourney({ statut, devisTotal: 80, devisBrouillon: false, quoteNeedsReview: false });
    texts.push(observer.label, observer.next);
  }
  texts.push(clientTaskExplanation({ statut: 'en_preparation' }, {}, { kind: 'messages' }));
  assert.deepEqual(texts.filter(text => /\bdossiers?\b/i.test(text || '')), []);
  assert.equal(clientWorkState({ statut: 'livre' }).action, 'Consulter l’expédition');
  assert.equal(clientJourney({ statut: 'annule' }).label, 'Expédition annulée');
});
