import test from 'node:test';
import assert from 'node:assert/strict';
import { eur, kg, messageEur, parisDateTime } from '../src/expedile/utils/format.js';

const NBSP = ' ', NNBSP = ' ';

test('amounts are French: comma, two decimals, narrow no-break space for thousands, no-break space before €', () => {
  assert.equal(eur(1234.5), `1${NNBSP}234,50${NBSP}€`);
  assert.equal(eur(76.08), `76,08${NBSP}€`);
  assert.equal(eur(4.22), `4,22${NBSP}€`);
  assert.equal(eur(1234567.891), `1${NNBSP}234${NNBSP}567,89${NBSP}€`);
  assert.equal(eur('12.5'), `12,50${NBSP}€`, 'A numeric string from a form is formatted too.');
  assert.equal(eur(-12.3), `-12,30${NBSP}€`);
  // No space a line can break at: « 4,22 » and « € » always stay together.
  for (const value of [4.22, 1234.5, 98765.43]) assert.doesNotMatch(eur(value), / /);
});

test('a missing amount keeps the former fallback, 0,00 €, and never reads « -0,00 € »', () => {
  for (const value of [0, -0, -0.001, 0.004, null, undefined, '', 'abc', NaN, Infinity]) assert.equal(eur(value), `0,00${NBSP}€`, String(value));
});

test('weights are French with at most two decimals: « 19,5 kg », « 8 kg », « 2,67 kg »', () => {
  assert.equal(kg(19.5), `19,5${NBSP}kg`);
  assert.equal(kg(8), `8${NBSP}kg`);
  assert.equal(kg(8.0), `8${NBSP}kg`);
  assert.equal(kg(2.6666667), `2,67${NBSP}kg`);
  assert.equal(kg(4.8), `4,8${NBSP}kg`);
  assert.equal(kg('3.20'), `3,2${NBSP}kg`);
  assert.equal(kg(0.6), `0,6${NBSP}kg`);
  assert.equal(kg(1234.5), `1${NNBSP}234,5${NBSP}kg`);
  assert.equal(kg(0), `0${NBSP}kg`);
  assert.equal(kg(-0.001), `0${NBSP}kg`);
  for (const value of [null, undefined, '', 'abc', NaN]) assert.equal(kg(value), `—${NBSP}kg`, String(value));
  for (const value of [19.5, 1234.5]) assert.doesNotMatch(kg(value), / /);
});

test('message text keeps the Edge renderer format until both renderers change together', () => {
  assert.equal(messageEur(76.08), '76.08 €');
  assert.equal(messageEur(1234.5), '1234.50 €');
  assert.equal(messageEur(undefined), '0.00 €');
});

test('dates are written in French, in Paris time, whatever the device time zone', () => {
  assert.equal(parisDateTime('2026-10-06T21:26:47.607Z'), '6 octobre 2026 à 23:26');
  assert.equal(parisDateTime('2026-01-15T08:00:00Z'), '15 janvier 2026 à 09:00');
  assert.equal(parisDateTime(Date.parse('2026-03-29T01:30:00Z')), '29 mars 2026 à 03:30', 'Summer time starts that night.');
  for (const value of [null, undefined, '', 'not a date', {}]) assert.equal(parisDateTime(value), null);
});
