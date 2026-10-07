/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closedDepartureWording, closingLabel, consentRelanceOpen, departureClosing, departureClosingHabitual, departureDefaultClosing, departureEditable,
  departureFieldEditable, departureFieldText, departureForDate, departureIssue, departureMatchesText, departureOptionLabel, departuresOfDay,
  destinationName, dossierDepartureClosing, dossierDepartureWish, dossierDestinationCode, dossierWishState, matchTypedDate, parisInstant,
  plannedDeparturesFor, wishedDepartureLabel, WISH_STATE_LABELS,
} from './departurePlanning.js';

// Tuesday 6 October 2026, 10:00 in Paris.
const today = Date.parse('2026-10-06T08:00:00Z');
const envoi = (id, date, fields = {}) => ({ id, ref: `ENV-${id}`, date, destinationCode: '974', statut: 'planifie', loadingClosesAt: null, departedAt: null, ...fields });
const reunion = { cp: '97400' };

test('the default closing is the last Wednesday strictly before the departure, at 17:00 Paris', () => {
  assert.equal(departureDefaultClosing('2026-10-08'), '2026-10-07T15:00:00.000Z', 'Thursday: the day before.');
  assert.equal(departureDefaultClosing('2026-10-09'), '2026-10-07T15:00:00.000Z', 'Friday: two days before.');
  assert.equal(departureDefaultClosing('2026-10-07'), '2026-09-30T15:00:00.000Z', 'Wednesday: seven days before.');
  for (const day of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) assert.equal(departureDefaultClosing(day), '2026-10-07T15:00:00.000Z', day);
  for (const invalid of [null, undefined, '', '2026-02-30', '08/10/2026', '2026-10-08T00:00:00Z']) assert.equal(departureDefaultClosing(invalid), null);
});

test('the default closing keeps 17:00 Paris across both clock changes', () => {
  // Autumn 2026: summer time ends on Sunday 25 October.
  assert.equal(departureDefaultClosing('2026-10-22'), '2026-10-21T15:00:00.000Z', 'Summer time: UTC+2.');
  assert.equal(departureDefaultClosing('2026-10-26'), '2026-10-21T15:00:00.000Z', 'The Monday after the change still closes on the summer Wednesday.');
  assert.equal(departureDefaultClosing('2026-10-29'), '2026-10-28T16:00:00.000Z', 'Winter time: UTC+1.');
  // Spring 2026: summer time starts on Sunday 29 March.
  assert.equal(departureDefaultClosing('2026-03-26'), '2026-03-25T16:00:00.000Z');
  assert.equal(departureDefaultClosing('2026-03-30'), '2026-03-25T16:00:00.000Z');
  assert.equal(departureDefaultClosing('2026-04-02'), '2026-04-01T15:00:00.000Z');
  assert.equal(new Date(parisInstant('2026-03-29', 17)).toISOString(), '2026-03-29T15:00:00.000Z');
  assert.equal(new Date(parisInstant('2026-10-25', 17)).toISOString(), '2026-10-25T16:00:00.000Z');
  const previous = process.env.TZ;
  try {
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Indian/Reunion']) {
      process.env.TZ = zone;
      assert.equal(departureDefaultClosing('2026-10-29'), '2026-10-28T16:00:00.000Z', `Same closing with the device in ${zone}.`);
      assert.equal(closingLabel('2026-10-28T16:00:00.000Z', { today }), 'mercredi 28 octobre, 17 h');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('a departure shows its own loading closing, otherwise the habitual Wednesday', () => {
  assert.equal(departureClosing(envoi('a', '2026-10-15')), '2026-10-14T15:00:00.000Z');
  assert.equal(departureClosingHabitual(envoi('a', '2026-10-15')), true, 'Without a loading closing, the Wednesday 17 h is the habitual closing.');
  assert.equal(departureClosing(envoi('a', '2026-10-15', { loadingClosesAt: '2026-10-14T13:30:00Z' })), '2026-10-14T13:30:00.000Z');
  assert.equal(departureClosingHabitual(envoi('a', '2026-10-15', { loadingClosesAt: '2026-10-14T13:30:00Z' })), false);
  assert.equal(departureClosing(envoi('a', null)), null, 'An undated departure has no closing.');
  assert.equal(closingLabel('2026-10-07T15:00:00Z', { today }), 'mercredi 7 octobre, 17 h');
  assert.equal(closingLabel('2026-10-14T07:30:00Z', { today }), 'mercredi 14 octobre, 9 h 30');
  assert.equal(closingLabel('2027-01-06T16:00:00Z', { today }), 'mercredi 6 janvier 2027, 17 h', 'The year appears when it is not the current one.');
  assert.equal(closingLabel(null, { today }), null);
});

test('the destination is the client postcode, or the paid quote, never Réunion by default', () => {
  assert.equal(dossierDestinationCode({ statut: 'mesure' }, reunion), '974');
  assert.equal(dossierDestinationCode({ statut: 'mesure' }, { cp: '97600' }), '976');
  assert.equal(dossierDestinationCode({ statut: 'mesure' }, {}), null);
  assert.equal(dossierDestinationCode({ statut: 'mesure', devisSnapshot: { inputs: { destination: { code: '974' } } } }, { cp: '97600' }), '976', 'Before payment the client decides.');
  assert.equal(dossierDestinationCode({ statut: 'paye', paiementDate: '2026-10-02T10:00:00Z', devisSnapshot: { inputs: { destination: { code: '974' } } } }, { cp: '97600' }), '974', 'Once paid the quote decides.');
  assert.equal(dossierDestinationCode({ statut: 'paye', paiementDate: '2026-10-02T10:00:00Z' }, { cp: '97200' }), '972');
  assert.deepEqual(['974', '976', '971', '972', '999'].map(destinationName), ['la Réunion', 'Mayotte', 'la Guadeloupe', 'la Martinique', null]);
});

test('planned departures follow the server rule (guard_colis_departure) and come soonest first', () => {
  const envois = [
    envoi('reunion-22', '2026-10-22'),
    envoi('reunion-15', '2026-10-15', { loadingClosesAt: '2026-10-14T13:30:00Z' }),
    envoi('reunion-08', '2026-10-08'),
    envoi('reunion-07-closed', '2026-10-07', { loadingClosesAt: '2026-10-06T06:00:00Z' }),
    envoi('reunion-07-open', '2026-10-07', { loadingClosesAt: '2026-10-07T16:00:00Z' }),
    envoi('reunion-past', '2026-10-01'),
    envoi('guadeloupe-15', '2026-10-15', { destinationCode: '971' }),
    envoi('reunion-parti', '2026-10-22', { statut: 'parti' }),
    envoi('reunion-archive', '2026-10-22', { statut: 'archive' }),
    envoi('reunion-departed', '2026-10-29', { departedAt: '2026-10-05T10:00:00Z' }),
    envoi('reunion-pret', '2026-10-29', { statut: 'pret', ref: 'ENV-B' }),
    envoi('reunion-prochain', '2026-10-29', { statut: 'prochain', ref: 'ENV-A' }),
    envoi('reunion-undated', null),
  ];
  assert.deepEqual(plannedDeparturesFor({ statut: 'mesure' }, reunion, envois, today).map(item => item.id),
    ['reunion-07-open', 'reunion-08', 'reunion-15', 'reunion-22', 'reunion-prochain', 'reunion-pret']);
  // Without a loading closing a departure stays open until its day: its habitual Wednesday never closes it.
  assert.deepEqual(plannedDeparturesFor({ statut: 'mesure' }, reunion, [envoi('x', '2026-10-07')], today).map(item => item.id), ['x'], 'Its habitual Wednesday (30 September) has passed.');
  for (const at of ['2026-10-07T14:59:00Z', '2026-10-07T15:00:00Z', '2026-10-08T07:00:00Z', '2026-10-08T21:59:00Z'])
    assert.deepEqual(plannedDeparturesFor({}, reunion, [envoi('reunion-08', '2026-10-08')], Date.parse(at)).map(item => item.id), ['reunion-08'], `Offered at ${at}, up to the end of its day in Paris.`);
  assert.deepEqual(plannedDeparturesFor({}, reunion, [envoi('reunion-08', '2026-10-08')], Date.parse('2026-10-08T22:00:00Z')), [], 'Midnight in Paris: its day has passed.');
  // An explicit loading closing closes it, to the minute.
  const closing = envoi('reunion-15', '2026-10-15', { loadingClosesAt: '2026-10-06T08:00:00Z' });
  assert.deepEqual(plannedDeparturesFor({}, reunion, [closing], Date.parse('2026-10-06T07:59:00Z')).map(item => item.id), ['reunion-15']);
  assert.deepEqual(plannedDeparturesFor({}, reunion, [closing], today), [], 'Its loading closing has passed.');
  // Late on 7 October in UTC it is already 8 October in Paris.
  assert.deepEqual(plannedDeparturesFor({}, reunion, [envoi('today', '2026-10-07', { loadingClosesAt: '2026-10-08T20:00:00Z' })], Date.parse('2026-10-07T22:30:00Z')), []);
  assert.deepEqual(plannedDeparturesFor({}, {}, envois, today), [], 'Without a destination nothing is proposed.');
  assert.deepEqual(plannedDeparturesFor({ statut: 'paye', paiementDate: '2026-10-02T10:00:00Z', devisSnapshot: { inputs: { destination: { code: '971' } } } }, reunion, envois, today).map(item => item.id), ['guadeloupe-15']);
  assert.equal(departureForDate(envois, '2026-10-15')?.id, 'reunion-15');
  assert.equal(departureForDate(envois, '2026-10-16'), null);
  assert.equal(departureForDate(envois, 'demain'), null);
});

test('departureIssue tells why a departure cannot take the dossier, as the server refuses it', () => {
  const paid = { statut: 'paye', paiementDate: '2026-10-02T10:00:00Z', devisSnapshot: { inputs: { destination: { code: '974' } } } };
  const issue = (fields, dossier = { statut: 'mesure' }, client = reunion) => departureIssue(fields && envoi('a', '2026-10-15', fields), dossier, client, today);
  assert.equal(issue({}), null);
  assert.equal(issue({ statut: 'pret', loadingClosesAt: '2026-10-06T08:01:00Z' }), null);
  assert.equal(issue(null), 'Départ introuvable');
  assert.equal(issue({}, { statut: 'mesure' }, {}), 'Destination du client inconnue');
  assert.equal(issue({ destinationCode: '971' }), 'Destination différente de celle du client');
  assert.equal(issue({ destinationCode: '971' }, paid, { cp: '97100' }), 'Destination différente du devis payé', 'Once paid, the quote destination.');
  assert.equal(issue({}, paid, { cp: '97100' }), null, 'The paid quote wins over a postcode changed since.');
  for (const fields of [{ statut: 'parti' }, { statut: 'arrive' }, { statut: 'archive' }, { departedAt: '2026-10-05T10:00:00Z' }]) assert.equal(issue(fields), 'Départ déjà parti, arrivé ou archivé', JSON.stringify(fields));
  assert.equal(departureIssue(envoi('a', '2026-10-05'), {}, reunion, today), 'Date de départ dépassée ou absente');
  assert.equal(departureIssue(envoi('a', null), {}, reunion, today), 'Date de départ dépassée ou absente');
  assert.equal(issue({ loadingClosesAt: '2026-10-06T08:00:00Z' }), 'Chargement clôturé');
  assert.equal(departureIssue(envoi('a', '2026-10-06'), {}, reunion, today), null, 'Today, without a loading closing: open.');
  assert.equal(closedDepartureWording(envoi('a', '2026-10-15', { loadingClosesAt: '2026-10-06T07:00:00Z' })), 'est clôturé');
  assert.equal(closedDepartureWording(envoi('a', '2026-10-15', { statut: 'parti' })), 'est déjà parti');
  assert.equal(closedDepartureWording(envoi('a', '2026-10-15', { departedAt: '2026-10-05T10:00:00Z' })), 'est déjà parti');
});

test('every departure of a day counts for that day, open or not, archived ones aside', () => {
  const envois = [
    envoi('open', '2026-10-15'), envoi('closed', '2026-10-15', { loadingClosesAt: '2026-10-06T06:00:00Z' }), envoi('left', '2026-10-16', { statut: 'parti' }),
    envoi('archived', '2026-10-17', { statut: 'archive' }), envoi('guadeloupe', '2026-10-17', { destinationCode: '971' }),
  ];
  assert.deepEqual(departuresOfDay({}, reunion, envois, '2026-10-15').map(item => item.id), ['open', 'closed']);
  assert.deepEqual(departuresOfDay({}, reunion, envois, '2026-10-16').map(item => item.id), ['left']);
  assert.deepEqual(departuresOfDay({}, reunion, envois, '2026-10-17'), [], 'An archived departure and another destination do not count.');
  assert.deepEqual(departuresOfDay({}, {}, envois, '2026-10-15'), [], 'Without a destination, no departure is that day’s.');
  assert.deepEqual(departuresOfDay({}, reunion, envois, 'demain'), []);
});

test('options name the day and the closing, the habitual one as such; typing filters them', () => {
  assert.equal(departureOptionLabel(envoi('a', '2026-10-08'), { today }), 'jeudi 8 octobre · clôture habituelle mercredi 7 octobre, 17 h');
  assert.equal(departureOptionLabel(envoi('a', '2026-10-15', { loadingClosesAt: '2026-10-14T13:30:00Z' }), { today }), 'jeudi 15 octobre · clôture mercredi 14 octobre, 15 h 30');
  assert.equal(departureOptionLabel(envoi('a', '2026-10-15', { loadingClosesAt: '2026-10-14T15:00:00Z' }), { today }), 'jeudi 15 octobre · clôture mercredi 14 octobre, 17 h', 'A loading closing set on Wednesday 17 h is enforced.');
  assert.equal(departureOptionLabel(envoi('a', '2027-01-07'), { today }), 'jeudi 7 janvier 2027 · clôture habituelle mercredi 6 janvier 2027, 17 h');
  const departure = envoi('a', '2026-10-22', { ref: 'ENV-2026-044' });
  for (const text of ['', 'jeudi', 'Jeudi 22', '22 oct', '22/10', 'cloture', 'habituelle', 'env-2026-044']) assert.equal(departureMatchesText(departure, text, { today }), true, text);
  for (const text of ['vendredi', '23/10', 'novembre']) assert.equal(departureMatchesText(departure, text, { today }), false, text);
});

test('a typed date is read on Paris time, from today', () => {
  const read = text => matchTypedDate(text, { today });
  assert.equal(read('23/10'), '2026-10-23');
  assert.equal(read('23/10/2026'), '2026-10-23');
  assert.equal(read('23/10/27'), '2027-10-23');
  assert.equal(read('23 octobre'), '2026-10-23');
  assert.equal(read('23 Octobre 2027'), '2027-10-23');
  assert.equal(read('23 oct.'), '2026-10-23');
  assert.equal(read('jeudi 22'), '2026-10-22', 'The next 22nd.');
  assert.equal(read('jeu. 22'), '2026-10-22');
  // A weekday never moves the date: the next such day, the label then names its real weekday.
  assert.equal(read('jeudi 23'), '2026-10-23', 'The next 23rd, a Friday: never a Thursday eleven months ahead.');
  assert.equal(read('vendredi 23'), '2026-10-23');
  assert.equal(read('mardi 6'), '2026-10-06', 'Today is still to come.');
  assert.equal(read('jeudi 5'), '2026-11-05', 'The 5th of October has passed.');
  assert.equal(read('samedi 31'), '2026-10-31');
  assert.equal(matchTypedDate('jeudi 31', { today: Date.parse('2026-11-01T09:00:00Z') }), '2026-12-31', 'November has no 31st.');
  assert.equal(read('jeudi 22 octobre'), '2026-10-22');
  assert.equal(read('lundi 22 octobre'), '2026-10-22', 'A weekday that contradicts the date is ignored.');
  assert.equal(read('1er novembre'), '2026-11-01');
  assert.equal(read('22.10'), '2026-10-22');
  assert.equal(read('2026-10-23'), '2026-10-23');
  assert.equal(read('6/10'), '2026-10-06', 'Today is still to come.');
  assert.equal(read('5/10'), '2027-10-05', 'A day already past means next year.');
  assert.equal(read('29/02'), '2028-02-29', 'The next 29 February.');
  for (const invalid of ['', 'demain', '23', '32/10', '23/13', '31/11/2026', 'jeudi', 'jour 23', '23 brumaire', 'ju 23', null, undefined]) assert.equal(read(invalid), null, String(invalid));
  // 22:30 UTC on 5 October is already 6 October in Paris.
  assert.equal(matchTypedDate('5/10', { today: Date.parse('2026-10-05T22:30:00Z') }), '2027-10-05');
  assert.equal(matchTypedDate('5/10', { today: Date.parse('2026-10-05T21:30:00Z') }), '2026-10-05');
});

test('the dossier names its departure, its desired day or what is still to choose', () => {
  const envois = [envoi('reunion-08', '2026-10-08'), envoi('undated', null, { destinationCode: '976' })];
  assert.deepEqual(departureFieldText({ envoi: 'reunion-08' }, envois, { today }), { state: 'assigned', prefix: 'Départ', value: 'jeudi 8 octobre · Réunion' });
  assert.deepEqual(departureFieldText({ envoi: 'undated' }, envois, { today }), { state: 'assigned', prefix: 'Départ', value: 'date à préciser · Mayotte' });
  assert.deepEqual(departureFieldText({ envoi: 'hidden' }, envois, { today }), { state: 'unknown', prefix: 'Départ', value: 'à vérifier' });
  assert.deepEqual(departureFieldText({ departSouhaite: '2026-11-19' }, envois, { today, client: reunion }), { state: 'wish', wishState: 'to_create', prefix: 'Départ souhaité', value: 'jeudi 19 novembre · à créer' });
  assert.deepEqual(departureFieldText({}, envois, { today }), { state: 'none', prefix: 'Départ', value: 'à choisir' });
  assert.equal(wishedDepartureLabel({ departSouhaite: '2026-11-19' }, { now: today }), 'Souhaité le 19/11/2026 · à créer');
  assert.equal(wishedDepartureLabel({ departSouhaite: '2026-11-19', envoi: 'reunion-08' }, { now: today }), null, 'An assigned departure replaces the wish.');
  assert.equal(wishedDepartureLabel({ departSouhaite: 'bientôt' }, { now: today }), null);
  assert.equal(dossierDepartureWish({ departSouhaite: '2026-11-19', envoiId: 'reunion-08' }), null);
});

test('a desired day says what it stands for: to create, planned and to assign, closed, or past', () => {
  const wish = day => ({ statut: 'autorise', departSouhaite: day });
  const state = (day, envois, now = today) => { const found = dossierWishState(wish(day), reunion, envois, now); return found && [found.state, found.envoi?.id ?? null]; };
  const nov19 = envoi('reunion-19-nov', '2026-11-19');
  assert.deepEqual(state('2026-11-19', []), ['to_create', null]);
  assert.deepEqual(state('2026-11-19', [nov19]), ['planned', 'reunion-19-nov']);
  assert.deepEqual(state('2026-11-19', [{ ...nov19, destinationCode: '971' }]), ['to_create', null], 'Another destination does not count.');
  assert.deepEqual(state('2026-11-19', [{ ...nov19, statut: 'archive' }]), ['to_create', null], 'An archived departure does not count.');
  assert.deepEqual(state('2026-11-19', [{ ...nov19, loadingClosesAt: '2026-10-06T07:00:00Z' }]), ['closed', 'reunion-19-nov']);
  assert.deepEqual(state('2026-11-19', [{ ...nov19, statut: 'parti' }]), ['closed', 'reunion-19-nov']);
  assert.deepEqual(state('2026-10-06', [envoi('today', '2026-10-06')]), ['planned', 'today'], 'Today without a loading closing: still planned.');
  assert.deepEqual(state('2026-10-01', [envoi('first', '2026-10-01')]), ['past', null]);
  assert.equal(dossierWishState({ envoi: 'reunion-08', departSouhaite: '2026-11-19' }, reunion, [nov19], today), null);
  const label = (day, envois) => wishedDepartureLabel(wish(day), { client: reunion, envois, now: today });
  assert.deepEqual([label('2026-11-19', []), label('2026-11-19', [nov19]), label('2026-11-19', [{ ...nov19, statut: 'parti' }]), label('2026-10-01', [])],
    ['Souhaité le 19/11/2026 · à créer', 'Souhaité le 19/11/2026 · départ prévu, à affecter', 'Souhaité le 19/11/2026 · départ clôturé', 'Souhaité le 01/10/2026 · date passée']);
  const field = (day, envois) => departureFieldText(wish(day), envois, { today, client: reunion });
  assert.deepEqual(field('2026-11-19', [nov19]), { state: 'wish', wishState: 'planned', prefix: 'Départ souhaité', value: 'jeudi 19 novembre · départ prévu, à affecter' });
  assert.deepEqual(field('2026-10-01', []), { state: 'wish', wishState: 'past', prefix: 'Départ souhaité', value: 'jeudi 1er octobre · date passée' });
  assert.deepEqual(Object.keys(WISH_STATE_LABELS), ['to_create', 'planned', 'closed', 'past']);
});

test('the Départ field opens with the server permissions and the planning in view', () => {
  const rights = (...granted) => permission => granted.includes(permission);
  assert.equal(departureFieldEditable({ statut: 'mesure' }, rights('perm_colis_affecter_envoi', 'perm_envois_voir')), true);
  assert.equal(departureFieldEditable({ statut: 'mesure' }, rights('perm_colis_affecter_envoi')), false, 'Choosing needs to see the departures.');
  assert.equal(departureFieldEditable({ statut: 'mesure' }, rights('perm_envois_creer', 'perm_envois_voir')), false, 'Creating departures does not assign one.');
  assert.equal(departureFieldEditable({ statut: 'mesure', envoi: 'reunion-08' }, rights('perm_colis_affecter_envoi', 'perm_envois_voir')), false, 'An assigned departure needs perm_envois_reaffecter.');
  assert.equal(departureFieldEditable({ statut: 'mesure', envoi: 'reunion-08' }, rights('perm_envois_reaffecter', 'perm_envois_voir')), true);
  assert.equal(departureFieldEditable({ statut: 'expedie' }, () => true), false);
  assert.equal(departureFieldEditable(null, () => true), false);
});

test('the departure can change at every step until the parcel leaves', () => {
  for (const statut of ['receptionne', 'mesure', 'attente_feu_vert', 'refuse_client', 'autorise', 'en_preparation', 'devis_envoye', 'attente_paiement', 'paye'])
    assert.equal(departureEditable({ statut }), true, statut);
  for (const statut of ['expedie', 'transit', 'dedouanement', 'arrive', 'livraison', 'livre', 'annule', 'inconnu', undefined])
    assert.equal(departureEditable({ statut }), false, String(statut));
  assert.equal(departureEditable({ statut: 'paye', archive: true }), false);
  assert.equal(departureEditable({ statut: 'paye', dateExpedition: '2026-10-05T10:00:00Z' }), false, 'A recorded expedition freezes the departure.');
});

test('the consent closing is the departure closing, or the closing of the desired day', () => {
  const assigned = envoi('reunion-08', '2026-10-08');
  assert.deepEqual(dossierDepartureClosing({ envoi: 'reunion-08' }, assigned), { closing: '2026-10-07T15:00:00.000Z', day: '2026-10-08', habitual: true });
  assert.deepEqual(dossierDepartureClosing({ envoi: 'reunion-08' }, { ...assigned, loadingClosesAt: '2026-10-07T13:00:00Z' }), { closing: '2026-10-07T13:00:00.000Z', day: '2026-10-08', habitual: false });
  assert.equal(dossierDepartureClosing({ envoi: 'reunion-08' }, null), null, 'An unreadable departure gives no closing.');
  assert.deepEqual(dossierDepartureClosing({ departSouhaite: '2026-10-09' }), { closing: '2026-10-07T15:00:00.000Z', day: '2026-10-09', habitual: true });
  assert.equal(dossierDepartureClosing({}), null);
  // A departure the dossier can join planned on its desired day closes it, as _departure_for_day assigns it.
  const wish = { statut: 'mesure', departSouhaite: '2026-10-22' };
  const oct22 = envoi('reunion-22', '2026-10-22', { loadingClosesAt: '2026-10-07T07:00:00Z' });
  const closingOf = (envois, now = today) => dossierDepartureClosing(wish, null, { client: reunion, envois, now });
  assert.deepEqual(closingOf([oct22]), { closing: '2026-10-07T07:00:00.000Z', day: '2026-10-22', habitual: false }, 'Its own loading closing.');
  assert.deepEqual(closingOf([{ ...oct22, loadingClosesAt: null }]), { closing: '2026-10-21T15:00:00.000Z', day: '2026-10-22', habitual: true }, 'Its Wednesday 17 h.');
  for (const [other, label] of [[{ ...oct22, destinationCode: '971' }, 'another destination'], [{ ...oct22, statut: 'parti' }, 'gone'], [{ ...oct22, loadingClosesAt: '2026-10-06T07:00:00Z' }, 'loading closed'],
    [{ ...oct22, date: '2026-10-23' }, 'another day'], [{ ...oct22, statut: 'archive' }, 'archived']])
    assert.deepEqual(closingOf([other]), { closing: '2026-10-21T15:00:00.000Z', day: '2026-10-22', habitual: true }, `${label}: the day's Wednesday 17 h.`);
  // Two departures that day: the lowest id, like the server (ORDER BY e.id).
  assert.equal(closingOf([{ ...oct22, id: 'reunion-22-b', ref: 'ENV-A', loadingClosesAt: '2026-10-07T09:00:00Z' }, { ...oct22, id: 'reunion-22-a', ref: 'ENV-B' }]).closing, '2026-10-07T07:00:00.000Z');
  assert.deepEqual(dossierDepartureClosing(wish, null, { envois: [oct22] }), { closing: '2026-10-21T15:00:00.000Z', day: '2026-10-22', habitual: true }, 'Without the client the destination is unknown: the Wednesday rule.');
  assert.deepEqual(dossierDepartureClosing({ ...wish, envoi: 'reunion-08' }, assigned, { client: reunion, envois: [oct22] }), { closing: '2026-10-07T15:00:00.000Z', day: '2026-10-08', habitual: true }, 'An assigned departure wins.');
  // The 48 hours before the closing, closing excluded.
  assert.equal(consentRelanceOpen('2026-10-07T15:00:00Z', Date.parse('2026-10-05T15:00:00Z')), true);
  assert.equal(consentRelanceOpen('2026-10-07T15:00:00Z', Date.parse('2026-10-05T14:59:00Z')), false);
  assert.equal(consentRelanceOpen('2026-10-07T15:00:00Z', Date.parse('2026-10-07T14:59:00Z')), true);
  assert.equal(consentRelanceOpen('2026-10-07T15:00:00Z', Date.parse('2026-10-07T15:00:00Z')), false);
  assert.equal(consentRelanceOpen(null, today), false);
});
