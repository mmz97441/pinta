/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dossierAlerts, dossierAlertsLabel, departureAfterSubscription, subscriptionEndConfirmation } from './dossierAlerts.js';
import { calendarDateLabel } from './departureGroups.js';

// Tuesday 6 October 2026, 10:00 in Paris.
const today = Date.parse('2026-10-06T08:00:00Z');
// A client who receives our messages and can pay online: no alert.
const complete = {
  id: 'client-1', userId: 'user-1', telegramChatId: 7001, type: 'particulier',
  nom: 'Hoarau Flavie', nomFamille: 'Hoarau', prenom: 'Flavie', email: 'flavie@example.test',
  adresse: '12 rue de Paris', adresseLigne1: '12 rue de Paris', cp: '97400', ville: 'Saint-Denis', commune: '',
  abonnement: 'freemium', abonnementFin: null,
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

test('billing_incomplete lists the fields payplug-create requires, in a French sentence', () => {
  const text = clientFields => alerts({}, clientFields).find(alert => alert.key === 'billing_incomplete')?.text;
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

test('billing_incomplete stays silent for a professional or once a payment is recorded', () => {
  const missing = { email: null, adresse: '', adresseLigne1: '' };
  assert.deepEqual(alerts({}, { ...missing, type: 'pro' }), []);
  assert.deepEqual(alerts({ paiementDate: '2026-10-02T10:00:00Z' }, missing), []);
  assert.deepEqual(alerts({ paiementMontant: 120 }, missing), []);
  assert.deepEqual(alerts({ statut: 'paye' }, missing), []);
  assert.deepEqual(keys(alerts({ statut: 'devis_envoye' }, missing)), ['billing_incomplete']);
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
  assert.deepEqual(keys(list), ['no_contact', 'billing_incomplete', 'after_subscription']);
  for (const alert of list.slice(0, 2)) {
    const href = pathOf(alert.action.href);
    assert.equal(href.pathname, '/clients/client-1');
    assert.deepEqual([...href.searchParams.keys()], ['returnTo']);
    assert.equal(href.searchParams.get('returnTo'), dossierUrl.split('#')[0], 'The client page leads back to the dossier, tab and task included.');
  }
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
  assert.deepEqual(departureAfterSubscription(OCT_22, { abonnementFin: '2026-10-21' }), { departureDay: '2026-10-22', endDay: '2026-10-21' });
  assert.equal(departureAfterSubscription(OCT_22, { abonnementFin: '2026-10-22' }), null);
  assert.equal(departureAfterSubscription(OCT_22, { abonnementFin: 'bientôt' }), null);
  assert.equal(departureAfterSubscription(departure('bad', '2026-02-30'), { abonnementFin: '2026-01-01' }), null);
  assert.equal(departureAfterSubscription(OCT_22, undefined), null);
});

test('day labels without the weekday follow the Paris calendar day', () => {
  assert.equal(calendarDateLabel('2026-10-18', { today }), '18 octobre');
  assert.equal(calendarDateLabel('2026-10-01', { today }), '1er octobre');
  assert.equal(calendarDateLabel('2027-01-07', { today }), '7 janvier 2027');
  assert.equal(calendarDateLabel('2026-03-29', { today }), '29 mars', 'The spring clock change keeps the day.');
  for (const invalid of [null, undefined, '', '2026-02-30', '18/10/2026']) assert.equal(calendarDateLabel(invalid, { today }), null);
});
