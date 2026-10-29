import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRIVAL_NOTICE_STATES, BROUILLON_STAGES, CLIENT_WAIT_LABEL, COLIS_DEFAULT_SORT, COLIS_DEFAULT_TAB, COLIS_SORTS, COLIS_TABS, MEASURE_MISSING_LABEL, NO_ACTION_LABEL,
  NOTICE_SEND_CHECK_MINUTES, PAID_TOTAL_STATE, actionAllowed, arrivalNoticeState, arrivalNoticeSummary, brouillonAlerts, brouillonFiche, cartonVolumeM3,
  colisActionHref, colisRow, colisSearchMatch, colisSortKey, colisStage, colisTab, colisTabKey, colisTotals, filterColisRows, formatDimensions, formatKg, formatM3,
  groupColisRowsByDeparture, groupColisRowsByDestination, NO_DESTINATION_GROUP_KEY, orderValidationItems, pendingByClient, pendingByColis, receptionTarget, sortColisRows,
} from './brouillon.js';
import { workspaceReturnPath } from './navigation.js';
import { STATUTS } from '../constants/index.js';
import { eur, kg } from '../utils/format.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const now = Date.parse('2026-10-28T10:00:00Z');
const all = () => true;
const nothing = () => false;
const flavie = { id: 'c-flavie', nom: 'PAYET Flavie', nomFamille: 'PAYET', prenom: 'Flavie', type: 'particulier', cp: '97400', ville: 'Saint-Denis', commune: 'Sainte-Clotilde', tel: '0692 12 34 56', email: 'flavie@example.re' };
const zoe = { id: 'c-zoe', nom: 'ÉBRARD Zoé', nomFamille: 'ÉBRARD', prenom: 'Zoé', type: 'particulier', cp: '97410', ville: 'Saint-Pierre' };
const paul = { id: 'c-paul', nom: 'durand Paul', nomFamille: 'durand', prenom: 'Paul', type: 'particulier', cp: '97400', ville: 'Saint-Denis' };
const pro = { id: 'c-pro', nom: 'HOARAU Jean', nomFamille: 'HOARAU', prenom: 'Jean', raisonSociale: 'Hoarau Distribution', type: 'pro', cp: '97600', ville: 'Mamoudzou' };
const clients = new Map([flavie, zoe, paul, pro].map(client => [client.id, client]));
const envois = [
  { id: 'e-soon', ref: 'ENV-29', date: '2026-10-29', statut: 'planifie', destinationCode: '974', loadingClosesAt: null, departedAt: null },
  { id: 'e-later', ref: 'ENV-05', date: '2026-11-05', statut: 'planifie', destinationCode: '974', loadingClosesAt: '2026-11-03T14:00:00Z', departedAt: null },
  { id: 'e-past', ref: 'ENV-20', date: '2026-10-20', statut: 'planifie', destinationCode: '974', loadingClosesAt: null, departedAt: null },
  { id: 'e-gone', ref: 'ENV-15', date: '2026-10-15', statut: 'arrive', destinationCode: '974', loadingClosesAt: null, departedAt: '2026-10-15T06:00:00Z' },
];
const ctx = (changes = {}) => ({ getClient: id => clients.get(id) || null, envois, settings: {}, pending: new Map(), notices: [], can: all, now, ...changes });
const box = (dimL, dimW, dimH, poids) => ({ dimL, dimW, dimH, poids });
const measured = {
  id: 'd-1', ref: 'EXP-AAA111', clientId: flavie.id, statut: 'mesure', feuVert: 'en_attente', nbColis: 2, casier: 'B12', consentRequestVersion: 0,
  trackings: ['6A 123 456 789 01', 'CB998877665FR'],
  trackingsDetail: [{ number: '6A 123 456 789 01', fournisseur: 'Amazon' }, { number: 'CB998877665FR', fournisseur: 'Zalando' }],
  dimsParColis: [box(40, 30, 20, 2.5), box(30, 20, 10, 1.25)],
  receptionDates: [{ receivedAt: '2026-10-26T08:00:00Z', source: 'initial_receipt' }, { receivedAt: '2026-10-27T09:00:00Z', source: 'append_receipt' }],
  messages: [], factures: [], lignes: [], createdAt: '2026-10-26T08:00:00Z',
};
const invoice = { id: 'f-1', valide: true, montant: 120, fichier: 'colis/d-1/facture.pdf' };
const prepared = { ...measured, statut: 'en_preparation', feuVert: 'autorise', feuVertDate: '2026-10-27T12:00:00Z', preparationCompositionVersion: 3,
  finalMeasurementsVersion: 3, outgoingParcelCount: 1, finalPackages: [box(40, 30, 15, 3.6)], factures: [invoice] };
const snapshot = {
  version: 1, schemaVersion: 1, mode: 'final', savings: 12.4,
  inputs: { client: { type: 'particulier' }, destination: { code: '974', nom: 'La Réunion', tva: 8.5 }, finalPackages: [box(40, 30, 15, 3.6)], volumetricDivisor: 5000, fees: [{ libelle: 'Stockage', montant: 5 }] },
  amounts: { transport: 70, om: 10.5, omr: 2.5, tva: 7.06, fees: 5, total: 95.06, realWeight: 3.6, volumetricWeight: 3.6, billableWeight: 3.6 },
};
// The raw columns disagree on purpose: every amount shown comes from the saved quote.
const quoted = { ...prepared, statut: 'devis_envoye', devisTotal: 95.06, devisSnapshot: snapshot, quoteVersion: 1, devisBrouillon: false,
  devisEnvoyeLe: '2026-10-27T15:00:00Z', devisTransport: 999, devisOM: 999, devisOMR: 999, devisTVA: 999, economie: 999, poidsFact: 999 };
const paid = { ...quoted, statut: 'paye', paiementMontant: 95.06, paiementDate: '2026-10-27T18:00:00Z', envoi: 'e-soon' };
const legacySingle = { id: 'd-old', ref: 'EXP-OLD001', clientId: flavie.id, statut: 'mesure', nbColis: 1, dimsParColis: [], trackings: ['LEGACY1'], trackingsDetail: [], dimL: 50, dimW: 40, dimH: 30, poids: 6, messages: [], factures: [] };
const pendingEntry = (colisId, cartons, changes = {}) => ({ colisId, ref: 'EXP-AAA111', clientId: flavie.id, statut: 'mesure', casier: 'B12',
  firstCarton: cartons[0], lastCarton: cartons[cartons.length - 1], cartonCount: cartons.length, receivedFrom: '2026-10-27T09:00:00Z', receivedTo: '2026-10-27T09:00:00Z',
  cartons: cartons.map(carton => ({ carton, number: '', fournisseur: '', dimL: 30, dimW: 20, dimH: 10, poids: 1.25, receivedAt: '2026-10-27T09:00:00Z' })), ...changes });
const staffMessage = (template, createdAt, changes = {}) => ({ id: `m-${template}-${createdAt}`, type: 'staff', template, createdAt, statut: 'envoye', canal: 'telegram', outboxStatus: 'sent', outboxSentAt: createdAt, ...changes });
const notice = (changes = {}) => ({
  id: 'n-1', createdAt: '2026-10-27T10:00:00Z', clientId: flavie.id, client: { nom: 'PAYET', prenom: 'Flavie' }, actor: { nom: 'Camille' },
  notify: true, canal: 'telegram', template: 'arrivee_colis', items: [{ colisId: 'd-1', ref: 'EXP-AAA111', firstCarton: 2, lastCarton: 3 }], cartons: [{ carton: 2 }, { carton: 3 }],
  message: { id: 'm-1', statut: 'envoye', texte: 'Bonjour Flavie, vos colis sont arrivés.', createdAt: '2026-10-27T10:00:00Z' },
  outbox: { id: 'o-1', status: 'sent', attempts: 1, sentAt: '2026-10-27T10:00:05Z', lastError: null }, ...changes,
});
const stageOf = (dossier, changes) => colisStage(dossier, ctx(changes));
// The rights each action carries, from the screen that does it, and what is said without them.
const RECEIVE = { permissions: ['perm_colis_receptionner'], deniedReason: 'Réservé aux personnes autorisées à réceptionner.' };
const CONSENT = { permissions: ['perm_colis_demander_feuvert'], deniedReason: 'Réservé aux personnes autorisées à demander l’accord.' };
const QUOTE = { permissions: ['perm_colis_calculer_devis', 'perm_colis_envoyer_devis'], deniedReason: 'Réservé aux personnes autorisées à établir ou envoyer le devis.' };
const PAYMENT = { permissions: ['perm_colis_confirmer_paiement', 'perm_comm_telegram', 'perm_comm_email', 'perm_comm_message_libre'], deniedReason: 'Réservé aux personnes autorisées à suivre les règlements.' };
const DEPARTURE = { permissions: ['perm_envois_voir'], deniedReason: 'Réservé aux personnes ayant accès aux départs.' };
const TRANSPORT = { permissions: ['perm_colis_changer_statut_expedition'], deniedReason: 'Réservé à l’équipe chargée du transport.' };
const CONVERSATION = { permissions: ['perm_comm_message_libre', 'perm_comm_telegram', 'perm_comm_email', 'perm_comm_voir_chat_autres'], deniedReason: 'Réservé aux personnes autorisées à échanger avec les clients.' };
const TELEGRAM = { permissions: ['perm_comm_telegram'], deniedReason: 'Réservé aux personnes autorisées à écrire sur Telegram.' };
// What the complete calculation needs (useApp().tarifs and categories): a tariff of La Réunion and Mayotte, one category.
const tarifs = { 974: { base: 10, parKg: 5 }, 976: { base: 12, parKg: 6 } };
const categories = [{ id: 'cat-1', label: 'Vêtements', taux: { 974: { om: 10, omr: 2.5 } } }];
const article = { id: 'l-1', desc: 'Robe', qte: 1, prix: 120, cat: 'cat-1', factureId: 'f-1' };
const complete = { ...prepared, lignes: [article] };
// A client's written message, as messages.type « client » records it.
const clientMessage = (createdAt, changes = {}) => ({ id: `m-client-${createdAt}`, type: 'client', template: null, createdAt, statut: 'envoye', canal: 'telegram', texte: 'Oui c’est bon pour moi, vous pouvez préparer', ...changes });

// ── Tabs and sorts ───────────────────────────────────────────────────────────
test('each internal status belongs to exactly one tab; archived and cancelled dossiers to none', () => {
  assert.deepEqual(COLIS_TABS.map(tab => [tab.key, tab.label]), [['brouillon', 'Brouillon'], ['a_payer', 'À payer'], ['pret', 'Prêt à partir'], ['parti', 'Parti']]);
  const expected = { receptionne: 'brouillon', mesure: 'brouillon', attente_feu_vert: 'brouillon', autorise: 'brouillon', en_preparation: 'brouillon', refuse_client: 'brouillon',
    devis_envoye: 'a_payer', attente_paiement: 'a_payer', paye: 'pret', expedie: 'parti', transit: 'parti', dedouanement: 'parti', arrive: 'parti', livraison: 'parti', livre: 'parti', annule: null };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(STATUTS).sort(), 'Every status of the application is placed.');
  for (const [statut, tab] of Object.entries(expected)) {
    assert.equal(colisTab({ statut }), tab, statut);
    assert.equal(colisTab({ statut, archive: true }), null, `${statut} archived`);
  }
  assert.equal(colisTab({ statut: 'inconnu' }), null);
  assert.equal(colisTab(null), null);
  assert.equal(COLIS_DEFAULT_TAB, 'brouillon');
  assert.equal(colisTabKey('pret'), 'pret');
  for (const value of [undefined, '', 'tout', 'BROUILLON']) assert.equal(colisTabKey(value), 'brouillon');
});

test('the five sorts, « Par nom » by default, « Par montant » marked financial', () => {
  assert.deepEqual(COLIS_SORTS.map(sort => [sort.key, sort.label, Boolean(sort.financial)]), [['nom', 'Par nom', false], ['depart', 'Par date d’envoi', false],
    ['destination', 'Par destination', false], ['reception', 'Par réception', false], ['montant', 'Par montant', true]]);
  assert.equal(COLIS_DEFAULT_SORT, 'nom');
  assert.equal(colisSortKey('montant'), 'montant');
  assert.equal(colisSortKey('destination'), 'destination');
  for (const value of [undefined, '', 'prix']) assert.equal(colisSortKey(value), 'nom');
});

// ── Brouillon steps ──────────────────────────────────────────────────────────
test('the Brouillon steps are those of the specification, in their order', () => {
  assert.deepEqual(BROUILLON_STAGES.map(item => [item.key, item.label]), [
    ['reception_a_valider', 'Réception à valider'], ['mesures_a_completer', 'Mesures à compléter'], ['client_a_repondu', 'Le client a répondu'],
    ['accord_a_demander', 'Accord à demander'], ['demande_a_verifier', 'Demande à vérifier'], ['attend_client', 'Attend son accord'],
    ['client_refuse', 'Le client refuse'], ['produit_interdit', 'Produit interdit à régler'], ['a_preparer', 'À préparer'],
    ['facture_manquante', 'Facture manquante'], ['devis_a_completer', 'Devis à compléter'], ['pret_pour_devis', 'Prêt pour le devis'],
  ]);
  assert.equal(NO_ACTION_LABEL, 'Rien à faire');
});

test('the first step that applies wins, from a reception to validate to the quote', () => {
  const pending = pendingByColis([pendingEntry('d-1', [2])]);
  // Everything at once: cartons to validate, a forbidden product, an outdated preparation and no invoice.
  const blocked = { ...prepared, preparationCompositionVersion: 4, produitInterdit: true, checkInterdits: ['Parfum'], factures: [] };
  const steps = [
    stageOf(blocked, { pending }),
    stageOf(blocked),
    stageOf({ ...blocked, produitInterdit: false }),
    stageOf({ ...blocked, produitInterdit: false, preparationCompositionVersion: 3 }),
    stageOf({ ...blocked, produitInterdit: false, preparationCompositionVersion: 3, factures: [invoice] }),
  ];
  assert.deepEqual(steps.map(step => step.key), ['reception_a_valider', 'produit_interdit', 'a_preparer', 'facture_manquante', 'pret_pour_devis']);
  assert.deepEqual(steps.map(step => step.action && [step.action.key, step.action.label, step.action.task]), [
    ['valider_reception', 'Valider la réception', null], ['voir_dossier', 'Voir le dossier', 'reception'], ['preparer', 'Préparer', 'preparation'],
    ['ajouter_facture', 'Ajouter la facture', 'documents'], ['envoyer_devis', 'Envoyer le devis', 'devis'],
  ]);
  assert.equal(steps[1].detail, 'Signalé : Parfum');
  assert.equal(steps[2].detail, 'Mesures après optimisation à confirmer pour les cartons actuels');
  // A reception to validate comes before every other step, whatever the status.
  for (const statut of ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'refuse_client'])
    assert.equal(stageOf({ ...measured, statut }, { pending }).key, 'reception_a_valider', statut);
});

test('« Réception à valider » counts the cartons waiting and opens the validation of the client’s reception', () => {
  const one = stageOf(measured, { pending: pendingByColis([pendingEntry('d-1', [2])]) });
  assert.deepEqual(one, { key: 'reception_a_valider', label: 'Réception à valider', detail: '1 carton à valider · reçu le 27/10/2026', tone: 'current',
    action: { key: 'valider_reception', label: 'Valider la réception', task: null, ...RECEIVE, href: '/recevoir?client=c-flavie&valider=1' } });
  // The server's list itself is accepted too, and an index by dossier.
  const two = stageOf(measured, { pending: [pendingEntry('d-1', [2, 3], { receivedTo: '2026-10-28T06:00:00Z' }), pendingEntry('d-other', [1])] });
  assert.equal(two.detail, '2 cartons à valider · dernier reçu le 28/10/2026');
  assert.equal(stageOf(measured, { pending: { 'd-1': pendingEntry('d-1', [2]) } }).key, 'reception_a_valider');
  assert.equal(stageOf(measured, { pending: [pendingEntry('d-other', [1])] }).key, 'accord_a_demander', 'Another dossier’s reception changes nothing here.');
  assert.equal(stageOf(measured, { pending: [pendingEntry('d-1', [], { cartonCount: 0, firstCarton: null, lastCarton: null })] }).key, 'accord_a_demander', 'Nothing left to validate.');
});

test('« Mesures à compléter » for a former carton received without its measures', () => {
  const step = stageOf({ ...measured, statut: 'receptionne', dimsParColis: [box(40, 30, 20, 2.5), { dimL: 30, dimW: null, dimH: 10, poids: 1 }] });
  assert.deepEqual([step.key, step.label, step.detail, step.action.key, step.action.label, step.action.task], ['mesures_a_completer', 'Mesures à compléter', '1 carton sans mesures', 'completer_mesures', 'Compléter les mesures', 'reception']);
  assert.equal(stageOf({ ...measured, statut: 'receptionne' }).detail, 'Mesures à enregistrer');
});

test('« Accord à demander » opens the consent request in place, never asked or to ask again after a new carton', () => {
  const first = stageOf(measured);
  assert.deepEqual(first, { key: 'accord_a_demander', label: 'Accord à demander', detail: 'Jamais demandé', tone: 'current',
    action: { key: 'demander_accord', label: 'Demander l’accord', task: 'accord', ...CONSENT, panel: 'demande_feu_vert' } });
  assert.equal(stageOf({ ...measured, consentRequestVersion: 2 }).detail, 'Nouvelle demande à envoyer');
  // A consent never recorded on a later status cannot be asked from the list: the dossier's accord task reopens it.
  const unrecorded = stageOf({ ...prepared, feuVert: 'en_attente' });
  assert.deepEqual([unrecorded.key, unrecorded.tone, unrecorded.detail, unrecorded.action.key, unrecorded.action.task], ['accord_a_demander', 'review', 'Accord du client à vérifier dans le dossier', 'voir_dossier', 'accord']);
});

test('« Attend son accord »: nothing to do while the request is followed up or the client’s wait runs; « Relancer » once due', () => {
  const waiting = { ...measured, statut: 'attente_feu_vert' };
  const read = dossier => { const step = stageOf(dossier); return [step.key, step.detail, step.action && step.action.key]; };
  // Delivered two hours ago: followed up for 24 hours.
  assert.deepEqual(read({ ...waiting, demandeFeuVertEnvoyeeAt: '2026-10-28T08:00:00Z', messages: [staffMessage('demande_feu_vert', '2026-10-28T08:00:00Z')] }), ['attend_client', 'Demandé le 28/10/2026', null]);
  // Still to deliver for a few minutes: it holds until delivered (beyond 10 minutes it is to check, see below).
  assert.deepEqual(read({ ...waiting, messages: [staffMessage('demande_feu_vert', '2026-10-28T09:55:00Z', { statut: 'envoi', outboxStatus: 'pending', outboxSentAt: null })] }), ['attend_client', 'Demande en cours d’envoi', null]);
  // Delivered two days ago without answer: the relance is due, it never leaves on its own.
  assert.deepEqual(read({ ...waiting, demandeFeuVertEnvoyeeAt: '2026-10-26T08:00:00Z', messages: [staffMessage('demande_feu_vert', '2026-10-26T08:00:00Z')] }), ['attend_client', 'Sans réponse · demandé le 26/10/2026', 'relancer']);
  const request = staffMessage('demande_feu_vert', '2026-10-25T08:00:00Z');
  assert.deepEqual(read({ ...waiting, messages: [request, staffMessage('relance_feu_vert', '2026-10-26T08:00:00Z')] }), ['attend_client', 'Sans réponse · relancé le 26/10/2026', 'relancer']);
  assert.deepEqual(read({ ...waiting, messages: [request, staffMessage('relance_feu_vert', '2026-10-28T07:00:00Z')] }), ['attend_client', 'Relancé le 28/10/2026', null]);
  assert.deepEqual(read({ ...waiting, messages: [request, staffMessage('relance_feu_vert', '2026-10-28T07:00:00Z', { statut: 'echec', outboxStatus: 'failed', outboxSentAt: null })] }),
    ['demande_a_verifier', 'Relance du 28/10/2026 · Envoi non confirmé', 'verifier_envoi'], 'A relance that failed is checked, never relanced.');
  // An e-mail relance stays a draft: the team acted, followed up 24 hours from its creation, then due again and says so.
  const draft = staffMessage('relance_feu_vert', '2026-10-26T08:00:00Z', { canal: 'email', statut: 'envoi', outboxStatus: 'manual', outboxSentAt: null });
  assert.deepEqual(read({ ...waiting, messages: [request, draft] }), ['attend_client', 'Sans réponse · relance du 26/10/2026 · Brouillon manuel', 'relancer']);
  // The wait the client chose: respected until its day, then to relance.
  assert.deepEqual(read({ ...waiting, attenteClientDate: '2026-10-27T10:00:00Z', attenteClientUntil: '2026-11-02T10:00:00Z' }), ['attend_client', 'Le client attend · jusqu’au 02/11', null]);
  const ended = { ...waiting, attenteClientDate: '2026-10-20T10:00:00Z', attenteClientUntil: '2026-10-27T10:00:00Z', messages: [staffMessage('demande_feu_vert', '2026-10-19T08:00:00Z')] };
  assert.deepEqual(read(ended), ['attend_client', 'Attente terminée le 27/10 · à réexaminer', 'redemander_accord']);
  assert.deepEqual(stageOf(ended).action, { key: 'redemander_accord', label: 'Redemander l’accord', task: 'accord', permissions: ['perm_colis_demander_feuvert'],
    requiresAll: ['perm_colis_revenir_arriere'], deniedReason: 'Réservé aux personnes autorisées à corriger le dossier et à demander l’accord.' }, 'After a chosen wait the accord is asked again in its task, not relanced.');
  assert.deepEqual(read({ ...ended, messages: [...ended.messages, staffMessage('relance_feu_vert', '2026-10-28T09:00:00Z')] }), ['attend_client', 'Relancé le 28/10/2026', null],
    'Once relanced after the wait, the relance is followed up like any other.');
  assert.deepEqual(read({ ...waiting, attenteClientDate: '2026-10-27T10:00:00Z' }), ['attend_client', 'Le client attend', null]);
  const relance = stageOf({ ...waiting, demandeFeuVertEnvoyeeAt: '2026-10-26T08:00:00Z', messages: [staffMessage('demande_feu_vert', '2026-10-26T08:00:00Z')] });
  assert.deepEqual(relance.action, { key: 'relancer', label: 'Relancer', task: 'accord', ...CONSENT, panel: 'relance_feu_vert' });
  assert.equal(relance.tone, 'waiting');
});

test('the waiting step says what is awaited and how the request left: its agreement, or his other parcels', () => {
  const waiting = { ...measured, statut: 'attente_feu_vert' };
  const read = dossier => { const step = stageOf(dossier); return [step.label, step.detail, step.action && step.action.key]; };
  // The agreement, asked and delivered on Telegram.
  assert.deepEqual(read({ ...waiting, demandeFeuVertEnvoyeeAt: '2026-10-26T08:00:00Z', messages: [staffMessage('demande_feu_vert', '2026-10-26T08:00:00Z')] }),
    ['Attend son accord', 'Sans réponse · demandé le 26/10/2026', 'relancer']);
  // Asked by e-mail (a draft: no provider confirms its sending), or in the client space: said, never a bare « Sans réponse ».
  const email = staffMessage('demande_feu_vert', '2026-10-25T08:00:00Z', { canal: 'email', statut: 'envoi', outboxStatus: 'manual', outboxSentAt: null });
  assert.deepEqual(read({ ...waiting, messages: [email] }), ['Attend son accord', 'Sans réponse · demande préparée par e-mail le 25/10/2026', 'relancer']);
  const portal = staffMessage('demande_feu_vert', '2026-10-25T08:00:00Z', { canal: 'portal', outboxStatus: null, outboxSentAt: null });
  assert.deepEqual(read({ ...waiting, messages: [portal] }), ['Attend son accord', 'Sans réponse · demande déposée dans son espace le 25/10/2026', 'relancer']);
  // A Telegram request whose delivery the dossier did not record (former data): at its delivery.
  assert.deepEqual(read({ ...waiting, messages: [staffMessage('demande_feu_vert', '2026-10-24T08:00:00Z', { outboxSentAt: '2026-10-25T09:00:00Z' })] }),
    ['Attend son accord', 'Sans réponse · demandé le 25/10/2026', 'relancer']);
  // No request recorded at all: said so.
  assert.deepEqual(read(waiting), ['Attend son accord', 'Sans réponse · date de la demande inconnue', 'relancer']);
  // The client chose to wait for his other parcels: the step says it, until the wait ends, then the accord is asked again.
  assert.deepEqual(read({ ...waiting, attenteClientDate: '2026-10-27T10:00:00Z', attenteClientUntil: '2026-11-02T10:00:00Z' }), [CLIENT_WAIT_LABEL, 'Le client attend · jusqu’au 02/11', null]);
  assert.deepEqual(read({ ...waiting, attenteClientDate: '2026-10-20T10:00:00Z', attenteClientUntil: '2026-10-27T10:00:00Z', messages: [staffMessage('demande_feu_vert', '2026-10-19T08:00:00Z')] }),
    [CLIENT_WAIT_LABEL, 'Attente terminée le 27/10 · à réexaminer', 'redemander_accord']);
  assert.equal(CLIENT_WAIT_LABEL, 'Attend ses autres colis');
});

test('« Attend son accord » with the automatic reminders: when the next one leaves, « Relancer » only once they are all sent', () => {
  const settings = { relancesAccordAuto: { actif: true, depuis: '2026-10-01T00:00:00Z', premiereApresHeures: 48, suivanteApresHeures: 24, nombreMax: 2 } };
  const linked = { ...flavie, telegramChatId: '7001' };
  const auto = (changes = {}) => ({ settings, getClient: id => (id === flavie.id ? linked : clients.get(id) || null), ...changes });
  const waiting = { ...measured, statut: 'attente_feu_vert' };
  const read = (dossier, changes) => { const step = stageOf(dossier, auto(changes)); return [step.key, step.detail, step.action && step.action.key]; };
  // Delivered two hours ago: the first reminder leaves 48 hours after the delivery.
  assert.deepEqual(read({ ...waiting, demandeFeuVertEnvoyeeAt: '2026-10-28T08:00:00Z', messages: [staffMessage('demande_feu_vert', '2026-10-28T08:00:00Z')] }),
    ['attend_client', 'Demandé le 28/10/2026 · relance auto le 30/10/2026', null]);
  // Due already: the scheduled worker sends it at its next run, nothing to do.
  assert.deepEqual(read({ ...waiting, demandeFeuVertEnvoyeeAt: '2026-10-26T08:00:00Z', messages: [staffMessage('demande_feu_vert', '2026-10-26T08:00:00Z')] }),
    ['attend_client', 'Sans réponse · demandé le 26/10/2026 · relance auto imminente', null]);
  const request = staffMessage('demande_feu_vert', '2026-10-25T08:00:00Z');
  const asked = { ...waiting, demandeFeuVertEnvoyeeAt: '2026-10-25T08:00:00Z' };
  // The first reminder delivered: the second 24 hours later.
  assert.deepEqual(read({ ...waiting, messages: [request, staffMessage('relance_feu_vert', '2026-10-28T07:00:00Z', { auteurId: null })] }),
    ['attend_client', 'Relancé le 28/10/2026 · relance auto le 29/10/2026', null]);
  // Both sent (a relance of the team counts) and followed up for 24 hours: then « Relancer » is the team's.
  const both = [request, staffMessage('relance_feu_vert', '2026-10-26T08:00:00Z'), staffMessage('relance_feu_vert', '2026-10-27T08:00:00Z')];
  assert.deepEqual(read({ ...waiting, messages: both }), ['attend_client', 'Sans réponse après 2 relances · relancé le 27/10/2026', 'relancer']);
  assert.deepEqual(read({ ...waiting, messages: [request, staffMessage('relance_feu_vert', '2026-10-27T08:00:00Z'), staffMessage('relance_feu_vert', '2026-10-28T08:00:00Z')] }),
    ['attend_client', 'Relancé le 28/10/2026', null], 'The last reminder is followed up like any relance.');
  // A conversation of the client waiting for the team (another dossier): the reminders wait for it.
  assert.deepEqual(read({ ...asked, messages: [request] }, { openConversationClients: new Set([flavie.id]) }),
    ['attend_client', 'Sans réponse · demandé le 25/10/2026 · relance auto suspendue : conversation à traiter', null]);
  // No Telegram, settings off, a request delivered before their start: the relance stays the team's, as before.
  assert.deepEqual(read({ ...asked, messages: [request] }, { getClient: id => clients.get(id) || null }), ['attend_client', 'Sans réponse · demandé le 25/10/2026', 'relancer']);
  assert.deepEqual(read({ ...asked, messages: [request] }, { settings: {} }), ['attend_client', 'Sans réponse · demandé le 25/10/2026', 'relancer']);
  assert.deepEqual(read({ ...asked, messages: [request] }, { settings: { relancesAccordAuto: { ...settings.relancesAccordAuto, depuis: '2026-10-28T00:00:00Z' } } }),
    ['attend_client', 'Sans réponse · demandé le 25/10/2026', 'relancer']);
  // A failed reminder is checked, never followed by another automatic one.
  assert.equal(stageOf({ ...waiting, messages: [request, staffMessage('relance_feu_vert', '2026-10-28T07:00:00Z', { statut: 'echec', outboxStatus: 'failed', outboxSentAt: null })] }, auto()).key, 'demande_a_verifier');
});

test('« Le client a répondu »: a written message to answer comes before any request or relance, never « Relancer »', () => {
  const waiting = { ...measured, statut: 'attente_feu_vert', demandeFeuVertEnvoyeeAt: '2026-10-25T08:00:00Z' };
  const request = staffMessage('demande_feu_vert', '2026-10-25T08:00:00Z');
  // The reviewer's case: the request was delivered, the client answered in writing, the conversation is « À répondre ».
  const replied = { ...waiting, conversationStatut: 'a_traiter', messages: [request, clientMessage('2026-10-27T18:00:00Z')] };
  assert.deepEqual(stageOf(replied), { key: 'client_a_repondu', label: 'Le client a répondu', detail: 'Message du 27/10/2026 à lire', tone: 'current',
    action: { key: 'lire_reponse', label: 'Lire la réponse', task: null, ...CONVERSATION, href: '/colis/d-1?onglet=conversation' } });
  // Without a durable state, the rule of conversationState: a client's message that no delivered team message followed.
  const unstated = { ...replied, conversationStatut: undefined };
  assert.equal(stageOf(unstated).key, 'client_a_repondu');
  assert.deepEqual([stageOf({ ...unstated, messages: [...unstated.messages, staffMessage('message_libre', '2026-10-27T19:00:00Z')] }).key,
    stageOf({ ...unstated, messages: [...unstated.messages, staffMessage('message_libre', '2026-10-27T19:00:00Z')] }).action.key], ['attend_client', 'relancer'], 'Answered since.');
  // Treated (its durable state), or a decision by button: no message to answer.
  assert.deepEqual([stageOf({ ...replied, conversationStatut: 'termine' }).key, stageOf({ ...replied, conversationStatut: 'termine' }).action.key], ['attend_client', 'relancer']);
  assert.equal(stageOf({ ...unstated, messages: [request, clientMessage('2026-10-27T18:00:00Z', { template: 'client_decision_wait' })] }).key, 'attend_client');
  // Wherever a request or a relance would be offered: before asking the accord, during the client's wait and after it,
  // before checking a relance that failed.
  assert.equal(stageOf({ ...measured, conversationStatut: 'a_traiter', messages: [clientMessage('2026-10-27T18:00:00Z')] }).key, 'client_a_repondu', 'Instead of « Demander l’accord ».');
  assert.equal(stageOf({ ...replied, attenteClientDate: '2026-10-27T10:00:00Z', attenteClientUntil: '2026-11-02T10:00:00Z' }).key, 'client_a_repondu');
  assert.equal(stageOf({ ...replied, attenteClientDate: '2026-10-20T10:00:00Z', attenteClientUntil: '2026-10-27T10:00:00Z' }).key, 'client_a_repondu', 'Instead of « Redemander l’accord ».');
  assert.equal(stageOf({ ...replied, messages: [request, staffMessage('relance_feu_vert', '2026-10-28T09:00:00Z', { statut: 'echec', outboxStatus: 'failed' }), clientMessage('2026-10-28T09:30:00Z')] }).key, 'client_a_repondu');
  // « À payer »: while the payment is awaited (its task offers a relance), not when the payment is to check.
  assert.equal(stageOf({ ...quoted, conversationStatut: 'a_traiter', messages: [clientMessage('2026-10-28T08:00:00Z')] }).key, 'client_a_repondu');
  assert.equal(stageOf({ ...quoted, devisBrouillon: true, conversationStatut: 'a_traiter', messages: [clientMessage('2026-10-28T08:00:00Z')] }).key, 'paiement_a_verifier');
  // The other steps keep their own action: the message waits in the conversations.
  assert.equal(stageOf({ ...prepared, conversationStatut: 'a_traiter', messages: [clientMessage('2026-10-28T08:00:00Z')] }).key, 'pret_pour_devis');
  assert.equal(stageOf({ ...measured, statut: 'receptionne', conversationStatut: 'a_traiter' }).key, 'mesures_a_completer');
  assert.equal(stageOf({ ...replied, messages: [request, clientMessage(null)] }).detail, 'Message à lire', 'Without a readable date.');
  // The conversation keeps the way back.
  assert.equal(colisActionHref(colisRow(replied, ctx()), '/?onglet=brouillon'), '/colis/d-1?onglet=conversation&returnTo=%2F%3Fonglet%3Dbrouillon');
  assert.equal(brouillonFiche(replied, ctx()).action.href, '/colis/d-1?onglet=conversation&returnTo=%2Fbrouillon%2Fd-1');
});

test('« Demande à vérifier »: a request or a relance that did not reach the client is checked in the conversation, never relanced', () => {
  const waiting = { ...measured, statut: 'attente_feu_vert' };
  const read = (messages, changes = {}) => { const step = stageOf({ ...waiting, messages, ...changes }); return [step.key, step.detail, step.tone, step.action && step.action.key]; };
  const request = (createdAt, changes) => staffMessage('demande_feu_vert', createdAt, { statut: 'envoi', outboxSentAt: null, ...changes });
  const minutesAgo = minutes => new Date(now - minutes * 60000).toISOString();
  // The reviewer's case: the Telegram delivery of the request failed.
  assert.deepEqual(stageOf({ ...waiting, messages: [request('2026-10-28T09:00:00Z', { statut: 'echec', outboxStatus: 'failed' })] }), {
    key: 'demande_a_verifier', label: 'Demande à vérifier', detail: 'Demande du 28/10/2026 · Envoi non confirmé', tone: 'review',
    action: { key: 'verifier_envoi', label: 'Vérifier l’envoi', task: null, ...TELEGRAM, href: '/colis/d-1?onglet=conversation' } });
  assert.deepEqual(read([request('2026-10-28T09:00:00Z', { statut: 'echec', outboxStatus: null })]), ['demande_a_verifier', 'Demande du 28/10/2026 · Envoi non confirmé', 'review', 'verifier_envoi'], 'Without its outbox: the message « echec ».');
  // On its way: for 10 minutes, then to check whatever the state of its outbox (the rule of the arrival notices).
  assert.deepEqual(read([request(minutesAgo(9), { outboxStatus: 'pending' })]), ['attend_client', 'Demande en cours d’envoi', 'waiting', null]);
  assert.deepEqual(read([request(minutesAgo(10), { outboxStatus: 'pending' })]), ['attend_client', 'Demande en cours d’envoi', 'waiting', null], 'Ten minutes exactly: still on its way.');
  assert.deepEqual(read([request(minutesAgo(11), { outboxStatus: 'pending' })]), ['demande_a_verifier', 'Demande du 28/10/2026 · Toujours pas parti au bout de 10 minutes', 'review', 'verifier_envoi']);
  assert.deepEqual(read([request(minutesAgo(60), { outboxStatus: 'sending' })]).slice(0, 2), ['demande_a_verifier', 'Demande du 28/10/2026 · Envoi commencé il y a plus de 10 minutes, sans confirmation']);
  assert.deepEqual(read([request(minutesAgo(60), { outboxStatus: 'blocked' })]).slice(0, 2), ['demande_a_verifier', 'Demande du 28/10/2026 · Envoi retenu depuis plus de 10 minutes'], 'The reviewer’s case: held for an hour.');
  assert.deepEqual(read([request(minutesAgo(60), { outboxStatus: null })]).slice(0, 2), ['demande_a_verifier', 'Demande du 28/10/2026 · Envoi sans confirmation depuis plus de 10 minutes']);
  // A relance that failed, or that the server cancelled because the dossier changed: checked, never relanced.
  const delivered = staffMessage('demande_feu_vert', '2026-10-25T08:00:00Z');
  const relance = changes => staffMessage('relance_feu_vert', '2026-10-27T08:00:00Z', { statut: 'echec', outboxSentAt: null, ...changes });
  assert.deepEqual(read([delivered, relance({ outboxStatus: 'failed' })]), ['demande_a_verifier', 'Relance du 27/10/2026 · Envoi non confirmé', 'review', 'verifier_envoi']);
  assert.deepEqual(read([delivered, relance({ outboxStatus: 'cancelled' })]), ['demande_a_verifier', 'Relance du 27/10/2026 · Envoi annulé', 'review', 'verifier_envoi']);
  // A relance the server postponed (one per client in 24 hours): the minutes count from its own time when the data layer gives it.
  const postponed = changes => staffMessage('relance_feu_vert', '2026-10-28T07:00:00Z', { statut: 'envoi', outboxStatus: 'pending', outboxSentAt: null, ...changes });
  assert.deepEqual(read([delivered, postponed({ outboxAvailableAt: '2026-10-28T20:00:00Z' })]), ['attend_client', 'Relance en cours d’envoi', 'waiting', null]);
  assert.deepEqual(read([delivered, postponed({ outboxAvailableAt: '2026-10-28T09:30:00Z' })]).slice(0, 2), ['demande_a_verifier', 'Relance du 28/10/2026 · Toujours pas parti au bout de 10 minutes']);
  assert.equal(read([delivered, postponed()])[0], 'demande_a_verifier', 'Without its own time: from its creation, as an arrival notice.');
  // Cancelled because the client chose to wait: no failure; the wait is respected, then the accord is asked again.
  const byWait = { attenteClientDate: '2026-10-27T09:00:00Z', attenteClientUntil: '2026-11-02T10:00:00Z' };
  assert.deepEqual(read([delivered, relance({ outboxStatus: 'cancelled' })], byWait), ['attend_client', 'Le client attend · jusqu’au 02/11', 'waiting', null]);
  assert.equal(read([delivered, relance({ outboxStatus: 'cancelled' })], { ...byWait, attenteClientUntil: '2026-10-28T08:00:00Z' })[3], 'redemander_accord');
  assert.equal(read([delivered, relance({ statut: 'envoi', outboxStatus: null })], { ...byWait, attenteClientUntil: '2026-10-28T08:00:00Z' })[3], 'redemander_accord', 'Without its outbox, left « envoi » by the wait.');
  // Only the latest message counts; an e-mail kept as a draft and a message of the client space are no failure.
  assert.deepEqual(read([request('2026-10-27T08:00:00Z', { statut: 'echec', outboxStatus: 'failed' }), staffMessage('relance_feu_vert', '2026-10-28T08:00:00Z')]), ['attend_client', 'Relancé le 28/10/2026', 'waiting', null]);
  // An e-mail is a draft (no provider is connected): « préparée », never « demandé ».
  assert.deepEqual(read([request('2026-10-28T08:00:00Z', { canal: 'email', outboxStatus: 'manual' })]), ['attend_client', 'Demande préparée par e-mail le 28/10/2026', 'waiting', null]);
  assert.deepEqual(read([request('2026-10-28T08:00:00Z', { canal: 'email', outboxStatus: null })]), ['attend_client', 'Demande préparée par e-mail le 28/10/2026', 'waiting', null]);
  assert.equal(read([staffMessage('demande_feu_vert', '2026-10-28T08:00:00Z', { canal: 'portal' })])[0], 'attend_client');
  // The right of its channel: an e-mail is checked by whoever writes e-mails.
  const email = stageOf({ ...waiting, messages: [request('2026-10-27T08:00:00Z', { canal: 'email', statut: 'echec', outboxStatus: 'failed' })] });
  assert.deepEqual([email.key, email.action.permissions], ['demande_a_verifier', ['perm_comm_email']]);
  // A message of the client is never a request.
  assert.equal(stageOf({ ...waiting, conversationStatut: 'termine', demandeFeuVertEnvoyeeAt: '2026-10-26T08:00:00Z',
    messages: [staffMessage('demande_feu_vert', '2026-10-26T08:00:00Z'), { ...request('2026-10-28T09:00:00Z', { statut: 'echec', outboxStatus: 'failed' }), type: 'client' }] }).key, 'attend_client');
  // Its address keeps the way back.
  const lost = colisRow({ ...waiting, messages: [request('2026-10-28T09:00:00Z', { statut: 'echec', outboxStatus: 'failed' })] }, ctx());
  assert.equal(colisActionHref(lost, '/?onglet=brouillon&q=payet'), '/colis/d-1?onglet=conversation&returnTo=%2F%3Fonglet%3Dbrouillon%26q%3Dpayet');
  assert.equal(colisActionHref(lost, 'https://evil.example/'), '/colis/d-1?onglet=conversation&returnTo=%2F', 'An outside way back is dropped.');
});

test('« Prêt pour le devis » only when the complete calculation would pass, otherwise « Devis à compléter » and its first gap', () => {
  const full = changes => ({ tarifs, categories, ...changes });
  const read = (dossier, changes) => { const step = stageOf(dossier, full(changes)); return [step.key, step.detail]; };
  assert.deepEqual(stageOf(complete, full()), { key: 'pret_pour_devis', label: 'Prêt pour le devis', detail: 'Tout est prêt pour le devis', tone: 'current', action: { key: 'envoyer_devis', label: 'Envoyer le devis', task: 'devis', ...QUOTE } });
  // The reviewer's case: no article, the taxes cannot be calculated.
  assert.deepEqual(stageOf(prepared, full()), { key: 'devis_a_completer', label: 'Devis à compléter', detail: 'Articles et catégories à renseigner', tone: 'review',
    action: { key: 'completer_devis', label: 'Compléter le devis', task: 'devis', ...QUOTE } });
  // The reviewer's case: a client whose type is not set.
  assert.deepEqual(read(complete, { getClient: () => ({ ...flavie, type: null }) }), ['devis_a_completer', 'Type de client à renseigner']);
  assert.deepEqual(read(complete, { tarifs: { 976: tarifs[976] } }), ['devis_a_completer', 'Tarif de la destination à renseigner']);
  assert.deepEqual(read(complete, { getClient: () => ({ ...flavie, cp: '75011' }) }), ['devis_a_completer', 'Destination du client à vérifier']);
  assert.deepEqual(read({ ...complete, lignes: [{ ...article, cat: 'cat-inconnue' }] }), ['devis_a_completer', 'Article 1 à compléter']);
  assert.deepEqual(read({ ...complete, lignes: [{ ...article, prix: 0 }] }), ['devis_a_completer', 'Valeur des articles à vérifier']);
  assert.deepEqual(read({ ...complete, fraisDivers: [{ libelle: '', montant: 5 }] }), ['devis_a_completer', 'Frais divers à compléter']);
  const customDuty = { stale: true, destination: '974', tariffId: 't-1', code: '6204430000', label: 'Robes', source: { id: 's-1' }, rates: { om: 10, omr: 2.5 }, baseRates: { om: 10, omr: 2.5 } };
  assert.deepEqual(read({ ...complete, lignes: [{ ...article, customDuty }] }), ['devis_a_completer', 'Classement douanier de l’article 1 à vérifier']);
  assert.deepEqual(read(complete, { getClient: () => null }), ['devis_a_completer', 'Fiche client à retrouver']);
  // A professional client: transport and fees, no article needed; the tariff of their destination is.
  assert.deepEqual(read({ ...prepared, clientId: pro.id, factures: [] }), ['pret_pour_devis', 'Tout est prêt pour le devis']);
  assert.deepEqual(read({ ...prepared, clientId: pro.id, factures: [] }, { tarifs: { 974: tarifs[974] } }), ['devis_a_completer', 'Tarif de la destination à renseigner']);
  // Without the tariffs and the categories nothing is claimed beyond the journey's own rules.
  assert.equal(stageOf(prepared, { categories }).key, 'pret_pour_devis');
  assert.equal(stageOf(prepared, { tarifs }).key, 'pret_pour_devis');
  // The steps before keep their place.
  assert.equal(stageOf({ ...prepared, factures: [] }, full()).key, 'facture_manquante');
  assert.equal(stageOf({ ...prepared, preparationCompositionVersion: 4 }, full()).key, 'a_preparer');
});

test('« Le client refuse » and « Produit interdit à régler » open the dossier', () => {
  const refused = stageOf({ ...measured, statut: 'refuse_client', feuVert: 'refuse', feuVertDate: '2026-10-27T12:00:00Z' });
  assert.deepEqual([refused.key, refused.label, refused.detail, refused.tone, refused.action.key, refused.action.task], ['client_refuse', 'Le client refuse', 'Refus enregistré le 27/10/2026', 'review', 'voir_dossier', 'accord']);
  const forbidden = stageOf({ ...prepared, statut: 'autorise', produitInterdit: true, checkInterdits: [] });
  assert.deepEqual([forbidden.key, forbidden.label, forbidden.detail, forbidden.action.task], ['produit_interdit', 'Produit interdit à régler', 'Signalé à la réception', 'reception']);
  // Before the consent, the consent steps come first.
  assert.equal(stageOf({ ...measured, produitInterdit: true }).key, 'accord_a_demander');
});

test('« À préparer » until the preparation of the current cartons is recorded', () => {
  const authorised = { ...measured, statut: 'autorise', feuVert: 'autorise', feuVertDate: '2026-10-27T12:00:00Z' };
  const step = stageOf(authorised);
  assert.deepEqual([step.key, step.label, step.detail, step.action.key, step.action.label, step.action.task], ['a_preparer', 'À préparer', 'Accord donné le 27/10/2026', 'preparer', 'Préparer', 'preparation']);
  assert.equal(stageOf({ ...authorised, statut: 'en_preparation' }).detail, 'Préparation en cours');
});

test('« Facture manquante » follows the quote engine’s invoice rule, which a professional client is spared', () => {
  const read = factures => stageOf({ ...prepared, factures });
  assert.deepEqual([read([]).key, read([]).detail], ['facture_manquante', 'Aucune facture reçue']);
  const toVerify = read([{ id: 'f-2', valide: false, montant: 0, fichier: 'colis/d-1/f2.pdf' }]);
  assert.deepEqual([toVerify.key, toVerify.detail], ['facture_manquante', '0 sur 1 facture vérifiée · 1 à vérifier']);
  // Validated but without its document: dossierNextTask would offer the quote, the quote engine refuses it.
  assert.equal(read([{ id: 'f-3', valide: true, montant: 120 }]).key, 'facture_manquante');
  assert.equal(read([invoice, { id: 'f-4', valide: true, montant: 0, fichier: 'colis/d-1/f4.pdf' }]).key, 'facture_manquante', 'A validated invoice needs a positive amount.');
  assert.equal(read([{ ...invoice, rejetMotif: 'Illisible' }]).key, 'facture_manquante', 'A rejected invoice does not count.');
  assert.equal(stageOf({ ...prepared, clientId: pro.id, factures: [] }).key, 'pret_pour_devis');
});

test('« Prêt pour le devis » sends the quote; its detail tells a saved draft or a withdrawn quote', () => {
  const ready = stageOf(prepared);
  assert.deepEqual(ready, { key: 'pret_pour_devis', label: 'Prêt pour le devis', detail: 'Tout est prêt pour le devis', tone: 'current', action: { key: 'envoyer_devis', label: 'Envoyer le devis', task: 'devis', ...QUOTE } });
  assert.equal(stageOf({ ...prepared, devisBrouillon: true, devisTotal: 95.06, devisSnapshot: snapshot, quoteVersion: 1 }).detail, 'Devis enregistré · à vérifier et envoyer');
  assert.equal(stageOf({ ...prepared, devisEnvoyeLe: '2026-10-20T10:00:00Z' }).detail, 'Ancien devis retiré · nouveau devis à envoyer');
});

// ── Other tabs ───────────────────────────────────────────────────────────────
test('« À payer » reads the payment model and opens the payment task; its amounts only with the right to see them', () => {
  const expected = stageOf(quoted);
  assert.deepEqual(expected, { key: 'paiement_attendu', label: 'Paiement attendu', detail: 'Devis envoyé le 27/10/2026', tone: 'waiting', action: { key: 'suivre_paiement', label: 'Suivre le paiement', task: 'paiement', ...PAYMENT } });
  const partial = stageOf({ ...quoted, statut: 'attente_paiement', paiementMontant: 50, paiementDate: '2026-10-27T18:00:00Z' });
  assert.deepEqual([partial.key, partial.label, partial.detail, partial.tone], ['paiement_attendu', 'Paiement partiel', `Devis envoyé le 27/10/2026 · reste ${eur(45.06)}`, 'waiting']);
  const withdrawn = stageOf({ ...quoted, devisBrouillon: true });
  assert.deepEqual([withdrawn.key, withdrawn.label, withdrawn.detail, withdrawn.tone, withdrawn.action.task], ['paiement_a_verifier', 'À recalculer', 'Devis retiré · à refaire', 'review', 'paiement']);
});

test('without the right to see amounts, « À payer » keeps its states, only the rest to pay is left out', () => {
  const read = (dossier, label) => { const step = stageOf(dossier, { can: nothing }); return [step.key, step.label, step.detail, step.tone, step.action.key]; };
  assert.deepEqual(read(quoted), ['paiement_attendu', 'Paiement attendu', 'Devis envoyé le 27/10/2026', 'waiting', 'suivre_paiement']);
  assert.deepEqual(read({ ...quoted, statut: 'attente_paiement', paiementMontant: 50, paiementDate: '2026-10-27T18:00:00Z' }),
    ['paiement_attendu', 'Paiement partiel', 'Devis envoyé le 27/10/2026', 'waiting', 'suivre_paiement'], 'Partial, without the amount left.');
  assert.deepEqual(read({ ...quoted, devisBrouillon: true }), ['paiement_a_verifier', 'À recalculer', 'Devis retiré · à refaire', 'review', 'suivre_paiement']);
  assert.deepEqual(read({ ...quoted, statut: 'attente_paiement', paiementMontant: 120, paiementDate: '2026-10-27T18:00:00Z' }),
    ['paiement_a_verifier', 'Trop-perçu à vérifier', 'Devis envoyé le 27/10/2026', 'review', 'suivre_paiement']);
  assert.deepEqual(read({ ...quoted, statut: 'attente_paiement', paiementMontant: 95.06 }),
    ['paiement_a_verifier', 'Paiement à vérifier', 'Devis envoyé le 27/10/2026', 'review', 'suivre_paiement'], 'An amount without its date.');
  assert.ok(!JSON.stringify(stageOf({ ...quoted, statut: 'attente_paiement', paiementMontant: 50, paiementDate: '2026-10-27T18:00:00Z' }, { can: nothing })).includes('€'));
});

test('« Prêt à partir » reads the departure readiness and prepares the departure', () => {
  const ready = stageOf(paid);
  assert.deepEqual(ready, { key: 'pret_a_partir', label: 'Prêt pour ce départ', detail: 'Prévu le 29/10/2026', tone: 'current', action: { key: 'preparer_depart', label: 'Préparer le départ', task: 'expedition', ...DEPARTURE } });
  const unassigned = stageOf({ ...paid, envoi: null });
  assert.deepEqual([unassigned.label, unassigned.detail], ['Prêt à affecter', 'Départ à choisir']);
  const unprepared = stageOf({ ...paid, finalMeasurementsVersion: 2 });
  assert.deepEqual([unprepared.key, unprepared.label, unprepared.tone], ['depart_a_verifier', 'Optimisation à terminer', 'review']);
});

test('« Parti » reads the status: the expedition, then the delivery, then nothing to do', () => {
  const flying = stageOf({ ...paid, statut: 'transit', envoi: 'e-gone', dateExpedition: '2026-10-15T06:00:00Z' });
  assert.deepEqual(flying, { key: 'parti', label: 'En vol', detail: 'Départ du jeudi 15 octobre', tone: 'current', action: { key: 'suivre_expedition', label: 'Suivre l’expédition', task: 'expedition', ...TRANSPORT } });
  const arrived = stageOf({ ...paid, statut: 'arrive', envoi: 'e-gone', dateExpedition: '2026-10-15T06:00:00Z' });
  assert.deepEqual([arrived.label, arrived.action.key, arrived.action.task], ['Arrivé destination', 'suivre_livraison', 'livraison']);
  const delivered = stageOf({ ...paid, statut: 'livre', envoi: 'e-gone', dateLivraison: '2026-10-20T08:00:00Z' });
  assert.deepEqual(delivered, { key: 'livre', label: 'Livré', detail: 'Livré le 20/10/2026', tone: 'done', action: null });
});

test('archived and cancelled dossiers have no step to work on', () => {
  assert.deepEqual(stageOf({ ...measured, archive: true }), { key: 'archive', label: 'Dossier archivé', detail: 'Aucune action attendue', tone: 'neutral', action: null });
  assert.deepEqual(stageOf({ ...quoted, statut: 'annule' }), { key: 'annule', label: 'Dossier annulé', detail: 'Aucune action attendue', tone: 'neutral', action: null });
  assert.equal(stageOf({ ...measured, archive: true }, { pending: pendingByColis([pendingEntry('d-1', [2])]) }).key, 'archive');
});

// ── Rights and team tasks ────────────────────────────────────────────────────
test('each action carries the rights of the screen that does it; actionAllowed needs one of them and every one of requiresAll', () => {
  const action = (dossier, changes) => stageOf(dossier, changes).action;
  const waiting = { ...measured, statut: 'attente_feu_vert', demandeFeuVertEnvoyeeAt: '2026-10-26T08:00:00Z', messages: [staffMessage('demande_feu_vert', '2026-10-26T08:00:00Z')] };
  const actions = {
    valider_reception: action(measured, { pending: pendingByColis([pendingEntry('d-1', [2])]) }),
    completer_mesures: action({ ...measured, statut: 'receptionne' }),
    demander_accord: action(measured),
    relancer: action(waiting),
    redemander_accord: action({ ...waiting, attenteClientDate: '2026-10-20T10:00:00Z', attenteClientUntil: '2026-10-27T10:00:00Z' }),
    lire_reponse: action({ ...waiting, conversationStatut: 'a_traiter' }),
    verifier_envoi: action({ ...waiting, messages: [staffMessage('demande_feu_vert', '2026-10-28T09:00:00Z', { statut: 'echec', outboxStatus: 'failed' })] }),
    voir_dossier: action({ ...measured, statut: 'refuse_client', feuVert: 'refuse' }),
    preparer: action({ ...measured, statut: 'autorise', feuVert: 'autorise' }),
    ajouter_facture: action({ ...prepared, factures: [] }),
    completer_devis: action(prepared, { tarifs, categories }),
    envoyer_devis: action(prepared),
    suivre_paiement: action(quoted),
    preparer_depart: action(paid),
    suivre_expedition: action({ ...paid, statut: 'transit', envoi: 'e-gone' }),
    suivre_livraison: action({ ...paid, statut: 'arrive', envoi: 'e-gone' }),
  };
  assert.deepEqual(Object.fromEntries(Object.entries(actions).map(([key, value]) => [key, [value.key, value.permissions, value.requiresAll || null]])), {
    valider_reception: ['valider_reception', ['perm_colis_receptionner'], null],
    completer_mesures: ['completer_mesures', ['perm_colis_mesurer'], null],
    demander_accord: ['demander_accord', ['perm_colis_demander_feuvert'], null],
    relancer: ['relancer', ['perm_colis_demander_feuvert'], null],
    redemander_accord: ['redemander_accord', ['perm_colis_demander_feuvert'], ['perm_colis_revenir_arriere']],
    lire_reponse: ['lire_reponse', ['perm_comm_message_libre', 'perm_comm_telegram', 'perm_comm_email', 'perm_comm_voir_chat_autres'], null],
    verifier_envoi: ['verifier_envoi', ['perm_comm_telegram'], null],
    voir_dossier: ['voir_dossier', [], null],
    preparer: ['preparer', ['perm_colis_preparer'], null],
    ajouter_facture: ['ajouter_facture', ['perm_factures_ajouter', 'perm_factures_valider'], null],
    completer_devis: ['completer_devis', ['perm_colis_calculer_devis', 'perm_colis_envoyer_devis'], null],
    envoyer_devis: ['envoyer_devis', ['perm_colis_calculer_devis', 'perm_colis_envoyer_devis'], null],
    suivre_paiement: ['suivre_paiement', ['perm_colis_confirmer_paiement', 'perm_comm_telegram', 'perm_comm_email', 'perm_comm_message_libre'], null],
    preparer_depart: ['preparer_depart', ['perm_envois_voir'], null],
    suivre_expedition: ['suivre_expedition', ['perm_colis_changer_statut_expedition'], null],
    suivre_livraison: ['suivre_livraison', ['perm_colis_changer_statut_expedition'], null],
  });
  // Every action that needs a right says why it is refused; consulting the dossier needs none.
  for (const value of Object.values(actions)) assert.equal(Boolean(value.deniedReason), value.permissions.length > 0, value.key);
  const only = (...granted) => permission => granted.includes(permission);
  assert.equal(actionAllowed(actions.voir_dossier, nothing), true);
  assert.equal(actionAllowed(actions.voir_dossier, undefined), true);
  assert.equal(actionAllowed(null, all), false);
  assert.equal(actionAllowed(actions.demander_accord, only('perm_colis_demander_feuvert')), true);
  assert.equal(actionAllowed(actions.demander_accord, nothing), false);
  assert.equal(actionAllowed(actions.demander_accord, undefined), false);
  assert.equal(actionAllowed(actions.redemander_accord, only('perm_colis_demander_feuvert')), false, 'The correction of the accord task needs both.');
  assert.equal(actionAllowed(actions.redemander_accord, only('perm_colis_revenir_arriere')), false);
  assert.equal(actionAllowed(actions.redemander_accord, only('perm_colis_demander_feuvert', 'perm_colis_revenir_arriere')), true);
  assert.equal(actionAllowed(actions.envoyer_devis, only('perm_colis_calculer_devis')), true, 'One suffices: the quote is calculated or sent.');
  assert.equal(actionAllowed(actions.ajouter_facture, only('perm_factures_valider')), true);
  assert.equal(actionAllowed(actions.lire_reponse, only('perm_comm_voir_chat_autres')), true);
  assert.equal(actionAllowed(actions.verifier_envoi, only('perm_comm_email')), false, 'A Telegram message is checked by whoever writes on Telegram.');
  // The reviewer's case: a préparateur (perm_colis_preparer only) prepares; the quote and the consent are not theirs.
  const preparateur = only('perm_colis_preparer', 'perm_clients_voir');
  assert.deepEqual(Object.values(actions).filter(value => actionAllowed(value, preparateur)).map(value => value.key), ['voir_dossier', 'preparer']);
  // The step is the same whatever the rights: the screen disables the action and says why.
  assert.deepEqual(stageOf(prepared, { can: preparateur }), stageOf(prepared));
});

test('a task held by a colleague: the step says who, from the team’s tasks; without them nothing changes', () => {
  const marie = { authId: 'u-marie', prenom: 'Marie', nom: 'Hoarau', actif: true };
  const work = (kind, changes = {}) => ({ id: `w-${kind}`, colis_id: 'd-1', kind, state: 'in_progress', assignee_id: 'u-marie', created_at: '2026-10-28T08:00:00Z', ...changes });
  const team = (actions, changes = {}) => ({ actions, me: { id: 'u-me' }, teamUsers: [marie, { authId: 'u-me', prenom: 'Camille', nom: 'Payet', actif: true }], ...changes });
  // The reviewer's case: a colleague holds the reception task of a measured dossier; asking the accord is that task.
  assert.deepEqual(stageOf(measured, team([work('reception')])), { ...stageOf(measured), heldBy: { id: 'u-marie', name: 'Marie Hoarau' } });
  assert.deepEqual(colisRow(measured, ctx(team([work('reception', { state: 'ready' })]))).stage.heldBy, { id: 'u-marie', name: 'Marie Hoarau' });
  assert.equal(brouillonFiche(measured, ctx(team([work('reception', { state: 'waiting' })]))).stage.heldBy.name, 'Marie Hoarau');
  // Held by me, done, unassigned, by someone no longer active or unknown to the team, another dossier or another task: nothing.
  for (const [label, changes] of [
    ['mine', team([work('reception', { assignee_id: 'u-me' })])],
    ['me as an id', team([work('reception', { assignee_id: 'u-me' })], { me: 'u-me' })],
    ['done', team([work('reception', { state: 'done' })])],
    ['unassigned', team([work('reception', { assignee_id: null })])],
    ['inactive', team([work('reception')], { teamUsers: [{ ...marie, actif: false }] })],
    ['unknown', team([work('reception', { assignee_id: 'u-gone' })])],
    ['another dossier', team([work('reception', { colis_id: 'd-9' })])],
    ['another task', team([work('preparation')])],
  ]) assert.equal('heldBy' in stageOf(measured, changes), false, label);
  // Without the tasks, the person or the team: the step is unchanged.
  for (const missing of ['actions', 'me', 'teamUsers']) assert.deepEqual(stageOf(measured, { ...team([work('reception')]), [missing]: undefined }), stageOf(measured), missing);
  // The task of each action: preparation, documents, quote, departure, conversation, the correction of a refusal.
  const heldOn = (dossier, kind, changes) => stageOf(dossier, { ...team([work(kind)]), ...changes }).heldBy?.name || null;
  assert.equal(heldOn({ ...measured, statut: 'autorise', feuVert: 'autorise' }, 'preparation'), 'Marie Hoarau');
  assert.equal(heldOn({ ...prepared, factures: [] }, 'documents'), 'Marie Hoarau');
  assert.equal(heldOn(prepared, 'quote'), 'Marie Hoarau');
  assert.equal(heldOn(prepared, 'quote', { tarifs, categories }), 'Marie Hoarau', '« Compléter le devis » too.');
  assert.equal(heldOn(paid, 'departure'), 'Marie Hoarau');
  assert.equal(heldOn({ ...measured, statut: 'attente_feu_vert', conversationStatut: 'a_traiter' }, 'conversation'), 'Marie Hoarau', '« Lire la réponse »: the conversation.');
  assert.equal(heldOn({ ...measured, statut: 'attente_feu_vert', conversationStatut: 'a_traiter' }, 'reception'), null);
  assert.equal(heldOn({ ...measured, statut: 'refuse_client', feuVert: 'refuse' }, 'correction'), 'Marie Hoarau');
  // No team task behind a reception to validate nor a payment to follow.
  assert.equal(heldOn(measured, 'reception', { pending: pendingByColis([pendingEntry('d-1', [2])]) }), null);
  assert.equal(heldOn(quoted, 'reception'), null);
  // A member without a name, as the application writes it.
  assert.equal(stageOf(measured, team([work('reception')], { teamUsers: [{ authId: 'u-marie', actif: true }] })).heldBy.name, 'Membre de l’équipe');
});

// ── Rows ─────────────────────────────────────────────────────────────────────
test('a row gives the client, the cartons received, the step, the total and the departure ready to show', () => {
  const row = colisRow({ ...measured, devisTransport: 70, devisOM: 10 }, ctx());
  assert.deepEqual(Object.keys(row).sort(), ['action', 'cartons', 'cartonsLabel', 'casier', 'casierLabel', 'clientId', 'clientKnown', 'clientName', 'clientRef', 'clientType', 'clientTypeLabel', 'commune',
    'departure', 'destinationCode', 'destinationLabel', 'destinationName', 'dimensions', 'ficheHref', 'forfait', 'forfaitLabel', 'id', 'identity', 'lastReceivedAt', 'lastReceivedLabel', 'pendingCartons', 'poids', 'poidsLabel', 'ref', 'searchCodes', 'searchText',
    'stage', 'statut', 'tab', 'total', 'volume', 'volumeLabel', 'zone', 'zoneLabel'].sort());
  assert.deepEqual([row.id, row.ref, row.statut, row.tab, row.clientId, row.clientName, row.clientType, row.clientTypeLabel, row.destinationCode, row.destinationLabel, row.commune],
    ['d-1', 'EXP-AAA111', 'mesure', 'brouillon', 'c-flavie', 'PAYET Flavie', 'particulier', 'Particulier', '974', 'Réunion', 'Sainte-Clotilde']);
  // The delivery zone of La Réunion (97400: Nord); no client number nor plan on this client.
  assert.deepEqual([row.zone, row.zoneLabel, row.clientRef, row.forfait, row.forfaitLabel], ['NORD', 'Nord', null, null, null]);
  assert.deepEqual([row.cartons, row.cartonsLabel, row.pendingCartons, row.casier, row.casierLabel, row.poids, row.poidsLabel, row.volumeLabel],
    [2, '2 cartons', 0, 'B12', 'Casier B12', 3.75, kg(3.75), '0,030\u00a0m³']);
  assert.ok(Math.abs(row.volume - 0.03) < 1e-12, 'L × l × H / 1 000 000, the cartons added up.');
  assert.deepEqual([row.lastReceivedAt, row.lastReceivedLabel], ['2026-10-27T09:00:00Z', '27/10/2026']);
  assert.equal(row.stage.key, 'accord_a_demander');
  assert.equal(row.action, row.stage.action);
  // Raw quote columns are never a price: without a saved quote, « À calculer », never a false zero.
  assert.deepEqual(row.total, { visible: true, amount: null, state: 'À calculer', label: 'À calculer' });
  assert.equal(row.ficheHref, '/brouillon/d-1');
  assert.deepEqual([row.departure.key, row.departure.kind, row.departure.date, row.departure.label, row.departure.closingLabel], ['none', 'none', null, 'Départ : à choisir', null]);
});

test('the total is the saved and current quote, with its state, and nothing without the right to see amounts', () => {
  assert.deepEqual(colisRow(quoted, ctx()).total, { visible: true, amount: 95.06, state: '', label: eur(95.06) });
  assert.deepEqual(colisRow({ ...prepared, devisBrouillon: true, devisTotal: 95.06, devisSnapshot: snapshot, quoteVersion: 1 }, ctx()).total,
    { visible: true, amount: 95.06, state: 'Brouillon', label: `${eur(95.06)} · Brouillon` });
  assert.deepEqual(colisRow({ ...quoted, quoteVersion: 2 }, ctx()).total, { visible: true, amount: null, state: 'À revoir', label: 'À revoir' }, 'Another version than the saved quote.');
  assert.deepEqual(colisRow(quoted, ctx({ can: nothing })).total, { visible: false, amount: null, state: null, label: null });
  assert.equal(colisRow(quoted, ctx({ can: permission => permission === 'perm_finances_voir_total' })).total.visible, true);
});

test('a paid dossier is « Payé », never to pay: the amount paid, else the quote’s total', () => {
  assert.equal(PAID_TOTAL_STATE, 'paid');
  assert.deepEqual(colisRow(paid, ctx()).total, { visible: true, amount: 95.06, state: 'paid', label: 'Payé' });
  // « Payé » carries no amount: said without the right to see amounts, the amount left out.
  assert.deepEqual(colisRow(paid, ctx({ can: nothing })).total, { visible: false, amount: null, state: 'paid', label: 'Payé' });
  // « Parti »: paid before leaving; a former dossier without its payment recorded shows the quote's total.
  assert.deepEqual(colisRow({ ...paid, statut: 'transit', envoi: 'e-gone' }, ctx()).total, { visible: true, amount: 95.06, state: 'paid', label: 'Payé' });
  assert.deepEqual(colisRow({ ...paid, statut: 'livre', envoi: 'e-gone', paiementMontant: null, paiementDate: null }, ctx()).total.amount, 95.06);
  assert.deepEqual(colisRow({ ...paid, paiementMontant: 100 }, ctx()).total.amount, 100, 'What was paid, even another amount.');
  assert.deepEqual(colisRow({ ...measured, statut: 'expedie', envoi: 'e-gone' }, ctx()).total, { visible: true, amount: null, state: 'paid', label: 'Payé' }, 'Nothing known: no false zero.');
  // A payment recorded in full before the status follows: paid too.
  assert.deepEqual(colisRow({ ...quoted, statut: 'attente_paiement', paiementMontant: 95.06, paiementDate: '2026-10-27T18:00:00Z' }, ctx()).total, { visible: true, amount: 95.06, state: 'paid', label: 'Payé' });
  assert.equal(colisRow({ ...quoted, statut: 'attente_paiement', paiementMontant: 50, paiementDate: '2026-10-27T18:00:00Z' }, ctx()).total.state, '', 'A partial payment is not paid.');
  // The totals and the sort read the amounts paid.
  const rows = [colisRow(paid, ctx()), colisRow({ ...paid, id: 'd-2', clientId: zoe.id, paiementMontant: 120, devisTotal: 120, devisSnapshot: { ...snapshot, amounts: { ...snapshot.amounts, total: 120 } } }, ctx())];
  assert.deepEqual([colisTotals(rows).montantConnu, colisTotals(rows).labels.prixConnus], [215.06, '2 prix connus sur 2']);
  assert.deepEqual(sortColisRows(rows, 'montant').map(row => row.id), ['d-2', 'd-1']);
});

test('the reviewer’s cases: a group mixing a known and an unknown price; « Par date d’envoi » keeps every row once', () => {
  const draft = { ...prepared, id: 'd-4', devisTotal: 100, devisBrouillon: true, quoteVersion: 1, devisSnapshot: { version: 1, amounts: { total: 100, transport: 80, om: 10, omr: 5, tva: 5 }, inputs: { client: { type: 'particulier' } } } };
  const totals = colisTotals([colisRow(draft, ctx()), colisRow({ ...prepared, id: 'd-5' }, ctx())]);
  assert.deepEqual([totals.montantConnu, totals.prixConnus, totals.labels.montant, totals.labels.prixConnus], [100, 1, eur(100), '1 prix connu sur 2']);
  const many = Array.from({ length: 6 }, (_, index) => colisRow({ ...measured, id: `d-g${index}`, envoi: index % 2 ? 'e-unknown' : null, departSouhaite: index === 4 ? '2026-11-12' : null }, ctx()));
  const groups = groupColisRowsByDeparture(many, { now });
  assert.deepEqual(groups.map(group => [group.key, group.label, group.rows.length]), [['wish:974:2026-11-12', 'Départ à créer du jeudi 12 novembre', 1], ['e-unknown', 'Départ à vérifier', 3], ['none', 'Départ à choisir', 2]]);
  assert.deepEqual(groups.reduce((ids, group) => ids.concat(group.rows.map(row => row.id)), []).sort(), many.map(row => row.id).sort());
  assert.equal(sortColisRows(many, 'depart', { now }).length, 6);
});

test('the departure of a row: assigned with its closing, desired, unreadable or to choose', () => {
  const soon = colisRow({ ...measured, envoi: 'e-soon' }, ctx()).departure;
  assert.deepEqual([soon.key, soon.kind, soon.envoiId, soon.ref, soon.date, soon.dateLabel, soon.label, soon.closingLabel],
    ['e-soon', 'assigned', 'e-soon', 'ENV-29', '2026-10-29', 'jeudi 29 octobre', 'Départ : jeudi 29 octobre · Réunion', 'clôture habituelle mercredi 28 octobre, 17 h']);
  assert.equal(colisRow({ ...measured, envoi: 'e-later' }, ctx()).departure.closingLabel, 'clôture mardi 3 novembre, 15 h', 'Its own loading closing, Paris time.');
  const wish = colisRow({ ...measured, departSouhaite: '2026-11-12' }, ctx()).departure;
  assert.deepEqual([wish.key, wish.kind, wish.date, wish.wishState, wish.label, wish.closingLabel],
    ['wish:974:2026-11-12', 'wish', '2026-11-12', 'to_create', 'Départ souhaité : jeudi 12 novembre · à créer', 'clôture habituelle mercredi 11 novembre, 17 h']);
  const hidden = colisRow({ ...measured, envoi: 'e-hidden' }, ctx()).departure;
  assert.deepEqual([hidden.key, hidden.kind, hidden.label, hidden.closingLabel], ['e-hidden', 'unknown', 'Départ : à vérifier', null]);
});

test('a former single carton keeps its own measures; several cartons without theirs are « À mesurer », never zero', () => {
  const single = colisRow(legacySingle, ctx());
  assert.deepEqual([single.cartons, single.poids, single.poidsLabel, single.volumeLabel], [1, 6, kg(6), '0,060\u00a0m³']);
  const several = colisRow({ ...legacySingle, nbColis: 3, trackings: [] }, ctx());
  assert.deepEqual([several.cartons, several.poids, several.poidsLabel, several.volume, several.volumeLabel], [3, null, MEASURE_MISSING_LABEL, null, MEASURE_MISSING_LABEL]);
  const card = brouillonFiche(legacySingle, ctx()).received.cartons[0];
  assert.deepEqual([card.number, card.tracking, card.supplierLabel, card.dimensionsLabel, card.receivedLabel], [1, 'LEGACY1', 'Vendeur non renseigné', '50 × 40 × 30 cm', 'Non renseigné']);
});

test('an unknown client and a client given by the context', () => {
  const orphan = colisRow({ ...measured, clientId: 'c-unknown' }, ctx());
  assert.deepEqual([orphan.clientName, orphan.clientKnown, orphan.clientTypeLabel, orphan.destinationLabel, orphan.commune], ['Client non renseigné', false, null, 'Destination à préciser', null]);
  assert.equal(colisRow(measured, { ...ctx({ getClient: undefined }), client: flavie }).clientName, 'PAYET Flavie');
  assert.equal(colisRow(measured, { ...ctx({ getClient: undefined }), client: zoe }).clientName, 'Client non renseigné', 'Another client’s record is never shown.');
  const company = colisRow({ ...measured, clientId: 'c-company' }, ctx({ getClient: () => ({ id: 'c-company', nom: '', nomFamille: '', prenom: '', raisonSociale: 'Ti Boutik', type: 'pro', cp: '97400' }) }));
  assert.deepEqual([company.clientName, company.clientTypeLabel], ['Ti Boutik', 'Professionnel']);
});

// ── Search and sorts ─────────────────────────────────────────────────────────
const rowFor = (dossier, changes) => colisRow(dossier, ctx(changes));
const searchRows = () => [
  rowFor(measured),
  rowFor({ ...measured, id: 'd-2', ref: 'EXP-BBB222', clientId: zoe.id, casier: 'C7', trackings: ['1Z999AA10123456784'], trackingsDetail: [{ number: '1Z999AA10123456784', fournisseur: 'Fnac' }] }),
  rowFor({ ...measured, id: 'd-3', ref: 'EXP-CCC333', clientId: pro.id, casier: 'A1', trackings: [], trackingsDetail: [] }),
];

test('the search finds a name, a reference, a casier or a tracking number, scanned or typed', () => {
  const rows = searchRows();
  const ids = query => filterColisRows(rows, query).map(row => row.id);
  assert.deepEqual(ids(''), ['d-1', 'd-2', 'd-3']);
  assert.deepEqual(ids('   '), ['d-1', 'd-2', 'd-3']);
  assert.deepEqual(ids('payet'), ['d-1']);
  assert.deepEqual(ids('ebrard zoe'), ['d-2'], 'Accents and case aside, every word.');
  assert.deepEqual(ids('Hoarau Distribution'), ['d-3']);
  assert.deepEqual(ids('EXP-BBB222'), ['d-2']);
  assert.deepEqual(ids('ccc333'), ['d-3']);
  assert.deepEqual(ids('C7'), ['d-2']);
  assert.deepEqual(ids('6A12345678901'), ['d-1'], 'A scan without the spaces of the recorded number.');
  assert.deepEqual(ids('6A 123 456'), ['d-1']);
  assert.deepEqual(ids('1z999aa10123456784'), ['d-2']);
  assert.deepEqual(ids('EXP-BBB222-1-2'), ['d-2'], 'A parcel label scanned finds its dossier.');
  assert.deepEqual(ids('0692123456'), ['d-1'], 'The client details of clientSearchText.');
  assert.deepEqual(ids('introuvable'), []);
});

test('the search finds a dossier by its expedition: the departure’s reference and the carrier’s number', () => {
  const shipped = [...envois, { id: 'e-air', ref: 'ENV-2026-037', date: '2026-10-30', statut: 'expedie', destinationCode: '974', trackingPrincipal: '235-1234 5675', loadingClosesAt: null, departedAt: '2026-10-30T06:00:00Z' }];
  const rows = [
    colisRow({ ...paid, id: 'd-air', envoi: 'e-air', statut: 'expedie' }, ctx({ envois: shipped })),
    colisRow({ ...paid, id: 'd-soon', ref: 'EXP-DDD444', clientId: zoe.id }, ctx({ envois: shipped })),
    ...searchRows(),
  ];
  const ids = query => filterColisRows(rows, query).map(row => row.id);
  assert.deepEqual(ids('ENV-2026-037'), ['d-air']);
  assert.deepEqual(ids('env 2026 037'), ['d-air'], 'Typed with spaces.');
  assert.deepEqual(ids('ENV2026037'), ['d-air'], 'Typed without its dashes.');
  assert.deepEqual(ids('23512345675'), ['d-air'], 'The carrier’s number, scanned without its dash and space.');
  assert.deepEqual(ids('235-1234 5675'), ['d-air']);
  assert.deepEqual(ids('ENV-29'), ['d-soon'], 'Another departure, by its reference.');
  // What matched, said on the line: a number only, never a name.
  const match = (id, query) => colisSearchMatch(rows.find(row => row.id === id), query);
  assert.equal(match('d-air', 'ENV-2026-037'), 'Départ ENV-2026-037');
  assert.equal(match('d-air', '23512345675'), 'Expédition 235-1234 5675');
  assert.equal(match('d-1', '6A12345678901'), 'Suivi 6A 123 456 789 01 · carton 1');
  assert.equal(match('d-1', 'cb998877665fr'), 'Suivi CB998877665FR · carton 2');
  assert.equal(match('d-2', '1Z999AA'), 'Suivi 1Z999AA10123456784 · carton 1', 'Part of the number.');
  assert.equal(match('d-2', 'exp-bbb222'), 'N° d’envoi EXP-BBB222');
  assert.equal(match('d-2', 'bbb222'), 'N° d’envoi EXP-BBB222');
  assert.equal(match('d-2', 'EXP-BBB222-1-2'), 'Colis 1/2 · N° d’envoi EXP-BBB222', 'A parcel label scanned.');
  assert.equal(match('d-1', 'payet'), null, 'A name: the line says it already.');
  assert.equal(match('d-1', '6A'), null, 'Too short to be a number.');
  assert.equal(match('d-1', ''), null);
  assert.equal(match('d-2', 'ENV-2026-037'), null, 'A number of another dossier.');
  assert.equal(colisSearchMatch(null, 'ENV'), null);
  // One carton: no carton number. A tracking number recorded without its carton detail (former dossiers) is found
  // and said too.
  const former = colisRow(legacySingle, ctx());
  assert.deepEqual(filterColisRows([former], 'legacy1').map(row => row.id), ['d-old']);
  assert.equal(colisSearchMatch(former, 'legacy1'), 'Suivi LEGACY1');
});

test('the dimensions of a row: each carton received, the parcels to ship once prepared, never a false zero', () => {
  const two = colisRow(measured, ctx()).dimensions;
  assert.deepEqual(two, { prepared: false, lines: ['40 × 30 × 20 cm', '30 × 20 × 10 cm'], shown: ['40 × 30 × 20 cm', '30 × 20 × 10 cm'], moreLabel: null, label: '40 × 30 × 20 cm · 30 × 20 × 10 cm' });
  // French decimals; a carton without its three sides is « À mesurer ».
  const partial = colisRow({ ...measured, dimsParColis: [box(35.5, 28, 18, 2), box(30, null, 10, 1)] }, ctx()).dimensions;
  assert.deepEqual(partial.lines, ['35,5 × 28 × 18 cm', MEASURE_MISSING_LABEL]);
  // Five cartons: three lines, the others counted.
  const five = colisRow({ ...measured, nbColis: 5, trackings: [], trackingsDetail: [], dimsParColis: [box(10, 10, 10, 1), box(20, 20, 20, 1), box(30, 30, 30, 1), box(40, 40, 40, 1), box(50, 50, 50, 1)] }, ctx()).dimensions;
  assert.deepEqual([five.lines.length, five.shown, five.moreLabel], [5, ['10 × 10 × 10 cm', '20 × 20 × 20 cm', '30 × 30 × 30 cm'], '+ 2 autres']);
  assert.equal(colisRow({ ...measured, nbColis: 4, trackings: [], trackingsDetail: [], dimsParColis: [box(10, 10, 10, 1), box(20, 20, 20, 1), box(30, 30, 30, 1), box(40, 40, 40, 1)] }, ctx()).dimensions.moreLabel, '+ 1 autre');
  // Prepared: the parcels to ship, from the saved packages or the single legacy final box.
  assert.deepEqual(colisRow(prepared, ctx()).dimensions, { prepared: true, lines: ['40 × 30 × 15 cm'], shown: ['40 × 30 × 15 cm'], moreLabel: null, label: '40 × 30 × 15 cm' });
  assert.deepEqual(colisRow({ ...prepared, finalPackages: null, finL: 60, finW: 40, finH: 40, finP: 12 }, ctx()).dimensions.lines, ['60 × 40 × 40 cm']);
  // A preparation of earlier cartons does not count: the cartons received are shown.
  assert.deepEqual(colisRow({ ...prepared, finalMeasurementsVersion: 2 }, ctx()).dimensions.prepared, false);
  // A former single carton keeps its own measures; several cartons without theirs are « À mesurer ».
  assert.deepEqual(colisRow(legacySingle, ctx()).dimensions.lines, ['50 × 40 × 30 cm']);
  assert.deepEqual(colisRow({ ...legacySingle, nbColis: 2, trackings: [] }, ctx()).dimensions.lines, [MEASURE_MISSING_LABEL, MEASURE_MISSING_LABEL]);
});

test('« Par nom » is alphabetical, accents and case aside, an unknown client last', () => {
  const rows = [
    rowFor({ ...measured, id: 'd-payet' }),
    rowFor({ ...measured, id: 'd-unknown', clientId: 'c-unknown' }),
    rowFor({ ...measured, id: 'd-ebrard', clientId: zoe.id }),
    rowFor({ ...measured, id: 'd-durand', clientId: paul.id }),
  ];
  assert.deepEqual(sortColisRows(rows, 'nom').map(row => row.id), ['d-durand', 'd-ebrard', 'd-payet', 'd-unknown']);
  assert.deepEqual(sortColisRows(rows).map(row => row.id), ['d-durand', 'd-ebrard', 'd-payet', 'd-unknown'], 'The default sort.');
  assert.deepEqual(rows.map(row => row.id), ['d-payet', 'd-unknown', 'd-ebrard', 'd-durand'], 'The list given is not reordered.');
});

test('« Par réception » puts the latest carton first and « Par montant » the highest price first, unknown values last', () => {
  const dated = (id, clientId, receivedAt) => rowFor({ ...measured, id, clientId, nbColis: 1, dimsParColis: [box(40, 30, 20, 2.5)], trackingsDetail: [], trackings: [],
    receptionDates: receivedAt ? [{ receivedAt, source: 'server' }] : null });
  const byReception = [dated('d-old', paul.id, '2026-10-20T08:00:00Z'), dated('d-none', flavie.id, null), dated('d-new', zoe.id, '2026-10-27T08:00:00Z')];
  assert.deepEqual(sortColisRows(byReception, 'reception').map(row => row.id), ['d-new', 'd-old', 'd-none']);
  const priced = [rowFor({ ...measured, id: 'd-free' }), rowFor({ ...quoted, id: 'd-95' }), rowFor({ ...quoted, id: 'd-120', clientId: zoe.id, devisTotal: 120, devisSnapshot: { ...snapshot, amounts: { ...snapshot.amounts, total: 120 } } })];
  assert.deepEqual(sortColisRows(priced, 'montant').map(row => row.id), ['d-120', 'd-95', 'd-free']);
  const hidden = priced.map(row => ({ ...row, total: { visible: false, amount: null, state: null, label: null } }));
  assert.deepEqual(sortColisRows(hidden, 'montant').map(row => row.id), ['d-120', 'd-free', 'd-95'], 'Without amounts: by name.');
});

test('« Par date d’envoi » groups by departure, soonest first, then « Départ à choisir », each with its totals', () => {
  const rows = [
    rowFor({ ...measured, id: 'd-none', clientId: paul.id }),
    rowFor({ ...quoted, id: 'd-later', envoi: 'e-later' }),
    rowFor({ ...measured, id: 'd-wish', departSouhaite: '2026-11-12' }),
    rowFor({ ...measured, id: 'd-hidden', envoi: 'e-hidden' }),
    rowFor({ ...measured, id: 'd-past', envoi: 'e-past' }),
    rowFor({ ...measured, id: 'd-soon-b', clientId: zoe.id, envoi: 'e-soon' }),
    rowFor({ ...quoted, id: 'd-soon-a', envoi: 'e-soon' }),
  ];
  const groups = groupColisRowsByDeparture(rows, { now });
  assert.deepEqual(groups.map(group => [group.key, group.label, group.rows.map(row => row.id)]), [
    ['e-soon', 'Départ du jeudi 29 octobre', ['d-soon-b', 'd-soon-a']],
    ['e-later', 'Départ du jeudi 5 novembre', ['d-later']],
    ['wish:974:2026-11-12', 'Départ à créer du jeudi 12 novembre', ['d-wish']],
    ['e-past', 'Départ du mardi 20 octobre', ['d-past']],
    ['e-hidden', 'Départ à vérifier', ['d-hidden']],
    ['none', 'Départ à choisir', ['d-none']],
  ]);
  const [soon] = groups;
  assert.deepEqual([soon.date, soon.dateLabel, soon.destinationLabel, soon.ref, soon.closingLabel], ['2026-10-29', 'jeudi 29 octobre', 'Réunion', 'ENV-29', 'clôture habituelle mercredi 28 octobre, 17 h']);
  assert.deepEqual([soon.totals.clients, soon.totals.dossiers, soon.totals.cartons, soon.totals.poids, soon.totals.montantConnu, soon.totals.prixConnus, soon.totals.labels.prixConnus],
    [2, 2, 4, 7.5, 95.06, 1, '1 prix connu sur 2']);
  assert.deepEqual([groups[5].date, groups[5].closingLabel, groups[5].destinationLabel], [null, null, null]);
  // The same order as a flat list, by name inside a departure (ÉBRARD before PAYET).
  assert.deepEqual(sortColisRows(rows, 'depart', { now }).map(row => row.id), ['d-soon-b', 'd-soon-a', 'd-later', 'd-wish', 'd-past', 'd-hidden', 'd-none']);
  assert.deepEqual(sortColisRows([rows[6], rows[5]], 'depart', { now }).map(row => row.id), ['d-soon-b', 'd-soon-a'], 'Whatever the incoming order.');
});

test('a row names the client number, the plan and the zone of La Réunion, and the search finds them', () => {
  const people = new Map([
    ['c-quentin', { id: 'c-quentin', ref: 'CLT174737', nom: 'QUENTIN Auguste', nomFamille: 'QUENTIN', prenom: 'Auguste', type: 'particulier', cp: '97410', ville: 'Saint-Pierre', abonnement: 'premium_annuel' }],
    ['c-old', { id: 'c-old', ref: 'CLT104122', nom: 'NICE Guillaume', nomFamille: 'NICE', prenom: 'Guillaume', type: 'particulier', cp: '97438', ville: 'Sainte-Marie', abonnement: 'premium' }],
    ['c-vip', { id: 'c-vip', ref: 'CLT154068', nom: 'COURTOIS Béatrice', nomFamille: 'COURTOIS', prenom: 'Béatrice', type: 'particulier', cp: '97460', ville: 'Saint-Paul', abonnement: 'vip' }],
    ['c-may', { id: 'c-may', ref: 'CLT302755', nom: 'MOGALIA Carole', nomFamille: 'MOGALIA', prenom: 'Carole', type: 'particulier', cp: '97600', ville: 'Mamoudzou', abonnement: 'freemium' }],
    ['c-odd', { id: 'c-odd', nom: 'DALLEAU Guyvan', nomFamille: 'DALLEAU', prenom: 'Guyvan', type: 'particulier', cp: '97499', ville: 'Ailleurs', abonnement: 'inconnu' }],
  ]);
  const at = (id, clientId) => colisRow({ ...measured, id, clientId }, ctx({ getClient: key => people.get(key) || null }));
  const rows = [at('d-q', 'c-quentin'), at('d-n', 'c-old'), at('d-v', 'c-vip'), at('d-m', 'c-may'), at('d-d', 'c-odd')];
  assert.deepEqual(rows.map(row => [row.clientRef, row.forfaitLabel, row.zone, row.zoneLabel]), [
    ['CLT174737', 'Premium Annuel', 'SUD', 'Sud'],
    ['CLT104122', 'Premium', 'NORD', 'Nord'],
    ['CLT154068', 'VIP Annuel', 'OUEST', 'Ouest'],
    ['CLT302755', 'Freemium', null, null],
    [null, null, null, null],
  ], 'Mayotte has no zone; an unknown postcode or plan is not guessed.');
  assert.deepEqual(filterColisRows(rows, 'CLT174737').map(row => row.id), ['d-q'], 'The client number.');
  assert.deepEqual(filterColisRows(rows, 'sud').map(row => row.id), ['d-q'], 'The zone.');
  assert.deepEqual(filterColisRows(rows, 'vip').map(row => row.id), ['d-v'], 'The plan.');
});

test('« Par destination » groups by destination, Réunion, Mayotte, Guadeloupe, Martinique, then the unknown ones, by name inside', () => {
  const lea = { id: 'c-lea', nom: 'BOURGEOIS Léa', nomFamille: 'BOURGEOIS', prenom: 'Léa', type: 'particulier', cp: '97110', ville: 'Pointe-à-Pitre' };
  const noPostcode = { id: 'c-nocp', nom: 'ADAM Marc', nomFamille: 'ADAM', prenom: 'Marc', type: 'particulier', cp: '', ville: '' };
  const abroad = { id: 'c-abroad', nom: 'MARTIN Luc', nomFamille: 'MARTIN', prenom: 'Luc', type: 'particulier', cp: '75011', ville: 'Paris' };
  const more = new Map([...clients, [lea.id, lea], [noPostcode.id, noPostcode], [abroad.id, abroad]]);
  const at = (dossier) => colisRow(dossier, ctx({ getClient: id => more.get(id) || null }));
  const rows = [
    at({ ...measured, id: 'd-payet' }),
    at({ ...measured, id: 'd-adam', clientId: noPostcode.id }),
    at({ ...measured, id: 'd-lea', clientId: lea.id }),
    at({ ...quoted, id: 'd-hoarau', clientId: pro.id }),
    at({ ...measured, id: 'd-durand', clientId: paul.id }),
    at({ ...measured, id: 'd-martin', clientId: abroad.id }),
    at({ ...measured, id: 'd-ebrard', clientId: zoe.id }),
  ];
  const groups = groupColisRowsByDestination(rows);
  // La Réunion by delivery zone: Nord (97400) before Sud (97410).
  assert.deepEqual(groups.map(group => [group.key, group.code, group.zone, group.label, group.rows.map(row => row.id)]), [
    ['destination:974:NORD', '974', 'NORD', 'Réunion · zone Nord', ['d-durand', 'd-payet']],
    ['destination:974:SUD', '974', 'SUD', 'Réunion · zone Sud', ['d-ebrard']],
    ['destination:976', '976', null, 'Mayotte', ['d-hoarau']],
    ['destination:971', '971', null, 'Guadeloupe', ['d-lea']],
    [NO_DESTINATION_GROUP_KEY, null, null, 'Destination à vérifier', ['d-adam', 'd-martin']],
  ]);
  const [nord] = groups;
  assert.deepEqual([nord.totals.clients, nord.totals.dossiers, nord.totals.labels.clients], [2, 2, '2 clients']);
  assert.equal(groups[2].totals.montantConnu, 95.06, 'The known amount of the group, with the right to see it.');
  // The same order as a flat list, whatever the incoming order; the list given is not reordered.
  assert.deepEqual(sortColisRows(rows, 'destination').map(row => row.id), ['d-durand', 'd-payet', 'd-ebrard', 'd-hoarau', 'd-lea', 'd-adam', 'd-martin']);
  assert.deepEqual(sortColisRows([...rows].reverse(), 'destination').map(row => row.id), ['d-durand', 'd-payet', 'd-ebrard', 'd-hoarau', 'd-lea', 'd-adam', 'd-martin']);
  // A postcode of La Réunion without zone: « Réunion », after its zones.
  const unzoned = at({ ...measured, id: 'd-unzoned', clientId: 'c-unzoned' });
  assert.equal(unzoned.zone, null);
  assert.deepEqual(groupColisRowsByDestination([rows[6], { ...unzoned, destinationCode: '974' }]).map(group => [group.key, group.label]),
    [['destination:974:SUD', 'Réunion · zone Sud'], ['destination:974', 'Réunion']]);
  assert.equal(rows[0].id, 'd-payet');
  assert.deepEqual(groupColisRowsByDestination([]), []);
});

test('the totals of the stock shown: clients, cartons, kilograms, m³, the known amount and how many prices are known', () => {
  const row = (id, clientId, cartons, poids, volume, amount, visible = true) => ({ id, clientId, cartons, poids, volume, total: { visible, amount, state: '', label: '' } });
  const totals = colisTotals([row('a', 'c1', 2, 3.75, 0.03, null), row('b', 'c1', 1, 6, 0.06, 95.06), row('c', 'c2', 3, null, null, 50.1)]);
  assert.deepEqual({ ...totals, labels: undefined }, { clients: 2, dossiers: 3, cartons: 6, poids: 9.75, poidsManquants: 1, volume: totals.volume, volumeManquants: 1,
    montantVisible: true, montantConnu: 145.16, prixConnus: 2, labels: undefined });
  assert.ok(Math.abs(totals.volume - 0.09) < 1e-12);
  assert.deepEqual(totals.labels, { clients: '2 clients', dossiers: '3 dossiers', cartons: '6 cartons', poids: kg(9.75), volume: '0,090\u00a0m³', montant: eur(145.16), prixConnus: '2 prix connus sur 3' });
  // Nothing known is never a zero.
  const unknown = colisTotals([row('a', 'c1', 1, null, null, null)]);
  assert.deepEqual([unknown.poids, unknown.volume, unknown.montantConnu, unknown.prixConnus, unknown.labels.poids, unknown.labels.volume, unknown.labels.montant],
    [null, null, null, 0, 'À mesurer', 'À mesurer', 'À calculer']);
  const hidden = colisTotals([row('a', 'c1', 1, 2, 0.01, null, false)]);
  assert.deepEqual([hidden.montantVisible, hidden.montantConnu, hidden.prixConnus, hidden.labels.montant, hidden.labels.prixConnus], [false, null, null, null, null]);
  const empty = colisTotals([]);
  assert.deepEqual([empty.clients, empty.dossiers, empty.cartons, empty.poids, empty.labels.clients, empty.labels.cartons], [0, 0, 0, null, '0 client', '0 carton']);
  assert.equal(colisTotals([row('a', null, 1, 1, 0.01, 10), row('b', null, 1, 1, 0.01, 10)]).clients, 2, 'Two dossiers without client are two clients to see.');
});

// ── Reception target ─────────────────────────────────────────────────────────
test('a reception joins the client’s most recent dossier still before its quote, otherwise opens a new Brouillon', () => {
  assert.deepEqual(receptionTarget(flavie.id, []), { mode: 'new', dossier: null, label: 'Nouveau brouillon', detail: 'Aucun dossier ouvert', blockedReason: null });
  assert.equal(receptionTarget(null, [measured]).mode, 'new');
  const one = receptionTarget(flavie.id, [measured, { ...measured, id: 'd-zoe', clientId: zoe.id }]);
  assert.deepEqual({ ...one, dossier: one.dossier.id }, { mode: 'append', dossier: 'd-1', label: 'Le carton rejoint son brouillon', detail: 'EXP-AAA111 · casier B12', impact: null });
  assert.equal(receptionTarget(flavie.id, [{ ...measured, statut: 'attente_feu_vert' }]).impact, 'Il faudra redemander l’accord du client pour inclure ce nouveau carton. L’ajout n’envoie aucun message.');
  // A quote already sent: a new Brouillon.
  assert.deepEqual(receptionTarget(flavie.id, [quoted]), { mode: 'new', dossier: null, label: 'Nouveau brouillon', detail: 'Devis déjà envoyé', blockedReason: null });
  // Several open: the most recent one.
  const older = { ...measured, id: 'd-older', ref: 'EXP-OLDER1', createdAt: '2026-10-01T08:00:00Z' };
  const newer = { ...measured, id: 'd-newer', ref: 'EXP-NEWER1', createdAt: '2026-10-20T08:00:00Z', casier: '' };
  const latest = receptionTarget(flavie.id, [older, newer, quoted]);
  assert.deepEqual([latest.mode, latest.dossier.id, latest.detail], ['append', 'd-newer', 'EXP-NEWER1 · casier à renseigner']);
  assert.equal(receptionTarget(flavie.id, [newer, older]).dossier.id, 'd-newer');
  // An open dossier that cannot take a carton: a new Brouillon, with the reason.
  const linked = receptionTarget(flavie.id, [{ ...prepared, payplugPaymentUrl: 'https://pay.example/1' }]);
  assert.deepEqual([linked.mode, linked.detail, linked.blockedReason], ['new', 'Le brouillon en cours ne peut pas recevoir de carton', 'Un lien de paiement existe. Corrigez le devis pour désactiver ce lien avant d’ajouter un carton.']);
  assert.equal(receptionTarget(flavie.id, [{ ...measured, statut: 'refuse_client' }]).mode, 'new', 'A refused dossier no longer receives cartons.');
  assert.equal(receptionTarget(flavie.id, [{ ...measured, archive: true }]).mode, 'new');
  const free = { ...measured, id: 'd-free', createdAt: '2026-09-01T08:00:00Z' };
  assert.equal(receptionTarget(flavie.id, [free, { ...prepared, createdAt: '2026-10-27T08:00:00Z', payplugPaymentUrl: 'https://pay.example/1' }]).dossier.id, 'd-free',
    'A more recent dossier that cannot take the carton gives way to one that can.');
});

// ── Arrival notices ──────────────────────────────────────────────────────────
// A notice validated five minutes before `now`: still on its way for a few minutes.
const recent = (changes = {}) => ({ createdAt: '2026-10-28T09:55:00Z', message: { id: 'm-1', statut: 'envoi', texte: 'Bonjour Flavie', createdAt: '2026-10-28T09:55:00Z' }, ...changes });

test('the state of an arrival notice, for every state of its message and delivery', () => {
  const state = changes => arrivalNoticeState(notice(changes), { now });
  const read = changes => { const value = state(changes); return [value.key, value.label, value.tone]; };
  assert.deepEqual(read({ notify: false, canal: null, template: null, message: null, outbox: null }), ['sans_avis', 'Sans avis', 'neutral']);
  for (const status of ['pending', 'sending', 'blocked'])
    assert.deepEqual(read(recent({ outbox: { status } })), ['en_cours', 'En cours d’envoi', 'waiting'], status);
  assert.deepEqual(read(recent({ outbox: null })), ['en_cours', 'En cours d’envoi', 'waiting']);
  assert.deepEqual(read({}), ['envoye', 'Envoyé', 'done']);
  assert.equal(state({}).detail, 'Telegram a confirmé l’envoi le 27/10/2026');
  assert.deepEqual(read({ outbox: null }), ['envoye', 'Envoyé', 'done']);
  for (const statut of ['distribue', 'lu']) assert.deepEqual(read({ canal: 'email', message: { statut }, outbox: { status: 'sent' } }), ['remis', 'Remis', 'done'], statut);
  const manual = state({ canal: 'email', message: { statut: 'envoi', texte: 'Bonjour' }, outbox: { status: 'manual' } });
  assert.deepEqual([manual.key, manual.label, manual.action, manual.canalLabel], ['a_envoyer', 'À envoyer', { key: 'copier_texte', label: 'Copier le texte' }, 'E-mail']);
  assert.equal(state({ canal: 'email', message: { statut: 'envoi' }, outbox: null }).key, 'a_envoyer');
  const telegramFailed = state({ message: { statut: 'echec' }, outbox: { status: 'failed', lastError: 'Forbidden: bot was blocked by the user' } });
  assert.deepEqual([telegramFailed.key, telegramFailed.label, telegramFailed.reason, telegramFailed.action], ['non_remis', 'Non remis', 'Forbidden: bot was blocked by the user', { key: 'reessayer', label: 'Réessayer' }]);
  const emailFailed = state({ canal: 'email', message: { statut: 'echec' }, outbox: { status: 'failed', lastError: 'Adresse inconnue' } });
  assert.deepEqual([emailFailed.key, emailFailed.reason, emailFailed.action], ['non_remis', 'Adresse inconnue', { key: 'corriger_adresse', label: 'Corriger l’adresse' }]);
  assert.equal(state({ message: { statut: 'echec' }, outbox: null }).reason, 'Raison non précisée');
  assert.deepEqual(read({ message: { statut: 'envoi' }, outbox: { status: 'cancelled' } }), ['annule', 'Annulé', 'neutral']);
  assert.equal(state({ message: { statut: 'lu' }, outbox: { status: 'failed' } }).key, 'remis', 'A read message was delivered.');
  assert.deepEqual(Object.keys(ARRIVAL_NOTICE_STATES), ['sans_avis', 'en_cours', 'a_verifier', 'envoye', 'remis', 'a_envoyer', 'non_remis', 'annule']);
  assert.equal(arrivalNoticeState(null), null);
  // The result of validate_reception reads the same, its outbox as the database writes it.
  const validated = arrivalNoticeState({ validation: { id: 'v-1', notify: true, canal: 'telegram' }, message: { statut: 'echec' }, outbox: { status: 'failed', last_error: 'Chat introuvable' }, reused: false }, { now });
  assert.deepEqual([validated.key, validated.reason], ['non_remis', 'Chat introuvable']);
});

test('a notice still on its way after 10 minutes becomes « Envoi à vérifier », never « En cours d’envoi » for good', () => {
  const at = (minutes, changes = {}) => {
    const created = new Date(now - minutes * 60000).toISOString();
    return notice({ createdAt: created, message: { id: 'm-1', statut: 'envoi', texte: 'Bonjour Flavie', createdAt: created }, ...changes });
  };
  const state = (item, when = now) => arrivalNoticeState(item, { now: when });
  assert.equal(NOTICE_SEND_CHECK_MINUTES, 10);
  assert.equal(state(at(9, { outbox: { status: 'pending' } })).key, 'en_cours');
  assert.equal(state(at(10, { outbox: { status: 'pending' } })).key, 'en_cours', 'Ten minutes exactly: still on its way.');
  // Never taken (the scheduled task stopped, a missing token…): « Réessayer » sends it (send-telegram takes a pending one).
  const pending = state(at(11, { outbox: { status: 'pending', attempts: 0 } }));
  assert.deepEqual(pending, { key: 'a_verifier', label: 'Envoi à vérifier', tone: 'review', detail: 'Toujours pas parti au bout de 10 minutes : l’envoi automatique ne l’a pas pris en charge.',
    canal: 'telegram', canalLabel: 'Telegram', reason: null, action: { key: 'reessayer', label: 'Réessayer' } });
  // A send started without confirmation: uncertain, to check in Telegram; the server sends again only a failed one.
  const sending = state(at(30, { outbox: { status: 'sending', attempts: 1 } }));
  assert.deepEqual([sending.key, sending.detail, sending.action], ['a_verifier', 'Envoi commencé il y a plus de 10 minutes, sans confirmation de Telegram : vérifiez dans Telegram si le message est arrivé.', null]);
  const blocked = state(at(30, { outbox: { status: 'blocked', lastError: 'Conversation client à traiter avant toute relance' } }));
  assert.deepEqual([blocked.key, blocked.detail, blocked.reason, blocked.action.key], ['a_verifier', 'Envoi retenu depuis plus de 10 minutes : Conversation client à traiter avant toute relance.', 'Conversation client à traiter avant toute relance', 'reessayer']);
  const email = state(at(30, { canal: 'email', outbox: { status: 'sending' } }));
  assert.deepEqual([email.key, email.detail, email.action], ['a_verifier', 'Envoi commencé il y a plus de 10 minutes, sans confirmation du fournisseur d’e-mail.', null]);
  assert.deepEqual([state(at(30, { outbox: null })).key, state(at(30, { outbox: null })).action], ['a_verifier', null]);
  // The message's date first, the validation's otherwise; without any date, nothing is claimed.
  assert.equal(state(at(60, { message: { id: 'm-1', statut: 'envoi', createdAt: new Date(now - 5 * 60000).toISOString() }, outbox: { status: 'pending' } })).key, 'en_cours');
  assert.equal(state(at(60, { message: { id: 'm-1', statut: 'envoi' }, outbox: { status: 'pending' } })).key, 'a_verifier');
  assert.equal(state(notice({ createdAt: null, message: { id: 'm-1', statut: 'envoi' }, outbox: { status: 'pending' } })).key, 'en_cours');
  // The states that are not « on its way » keep their own words, however old.
  for (const [changes, key] of [[{ outbox: { status: 'sent', sentAt: '2026-10-01T10:00:00Z' } }, 'envoye'], [{ outbox: { status: 'failed' } }, 'non_remis'],
    [{ canal: 'email', outbox: { status: 'manual' } }, 'a_envoyer'], [{ outbox: { status: 'cancelled' } }, 'annule'], [{ notify: false, message: null, outbox: null }, 'sans_avis']])
    assert.equal(state(at(600, changes)).key, key, key);
  // The result of validate_reception, with the database's own field names.
  const result = { validation: { id: 'v-1', notify: true, canal: 'telegram', createdAt: new Date(now - 20 * 60000).toISOString() },
    message: { id: 'm-1', statut: 'envoi', created_at: new Date(now - 20 * 60000).toISOString() }, outbox: { id: 'o-1', status: 'pending' }, reused: false };
  assert.equal(state(result).key, 'a_verifier');
  assert.equal(state(result, now - 15 * 60000).key, 'en_cours', 'Read at its own instant.');
  assert.equal(arrivalNoticeSummary(at(30, { outbox: { status: 'pending' } }), { now }).state.key, 'a_verifier');
});

test('an arrival notice summary: date, client, channel, cartons and those of a dossier', () => {
  const summary = arrivalNoticeSummary(notice(), { colisId: 'd-1' });
  assert.deepEqual({ ...summary, state: summary.state.key }, { id: 'n-1', createdAt: '2026-10-27T10:00:00Z', dateLabel: '27/10/2026', clientName: 'PAYET Flavie', actorName: 'Camille',
    canal: 'telegram', canalLabel: 'Telegram', cartonCount: 2, cartonsLabel: '2 cartons', refs: ['EXP-AAA111'], dossierCartonsLabel: 'Cartons 2 et 3', state: 'envoye', text: 'Bonjour Flavie, vos colis sont arrivés.' });
  assert.equal(arrivalNoticeSummary(notice({ items: [{ colisId: 'd-1', ref: 'EXP-AAA111', firstCarton: 4, lastCarton: 4 }] }), { colisId: 'd-1' }).dossierCartonsLabel, 'Carton 4');
  assert.equal(arrivalNoticeSummary(notice({ items: [{ colisId: 'd-1', ref: 'EXP-AAA111', firstCarton: 1, lastCarton: 3 }], cartons: undefined }), { colisId: 'd-1' }).dossierCartonsLabel, 'Cartons 1 à 3');
  assert.equal(arrivalNoticeSummary(notice({ cartons: undefined, items: [{ colisId: 'd-1', firstCarton: 1, lastCarton: 3 }, { colisId: 'd-2', firstCarton: 2, lastCarton: 2 }] })).cartonCount, 4);
  assert.equal(arrivalNoticeSummary(null), null);
});

test('the alerts of the page appear only when something is to do', () => {
  assert.deepEqual(brouillonAlerts({ pending: [], notices: [notice()], now }), []);
  assert.deepEqual(brouillonAlerts(), []);
  const one = brouillonAlerts({ pending: [pendingEntry('d-1', [2, 3]), pendingEntry('d-2', [1], { clientId: flavie.id })], now });
  assert.deepEqual(one, [{ key: 'reception_a_valider', tone: 'review', count: 3, clients: 1, text: 'Réception à valider : 3 cartons', action: { label: 'Valider et prévenir', href: '/recevoir?client=c-flavie&valider=1' } }]);
  const several = brouillonAlerts({ pending: pendingByColis([pendingEntry('d-1', [2]), pendingEntry('d-3', [1, 2], { clientId: zoe.id })]), now });
  assert.deepEqual(several[0], { key: 'reception_a_valider', tone: 'review', count: 3, clients: 2, text: 'Réception à valider : 3 cartons de 2 clients', action: { label: 'Voir les réceptions', href: '/avis' } });
  // Not delivered; an e-mail to send by hand is no alert; a notice on its way for a few minutes neither.
  const delivered = notice({ id: 'n-2' }), manual = notice({ id: 'n-3', canal: 'email', message: { statut: 'envoi' }, outbox: { status: 'manual' } });
  const onItsWay = notice({ id: 'n-5', ...recent({ outbox: { status: 'pending' } }) });
  const failed = brouillonAlerts({ notices: [notice({ outbox: { status: 'failed', lastError: 'x' } }), delivered, manual, notice({ id: 'n-4', message: { statut: 'echec' }, outbox: null }), onItsWay], now });
  assert.deepEqual(failed, [{ key: 'avis_non_remis', tone: 'review', count: 2, failed: 2, toCheck: 0, text: '2 avis d’arrivée non remis', action: { label: 'Voir les avis', href: '/avis' } }]);
  // On its way for too long: to check, counted with the notices not delivered.
  const stuck = notice({ id: 'n-6', createdAt: '2026-10-28T09:00:00Z', message: { id: 'm-6', statut: 'envoi', createdAt: '2026-10-28T09:00:00Z' }, outbox: { status: 'sending' } });
  assert.deepEqual(brouillonAlerts({ notices: [stuck, delivered, manual], now }), [{ key: 'avis_non_remis', tone: 'review', count: 1, failed: 0, toCheck: 1, text: '1 avis d’arrivée à vérifier', action: { label: 'Voir les avis', href: '/avis' } }]);
  assert.equal(brouillonAlerts({ notices: [stuck, notice({ id: 'n-7', outbox: { status: 'failed' } }), notice({ id: 'n-8', outbox: { status: 'failed' } })], now })[0].text, '2 avis d’arrivée non remis, 1 à vérifier');
  assert.deepEqual(brouillonAlerts({ notices: [stuck], now: Date.parse('2026-10-28T09:05:00Z') }), [], 'Read at its own instant.');
});

test('the receptions to validate, indexed by dossier and grouped by client', () => {
  const index = pendingByColis([pendingEntry('d-1', [2]), { colisId: null }, pendingEntry('d-1', [3], { receivedFrom: '2026-10-28T06:00:00Z', receivedTo: '2026-10-28T06:00:00Z' }),
    { colisId: 'd-5', clientId: zoe.id, firstCarton: 2, lastCarton: 4, receivedFrom: '2026-10-25T08:00:00Z' }]);
  assert.deepEqual([...index.keys()], ['d-1', 'd-5']);
  const merged = index.get('d-1');
  assert.deepEqual([merged.firstCarton, merged.lastCarton, merged.cartonCount, merged.cartons.map(carton => carton.carton), merged.receivedFrom, merged.receivedTo],
    [2, 3, 2, [2, 3], '2026-10-27T09:00:00Z', '2026-10-28T06:00:00Z']);
  assert.deepEqual([index.get('d-5').cartonCount, index.get('d-5').cartons], [3, []], 'Without its cartons, the range counts them.');
  assert.deepEqual(pendingByColis(null).size, 0);
  const groups = pendingByClient(index);
  assert.deepEqual(groups.map(group => [group.clientId, group.cartonCount, group.dossiers.map(entry => entry.colisId), group.items, group.href]), [
    ['c-zoe', 3, ['d-5'], [{ colisId: 'd-5', fromCarton: 2, throughCarton: 4 }], '/recevoir?client=c-zoe&valider=1'],
    ['c-flavie', 2, ['d-1'], [{ colisId: 'd-1', fromCarton: 2, throughCarton: 3 }], '/recevoir?client=c-flavie&valider=1'],
  ], 'The longest waiting first.');
  // Every dossier of the client waiting: validateReception validates them together, from the first carton shown.
  const both = pendingByClient([pendingEntry('d-1', [2, 3]), pendingEntry('d-2', [1])]);
  assert.deepEqual(both.map(group => [group.clientId, group.cartonCount, group.items]), [['c-flavie', 3, [{ colisId: 'd-1', fromCarton: 2, throughCarton: 3 }, { colisId: 'd-2', fromCarton: 1, throughCarton: 1 }]]]);
  // The cartons listed are those shown: they decide over a range that disagrees.
  assert.deepEqual(pendingByClient([pendingEntry('d-1', [3, 4], { firstCarton: 2, lastCarton: 5 })])[0].items, [{ colisId: 'd-1', fromCarton: 3, throughCarton: 4 }]);
  assert.deepEqual(pendingByClient(undefined), []);
});

test('a validation files its notice on a dossier that still requests its purchase invoice', () => {
  const asking = { id: 'd-ask', factures: [] };
  const corrected = { id: 'd-fix', factures: [{ id: 'f-9', valide: false, fichier: 'colis/d-fix/f9.pdf', rejetMotif: 'Illisible' }] };
  const documented = { id: 'd-ok', factures: [invoice] };
  const received = { id: 'd-received', factures: [{ id: 'f-8', valide: false, fichier: 'colis/d-received/f8.pdf' }] };
  const items = [{ colisId: 'd-ok', fromCarton: 1, throughCarton: 2 }, { colisId: 'd-ask', fromCarton: 1, throughCarton: 1 }, { colisId: 'd-received', fromCarton: 3, throughCarton: 3 },
    { colisId: 'd-unknown', fromCarton: 1, throughCarton: 1 }, { colisId: 'd-fix', fromCarton: 2, throughCarton: 2 }];
  const ids = list => list.map(item => item.colisId);
  const byMap = new Map([asking, corrected, documented, received].map(dossier => [dossier.id, dossier]));
  // Requested first (no invoice, an invoice to correct), each group in its incoming order; received ones and unknown dossiers after.
  assert.deepEqual(ids(orderValidationItems(items, byMap)), ['d-ask', 'd-fix', 'd-ok', 'd-received', 'd-unknown']);
  assert.deepEqual(ids(orderValidationItems(items, Object.fromEntries(byMap))), ['d-ask', 'd-fix', 'd-ok', 'd-received', 'd-unknown'], 'An object by id.');
  assert.deepEqual(ids(orderValidationItems(items, [asking, corrected, documented, received])), ['d-ask', 'd-fix', 'd-ok', 'd-received', 'd-unknown'], 'The list of dossiers.');
  assert.deepEqual(ids(orderValidationItems(items, id => byMap.get(id))), ['d-ask', 'd-fix', 'd-ok', 'd-received', 'd-unknown'], 'A lookup.');
  assert.deepEqual(orderValidationItems(items, byMap)[0], { colisId: 'd-ask', fromCarton: 1, throughCarton: 1 }, 'The items themselves, unchanged.');
  assert.deepEqual(ids(items), ['d-ok', 'd-ask', 'd-received', 'd-unknown', 'd-fix'], 'The list given is not reordered.');
  assert.deepEqual(ids(orderValidationItems([items[0], items[2]], byMap)), ['d-ok', 'd-received'], 'Nothing requested: the incoming order.');
  assert.deepEqual(orderValidationItems(null, byMap), []);
  assert.deepEqual(ids(orderValidationItems(items)), ids(items), 'Without the dossiers: the incoming order.');
});

// ── Brouillon sheet ──────────────────────────────────────────────────────────
test('the sheet: header, cartons received with those to validate, one action and the links', () => {
  const sheet = brouillonFiche(measured, ctx({ pending: pendingByColis([pendingEntry('d-1', [2])]) }));
  assert.deepEqual(sheet.header, { ref: 'EXP-AAA111', clientName: 'PAYET Flavie', clientTypeLabel: 'Particulier', destinationLabel: 'Réunion', commune: 'Sainte-Clotilde',
    zone: 'NORD', zoneLabel: 'Nord', clientRef: null, forfaitLabel: null, casier: 'B12', casierLabel: 'Casier B12', stage: sheet.stage,
    // Every fact the sheet names with its word (domain/dossierIdentity.js): no client number nor plan on this client.
    identity: { ref: 'EXP-AAA111', casier: 'B12', clientRef: null, clientTypeLabel: 'Particulier', forfaitLabel: null, destinationCode: '974', destinationLabel: 'Réunion',
      destinationName: 'La Réunion', commune: 'Sainte-Clotilde', zone: 'NORD', zoneLabel: 'Nord' } });
  assert.equal(sheet.stage.key, 'reception_a_valider');
  assert.deepEqual(sheet.action, { key: 'valider_reception', label: 'Valider la réception', task: null, ...RECEIVE, href: '/recevoir?client=c-flavie&valider=1' });
  assert.deepEqual(sheet.received.cartons.map(carton => [carton.number, carton.supplierLabel, carton.trackingLabel, carton.dimensionsLabel, carton.poidsLabel, carton.volumeLabel, carton.receivedLabel, carton.pending]), [
    [1, 'Amazon', '6A 123 456 789 01', '40 × 30 × 20 cm', kg(2.5), '0,024\u00a0m³', '26/10/2026', false],
    [2, 'Zalando', 'CB998877665FR', '30 × 20 × 10 cm', kg(1.25), '0,006\u00a0m³', '27/10/2026', true],
  ]);
  assert.deepEqual([sheet.received.count, sheet.received.countLabel, sheet.received.poidsLabel, sheet.received.volumeLabel, sheet.received.pendingCount, sheet.received.pendingLabel],
    [2, '2 cartons', kg(3.75), '0,030\u00a0m³', 1, '1 carton à valider']);
  assert.deepEqual(sheet.links, { dossier: { label: 'Tout le dossier', href: '/colis/d-1?returnTo=%2Fbrouillon%2Fd-1' }, addCarton: { label: 'Ajouter un carton', href: '/recevoir?dossier=d-1', blockedReason: null } });
  assert.equal(workspaceReturnPath(new URL(sheet.links.dossier.href, 'https://pinta.invalid').search), '/brouillon/d-1', 'The dossier page leads back to the sheet.');
  // The same action as the row, its page coming back to the sheet.
  assert.equal(brouillonFiche({ ...measured, statut: 'autorise', feuVert: 'autorise' }, ctx()).action.href, '/colis/d-1?returnTo=%2Fbrouillon%2Fd-1&section=preparation#dossier-work');
  assert.equal(brouillonFiche(measured, ctx()).action.href, null, 'A consent request opens in place.');
  const paidSheet = brouillonFiche(paid, ctx());
  assert.deepEqual(paidSheet.links.addCarton, { label: 'Ajouter un carton', href: null, blockedReason: 'Le paiement est déjà enregistré. Un responsable doit vérifier ce dossier avant tout ajout.' });
});

test('the sheet: parcels after optimisation and the volume gained', () => {
  const sheet = brouillonFiche(prepared, ctx());
  assert.deepEqual([sheet.optimized.done, sheet.optimized.summary, sheet.optimized.count, sheet.optimized.poidsLabel, sheet.optimized.volumeLabel], [true, '1 colis à expédier', 1, kg(3.6), '0,018\u00a0m³']);
  assert.deepEqual(sheet.optimized.packages.map(parcel => [parcel.number, parcel.dimensionsLabel, parcel.poidsLabel, parcel.volumeLabel]), [[1, '40 × 30 × 15 cm', kg(3.6), '0,018\u00a0m³']]);
  assert.deepEqual(sheet.optimized.volumeGain, { percent: 40, label: 'Gain de volume : 40\u00a0%' });
  const bigger = brouillonFiche({ ...prepared, finalPackages: [box(50, 40, 20, 3.6)] }, ctx()).optimized.volumeGain;
  assert.deepEqual(bigger, { percent: -33, label: 'Volume en hausse de 33\u00a0%' });
  const todo = brouillonFiche(measured, ctx()).optimized;
  assert.deepEqual([todo.done, todo.summary, todo.packages, todo.volumeGain, todo.poidsLabel], [false, 'Préparation à faire', [], null, 'À mesurer']);
  assert.equal(brouillonFiche({ ...prepared, preparationCompositionVersion: 4 }, ctx()).optimized.summary, 'Mesures après optimisation à confirmer pour les cartons actuels');
  // No received volume to compare: no gain announced.
  assert.equal(brouillonFiche({ ...prepared, dimsParColis: [box(40, 30, 20, 2.5), box(30, null, 10, 1)] }, ctx()).optimized.volumeGain, null);
});

test('the sheet’s price comes from the saved quote only: transport, estimated import taxes, fees, total and saving', () => {
  const price = brouillonFiche(quoted, ctx()).price;
  assert.deepEqual([price.visible, price.known, price.detailed, price.state, price.label, price.message], [true, true, true, '', eur(95.06), null]);
  assert.deepEqual(price.total, { label: 'Total', amount: 95.06, text: eur(95.06) });
  assert.deepEqual(price.transport, { label: 'Transport', amount: 70, text: eur(70), billableWeight: 3.6, billableWeightLabel: `Poids facturé : ${kg(3.6)}` });
  assert.deepEqual(price.taxes, { label: 'Taxes à l’importation estimées', amount: 20.06, text: eur(20.06), professional: false,
    heading: 'Estimation des taxes à l’importation à La Réunion', note: 'payées à l’arrivée, comprises dans le prix', lines: [
      { key: 'om', label: 'dont estimation octroi de mer de La Réunion', amount: 10.5, text: eur(10.5) },
      { key: 'omr', label: 'dont estimation octroi de mer régional de La Réunion', amount: 2.5, text: eur(2.5) },
      { key: 'tva', label: 'dont estimation TVA à l’importation de La Réunion', amount: 7.06, text: eur(7.06) },
    ] });
  assert.deepEqual(price.fees, { label: 'Frais convenus', amount: 5, text: eur(5), lines: [{ label: 'Stockage', amount: 5, text: eur(5) }] });
  assert.deepEqual(price.savings, { label: 'Économie réalisée grâce à l’optimisation', amount: 12.4, text: eur(12.4) });
  // Never the raw columns (999 €): only the saved quote speaks.
  assert.ok(!JSON.stringify(price).includes('999'));
  // A draft keeps its state; a quote without fees nor saving shows no « 0,00 € » line.
  const draft = brouillonFiche({ ...prepared, devisBrouillon: true, devisTotal: 90.06, devisSnapshot: { ...snapshot, savings: 0, inputs: { ...snapshot.inputs, fees: [] }, amounts: { ...snapshot.amounts, fees: 0, total: 90.06 } }, quoteVersion: 1 }, ctx()).price;
  assert.deepEqual([draft.state, draft.label, draft.fees, draft.savings], ['Brouillon', `${eur(90.06)} · Brouillon`, null, null]);
  // A professional quote: transport and fees, without taxes.
  const proQuote = brouillonFiche({ ...quoted, clientId: pro.id, devisTotal: 75, devisSnapshot: { ...snapshot, inputs: { ...snapshot.inputs, client: { type: 'pro' }, destination: { code: '976', nom: 'Mayotte', tva: 0 } }, amounts: { ...snapshot.amounts, om: 0, omr: 0, tva: 0, total: 75 } } }, ctx()).price;
  assert.deepEqual(proQuote.taxes, { label: 'Taxes à l’importation estimées', amount: 0, text: 'Sans taxes (pro)', professional: true, heading: null, note: null, lines: [] });
  // A former quote without saved detail: its recorded total, the detail in the dossier.
  const former = brouillonFiche({ ...quoted, devisTotal: 80, devisSnapshot: null, quoteVersion: 0 }, ctx()).price;
  assert.deepEqual([former.known, former.detailed, former.total.amount, former.transport, former.taxes, former.message], [true, false, 80, null, null, 'Le détail de ce devis est à consulter dans le dossier.']);
});

test('without a saved quote the sheet says what the quote still needs; without the right, no price at all', () => {
  const missing = brouillonFiche({ ...measured, devisTransport: 70, devisOM: 10, economie: 12 }, ctx()).price;
  assert.deepEqual(missing, { visible: true, known: false, state: 'À calculer', label: 'À calculer', missing: ['Accord du client', 'Mesures après optimisation', 'Factures d’achat vérifiées'], message: null });
  assert.deepEqual(brouillonFiche({ ...measured, statut: 'receptionne', dimsParColis: [box(40, 30, 20, 2.5), box(30, null, 10, 1)] }, ctx()).price.missing,
    ['Mesures des cartons reçus', 'Accord du client', 'Mesures après optimisation', 'Factures d’achat vérifiées']);
  assert.deepEqual(brouillonFiche({ ...prepared, produitInterdit: true }, ctx()).price.missing, ['Produit interdit à régler']);
  const ready = brouillonFiche(prepared, ctx()).price;
  assert.deepEqual([ready.known, ready.missing, ready.message], [false, [], 'Tout est prêt pour calculer le devis.']);
  const review = brouillonFiche({ ...quoted, quoteVersion: 2 }, ctx()).price;
  assert.deepEqual([review.known, review.label, review.message], [false, 'À revoir', 'Le devis enregistré est à revoir dans le dossier.']);
  assert.deepEqual(brouillonFiche(quoted, ctx({ can: nothing })).price, { visible: false });
});

test('the sheet lists everything the quote still misses, for everyone, the complete calculation included', () => {
  const full = changes => ctx({ tarifs, categories, ...changes });
  assert.deepEqual(brouillonFiche(measured, full()).missing, ['Accord du client', 'Mesures après optimisation', 'Factures d’achat vérifiées', 'Articles et catégories à renseigner']);
  const legacy = brouillonFiche(prepared, full({ getClient: () => ({ ...flavie, type: null }), tarifs: {} }));
  assert.deepEqual(legacy.missing, ['Type de client à renseigner', 'Tarif de la destination à renseigner', 'Articles et catégories à renseigner']);
  assert.deepEqual([legacy.stage.key, legacy.stage.detail, legacy.price.missing, legacy.price.message], ['devis_a_completer', 'Type de client à renseigner', legacy.missing, null]);
  // The reviewer's case: no article; without the right to see amounts, the gaps are still listed (no amount in them).
  const hidden = brouillonFiche(prepared, full({ can: nothing }));
  assert.deepEqual([hidden.price, hidden.missing], [{ visible: false }, ['Articles et catégories à renseigner']]);
  const ready = brouillonFiche(complete, full());
  assert.deepEqual([ready.missing, ready.price.missing, ready.price.message], [[], [], 'Tout est prêt pour calculer le devis.']);
  // Without the tariffs and categories: the journey's own rules only. A known price or a paid dossier misses nothing.
  assert.deepEqual(brouillonFiche(prepared, ctx()).missing, []);
  assert.deepEqual(brouillonFiche(measured, ctx()).missing, ['Accord du client', 'Mesures après optimisation', 'Factures d’achat vérifiées']);
  assert.deepEqual([brouillonFiche(quoted, full()).missing, brouillonFiche(paid, full()).missing], [[], []]);
});

test('the sheet of a paid dossier says « Payé » with its amount, never « à payer »', () => {
  const sheet = brouillonFiche(paid, ctx());
  assert.deepEqual([sheet.price.visible, sheet.price.known, sheet.price.state, sheet.price.label, sheet.price.detailed, sheet.price.message], [true, true, 'paid', 'Payé', true, null]);
  assert.deepEqual(sheet.price.total, { label: 'Payé', amount: 95.06, text: eur(95.06) });
  assert.deepEqual([sheet.price.transport.amount, sheet.price.taxes.amount, sheet.price.fees.amount], [70, 20.06, 5], 'The detail of the quote paid.');
  assert.ok(!/payer/i.test(JSON.stringify(sheet.price)));
  assert.deepEqual(brouillonFiche({ ...paid, statut: 'livre', envoi: 'e-gone' }, ctx()).price.state, 'paid');
  assert.deepEqual(brouillonFiche(paid, ctx({ can: nothing })).price, { visible: false, state: 'paid', label: 'Payé' });
  // Paid at another amount than the quote: that amount, the detail in the dossier.
  const other = brouillonFiche({ ...paid, paiementMontant: 100 }, ctx()).price;
  assert.deepEqual([other.label, other.total, other.detailed, other.message], ['Payé', { label: 'Payé', amount: 100, text: eur(100) }, false, 'Le détail de ce devis est à consulter dans le dossier.']);
  // Nothing known of the amount: no false zero.
  assert.deepEqual(brouillonFiche({ ...measured, statut: 'expedie', envoi: 'e-gone' }, ctx()).price,
    { visible: true, known: false, state: 'paid', label: 'Payé', missing: [], message: 'Le montant réglé est à consulter dans le dossier.' });
});

test('the sheet shows the latest arrival notice of the dossier and its state', () => {
  const notices = [notice({ id: 'n-old', createdAt: '2026-10-20T10:00:00Z', items: [{ colisId: 'd-1', ref: 'EXP-AAA111', firstCarton: 1, lastCarton: 1 }] }), notice(),
    notice({ id: 'n-other', createdAt: '2026-10-28T08:00:00Z', items: [{ colisId: 'd-9', ref: 'EXP-ZZZ999', firstCarton: 1, lastCarton: 1 }] })];
  const sheet = brouillonFiche(measured, ctx({ notices }));
  assert.deepEqual([sheet.notice.id, sheet.notice.dossierCartonsLabel, sheet.notice.state.key, sheet.notice.state.label, sheet.noticeLabel], ['n-1', 'Cartons 2 et 3', 'envoye', 'Envoyé', null]);
  const without = brouillonFiche(measured, ctx({ notices: [notices[2]] }));
  assert.deepEqual([without.notice, without.noticeLabel], [null, 'Aucun avis d’arrivée']);
});

// ── Addresses of the actions ─────────────────────────────────────────────────
test('an action opens its dossier task with the way back, the reception its validation; in place or nothing: no address', () => {
  const authorised = colisRow({ ...measured, statut: 'autorise', feuVert: 'autorise' }, ctx());
  const href = colisActionHref(authorised, '/?onglet=brouillon&classer=depart');
  assert.equal(href, '/colis/d-1?returnTo=%2F%3Fonglet%3Dbrouillon%26classer%3Ddepart&section=preparation#dossier-work');
  assert.equal(workspaceReturnPath(new URL(href, 'https://pinta.invalid').search), '/?onglet=brouillon&classer=depart');
  assert.equal(colisActionHref(authorised), '/colis/d-1?returnTo=%2F&section=preparation#dossier-work');
  assert.equal(colisActionHref(authorised, 'https://evil.example/'), '/colis/d-1?returnTo=%2F&section=preparation#dossier-work', 'An outside way back is dropped.');
  assert.equal(colisActionHref(authorised, '/brouillon/d-1'), '/colis/d-1?returnTo=%2Fbrouillon%2Fd-1&section=preparation#dossier-work');
  assert.equal(colisActionHref(colisRow(measured, ctx({ pending: pendingByColis([pendingEntry('d-1', [2])]) }))), '/recevoir?client=c-flavie&valider=1');
  assert.equal(colisActionHref(colisRow(measured, ctx())), null, '« Demander l’accord » opens in place.');
  assert.equal(colisActionHref(colisRow({ ...paid, statut: 'livre', envoi: 'e-gone' }, ctx())), null, '« Rien à faire ».');
  assert.equal(colisActionHref(colisRow(quoted, ctx()), '/?onglet=a_payer'), '/colis/d-1?returnTo=%2F%3Fonglet%3Da_payer&section=paiement#dossier-work');
  assert.equal(colisActionHref(null), null);
});

// ── Measures ─────────────────────────────────────────────────────────────────
test('the measures shared by the screens: volume in m³ from centimetres, French formats, never a false zero', () => {
  assert.equal(cartonVolumeM3(box(40, 30, 20, 2)), 0.024);
  assert.equal(cartonVolumeM3({ dimL: '40', dimW: '30', dimH: '20' }), 0.024);
  for (const value of [null, {}, box(40, 0, 20, 1), box(40, -3, 20, 1), box(40, '', 20, 1)]) assert.equal(cartonVolumeM3(value), null);
  assert.equal(formatDimensions(box(40, 30.5, 20)), '40 × 30,5 × 20 cm');
  assert.equal(formatDimensions(box(40, null, 20)), 'À mesurer');
  assert.equal(formatKg(2.5), '2,5\u00a0kg');
  assert.equal(formatKg(12.345), '12,35\u00a0kg');
  for (const value of [0, null, undefined, '', -1, 'abc']) assert.equal(formatKg(value), 'À mesurer');
  assert.equal(formatM3(0.024), '0,024\u00a0m³');
  assert.equal(formatM3(0.1), '0,100\u00a0m³');
  assert.equal(formatM3(0.0234567), '0,023\u00a0m³');
  assert.equal(formatM3(0.0006), '0,001\u00a0m³');
  assert.equal(formatM3(0.0001), '<\u00a00,001\u00a0m³', 'A tiny volume is never shown as zero.');
  for (const value of [0, null, -0.5, NaN]) assert.equal(formatM3(value), 'À mesurer');
  assert.equal(MEASURE_MISSING_LABEL, 'À mesurer');
});
