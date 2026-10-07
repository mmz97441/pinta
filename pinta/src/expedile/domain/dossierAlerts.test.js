/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { consentFollowUp, dossierAlerts, dossierAlertsLabel, departureAfterSubscription, subscriptionEndConfirmation } from './dossierAlerts.js';
import { calendarDateLabel } from './departureGroups.js';

// Tuesday 6 October 2026, 10:00 in Paris.
const today = Date.parse('2026-10-06T08:00:00Z');
// A client who receives our messages, can pay online and whose record is complete: no alert.
const complete = {
  id: 'client-1', userId: 'user-1', telegramChatId: 7001, type: 'particulier',
  nom: 'Hoarau Flavie', nomFamille: 'Hoarau', prenom: 'Flavie', email: 'flavie@example.test', tel: '0692 12 34 56', telFixe: '',
  adresse: '12 rue de Paris', adresseLigne1: '12 rue de Paris', cp: '97400', ville: 'Saint-Denis', commune: '',
  abonnement: 'premium_annuel', abonnementFin: null,
};
const departure = (id, date) => ({ id, date, destinationCode: '974', ref: `ENV-${id}` });
const OCT_22 = departure('reunion-22', '2026-10-22');
const dossier = fields => ({ id: 'dossier-1', ref: 'EXP-0042', clientId: 'client-1', statut: 'autorise', archive: false, envoi: null, paiementDate: null, paiementMontant: null, ...fields });
const alerts = (dossierFields, clientFields, envoi, options) => dossierAlerts({ dossier: dossier(dossierFields), client: { ...complete, ...clientFields }, envoi, today, ...options });
const keys = list => list.map(alert => alert.key);
const pathOf = href => new URL(href, 'https://example.test');

test('a complete client with a departure inside the subscription has nothing to check', () => {
  assert.deepEqual(alerts(), []);
  assert.deepEqual(alerts({ envoi: OCT_22.id }, { abonnement: 'premium', abonnementFin: '2026-10-22' }, OCT_22), [], 'A departure on the last day is inside the subscription.');
  assert.deepEqual(dossierAlerts({ dossier: dossier(), client: undefined, today }), [], 'Without its client, nothing is asserted.');
  assert.deepEqual(dossierAlerts(), []);
});

test('no_contact: neither a client space nor Telegram, while the dossier is open and not delivered', () => {
  const [alert] = alerts({}, { userId: null, telegramChatId: null });
  assert.deepEqual({ key: alert.key, text: alert.text, label: alert.action.label }, {
    key: 'no_contact',
    text: 'Le client n’a ni espace client ni Telegram : il ne reçoit pas nos messages.',
    label: 'Inviter le client',
  });
  assert.equal(pathOf(alert.action.href).pathname, '/clients/client-1');
  assert.deepEqual(alerts({}, { userId: 'user-1', telegramChatId: null }), [], 'A client space is enough.');
  assert.deepEqual(alerts({}, { userId: null, telegramChatId: 7001 }), [], 'Telegram is enough.');
  assert.deepEqual(alerts({ archive: true }, { userId: null, telegramChatId: null }), [], 'An archived dossier expects no message.');
  assert.deepEqual(alerts({ statut: 'livre', paiementDate: '2026-10-01T08:00:00Z' }, { userId: null, telegramChatId: null }), [], 'A delivered dossier expects no message.');
  for (const statut of ['receptionne', 'attente_feu_vert', 'paye', 'transit']) assert.deepEqual(keys(alerts({ statut }, { userId: null, telegramChatId: null })), ['no_contact'], statut);
});

test('a closed dossier asks for nothing, whatever the client record', () => {
  const bare = { userId: null, telegramChatId: null, email: '', cp: '' };
  for (const fields of [{ archive: true }, { statut: 'livre' }, { statut: 'refuse_client' }, { statut: 'annule' }]) assert.deepEqual(alerts(fields, bare), [], JSON.stringify(fields));
});

test('client_incomplete lists the fields payplug-create requires, in a French sentence', () => {
  const text = clientFields => alerts({}, clientFields).find(alert => alert.key === 'client_incomplete')?.text;
  assert.equal(text({ email: null, cp: '' }), 'Fiche client incomplète pour le paiement en ligne : il manque l’email et le code postal.');
  assert.equal(text({ email: ' ' }), 'Fiche client incomplète pour le paiement en ligne : il manque l’email.', 'A blank value is missing.');
  assert.equal(text({ nomFamille: '', nom: ' Flavie', email: '', adresse: '', adresseLigne1: null, cp: null, ville: '', commune: undefined }),
    'Fiche client incomplète pour le paiement en ligne : il manque le nom, l’email, l’adresse, le code postal et la ville.');
  // The same alternatives as payplug-create: either address field, either city field.
  assert.equal(text({ adresse: '', adresseLigne1: '3 rue des Bons Enfants' }), undefined);
  assert.equal(text({ adresse: '3 rue des Bons Enfants', adresseLigne1: '' }), undefined);
  assert.equal(text({ ville: '', commune: 'Saint-Pierre' }), undefined);
  assert.equal(text({ ville: ' ', commune: 'Saint-Pierre' }), undefined);
  assert.equal(text({ nomFamille: undefined, nom: 'Hoarau' }), undefined, 'Without the family name field, the displayed name counts.');
  const [alert] = alerts({}, { email: null });
  assert.equal(alert.action.label, 'Compléter la fiche');
  assert.equal(pathOf(alert.action.href).pathname, '/clients/client-1');
});

test('client_incomplete: every record needs a prénom, a nom, an email, a téléphone and its complete address', () => {
  const alert = clientFields => alerts({}, clientFields).find(item => item.key === 'client_incomplete');
  // Every missing field, in the order of the client page; the link opens the form on the first one.
  const all = alert({ prenom: ' ', nomFamille: '', email: null, tel: '', telFixe: null, adresse: '', adresseLigne1: '', cp: '', ville: '', commune: '' });
  assert.deepEqual([all.text, all.action.label], ['Fiche client incomplète : il manque le prénom, le nom, l’email, le téléphone, l’adresse, le code postal et la ville.', 'Compléter la fiche']);
  assert.equal(pathOf(all.action.href).searchParams.get('completer'), 'prenom');
  // A field online payment does not need reads as a plain incomplete record, listing everything that is missing.
  const phoneAndAddress = alert({ tel: null, adresse: '', adresseLigne1: '' });
  assert.equal(phoneAndAddress.text, 'Fiche client incomplète : il manque le téléphone et l’adresse.');
  assert.equal(pathOf(phoneAndAddress.action.href).searchParams.get('completer'), 'telephone');
  assert.equal(alert({ prenom: '' }).text, 'Fiche client incomplète : il manque le prénom.');
  assert.equal(alert({ tel: '' }).text, 'Fiche client incomplète : il manque le téléphone.');
  // Only the payment fields missing: the online payment of the individual is what waits for them.
  const address = alert({ adresse: '', adresseLigne1: '' });
  assert.equal(address.text, 'Fiche client incomplète pour le paiement en ligne : il manque l’adresse.');
  assert.equal(pathOf(address.action.href).searchParams.get('completer'), 'adresse');
  for (const [fields, completer] of [[{ nomFamille: '' }, 'nom'], [{ email: '' }, 'email'], [{ cp: null }, 'cp'], [{ ville: '', commune: '' }, 'ville'], [{ email: '', ville: '', commune: '' }, 'email']])
    assert.equal(pathOf(alert(fields).action.href).searchParams.get('completer'), completer, JSON.stringify(fields));
  // A mobile or a landline is a téléphone.
  assert.equal(alert({ tel: '', telFixe: '0262 12 34 56' }), undefined);
  assert.equal(alert({ tel: '0692 12 34 56', telFixe: '' }), undefined);
});

test('client_incomplete reads « pour le paiement en ligne » only while the online payment of an individual is to come', () => {
  const missing = { email: null, adresse: '', adresseLigne1: '' };
  const PLAIN = 'Fiche client incomplète : il manque l’email et l’adresse.';
  const PAYMENT = 'Fiche client incomplète pour le paiement en ligne : il manque l’email et l’adresse.';
  const texts = (dossierFields, clientFields) => alerts(dossierFields, clientFields).map(alert => [alert.key, alert.text]);
  // Every record needs these fields: a professional or a paid dossier still lists them, without the online payment.
  assert.deepEqual(texts({}, { ...missing, type: 'pro' }), [['client_incomplete', PLAIN]]);
  assert.deepEqual(texts({ paiementDate: '2026-10-02T10:00:00Z' }, missing), [['client_incomplete', PLAIN]]);
  assert.deepEqual(texts({ paiementMontant: 120 }, missing), [['client_incomplete', PLAIN]]);
  assert.deepEqual(texts({ statut: 'paye' }, missing), [['client_incomplete', PLAIN]]);
  assert.deepEqual(texts({ statut: 'transit', paiementDate: '2026-10-02T10:00:00Z' }, missing), [['client_incomplete', PLAIN]], 'Until the dossier is delivered.');
  assert.deepEqual(texts({ statut: 'devis_envoye' }, missing), [['client_incomplete', PAYMENT]]);
  assert.deepEqual(texts({ statut: 'receptionne' }, missing), [['client_incomplete', PAYMENT]]);
});

test('after_subscription: a departure after the end of the subscription, before the dossier leaves', () => {
  const subscription = { abonnement: 'premium', abonnementFin: '2026-10-18' };
  const [alert] = alerts({ envoi: OCT_22.id }, subscription, OCT_22);
  assert.deepEqual({ key: alert.key, text: alert.text, label: alert.action.label }, {
    key: 'after_subscription',
    text: 'Le départ du jeudi 22 octobre est après la fin de son abonnement (18 octobre). Contactez le client.',
    label: 'Écrire au client',
  });
  for (const statut of ['receptionne', 'mesure', 'attente_feu_vert', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye']) {
    assert.deepEqual(keys(alerts({ statut, envoi: OCT_22.id, paiementDate: statut === 'paye' ? '2026-10-02T10:00:00Z' : null }, subscription, OCT_22)), ['after_subscription'], statut);
  }
  for (const statut of ['expedie', 'transit', 'livre', 'refuse_client', 'annule']) {
    assert.deepEqual(alerts({ statut, envoi: OCT_22.id, paiementDate: '2026-10-02T10:00:00Z' }, subscription, OCT_22), [], `${statut}: the dossier has left or will not leave.`);
  }
  assert.deepEqual(alerts({ envoi: OCT_22.id }, { abonnementFin: '2026-10-22' }, OCT_22), [], 'Same day: inside the subscription.');
  assert.deepEqual(alerts({ envoi: OCT_22.id }, { abonnementFin: null }, OCT_22), [], 'No end date, nothing to compare.');
  assert.deepEqual(alerts({ envoi: 'undated' }, subscription, departure('undated', null)), [], 'A departure without a date is not compared.');
  assert.deepEqual(alerts({ envoi: null }, subscription, OCT_22), [], 'Only the dossier’s own departure counts.');
  assert.deepEqual(alerts({ envoi: 'another' }, subscription, OCT_22), []);
  assert.deepEqual(keys(alerts({ envoiId: OCT_22.id }, subscription, OCT_22)), ['after_subscription'], 'The envoiId alias is understood.');
  // The year appears when it is not the current one.
  const january = departure('reunion-jan', '2027-01-07');
  assert.equal(alerts({ envoi: january.id }, { abonnementFin: '2026-12-31' }, january)[0].text,
    'Le départ du jeudi 7 janvier 2027 est après la fin de son abonnement (31 décembre). Contactez le client.');
  assert.equal(alerts({ envoi: OCT_22.id }, { abonnementFin: '2026-10-01' }, OCT_22)[0].text,
    'Le départ du jeudi 22 octobre est après la fin de son abonnement (1er octobre). Contactez le client.');
});

test('the alerts keep their order and their links lead back to the dossier as it was displayed', () => {
  const dossierUrl = '/colis/dossier-1?returnTo=%2Fcolis%3Ftable%3Ddepartures&section=paiement&action=task-7&modifier=devis#dossier-work';
  const list = alerts({ statut: 'devis_envoye', envoi: OCT_22.id }, { userId: null, telegramChatId: null, email: null, abonnementFin: '2026-10-18' }, OCT_22, { dossierUrl });
  assert.deepEqual(keys(list), ['no_contact', 'client_incomplete', 'after_subscription']);
  for (const [alert, params] of [[list[0], ['returnTo']], [list[1], ['completer', 'returnTo']]]) {
    const href = pathOf(alert.action.href);
    assert.equal(href.pathname, '/clients/client-1');
    assert.deepEqual([...href.searchParams.keys()], params);
    assert.equal(href.searchParams.get('returnTo'), dossierUrl.split('#')[0], 'The client page leads back to the dossier, tab and task included.');
  }
  assert.equal(pathOf(list[1].action.href).searchParams.get('completer'), 'email', 'The client page opens on the missing field.');
  const conversation = pathOf(list[2].action.href);
  assert.equal(conversation.pathname, '/colis/dossier-1');
  assert.deepEqual(Object.fromEntries(conversation.searchParams), { returnTo: '/colis?table=departures', section: 'paiement', action: 'task-7', onglet: 'conversation' }, 'The Conversation tab keeps the way back to the list.');
  assert.equal(conversation.hash, '');
  // Without the page, or with another page, the links use the dossier's own address.
  for (const other of [undefined, '', '/colis?table=departures', '/colis/dossier-2?returnTo=%2Fcolis', 'https://example.org/colis/dossier-1', '//example.org/colis/dossier-1']) {
    const fallback = alerts({ statut: 'devis_envoye', envoi: OCT_22.id }, { userId: null, telegramChatId: null, abonnementFin: '2026-10-18' }, OCT_22, { dossierUrl: other });
    assert.equal(fallback[0].action.href, `/clients/client-1?${new URLSearchParams({ returnTo: '/colis/dossier-1' })}`, String(other));
    assert.equal(fallback[1].action.href, '/colis/dossier-1?onglet=conversation', String(other));
  }
  const encoded = dossierAlerts({ dossier: dossier({ id: 'a/b' }), client: { ...complete, id: 'c?d', userId: null, telegramChatId: null }, today });
  assert.equal(pathOf(encoded[0].action.href).pathname, '/clients/c%3Fd');
  assert.equal(new URL(pathOf(encoded[0].action.href).searchParams.get('returnTo'), 'https://example.test').pathname, '/colis/a%2Fb');
});

test('the list mark names every alert after « À vérifier : »', () => {
  const list = alerts({ statut: 'devis_envoye' }, { userId: null, telegramChatId: null, email: null });
  assert.equal(dossierAlertsLabel(list), 'À vérifier : Le client n’a ni espace client ni Telegram : il ne reçoit pas nos messages. Fiche client incomplète pour le paiement en ligne : il manque l’email.');
});

test('assigning a departure after the end of the subscription asks for a confirmation, never blocks', () => {
  const client = { ...complete, abonnement: 'premium', abonnementFin: '2026-10-18' };
  assert.deepEqual(subscriptionEndConfirmation(OCT_22, client, { today }), {
    title: 'Affecter quand même ?',
    message: 'Le départ du jeudi 22 octobre est après la fin de l’abonnement de Flavie (18 octobre).',
    okLabel: 'Affecter quand même',
  });
  assert.equal(subscriptionEndConfirmation(departure('reunion-18', '2026-10-18'), client, { today }), null, 'The last day of the subscription needs no confirmation.');
  assert.equal(subscriptionEndConfirmation(departure('reunion-15', '2026-10-15'), client, { today }), null);
  assert.equal(subscriptionEndConfirmation(OCT_22, { ...client, abonnementFin: null }, { today }), null);
  assert.equal(subscriptionEndConfirmation(null, client, { today }), null, 'Removing the departure needs no confirmation.');
  assert.match(subscriptionEndConfirmation(OCT_22, { ...client, prenom: '', type: 'pro', raisonSociale: 'Lagon Services' }, { today }).message, /de l’abonnement de Lagon Services \(18 octobre\)\.$/);
  assert.match(subscriptionEndConfirmation(OCT_22, { ...client, prenom: ' ', raisonSociale: '', nom: 'Hoarau' }, { today }).message, /de l’abonnement de Hoarau \(/);
  assert.match(subscriptionEndConfirmation(OCT_22, { ...client, prenom: '', raisonSociale: '', nom: '' }, { today }).message, /de l’abonnement de ce client \(/);
});

test('the subscription end is compared on its calendar day', () => {
  assert.deepEqual(departureAfterSubscription(OCT_22, { abonnement: 'premium', abonnementFin: '2026-10-21' }), { departureDay: '2026-10-22', endDay: '2026-10-21' });
  assert.equal(departureAfterSubscription(OCT_22, { abonnement: 'premium', abonnementFin: '2026-10-22' }), null);
  assert.equal(departureAfterSubscription(OCT_22, { abonnement: 'premium', abonnementFin: 'bientôt' }), null);
  assert.equal(departureAfterSubscription(departure('bad', '2026-02-30'), { abonnement: 'premium', abonnementFin: '2026-01-01' }), null);
  assert.equal(departureAfterSubscription(OCT_22, undefined), null);
});

test('day labels without the weekday follow the Paris calendar day', () => {
  assert.equal(calendarDateLabel('2026-10-18', { today }), '18 octobre');
  assert.equal(calendarDateLabel('2026-10-01', { today }), '1er octobre');
  assert.equal(calendarDateLabel('2027-01-07', { today }), '7 janvier 2027');
  assert.equal(calendarDateLabel('2026-03-29', { today }), '29 mars', 'The spring clock change keeps the day.');
  for (const invalid of [null, undefined, '', '2026-02-30', '18/10/2026']) assert.equal(calendarDateLabel(invalid, { today }), null);
});

// Thursday 8 October closes, as usual, on Wednesday 7 October at 17:00 Paris: within 48 hours of today.
// Without a loading closing of its own that Wednesday is the habitual closing, and the alert says so.
const planned = (id, date) => ({ ...departure(id, date), statut: 'planifie' });
const OCT_08 = planned('reunion-08', '2026-10-08');
const OCT_15 = planned('reunion-15', '2026-10-15');
const CUTOFF = 'Accord du client à obtenir avant mercredi 7 octobre, 17 h (clôture habituelle du départ du jeudi 8 octobre).';
const MEASURE_CUTOFF = 'Cartons à mesurer puis accord du client à demander avant mercredi 7 octobre, 17 h (clôture habituelle du départ du jeudi 8 octobre).';
const TO_CREATE = 'Départ souhaité le jeudi 19 novembre : aucun départ n’est prévu ce jour-là pour la Réunion.';

test('consent_before_cutoff: consent still missing while the departure closes within 48 hours', () => {
  const [awaited] = alerts({ statut: 'attente_feu_vert', envoi: OCT_08.id }, {}, OCT_08);
  assert.deepEqual({ key: awaited.key, text: awaited.text, label: awaited.action.label }, { key: 'consent_before_cutoff', text: CUTOFF, label: 'Relancer le client' });
  const accord = pathOf(awaited.action.href);
  assert.deepEqual([accord.pathname, Object.fromEntries(accord.searchParams), accord.hash], ['/colis/dossier-1', { section: 'accord' }, '#dossier-work'], 'The link opens the accord task of the dossier.');
  assert.equal(awaited.step, 'accord');
  const [ask] = alerts({ statut: 'mesure', envoi: OCT_08.id }, {}, OCT_08);
  assert.deepEqual([ask.key, ask.step, ask.text, ask.action.label], ['consent_before_cutoff', 'accord', CUTOFF, 'Demander l’accord'], 'mesure');
  assert.equal(pathOf(ask.action.href).searchParams.get('section'), 'accord');
  // Received, not measured: the cartons are measured first (the server hint « Mesurer puis demander l’accord
  // avant la clôture du départ »), from the reception task.
  const [measure] = alerts({ statut: 'receptionne', envoi: OCT_08.id }, {}, OCT_08);
  assert.deepEqual([measure.key, measure.step, measure.text, measure.action.label], ['consent_before_cutoff', 'reception', MEASURE_CUTOFF, 'Mesurer les cartons'], 'receptionne');
  const reception = pathOf(measure.action.href);
  assert.deepEqual([reception.pathname, Object.fromEntries(reception.searchParams), reception.hash], ['/colis/dossier-1', { section: 'reception' }, '#dossier-work'], 'The link opens the reception task of the dossier.');
  // A desired day closes like its departure would, as usual.
  assert.equal(alerts({ statut: 'mesure', departSouhaite: '2026-10-09' }).find(alert => alert.key === 'consent_before_cutoff')?.text,
    'Accord du client à obtenir avant mercredi 7 octobre, 17 h (clôture habituelle du départ du vendredi 9 octobre).');
  // A loading closing set on the departure is the one that counts, and it is no habitual closing.
  const early = { ...OCT_15, loadingClosesAt: '2026-10-07T07:30:00Z' };
  assert.equal(alerts({ statut: 'mesure', envoi: early.id }, {}, early)[0]?.text, 'Accord du client à obtenir avant mercredi 7 octobre, 9 h 30 (clôture du départ du jeudi 15 octobre).');
  const set = { ...OCT_08, loadingClosesAt: '2026-10-07T15:00:00Z' };
  assert.equal(alerts({ statut: 'mesure', envoi: set.id }, {}, set)[0]?.text, 'Accord du client à obtenir avant mercredi 7 octobre, 17 h (clôture du départ du jeudi 8 octobre).');
});

test('consent_before_cutoff stays silent outside the window, during a voluntary wait or after consent', () => {
  assert.deepEqual(alerts({ statut: 'attente_feu_vert', envoi: OCT_15.id }, {}, OCT_15), [], 'Closing in more than 48 hours.');
  assert.deepEqual(alerts({ statut: 'attente_feu_vert', envoi: OCT_08.id }, {}, OCT_08, { today: Date.parse('2026-10-07T15:00:00Z') }), [], 'Closing passed.');
  assert.equal(alerts({ statut: 'attente_feu_vert', envoi: OCT_08.id }, {}, OCT_08, { today: Date.parse('2026-10-05T15:00:00Z') })[0]?.key, 'consent_before_cutoff', 'Exactly 48 hours before.');
  assert.deepEqual(alerts({ statut: 'attente_feu_vert', envoi: OCT_08.id }, {}, OCT_08, { today: Date.parse('2026-10-05T14:59:00Z') }), []);
  assert.deepEqual(alerts({ statut: 'attente_feu_vert', envoi: OCT_08.id, attenteClientDate: '2026-10-05T08:00:00Z' }, {}, OCT_08), [], 'The client asked to wait.');
  for (const statut of ['autorise', 'en_preparation', 'devis_envoye', 'paye']) assert.deepEqual(keys(alerts({ statut, envoi: OCT_08.id, paiementDate: statut === 'paye' ? '2026-10-02T10:00:00Z' : null }, {}, OCT_08)), [], statut);
  assert.deepEqual(alerts({ statut: 'attente_feu_vert', envoi: OCT_08.id }), [], 'A departure the person cannot read gives no closing.');
  assert.deepEqual(alerts({ statut: 'attente_feu_vert' }), [], 'Without a departure or a desired day there is no closing.');
});

// The consent requests and relances of a dossier, as mapMessage reads them.
const request = (id, createdAt, fields = {}) => ({ id, type: 'staff', template: 'demande_feu_vert', canal: 'telegram', statut: 'envoye', createdAt, ...fields });
const relance = (id, createdAt, fields = {}) => request(id, createdAt, { template: 'relance_feu_vert', ...fields });

test('consentFollowUp: the latest staff request or relance is followed up 24 hours from its delivery, unless it failed or was cancelled', () => {
  const followUp = (messages, now = today) => consentFollowUp({ messages }, now);
  // Without its outbox row (a portal or older message): 24 hours from its creation.
  assert.deepEqual(followUp([request('m1', '2026-10-06T06:00:00Z')]), { at: '2026-10-06T06:00:00Z', until: '2026-10-07T06:00:00.000Z', pending: false });
  assert.deepEqual(followUp([request('m1', '2026-10-05T09:00:00Z'), relance('m2', '2026-10-06T07:30:00Z')]), { at: '2026-10-06T07:30:00Z', until: '2026-10-07T07:30:00.000Z', pending: false }, 'The relance is the latest.');
  // 24 hours, end excluded (the server's end > now()).
  assert.equal(followUp([request('m1', '2026-10-05T08:00:00Z')]), null);
  assert.deepEqual(followUp([request('m1', '2026-10-05T08:01:00Z')]), { at: '2026-10-05T08:01:00Z', until: '2026-10-06T08:01:00.000Z', pending: false });
  // A failed or cancelled delivery is no follow-up, and an earlier delivered request does not take over.
  assert.equal(followUp([request('m1', '2026-10-06T05:00:00Z'), relance('m2', '2026-10-06T07:00:00Z', { statut: 'echec' })]), null);
  assert.equal(followUp([relance('m2', '2026-10-06T07:00:00Z', { statut: 'envoi', outboxStatus: 'cancelled' })]), null);
  assert.equal(followUp([relance('m2', '2026-10-06T07:00:00Z', { statut: 'envoi', outboxStatus: 'failed' })]), null);
  assert.equal(followUp([relance('m2', '2026-10-06T07:00:00Z', { statut: 'envoye', outboxStatus: 'failed' })]), null, 'The outbox decides over the message.');
  // An e-mail draft (outbox manual) and a portal message: 24 hours from their creation, the team acted.
  assert.deepEqual(followUp([relance('m2', '2026-10-06T07:00:00Z', { statut: 'envoi', canal: 'email', outboxStatus: 'manual' })]), { at: '2026-10-06T07:00:00Z', until: '2026-10-07T07:00:00.000Z', pending: false });
  assert.equal(followUp([relance('m2', '2026-10-05T07:00:00Z', { statut: 'envoi', canal: 'email', outboxStatus: 'manual' })]), null, 'A draft written 25 hours ago is no longer followed up.');
  assert.deepEqual(followUp([request('m1', '2026-10-06T07:00:00Z', { canal: 'portal', outboxStatus: 'sent', outboxSentAt: null })]).until, '2026-10-07T07:00:00.000Z', 'A portal message has no delivery instant: its creation counts.');
  for (const fields of [{ statut: 'lu' }, { statut: 'envoi' }]) assert.notEqual(followUp([relance('m2', '2026-10-06T07:00:00Z', fields)]), null, JSON.stringify(fields));
  // Other messages and unreadable dates do not count.
  assert.equal(followUp([{ id: 'm3', type: 'staff', template: null, statut: 'envoye', createdAt: '2026-10-06T07:00:00Z' }, { id: 'm4', type: 'client', template: 'client_decision_wait', createdAt: '2026-10-06T07:00:00Z' }]), null);
  assert.equal(followUp([request('m1', 'bientôt'), request('m2', null)]), null);
  assert.deepEqual(followUp([relance('m2', '2026-10-06T07:00:00Z', { statut: 'echec' }), request('m1', 'bientôt')]), null, 'An unreadable date never hides the failed latest relance.');
  // Same instant: the larger id is the latest, as the server orders them.
  assert.equal(followUp([relance('m1', '2026-10-06T07:00:00Z'), relance('m2', '2026-10-06T07:00:00Z', { statut: 'echec' })]), null);
  assert.equal(consentFollowUp({}, today), null);
  assert.equal(consentFollowUp(undefined, today), null);
  assert.equal(followUp([request('m1', '2026-10-06T06:00:00Z')], 'demain'), null);
});

test('consentFollowUp anchors the 24 hours on the delivery and holds while it is still to come', () => {
  const followUp = (messages, now = today) => consentFollowUp({ messages }, now);
  // Queued 30 hours ago, delivered 2 hours ago (notification_outbox.sent_at): 22 hours more.
  assert.deepEqual(followUp([request('m1', '2026-10-05T02:00:00Z', { outboxStatus: 'sent', outboxSentAt: '2026-10-06T06:00:00Z' })]), { at: '2026-10-05T02:00:00Z', until: '2026-10-07T06:00:00.000Z', pending: false });
  assert.equal(followUp([request('m1', '2026-10-05T02:00:00Z', { outboxStatus: 'sent', outboxSentAt: '2026-10-05T07:00:00Z' })]), null, 'Delivered 25 hours ago.');
  // Still to deliver (queued, blocked by an open conversation, rescheduled by the 24-hour client rule, being sent):
  // it holds whatever its age, until it is delivered.
  for (const outboxStatus of ['pending', 'blocked', 'sending'])
    assert.deepEqual(followUp([relance('m2', '2026-10-05T02:00:00Z', { statut: 'envoi', outboxStatus })]), { at: '2026-10-05T02:00:00Z', until: null, pending: true }, outboxStatus);
  // A retry to deliver holds over the « echec » of its first attempt.
  assert.deepEqual(followUp([relance('m2', '2026-10-06T07:00:00Z', { statut: 'echec', outboxStatus: 'pending' })]), { at: '2026-10-06T07:00:00Z', until: null, pending: true });
  // A client's message never counts, even with a consent template: the staff request decides.
  const client = (id, createdAt, template) => ({ id, type: 'client', template, canal: 'portal', statut: null, createdAt });
  assert.equal(followUp([request('m1', '2026-10-05T02:00:00Z', { outboxStatus: 'sent', outboxSentAt: '2026-10-05T02:00:00Z' }), client('c1', '2026-10-06T07:50:00Z', 'relance_feu_vert'), client('c2', '2026-10-06T07:55:00Z', 'demande_feu_vert')]), null);
  assert.equal(followUp([client('c1', '2026-10-06T07:50:00Z', 'relance_feu_vert')]), null);
});

test('consent_before_cutoff: no relance while the latest request or relance is followed up', () => {
  const awaiting = messages => alerts({ statut: 'attente_feu_vert', envoi: OCT_08.id, messages }, {}, OCT_08);
  assert.deepEqual(awaiting([request('m1', '2026-10-05T09:00:00Z'), relance('m2', '2026-10-06T07:30:00Z')]), [], 'A relance sent 30 minutes ago.');
  assert.deepEqual(awaiting([request('m1', '2026-10-05T10:00:00Z')]), [], 'A request sent 22 hours ago.');
  // After 24 hours without answer, still before the closing: the relance is back.
  assert.deepEqual(awaiting([request('m1', '2026-10-05T08:00:00Z')]).map(alert => [alert.key, alert.text, alert.action.label]), [['consent_before_cutoff', CUTOFF, 'Relancer le client']]);
  assert.deepEqual(keys(alerts({ statut: 'attente_feu_vert', envoi: OCT_08.id, messages: [request('m1', '2026-10-05T10:00:00Z')] }, {}, OCT_08, { today: Date.parse('2026-10-06T10:00:00Z') })), ['consent_before_cutoff'], 'Two hours later.');
  // A failed or cancelled relance did not reach the client: the relance is due.
  assert.deepEqual(keys(awaiting([request('m1', '2026-10-05T10:00:00Z'), relance('m2', '2026-10-06T07:00:00Z', { statut: 'echec' })])), ['consent_before_cutoff']);
  assert.deepEqual(keys(awaiting([relance('m2', '2026-10-06T07:00:00Z', { statut: 'envoi', outboxStatus: 'cancelled' })])), ['consent_before_cutoff']);
  // Queued 30 hours ago and still to deliver: no relance on top of it; delivered 2 hours ago: followed up.
  assert.deepEqual(awaiting([relance('m2', '2026-10-05T02:00:00Z', { statut: 'envoi', outboxStatus: 'pending' })]), []);
  assert.deepEqual(awaiting([relance('m2', '2026-10-05T02:00:00Z', { outboxStatus: 'sent', outboxSentAt: '2026-10-06T06:00:00Z' })]), []);
  assert.deepEqual(keys(awaiting([relance('m2', '2026-10-05T02:00:00Z', { outboxStatus: 'sent', outboxSentAt: '2026-10-05T07:00:00Z' })])), ['consent_before_cutoff'], 'Delivered 25 hours ago.');
  // A client's message with a consent template does not hide the relance.
  assert.deepEqual(keys(awaiting([request('m1', '2026-10-05T02:00:00Z'), { id: 'c1', type: 'client', template: 'relance_feu_vert', canal: 'portal', statut: null, createdAt: '2026-10-06T07:50:00Z' }])), ['consent_before_cutoff']);
  // A voluntary wait stays silent whatever the messages; a consent still to ask is never followed up (a recent message
  // belongs to an earlier set of cartons).
  assert.deepEqual(alerts({ statut: 'attente_feu_vert', envoi: OCT_08.id, attenteClientDate: '2026-10-05T08:00:00Z', messages: [request('m1', '2026-10-01T08:00:00Z')] }, {}, OCT_08), []);
  for (const [statut, label] of [['mesure', 'Demander l’accord'], ['receptionne', 'Mesurer les cartons']])
    assert.deepEqual(alerts({ statut, envoi: OCT_08.id, messages: [request('m1', '2026-10-06T07:00:00Z')] }, {}, OCT_08).map(alert => alert.action.label), [label], statut);
});

test('consent_before_cutoff: a departure that has left or is closed asks for another departure, never for consent before its closing', () => {
  // Thursday 8 October closes, as usual, on Wednesday 7 October at 17 h: inside the window. Its departure's own loading
  // closed yesterday: the day cannot be met, only another departure can.
  const closedOct08 = { ...OCT_08, loadingClosesAt: '2026-10-05T10:00:00Z' };
  for (const statut of ['receptionne', 'mesure', 'attente_feu_vert']) {
    assert.deepEqual(alerts({ statut, departSouhaite: '2026-10-08' }, {}, undefined, { envois: [closedOct08] }).map(alert => [alert.key, alert.text, alert.action.label]),
      [['departure_to_create', 'Départ souhaité le jeudi 8 octobre : le départ de ce jour pour la Réunion est clôturé.', 'Choisir un autre départ']], statut);
    assert.deepEqual(keys(alerts({ statut, departSouhaite: '2026-10-08' }, {}, undefined, { envois: [{ ...OCT_08, statut: 'parti', departedAt: '2026-10-06T06:00:00Z' }] })), ['departure_to_create'], `${statut}: left`);
  }
  // Without any departure that day, the Wednesday closing still asks for consent before it.
  assert.deepEqual(keys(alerts({ statut: 'mesure', departSouhaite: '2026-10-08' })), ['consent_before_cutoff', 'departure_to_create']);
  // Another destination's closed departure that day does not count.
  assert.deepEqual(keys(alerts({ statut: 'mesure', departSouhaite: '2026-10-08' }, {}, undefined, { envois: [{ ...closedOct08, destinationCode: '971' }] })), ['consent_before_cutoff', 'departure_to_create']);
  // An assigned departure archived or gone gives no closing either.
  for (const gone of [{ ...OCT_08, statut: 'archive' }, { ...OCT_08, statut: 'parti', departedAt: '2026-10-06T06:00:00Z' }, { ...OCT_08, departedAt: '2026-10-06T06:00:00Z' }])
    assert.deepEqual(keys(alerts({ statut: 'attente_feu_vert', envoi: gone.id }, {}, gone)), [], JSON.stringify(gone));
  assert.deepEqual(keys(alerts({ statut: 'attente_feu_vert', envoi: OCT_08.id }, {}, OCT_08)), ['consent_before_cutoff'], 'Its open departure still closes it.');
});

test('departure_to_create: a desired day without a planned departure leads to the Départ field', () => {
  const dossierUrl = '/colis/dossier-1?returnTo=%2Fcolis%3Ftable%3Ddepartures&section=accord&onglet=conversation';
  const [alert] = alerts({ statut: 'autorise', departSouhaite: '2026-11-19' }, {}, undefined, { dossierUrl });
  assert.deepEqual({ key: alert.key, text: alert.text, label: alert.action.label }, { key: 'departure_to_create', text: TO_CREATE, label: 'Choisir ou créer le départ' });
  const field = pathOf(alert.action.href);
  assert.equal(field.pathname, '/colis/dossier-1');
  assert.deepEqual(Object.fromEntries(field.searchParams), { returnTo: '/colis?table=departures', section: 'accord', modifier: 'depart' }, 'The Colis tab opens with the Départ field, the way back kept.');
  // A departure planned that day (and readable) means there is nothing to create: it is to assign.
  const nov19 = planned('reunion-19-nov', '2026-11-19');
  assert.deepEqual(keys(alerts({ statut: 'autorise', departSouhaite: '2026-11-19' }, {}, undefined, { envois: [nov19] })), ['departure_to_assign']);
  assert.deepEqual(keys(alerts({ statut: 'autorise', departSouhaite: '2026-11-19' }, {}, undefined, { envois: [{ ...nov19, destinationCode: '971' }] })), ['departure_to_create'], 'Another destination does not count.');
  assert.deepEqual(keys(alerts({ statut: 'autorise', departSouhaite: '2026-11-19' }, {}, undefined, { envois: [{ ...nov19, statut: 'archive' }] })), ['departure_to_create'], 'An archived departure does not count.');
  assert.equal(alerts({ statut: 'autorise', departSouhaite: '2026-11-19' }, { cp: '' }).find(alert => alert.key === 'departure_to_create')?.text, 'Départ souhaité le jeudi 19 novembre : aucun départ n’est prévu ce jour-là.', 'Without a known destination the sentence stops at the day.');
  assert.equal(alerts({ statut: 'paye', paiementDate: '2026-10-02T10:00:00Z', departSouhaite: '2026-11-19', devisSnapshot: { inputs: { destination: { code: '972' } } } })[0]?.text,
    'Départ souhaité le jeudi 19 novembre : aucun départ n’est prévu ce jour-là pour la Martinique.', 'Once paid, the quote destination.');
  assert.deepEqual(alerts({ statut: 'autorise', departSouhaite: '2026-11-19', envoi: OCT_15.id }, {}, OCT_15), [], 'An assigned departure replaces the desired day.');
  for (const fields of [{ statut: 'expedie' }, { statut: 'livre' }, { statut: 'annule' }, { statut: 'refuse_client' }, { archive: true }])
    assert.deepEqual(alerts({ departSouhaite: '2026-11-19', ...fields }), [], JSON.stringify(fields));
});

test('departure_to_create: a desired day whose departure is closed, has left or whose day has passed asks for another departure', () => {
  const dossierUrl = '/colis/dossier-1?returnTo=%2Fcolis';
  const nov19 = planned('reunion-19-nov', '2026-11-19');
  const closed = alerts({ statut: 'autorise', departSouhaite: '2026-11-19' }, {}, undefined, { dossierUrl, envois: [{ ...nov19, loadingClosesAt: '2026-10-05T10:00:00Z' }] });
  assert.deepEqual(closed.map(alert => [alert.key, alert.text, alert.action.label]), [['departure_to_create', 'Départ souhaité le jeudi 19 novembre : le départ de ce jour pour la Réunion est clôturé.', 'Choisir un autre départ']]);
  assert.equal(pathOf(closed[0].action.href).searchParams.get('modifier'), 'depart', 'The link opens the Départ field.');
  assert.equal(alerts({ statut: 'autorise', departSouhaite: '2026-11-19' }, {}, undefined, { envois: [{ ...nov19, statut: 'parti' }] })[0]?.text,
    'Départ souhaité le jeudi 19 novembre : le départ de ce jour pour la Réunion est déjà parti.');
  const past = alerts({ statut: 'autorise', departSouhaite: '2026-10-01' }, {}, undefined, { envois: [planned('reunion-01', '2026-10-01')] });
  assert.deepEqual(past.map(alert => [alert.key, alert.text, alert.action.label]), [['departure_to_create', 'Départ souhaité le jeudi 1er octobre : cette date est passée.', 'Choisir un autre départ']]);
  // Without a loading closing, the departure of the desired day is planned: nothing to create, even after its habitual Wednesday.
  assert.deepEqual(alerts({ statut: 'autorise', departSouhaite: '2026-10-06' }, {}, undefined, { envois: [planned('reunion-06', '2026-10-06')] }).map(alert => [alert.key, alert.text]),
    [['departure_to_assign', 'Un départ est prévu le mardi 6 octobre, jour souhaité : affectez-y le dossier.']]);
});

test('departure_to_assign: a departure planned on the desired day leads to the Départ field to assign it', () => {
  const dossierUrl = '/colis/dossier-1?returnTo=%2Fcolis%3Ftable%3Ddepartures&section=accord&onglet=conversation';
  const oct22 = planned('reunion-22', '2026-10-22');
  const [alert, ...others] = alerts({ statut: 'mesure', departSouhaite: '2026-10-22' }, {}, undefined, { dossierUrl, envois: [oct22, planned('reunion-15', '2026-10-15')] });
  assert.deepEqual(others, []);
  assert.deepEqual({ key: alert.key, text: alert.text, label: alert.action.label },
    { key: 'departure_to_assign', text: 'Un départ est prévu le jeudi 22 octobre, jour souhaité : affectez-y le dossier.', label: 'Affecter au départ' });
  const field = pathOf(alert.action.href);
  assert.equal(field.pathname, '/colis/dossier-1');
  assert.deepEqual(Object.fromEntries(field.searchParams), { returnTo: '/colis?table=departures', section: 'accord', modifier: 'depart' }, 'The Colis tab opens with the Départ field, the way back kept.');
  // Only a departure the dossier can join counts, as the server's _departure_for_day.
  assert.deepEqual(keys(alerts({ statut: 'mesure', departSouhaite: '2026-10-22' }, {}, undefined, { envois: [{ ...oct22, destinationCode: '971' }] })), ['departure_to_create']);
  assert.deepEqual(keys(alerts({ statut: 'mesure', departSouhaite: '2026-10-22' }, {}, undefined, { envois: [{ ...oct22, loadingClosesAt: '2026-10-06T07:00:00Z' }] })), ['departure_to_create']);
  assert.deepEqual(alerts({ statut: 'mesure', departSouhaite: '2026-10-22', envoi: 'reunion-22' }, {}, oct22, { envois: [oct22] }), [], 'Assigned: nothing to assign.');
  for (const fields of [{ statut: 'expedie' }, { statut: 'livre' }, { statut: 'annule' }, { archive: true }])
    assert.deepEqual(alerts({ departSouhaite: '2026-10-22', ...fields }, {}, undefined, { envois: [oct22] }), [], JSON.stringify(fields));
});

test('a desired day with its departure planned closes the consent with that departure', () => {
  // Planned on 22 October with its own loading closing on Wednesday 7 October at 9 h: within 48 hours.
  const oct22 = { ...planned('reunion-22', '2026-10-22'), loadingClosesAt: '2026-10-07T07:00:00Z' };
  assert.deepEqual(alerts({ statut: 'mesure', departSouhaite: '2026-10-22' }, {}, undefined, { envois: [oct22] }).map(alert => [alert.key, alert.text]), [
    ['consent_before_cutoff', 'Accord du client à obtenir avant mercredi 7 octobre, 9 h (clôture du départ du jeudi 22 octobre).'],
    ['departure_to_assign', 'Un départ est prévu le jeudi 22 octobre, jour souhaité : affectez-y le dossier.'],
  ]);
  // Without a loading closing, its Wednesday 17 h (21 October) is far: no consent alert.
  assert.deepEqual(keys(alerts({ statut: 'mesure', departSouhaite: '2026-10-22' }, {}, undefined, { envois: [planned('reunion-22', '2026-10-22')] })), ['departure_to_assign']);
  // A day without a departure the dossier can join keeps that day's Wednesday 17 h.
  assert.deepEqual(keys(alerts({ statut: 'mesure', departSouhaite: '2026-10-22' }, {}, undefined, { envois: [{ ...oct22, destinationCode: '971' }] })), ['departure_to_create']);
});

test('after_subscription also compares the desired day when no departure is assigned', () => {
  assert.deepEqual(alerts({ departSouhaite: '2026-10-22' }, { abonnementFin: '2026-10-18' }).map(alert => [alert.key, alert.text]), [
    ['departure_to_create', 'Départ souhaité le jeudi 22 octobre : aucun départ n’est prévu ce jour-là pour la Réunion.'],
    ['after_subscription', 'Le départ du jeudi 22 octobre est après la fin de son abonnement (18 octobre). Contactez le client.'],
  ]);
  assert.deepEqual(keys(alerts({ departSouhaite: '2026-10-22' }, { abonnementFin: '2026-10-18' }, undefined, { envois: [planned(OCT_22.id, OCT_22.date)] })), ['departure_to_assign', 'after_subscription'], 'Planned that day: to assign, and the subscription.');
  assert.deepEqual(keys(alerts({ departSouhaite: '2026-10-15' }, { abonnementFin: '2026-10-18' }, undefined, { envois: [OCT_15] })), ['departure_to_assign'], 'Inside the subscription: only the departure to assign.');
});

test('the five alerts keep their order: contact, billing, consent, departure to create, subscription', () => {
  const list = alerts({ statut: 'mesure', departSouhaite: '2026-10-08' }, { userId: null, telegramChatId: null, email: null, abonnementFin: '2026-10-01' });
  assert.deepEqual(keys(list), ['no_contact', 'client_incomplete', 'consent_before_cutoff', 'departure_to_create', 'after_subscription']);
  assert.equal(list[2].text, CUTOFF);
  assert.equal(list[3].text, 'Départ souhaité le jeudi 8 octobre : aucun départ n’est prévu ce jour-là pour la Réunion.');
  assert.equal(list[4].text, 'Le départ du jeudi 8 octobre est après la fin de son abonnement (1er octobre). Contactez le client.');
  assert.match(dossierAlertsLabel(list), /^À vérifier : Le client n’a ni espace client.* Accord du client à obtenir avant .* Départ souhaité le jeudi 8 octobre .* Contactez le client\.$/);
});

test('a Freemium client has no subscription to end: a leftover end date raises nothing', () => {
  const former = { abonnement: 'freemium', abonnementFin: '2026-10-01' };
  assert.equal(departureAfterSubscription(OCT_22, former), null);
  assert.deepEqual(keys(alerts({ envoi: OCT_22.id }, former, OCT_22)), []);
  assert.equal(subscriptionEndConfirmation(OCT_22, { ...complete, ...former }, { today }), null);
});
