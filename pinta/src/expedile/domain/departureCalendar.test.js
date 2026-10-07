import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, calendarDay, calendarMonthBounds, dayProposal, departureCalendarContext, departureClosingText, departureShortcuts,
  initialCalendarMonth, initialFocusDay, monthLabel, monthOf, monthWeeks, moveCalendarFocus, sameDayInMonth, shortClosingLabel, shortDayLabel,
} from './departureCalendar.js';
import { departureDefaultClosing } from './departurePlanning.js';

// Tuesday 6 October 2026, 10:00 in Paris.
const now = Date.parse('2026-10-06T08:00:00Z');
const client = { cp: '97400', prenom: 'Flavie' };
const departure = (id, date, fields = {}) => ({ id, ref: `ENV-${id}`, date, destinationCode: '974', statut: 'planifie', loadingClosesAt: null, departedAt: null, ...fields });
const envois = [
  departure('oct1', '2026-10-01', { statut: 'parti', departedAt: '2026-10-01T06:00:00Z' }),
  departure('oct8', '2026-10-08'),
  departure('oct9', '2026-10-09', { statut: 'parti', departedAt: '2026-10-06T06:00:00Z' }),
  departure('oct15', '2026-10-15', { loadingClosesAt: '2026-10-05T15:00:00Z' }),
  departure('oct22', '2026-10-22'),
  departure('oct29', '2026-10-29'),
  departure('nov5', '2026-11-05'),
  departure('gp22', '2026-10-22', { destinationCode: '971' }),
];
const dossier = { id: 'dossier', ref: 'EXP-1', statut: 'mesure', envoi: 'oct8' };
const context = (fields = {}, options = {}) => departureCalendarContext({ ...dossier, ...fields }, options.client || client, options.envois || envois, { now });

test('months: Monday-first weeks, French labels and month arithmetic', () => {
  const weeks = monthWeeks('2026-11');
  assert.equal(weeks.length, 6);
  assert.deepEqual(weeks[0], [null, null, null, null, null, null, '2026-11-01']);
  assert.deepEqual(weeks[5], ['2026-11-30', null, null, null, null, null, null]);
  assert.ok(weeks.every(week => week.length === 7));
  assert.equal(monthWeeks('2026-02').flat().filter(Boolean).length, 28);
  assert.equal(monthLabel('2026-11'), 'novembre 2026');
  assert.equal(addMonths('2026-12', 1), '2027-01'); assert.equal(addMonths('2026-01', -1), '2025-12'); assert.equal(addMonths('2026-10', 18), '2028-04');
  assert.equal(monthOf('2026-11-19'), '2026-11'); assert.equal(monthOf('19/11/2026'), null);
  assert.equal(sameDayInMonth('2026-10-31', '2026-11'), '2026-11-30');
});

test('short labels for the shortcuts and the full closing wording', () => {
  assert.equal(shortDayLabel('2026-10-08'), 'jeu. 8 oct.');
  assert.equal(shortClosingLabel(departureDefaultClosing('2026-10-08')), 'mer. 7, 17 h');
  assert.equal(shortClosingLabel('2026-10-01T07:30:00Z'), 'jeu. 1er, 9 h 30');
  assert.equal(departureClosingText(envois[1], { now }), 'clôture habituelle mercredi 7 octobre, 17 h');
  assert.equal(departureClosingText(departure('x', '2026-10-08', { loadingClosesAt: '2026-10-07T07:30:00Z' }), { now }), 'clôture mercredi 7 octobre, 9 h 30');
  assert.equal(departureClosingText(envois[1], { now, short: true }), 'clôture habituelle mer. 7, 17 h');
});

test('each day says what it is for the dossier, in its accessible name', () => {
  const ctx = context();
  const day = value => calendarDay(value, ctx);
  assert.deepEqual([day('2026-10-05').kind, day('2026-10-01').kind], ['past', 'past']);
  assert.equal(day('2026-10-05').label, 'lundi 5 octobre, jour passé');
  const today = day('2026-10-06');
  assert.equal(today.kind, 'free'); assert.equal(today.today, true); assert.equal(today.label, 'mardi 6 octobre, aucun départ prévu, aujourd’hui');
  const assigned = day('2026-10-08');
  assert.equal(assigned.kind, 'departure'); assert.equal(assigned.assigned, true); assert.equal(assigned.envoi.id, 'oct8');
  assert.equal(assigned.label, 'jeudi 8 octobre, départ du dossier, clôture habituelle mercredi 7 octobre, 17 h');
  assert.equal(day('2026-10-22').label, 'jeudi 22 octobre, départ prévu, clôture habituelle mercredi 21 octobre, 17 h');
  assert.equal(day('2026-10-22').envoi.id, 'oct22', 'Only the departures of the dossier’s destination.');
  // A loading closed or a departure gone: the day stays visible, muted, with its reason.
  assert.deepEqual([day('2026-10-15').kind, day('2026-10-15').label], ['closed', 'jeudi 15 octobre, départ clôturé']);
  assert.deepEqual([day('2026-10-09').kind, day('2026-10-09').label], ['closed', 'vendredi 9 octobre, départ déjà parti']);
  assert.deepEqual([day('2026-11-15').kind, day('2026-11-15').label], ['free', 'dimanche 15 novembre, aucun départ prévu']);
  const wished = calendarDay('2026-11-19', context({ envoi: null, departSouhaite: '2026-11-19' }));
  assert.equal(wished.wish, true); assert.equal(wished.label, 'jeudi 19 novembre, jour souhaité, aucun départ prévu');
  // Another year carries its year.
  assert.equal(calendarDay('2027-01-07', ctx).label, 'jeudi 7 janvier 2027, aucun départ prévu');
});

test('shortcuts: the next three departures the dossier can join, its own marked', () => {
  const shortcuts = departureShortcuts(context());
  assert.deepEqual(shortcuts.map(item => [item.envoi.id, item.label, item.closing, item.current]), [
    ['oct8', 'jeu. 8 oct.', 'clôture habituelle mer. 7, 17 h', true],
    ['oct22', 'jeu. 22 oct.', 'clôture habituelle mer. 21, 17 h', false],
    ['oct29', 'jeu. 29 oct.', 'clôture habituelle mer. 28, 17 h', false],
  ]);
  assert.equal(shortcuts[0].accessibleLabel, 'jeudi 8 octobre, départ du dossier, clôture habituelle mercredi 7 octobre, 17 h');
  assert.equal(shortcuts[1].accessibleLabel, 'jeudi 22 octobre, départ prévu, clôture habituelle mercredi 21 octobre, 17 h');
  assert.deepEqual(departureShortcuts(context({}, { client: { cp: '97110' } })).map(item => item.envoi.id), ['gp22']);
  assert.deepEqual(departureShortcuts(context({}, { client: {} })), [], 'Without a destination, no departure is offered.');
});

test('the calendar opens on the assigned, desired, next departure or current month', () => {
  assert.equal(initialCalendarMonth(context()), '2026-10');
  assert.equal(initialCalendarMonth(context({ envoi: null, departSouhaite: '2026-11-19' })), '2026-11');
  assert.equal(initialCalendarMonth(context({ envoi: null }, { envois: [departure('dec3', '2026-12-03')] })), '2026-12');
  assert.equal(initialCalendarMonth(context({ envoi: null }, { envois: [] })), '2026-10');
  // A past desired month never opens before the current month.
  assert.equal(initialCalendarMonth(context({ envoi: null, departSouhaite: '2026-09-10' })), '2026-10');
  assert.equal(initialFocusDay('2026-10', context()), '2026-10-08');
  assert.equal(initialFocusDay('2026-11', context()), '2026-11-05');
  assert.equal(initialFocusDay('2026-12', context()), '2026-12-01');
  assert.equal(initialFocusDay('2026-10', context({ envoi: null }, { envois: [] })), '2026-10-06');
});

test('keyboard moves of the date grid stay within the offered months', () => {
  const ctx = context();
  assert.deepEqual(calendarMonthBounds(ctx), { first: '2026-10', last: '2028-04' });
  const move = (day, key, shift) => moveCalendarFocus(day, key, ctx, { shift });
  assert.equal(move('2026-10-31', 'ArrowRight'), '2026-11-01');
  assert.equal(move('2026-10-15', 'ArrowLeft'), '2026-10-14');
  assert.equal(move('2026-10-15', 'ArrowDown'), '2026-10-22');
  assert.equal(move('2026-10-15', 'ArrowUp'), '2026-10-08');
  assert.equal(move('2026-10-02', 'ArrowUp'), '2026-10-01', 'Never before the current month.');
  assert.equal(move('2026-10-08', 'Home'), '2026-10-05'); assert.equal(move('2026-10-08', 'End'), '2026-10-11');
  assert.equal(move('2026-10-31', 'PageDown'), '2026-11-30'); assert.equal(move('2026-11-30', 'PageUp'), '2026-10-30');
  assert.equal(move('2026-10-31', 'PageDown', true), '2027-10-31');
  assert.equal(move('2028-04-20', 'PageDown'), '2028-04-30', 'Never after the last offered month.');
  assert.equal(move('2026-10-08', 'Tab'), null);
  // A departure planned further away extends the calendar to its month.
  const far = context({ envoi: 'far' }, { envois: [...envois, departure('far', '2099-09-12')] });
  assert.equal(calendarMonthBounds(far).last, '2099-09');
  assert.equal(initialCalendarMonth(far), '2099-09');
});

test('a day without departure proposes its creation and the desired day; a closed day says so', () => {
  const ctx = context({ envoi: null });
  const free = dayProposal('2026-11-15', ctx, { canCreate: true });
  assert.equal(free.message, 'Dimanche 15 novembre : aucun départ prévu');
  assert.equal(free.create, true); assert.equal(free.keep, true);
  assert.equal(free.createLabel, 'Créer ce départ (aérien) et y affecter le dossier');
  assert.equal(free.keepLabel, 'Garder comme date souhaitée');
  assert.equal(free.closingText, 'clôture mercredi 11 novembre, 17 h (heure de Paris)');
  // Without the right to create: only the desired day.
  const kept = dayProposal('2026-11-15', ctx, { canCreate: false });
  assert.equal(kept.create, false); assert.equal(kept.keep, true); assert.equal(kept.closingText, null);
  // A departure assigned: both choices say what they replace.
  const replacing = dayProposal('2026-11-15', context(), { canCreate: true });
  assert.equal(replacing.createLabel, 'Créer ce départ (aérien) et y affecter le dossier à la place du départ du jeudi 8 octobre');
  assert.equal(replacing.keepLabel, 'Garder comme date souhaitée à la place du départ du jeudi 8 octobre');
  // Its habitual closing already passed: no creation.
  const late = dayProposal('2026-10-07', ctx, { canCreate: true });
  assert.equal(late.create, false); assert.match(late.note, /clôture de ce départ est déjà passée/);
  // The desired day itself: nothing to keep again.
  assert.equal(dayProposal('2026-11-19', context({ envoi: null, departSouhaite: '2026-11-19' }), { canCreate: true }).keep, false);
  assert.deepEqual(dayProposal('2026-10-15', ctx), { day: '2026-10-15', kind: 'closed', title: 'Jeudi 15 octobre', message: 'Le départ du jeudi 15 octobre est clôturé : choisissez un autre jour.' });
  assert.equal(dayProposal('2026-10-09', ctx).message, 'Le départ du vendredi 9 octobre est déjà parti : choisissez un autre jour.');
  assert.equal(dayProposal('2026-10-05', ctx), null, 'A past day proposes nothing.');
  assert.equal(dayProposal('2026-10-22', ctx), null, 'A departure day is assigned directly.');
  assert.match(dayProposal('2026-11-15', context({ envoi: null }, { client: {} }), { canCreate: true }).note, /Destination du client inconnue/);
});
