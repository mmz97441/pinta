/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupDossiersByDeparture, departureDayLabel, parisCalendarDay, isoCalendarDay, NO_DEPARTURE_GROUP_KEY } from './departureGroups.js';

// Tuesday 6 October 2026, 10:00 in Paris.
const today = Date.parse('2026-10-06T08:00:00Z');
const envoi = (id, date, destinationCode, ref) => ({ id, date, destinationCode, ref });
const ENVOIS = [
  envoi('reunion-15', '2026-10-15', '974', 'ENV-2026-041'),
  envoi('guadeloupe-15', '2026-10-15', '971', 'ENV-2026-042'),
  envoi('martinique-08', '2026-10-08', '972', 'ENV-2026-043'),
  envoi('reunion-22', '2026-10-22', '974', 'ENV-2026-044'),
  envoi('reunion-01', '2026-10-01', '974', 'ENV-2026-039'),
  envoi('reunion-sept', '2026-09-17', '974', 'ENV-2026-035'),
  envoi('mayotte-undated', null, '976', 'ENV-2026-045'),
  envoi('reunion-undated', '', '974', 'ENV-2026-040'),
  envoi('empty-departure', '2026-10-09', '974', 'ENV-2026-046'),
];
const dossier = (id, envoiId) => ({ id, ref: `EXP-${id}`, envoi: envoiId || null });
const keys = groups => groups.map(group => group.key);
const ids = group => group.dossiers.map(item => item.id);

test('one group per departure, ordered: upcoming soonest first, past most recent first, undated by reference', () => {
  const dossiers = [
    dossier('a', 'reunion-sept'), dossier('b', 'reunion-15'), dossier('c', 'mayotte-undated'), dossier('d'),
    dossier('e', 'reunion-01'), dossier('f', 'guadeloupe-15'), dossier('g', 'reunion-22'), dossier('h', 'martinique-08'),
    dossier('i', 'reunion-undated'), dossier('j', 'reunion-15'),
  ];
  const groups = groupDossiersByDeparture(dossiers, ENVOIS, { today });
  assert.deepEqual(keys(groups), ['martinique-08', 'guadeloupe-15', 'reunion-15', 'reunion-22', 'reunion-01', 'reunion-sept', 'reunion-undated', 'mayotte-undated', NO_DEPARTURE_GROUP_KEY]);
  assert.equal(groups.some(group => group.key === 'empty-departure'), false, 'A departure without a listed dossier has no group.');
  assert.deepEqual(ids(groups.find(group => group.key === 'reunion-15')), ['b', 'j']);
  assert.equal(groups.reduce((sum, group) => sum + group.dossiers.length, 0), dossiers.length, 'Every dossier appears exactly once.');
});

test('each group carries its departure, a Paris day label, the destination label and the reference', () => {
  const groups = groupDossiersByDeparture([dossier('a', 'reunion-15'), dossier('b', 'reunion-01'), dossier('c', 'mayotte-undated'), dossier('d')], ENVOIS, { today });
  assert.deepEqual(groups.map(({ key, label, destinationLabel, ref }) => ({ key, label, destinationLabel, ref })), [
    { key: 'reunion-15', label: 'Départ du jeudi 15 octobre', destinationLabel: 'Réunion', ref: 'ENV-2026-041' },
    { key: 'reunion-01', label: 'Départ du jeudi 1er octobre', destinationLabel: 'Réunion', ref: 'ENV-2026-039' },
    { key: 'mayotte-undated', label: 'Date à préciser', destinationLabel: 'Mayotte', ref: 'ENV-2026-045' },
    { key: NO_DEPARTURE_GROUP_KEY, label: 'Sans départ affecté', destinationLabel: null, ref: null },
  ]);
  assert.equal(groups[0].envoi, ENVOIS[0]);
  assert.equal(groups.at(-1).envoi, null);
});

test('« Sans départ affecté » goes first with top and last otherwise', () => {
  const dossiers = [dossier('a'), dossier('b', 'reunion-15'), dossier('c')];
  for (const noDeparture of ['bottom', undefined, 'invalid']) {
    const groups = groupDossiersByDeparture(dossiers, ENVOIS, { today, noDeparture });
    assert.deepEqual(keys(groups), ['reunion-15', NO_DEPARTURE_GROUP_KEY]);
  }
  const top = groupDossiersByDeparture(dossiers, ENVOIS, { today, noDeparture: 'top' });
  assert.deepEqual(keys(top), [NO_DEPARTURE_GROUP_KEY, 'reunion-15']);
  assert.deepEqual(ids(top[0]), ['a', 'c'], 'The incoming order is kept inside the group.');
  assert.deepEqual(keys(groupDossiersByDeparture([dossier('b', 'reunion-15')], ENVOIS, { today, noDeparture: 'top' })), ['reunion-15'], 'No empty « Sans départ affecté » group.');
});

test('incoming order is kept inside every group, whatever the sort the caller applied', () => {
  const ascending = [dossier('1', 'reunion-15'), dossier('2', 'martinique-08'), dossier('3', 'reunion-15'), dossier('4', 'martinique-08')];
  const descending = [...ascending].reverse();
  const order = list => groupDossiersByDeparture(list, ENVOIS, { today }).map(ids);
  assert.deepEqual(order(ascending), [['2', '4'], ['1', '3']]);
  assert.deepEqual(order(descending), [['4', '2'], ['3', '1']]);
  const input = structuredClone(ascending);
  groupDossiersByDeparture(input, ENVOIS, { today });
  assert.deepEqual(input, ascending, 'The dossiers are not modified.');
});

test('today is the Paris calendar day: a departure today is upcoming, yesterday is past', () => {
  // 23:30 UTC on 7 October is already 8 October in Paris (UTC+2).
  const lateEvening = Date.parse('2026-10-07T22:30:00Z');
  const list = [dossier('a', 'martinique-08'), dossier('b', 'reunion-01'), dossier('c', 'reunion-15')];
  assert.deepEqual(keys(groupDossiersByDeparture(list, ENVOIS, { today: lateEvening })), ['martinique-08', 'reunion-15', 'reunion-01']);
  const nextDay = Date.parse('2026-10-08T22:30:00Z');
  assert.deepEqual(keys(groupDossiersByDeparture(list, ENVOIS, { today: nextDay })), ['reunion-15', 'martinique-08', 'reunion-01']);
  assert.deepEqual(keys(groupDossiersByDeparture(list, ENVOIS, { today: '2026-10-08' })), ['martinique-08', 'reunion-15', 'reunion-01'], 'A calendar day is accepted as today.');
});

test('same day departures are ordered by destination label then reference; ties stay stable', () => {
  const extra = [envoi('z', '2026-10-15', '974', 'ENV-2026-050'), envoi('y', '2026-10-15', null, 'ENV-2026-051'), envoi('x', '2026-10-15', '999', 'ENV-2026-052')];
  const groups = groupDossiersByDeparture([dossier('1', 'z'), dossier('2', 'reunion-15'), dossier('3', 'y'), dossier('4', 'guadeloupe-15'), dossier('5', 'x')], [...ENVOIS, ...extra], { today });
  assert.deepEqual(keys(groups), ['x', 'guadeloupe-15', 'reunion-15', 'z', 'y']);
  assert.equal(groups[0].destinationLabel, '999', 'An unknown code is shown as recorded.');
  assert.equal(groups.at(-1).destinationLabel, null, 'A departure without destination sorts last on its day.');
  const past = groupDossiersByDeparture([dossier('1', 'old-b'), dossier('2', 'old-a')], [envoi('old-b', '2026-09-01', '974', 'ENV-2026-011'), envoi('old-a', '2026-09-01', '974', 'ENV-2026-010')], { today });
  assert.deepEqual(keys(past), ['old-a', 'old-b']);
});

test('a departure the person cannot read keeps its dossiers together as « Départ à vérifier »', () => {
  const groups = groupDossiersByDeparture([dossier('a', 'hidden-1'), dossier('b', 'reunion-15'), dossier('c', 'hidden-1'), dossier('d', 'hidden-2'), dossier('e')], ENVOIS, { today });
  assert.deepEqual(keys(groups), ['reunion-15', 'hidden-1', 'hidden-2', NO_DEPARTURE_GROUP_KEY]);
  assert.deepEqual(groups.slice(1, 3).map(({ envoi: departure, label, destinationLabel, ref }) => ({ departure, label, destinationLabel, ref })), [
    { departure: null, label: 'Départ à vérifier', destinationLabel: null, ref: null },
    { departure: null, label: 'Départ à vérifier', destinationLabel: null, ref: null },
  ]);
  assert.deepEqual(ids(groups[1]), ['a', 'c']);
  assert.deepEqual(keys(groupDossiersByDeparture([{ id: 'legacy', envoiId: 'reunion-15' }], ENVOIS, { today })), ['reunion-15'], 'The envoiId alias is understood.');
  assert.deepEqual(groupDossiersByDeparture([], ENVOIS, { today }), []);
  assert.deepEqual(keys(groupDossiersByDeparture([dossier('a', 'reunion-15')], undefined, { today })), ['reunion-15']);
});

test('day labels are built in Paris from the ISO day without shifting it, with the year only when needed', () => {
  assert.equal(departureDayLabel('2026-10-15', { today }), 'jeudi 15 octobre');
  assert.equal(departureDayLabel('2026-10-01', { today }), 'jeudi 1er octobre');
  assert.equal(departureDayLabel('2026-10-25', { today }), 'dimanche 25 octobre', 'The autumn clock change keeps the day.');
  assert.equal(departureDayLabel('2026-03-29', { today }), 'dimanche 29 mars', 'The spring clock change keeps the day.');
  assert.equal(departureDayLabel('2027-01-07', { today }), 'jeudi 7 janvier 2027');
  assert.equal(departureDayLabel('2025-12-31', { today }), 'mercredi 31 décembre 2025');
  for (const invalid of [null, undefined, '', '2026-02-30', '15/10/2026', '2026-10-15T00:00:00Z', 20261015]) assert.equal(departureDayLabel(invalid, { today }), null);
  const previous = process.env.TZ;
  try {
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Indian/Reunion']) {
      process.env.TZ = zone;
      assert.equal(departureDayLabel('2026-10-15', { today }), 'jeudi 15 octobre', `Same label with the device in ${zone}.`);
      assert.equal(parisCalendarDay(Date.parse('2026-10-07T22:30:00Z')), '2026-10-08');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('calendar days are validated and instants are read on Paris time', () => {
  assert.equal(isoCalendarDay('2026-10-15'), '2026-10-15');
  for (const invalid of ['2026-13-01', '2026-02-29', '2026-10-15T10:00:00Z', 'demain', null, 42]) assert.equal(isoCalendarDay(invalid), null);
  assert.equal(parisCalendarDay('2026-10-15'), '2026-10-15');
  assert.equal(parisCalendarDay(Date.parse('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.equal(parisCalendarDay(new Date('2026-07-01T21:59:00Z')), '2026-07-01');
  assert.equal(parisCalendarDay('2026-07-01T22:00:00Z'), '2026-07-02');
  for (const invalid of [null, 'demain', NaN]) assert.equal(parisCalendarDay(invalid), null);
});

test('a desired day without a departure forms « Départ à créer », ordered by its day among the departures', () => {
  const wish = (id, day, destination) => ({ id, ref: `EXP-${id}`, envoi: null, departSouhaite: day, destination });
  const destinationOf = item => item.destination;
  const dossiers = [
    wish('w1', '2026-11-19', '974'), dossier('a', 'reunion-15'), wish('w2', '2026-10-15', '974'), dossier('b'),
    wish('w3', '2026-11-19', '974'), wish('w4', '2026-11-19', '971'), wish('w5', '2026-09-24', '974'), { id: 'c', envoi: 'reunion-22', departSouhaite: '2026-11-19' },
  ];
  const groups = groupDossiersByDeparture(dossiers, ENVOIS, { today, destinationOf });
  assert.deepEqual(keys(groups), ['wish:974:2026-10-15', 'reunion-15', 'reunion-22', 'wish:971:2026-11-19', 'wish:974:2026-11-19', 'wish:974:2026-09-24', NO_DEPARTURE_GROUP_KEY]);
  assert.deepEqual(groups.filter(group => group.wish).map(({ label, destinationLabel, ref, wish: day, envoi: departure }) => ({ label, destinationLabel, ref, day, departure })), [
    { label: 'Départ à créer du jeudi 15 octobre', destinationLabel: 'Réunion', ref: 'À créer', day: '2026-10-15', departure: null },
    { label: 'Départ à créer du jeudi 19 novembre', destinationLabel: 'Guadeloupe', ref: 'À créer', day: '2026-11-19', departure: null },
    { label: 'Départ à créer du jeudi 19 novembre', destinationLabel: 'Réunion', ref: 'À créer', day: '2026-11-19', departure: null },
    { label: 'Départ à créer du jeudi 24 septembre', destinationLabel: 'Réunion', ref: 'À créer', day: '2026-09-24', departure: null },
  ]);
  assert.deepEqual(ids(groups.find(group => group.key === 'wish:974:2026-11-19')), ['w1', 'w3'], 'One group per destination and day, in the incoming order.');
  assert.deepEqual(ids(groups.find(group => group.key === 'reunion-22')), ['c'], 'An assigned departure wins over an old desired day.');
  assert.equal(groups.reduce((sum, group) => sum + group.dossiers.length, 0), dossiers.length);
  // A wish group on the day of a departure of the same destination comes first (« À créer » before the reference).
  const sameDay = groupDossiersByDeparture([dossier('a', 'reunion-15'), wish('w', '2026-10-15', '974')], ENVOIS, { today, destinationOf });
  assert.deepEqual(keys(sameDay), ['wish:974:2026-10-15', 'reunion-15']);
  // Without a known destination the group keeps the day only.
  const unknown = groupDossiersByDeparture([wish('w', '2026-11-19')], ENVOIS, { today });
  assert.deepEqual(unknown.map(({ key, label, destinationLabel }) => ({ key, label, destinationLabel })), [{ key: 'wish::2026-11-19', label: 'Départ à créer du jeudi 19 novembre', destinationLabel: null }]);
  assert.deepEqual(keys(groupDossiersByDeparture([wish('w', 'bientôt', '974')], ENVOIS, { today, destinationOf })), [NO_DEPARTURE_GROUP_KEY], 'An unreadable day is not a wish.');
});

test('a desired day group says when its day has a departure to assign, a closed one, or has passed', () => {
  const wish = (id, day, state) => ({ id, envoi: null, departSouhaite: day, destination: '974', state });
  const groups = groupDossiersByDeparture([wish('a', '2026-11-19', 'planned'), wish('b', '2026-11-26', 'closed'), wish('c', '2026-09-24', 'past'), wish('d', '2026-12-03', 'to_create'), wish('e', '2026-12-10', 'unknown')],
    ENVOIS, { today, destinationOf: item => item.destination, wishStateOf: item => item.state });
  assert.deepEqual(groups.map(({ key, label, destinationLabel, ref, wishState }) => ({ key, label, destinationLabel, ref, wishState })), [
    { key: 'wish:974:2026-11-19', label: 'Départ souhaité le jeudi 19 novembre', destinationLabel: 'Réunion', ref: 'Départ prévu, à affecter', wishState: 'planned' },
    { key: 'wish:974:2026-11-26', label: 'Départ souhaité le jeudi 26 novembre', destinationLabel: 'Réunion', ref: 'Départ clôturé', wishState: 'closed' },
    { key: 'wish:974:2026-12-03', label: 'Départ à créer du jeudi 3 décembre', destinationLabel: 'Réunion', ref: 'À créer', wishState: 'to_create' },
    { key: 'wish:974:2026-12-10', label: 'Départ à créer du jeudi 10 décembre', destinationLabel: 'Réunion', ref: 'À créer', wishState: 'to_create' },
    { key: 'wish:974:2026-09-24', label: 'Départ souhaité le jeudi 24 septembre', destinationLabel: 'Réunion', ref: 'Date passée', wishState: 'past' },
  ], 'The key stays the same whatever the state, so a folded group stays folded.');
});
