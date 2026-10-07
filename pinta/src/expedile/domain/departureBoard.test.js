/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignmentFailure, confirmedLine, countLabel, departureClosingLine, departureDeparted, departureEditErrors, departureInView, departureOverdue,
  departureStateLabel, formatKg, loadableDossiers, planningErrors, preparedSummary, sortDepartures, weeklyDepartures, wishedDossiersFor,
} from './departureBoard.js';

// Wednesday 7 October 2026, 23:30 in Paris: already Thursday 8 in Réunion, still 17:30 in New York.
const NOW = Date.parse('2026-10-07T21:30:00Z');
const envoi = (id, date, fields = {}) => ({ id, ref: `ENV-${id}`, date, destinationCode: '974', statut: 'planifie', loadingClosesAt: null, departedAt: null, manifestVersion: 0, ...fields });
const departed = { statut: 'parti', departedAt: '2026-10-01T06:00:00Z', manifestVersion: 1 };
const ZONES = ['Europe/Paris', 'Indian/Reunion', 'America/New_York'];
function inEveryZone(check) {
  const previous = process.env.TZ;
  try { for (const zone of ZONES) { process.env.TZ = zone; check(zone); } }
  finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
}

test('« today » is the Paris day: a departure of 7 October is not overdue at 23:30 in Paris, anywhere', () => inEveryZone(zone => {
  assert.equal(departureOverdue(envoi('today', '2026-10-07'), NOW), false, zone);
  assert.equal(departureOverdue(envoi('yesterday', '2026-10-06'), NOW), true, zone);
  assert.equal(departureOverdue(envoi('next', '2026-10-08'), NOW), false, zone);
  assert.equal(departureOverdue(envoi('left', '2026-10-01', departed), NOW), false, 'A departure that left is never overdue.');
  assert.equal(departureOverdue(envoi('archived', '2026-09-01', { statut: 'archive' }), NOW), false);
  assert.equal(departureOverdue(envoi('undated', null), NOW), false);
}));

test('to prepare: overdue departures first, oldest first, then the coming ones, undated last', () => inEveryZone(() => {
  const list = [envoi('c', '2026-10-15'), envoi('u', null), envoi('o2', '2026-10-03'), envoi('t', '2026-10-07'), envoi('o1', '2026-09-30'), envoi('b', '2026-10-15', { ref: 'ENV-a' })];
  assert.deepEqual(sortDepartures(list, 'a-preparer', NOW).map(item => item.id), ['o1', 'o2', 't', 'b', 'c', 'u']);
  assert.deepEqual(sortDepartures(list, 'partis', NOW).map(item => item.id), ['b', 'c', 't', 'o2', 'o1', 'u'], 'Other views: most recent first.');
  assert.deepEqual(list.map(item => item.id), ['c', 'u', 'o2', 't', 'o1', 'b'], 'The list itself is not reordered.');
}));

test('each departure belongs to one view and says its own state', () => {
  const planned = envoi('p', '2026-10-15'), left = envoi('l', '2026-10-01', departed), arrived = envoi('a', '2026-09-20', { ...departed, statut: 'arrive' }), archived = envoi('x', '2026-09-10', { ...departed, statut: 'archive' });
  assert.deepEqual([planned, left, arrived, archived].map(item => ['a-preparer', 'partis', 'archives'].filter(view => departureInView(item, view))), [['a-preparer'], ['partis'], ['partis'], ['archives']]);
  assert.deepEqual([planned, left, arrived, archived].map(departureStateLabel), ['À préparer', 'Départ confirmé', 'Arrivé à destination', 'Archivé']);
  assert.equal(departureDeparted(left), true);
  assert.equal(departureDeparted(planned), false);
});

test('the closing line names the habitual Wednesday 17 h without a closing of its own, in Paris time, and disappears once left', () => inEveryZone(zone => {
  assert.equal(departureClosingLine(envoi('h', '2026-10-22'), { today: NOW }), 'Clôture habituelle : mercredi 21 octobre, 17 h (heure de Paris)', zone);
  assert.equal(departureClosingLine(envoi('e', '2026-10-22', { loadingClosesAt: '2026-10-21T15:00:00Z' }), { today: NOW }), 'Clôture : mercredi 21 octobre, 17 h (heure de Paris)', zone);
  assert.equal(departureClosingLine(envoi('w', '2026-10-29'), { today: NOW }), 'Clôture habituelle : mercredi 28 octobre, 17 h (heure de Paris)', 'After the clock change: still 17 h.');
  assert.equal(departureClosingLine(envoi('m', '2026-10-16', { loadingClosesAt: '2026-10-14T07:30:00Z' }), { today: NOW }), 'Clôture : mercredi 14 octobre, 9 h 30 (heure de Paris)');
  assert.equal(departureClosingLine(envoi('c', '2026-10-29', { loadingClosesAt: '2026-10-07T10:00:00Z' }), { today: NOW }), 'Clôture : mercredi 7 octobre, 12 h (heure de Paris) · chargement clôturé', 'A passed loading closing says the departure takes no more dossiers.');
  assert.equal(departureClosingLine(envoi('p', '2026-10-08'), { today: NOW }), 'Clôture habituelle : mercredi 7 octobre, 17 h (heure de Paris)', 'A passed habitual closing never closes a departure.');
  for (const gone of [envoi('l', '2026-10-01', departed), envoi('a', '2026-10-01', { ...departed, statut: 'arrive' }), envoi('x', '2026-09-01', { statut: 'archive' })])
    assert.equal(departureClosingLine(gone, { today: NOW }), null, gone.id);
  assert.equal(departureClosingLine(envoi('u', null), { today: NOW }), null, 'An undated departure has no closing yet.');
}));

test('the manifest confirmation shows in Paris time without seconds', () => inEveryZone(zone => {
  assert.equal(confirmedLine('2026-10-07T21:30:45Z', { today: NOW }), 'Confirmé le mercredi 7 octobre, 23 h 30 (heure de Paris)', zone);
  assert.equal(confirmedLine(null, { today: NOW }), 'Date de confirmation à vérifier');
}));

test('weights and counts are written the French way, the same in the review and the manifest', () => {
  assert.equal(formatKg(19.5), '19,5 kg');
  assert.equal(formatKg(3.1 + 4.2), '7,3 kg', 'No floating-point tail.');
  assert.equal(formatKg(1234.567), '1 234,57 kg');
  assert.equal(formatKg(8), '8 kg');
  for (const missing of [null, undefined, NaN, '19.5']) assert.equal(formatKg(missing), null);
  assert.equal(preparedSummary(2, 19.5), '2 colis préparés · 19,5 kg');
  assert.equal(preparedSummary(1, 3), '1 colis préparé · 3 kg');
  assert.equal(preparedSummary(0, null), 'Nombre de colis à vérifier · poids à vérifier');
  assert.equal(countLabel(0, 'dossier', 'dossiers'), '0 dossier');
  assert.equal(countLabel(1, 'dossier', 'dossiers'), '1 dossier');
  assert.equal(countLabel(3, 'dossier', 'dossiers'), '3 dossiers');
});

test('only the dossiers the loading can still take count as loadable', () => {
  const departure = envoi('d', '2026-10-15');
  const dossiers = [
    { id: 1, envoi: 'd', statut: 'paye' }, { id: 2, envoi: 'd', statut: 'en_preparation' }, { id: 3, envoi: 'd', statut: 'expedie' },
    { id: 4, envoi: 'd', statut: 'annule' }, { id: 5, envoi: 'd', statut: 'paye', archive: true }, { id: 6, envoi: 'other', statut: 'paye' },
    { id: 7, envoiId: 'd', statut: 'paye' }, { id: 8, envoi: 'd', statut: 'paye', dateExpedition: '2026-10-01' },
  ];
  assert.deepEqual(loadableDossiers(departure, dossiers).map(item => item.id), [1, 2, 7]);
  assert.deepEqual(loadableDossiers(departure, []), []);
});

test('the dossiers wishing the departure day are the ones the server lets it take', () => inEveryZone(zone => {
  const reunion = { id: 'r', cp: '97400' }, mayotte = { id: 'm', cp: '97600' };
  const wish = (id, fields = {}) => ({ id, ref: `EXP-${id}`, clientId: 'r', statut: 'autorise', departSouhaite: '2026-10-15', envoi: null, archive: false, ...fields });
  const dossiers = [
    wish('C'), wish('A'), wish('B', { statut: 'paye', paiementDate: '2026-10-02T10:00:00Z', devisSnapshot: { inputs: { destination: { code: '974' } } } }),
    wish('other-day', { departSouhaite: '2026-10-22' }), wish('assigned', { envoi: 'elsewhere' }), wish('archived', { archive: true }),
    wish('cancelled', { statut: 'annule' }), wish('shipped', { statut: 'expedie' }), wish('mayotte', { clientId: 'm' }),
    // Paid for Mayotte although the client lives in Réunion: the paid quote decides.
    wish('paid-elsewhere', { statut: 'paye', paiementDate: '2026-10-02T10:00:00Z', devisSnapshot: { inputs: { destination: { code: '976' } } } }),
    wish('unknown-client', { clientId: 'nobody' }),
  ];
  const departure = envoi('d15', '2026-10-15');
  assert.deepEqual(wishedDossiersFor(departure, dossiers, [reunion, mayotte], NOW).map(item => item.id), ['A', 'B', 'C'], zone);
  assert.deepEqual(wishedDossiersFor({ ...departure, destinationCode: '976' }, dossiers, [reunion, mayotte], NOW).map(item => item.id), ['mayotte', 'paid-elsewhere']);
  // A departure that is closed, has left or is archived proposes nothing.
  for (const closed of [{ loadingClosesAt: '2026-10-07T10:00:00Z' }, departed, { statut: 'archive' }, { statut: 'arrive' }])
    assert.deepEqual(wishedDossiersFor({ ...departure, ...closed }, dossiers, [reunion, mayotte], NOW), [], JSON.stringify(closed));
  // A loading closing still ahead keeps the proposal; a past day has none.
  assert.equal(wishedDossiersFor({ ...departure, loadingClosesAt: '2026-10-14T15:00:00Z' }, dossiers, [reunion], NOW).length, 3);
  assert.deepEqual(wishedDossiersFor(envoi('past', '2026-10-06'), [wish('late', { departSouhaite: '2026-10-06' })], [reunion], NOW), []);
  assert.deepEqual(wishedDossiersFor(envoi('undated', null), dossiers, [reunion], NOW), []);
}));

test('a changed dossier asks to be reloaded, other refusals keep the server words', () => {
  assert.equal(assignmentFailure({ ref: 'EXP-1' }, { code: '40001', message: 'Le dossier a changé. Rechargez-le.' }), 'Le dossier EXP-1 a changé : rechargez-le');
  assert.equal(assignmentFailure({ ref: 'EXP-2' }, { code: '22023', message: 'Départ incompatible, passé ou clôturé' }), 'EXP-2 : Départ incompatible, passé ou clôturé');
  assert.equal(assignmentFailure({ ref: 'EXP-3' }, new Error('')), 'EXP-3 : affectation impossible');
});

test('the planning form checks every field on Paris time', () => inEveryZone(zone => {
  const valid = { date: '2026-10-22', destinationCode: '974', weeks: '1', closing: '' };
  assert.deepEqual(planningErrors(valid, { now: NOW }), {}, zone);
  assert.deepEqual(planningErrors({ ...valid, date: '2026-10-07' }, { now: NOW }), {}, 'Today in Paris is allowed, even when the device is already on the 8th.');
  assert.deepEqual(planningErrors({ ...valid, date: '2026-10-06' }, { now: NOW }), { date: 'Choisissez une date à partir d’aujourd’hui (heure de Paris).' });
  assert.deepEqual(planningErrors({ ...valid, date: '' }, { now: NOW }), { date: 'Choisissez la date du premier départ.' });
  assert.deepEqual(planningErrors({ ...valid, destinationCode: '' }, { now: NOW }), { destinationCode: 'Choisissez une destination.' });
  for (const weeks of ['', '0', '13', '1.5', 'deux']) assert.deepEqual(planningErrors({ ...valid, weeks }, { now: NOW }), { weeks: 'Indiquez entre 1 et 12 départs hebdomadaires.' }, weeks);
  assert.deepEqual(planningErrors({ ...valid, closing: '2026-10-21T17:00' }, { now: NOW }), {});
  assert.deepEqual(planningErrors({ ...valid, closing: '2026-10-22T09:00' }, { now: NOW }), {}, 'The departure day itself is allowed.');
  assert.deepEqual(planningErrors({ ...valid, closing: '2026-10-23T09:00' }, { now: NOW }), { closing: 'La clôture doit avoir lieu au plus tard le jour du départ.' });
  assert.deepEqual(planningErrors({ ...valid, closing: '2026-10-07T23:00' }, { now: NOW }), { closing: 'La clôture doit être à venir.' }, '23:00 Paris has passed at 23:30 Paris.');
  assert.deepEqual(planningErrors({ ...valid, closing: '2026-10-07T23:45' }, { now: NOW }), {}, 'Still ahead in Paris.');
  assert.deepEqual(planningErrors({ date: '2027-03-30', destinationCode: '974', weeks: '1', closing: '2027-03-28T02:30' }, { now: NOW }), { closing: 'Cet horaire n’existe pas à Paris (changement d’heure) : choisissez une autre heure.' });
  assert.deepEqual(planningErrors({ date: '2027-03-23', destinationCode: '974', weeks: '2', closing: '2027-03-21T02:30' }, { now: NOW }), { closing: 'Une semaine de la série tombe sur l’heure sautée au changement d’heure : choisissez une autre heure.' });
}));

test('the edit form checks the same rules', () => {
  const valid = { date: '2026-10-22', destinationCode: '974', closing: '2026-10-21T17:00' };
  assert.deepEqual(departureEditErrors(valid, { now: NOW }), {});
  assert.deepEqual(departureEditErrors({ ...valid, date: '2026-10-03', closing: '' }, { now: NOW }), { date: 'Choisissez une date à partir d’aujourd’hui (heure de Paris).' }, 'An overdue departure is reprogrammed from today.');
  assert.deepEqual(departureEditErrors({ ...valid, date: '' }, { now: NOW }), { date: 'Choisissez la date du départ.' });
  assert.deepEqual(departureEditErrors({ ...valid, destinationCode: '' }, { now: NOW }), { destinationCode: 'Choisissez une destination.' });
  assert.deepEqual(departureEditErrors({ ...valid, closing: '2026-10-01T17:00' }, { now: NOW }), { closing: 'La clôture doit être à venir.' });
  assert.deepEqual(departureEditErrors({ ...valid, closing: '2026-10-24T17:00' }, { now: NOW }), { closing: 'La clôture doit avoir lieu au plus tard le jour du départ.' });
});

test('a weekly series created across the 25 October clock change keeps 17:00 Paris', () => inEveryZone(zone => {
  assert.deepEqual(weeklyDepartures({ date: '2026-10-22', weeks: '3', closing: '2026-10-21T17:00' }), [
    { date: '2026-10-22', loadingClosesAt: '2026-10-21T15:00:00.000Z' },
    { date: '2026-10-29', loadingClosesAt: '2026-10-28T16:00:00.000Z' },
    { date: '2026-11-05', loadingClosesAt: '2026-11-04T16:00:00.000Z' },
  ], zone);
  assert.deepEqual(weeklyDepartures({ date: '2026-10-22', weeks: 2, closing: '' }), [{ date: '2026-10-22', loadingClosesAt: null }, { date: '2026-10-29', loadingClosesAt: null }]);
}));
