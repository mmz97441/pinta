/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarDays, parisDateLabel, parisDateTimeInput, parisDateTimeInstant, parisMonth, shiftParisDateTime } from './parisTime.js';

// Every assertion runs again with the device in these zones: the result never moves.
const ZONES = ['Europe/Paris', 'Indian/Reunion', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
function inEveryZone(check) {
  const previous = process.env.TZ;
  try {
    for (const zone of ZONES) { process.env.TZ = zone; check(zone); }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
}

test('a Paris wall time typed in a datetime-local field becomes its instant, whatever the device zone', () => inEveryZone(zone => {
  assert.equal(parisDateTimeInstant('2026-10-21T17:00'), '2026-10-21T15:00:00.000Z', `${zone}: summer time, UTC+2.`);
  assert.equal(parisDateTimeInstant('2026-10-28T17:00'), '2026-10-28T16:00:00.000Z', `${zone}: winter time, UTC+1.`);
  assert.equal(parisDateTimeInstant('2026-01-06T09:30'), '2026-01-06T08:30:00.000Z');
  assert.equal(parisDateTimeInstant('2026-10-21T17:00:00'), '2026-10-21T15:00:00.000Z', 'Zero seconds added by a browser are accepted.');
  assert.equal(parisDateTimeInstant(' 2026-10-21T17:00 '), '2026-10-21T15:00:00.000Z');
}));

test('the instant shows back as its Paris wall time, never the device time', () => inEveryZone(zone => {
  assert.equal(parisDateTimeInput('2026-10-21T15:00:00Z'), '2026-10-21T17:00', zone);
  assert.equal(parisDateTimeInput('2026-10-28T16:00:00.000Z'), '2026-10-28T17:00', zone);
  assert.equal(parisDateTimeInput(Date.parse('2026-10-07T21:30:00Z')), '2026-10-07T23:30', 'A timestamp too.');
  assert.equal(parisDateTimeInput(new Date('2026-12-31T23:30:00Z')), '2027-01-01T00:30', 'Midnight is 00, never 24.');
  for (const empty of [null, undefined, '', 'demain', NaN]) assert.equal(parisDateTimeInput(empty), '');
}));

test('spring forward: the skipped hour does not exist in Paris, the hours around it do', () => inEveryZone(() => {
  // Sunday 29 March 2026: 02:00 → 03:00.
  assert.equal(parisDateTimeInstant('2026-03-29T01:59'), '2026-03-29T00:59:00.000Z');
  assert.equal(parisDateTimeInstant('2026-03-29T02:30'), null, '02:30 never happens in Paris that night.');
  assert.equal(parisDateTimeInstant('2026-03-29T03:00'), '2026-03-29T01:00:00.000Z');
  assert.equal(parisDateTimeInstant('2026-03-29T17:00'), '2026-03-29T15:00:00.000Z');
  assert.equal(parisDateTimeInstant('2026-03-28T17:00'), '2026-03-28T16:00:00.000Z', 'The day before is still winter time.');
}));

test('fall back: an hour that happens twice is read after the change, the others keep their offset', () => inEveryZone(() => {
  // Sunday 25 October 2026: 03:00 → 02:00.
  assert.equal(parisDateTimeInstant('2026-10-25T01:30'), '2026-10-24T23:30:00.000Z', 'Before the change: UTC+2.');
  assert.equal(parisDateTimeInstant('2026-10-25T02:30'), '2026-10-25T01:30:00.000Z', 'Twice that night: the winter one.');
  assert.equal(parisDateTimeInput('2026-10-25T00:30:00Z'), '2026-10-25T02:30', 'The summer occurrence still reads 02:30.');
  assert.equal(parisDateTimeInstant('2026-10-25T17:00'), '2026-10-25T16:00:00.000Z');
}));

test('a weekly series keeps its Paris hour across both clock changes', () => inEveryZone(() => {
  const autumn = [0, 1, 2].map(week => parisDateTimeInstant(shiftParisDateTime('2026-10-21T17:00', week * 7)));
  assert.deepEqual(autumn, ['2026-10-21T15:00:00.000Z', '2026-10-28T16:00:00.000Z', '2026-11-04T16:00:00.000Z']);
  const spring = [0, 1].map(week => parisDateTimeInstant(shiftParisDateTime('2026-03-25T17:00', week * 7)));
  assert.deepEqual(spring, ['2026-03-25T16:00:00.000Z', '2026-04-01T15:00:00.000Z']);
  assert.equal(shiftParisDateTime('2026-12-30T09:15', 7), '2027-01-06T09:15', 'Across the new year.');
  assert.equal(shiftParisDateTime('2026-10-21', 7), null, 'A day without a time is not a wall time.');
}));

test('invalid wall times are refused instead of guessed', () => {
  for (const text of ['', null, undefined, '2026-10-21', '21/10/2026 17:00', '2026-02-30T17:00', '2026-10-21T24:00', '2026-10-21T17:60', '2026-10-21T17:00:30', '2026-10-21T17:00Z'])
    assert.equal(parisDateTimeInstant(text), null, String(text));
});

test('calendar days move by whole days only', () => {
  assert.equal(addCalendarDays('2026-10-22', 7), '2026-10-29');
  assert.equal(addCalendarDays('2026-10-22', 14), '2026-11-05');
  assert.equal(addCalendarDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addCalendarDays('2026-10-22', 0.5), null);
  assert.equal(addCalendarDays('22/10/2026', 7), null);
});

test('the month of a payment is its Paris calendar month', () => inEveryZone(zone => {
  assert.deepEqual(parisMonth('2026-09-30T21:00:00Z'), { year: 2026, month: 8 }, `${zone}: 23:00 in Paris on 30 September.`);
  assert.deepEqual(parisMonth('2026-09-30T22:00:00Z'), { year: 2026, month: 9 }, `${zone}: midnight in Paris is 1 October.`);
  assert.deepEqual(parisMonth('2026-12-31T23:30:00Z'), { year: 2027, month: 0 }, 'New year in Paris before London.');
  assert.deepEqual(parisMonth('2026-09-15'), { year: 2026, month: 8 }, 'A calendar day is read as it is.');
  for (const empty of [null, undefined, '', 'inconnue']) assert.equal(parisMonth(empty), null);
}));

test('a date shows as its Paris calendar day', () => inEveryZone(() => {
  assert.equal(parisDateLabel('2026-09-30T21:00:00Z'), '30/09/2026');
  assert.equal(parisDateLabel('2026-09-30T22:30:00Z'), '01/10/2026');
  assert.equal(parisDateLabel('2026-09-15'), '15/09/2026');
  assert.equal(parisDateLabel(null), '');
  assert.equal(parisDateLabel(undefined), '', 'Never today by default.');
}));
