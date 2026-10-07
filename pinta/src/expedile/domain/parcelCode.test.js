import test from 'node:test';
import assert from 'node:assert/strict';
import { formatParcelCode, parcelCodeText, parseParcelCode } from './parcelCode.js';

test('a parcel code holds the reference, the position and the count', () => {
  assert.equal(formatParcelCode('EXP-2YE537', 1, 2), 'EXP-2YE537-1-2');
  assert.equal(parcelCodeText('EXP-2YE537', 1, 2), 'EXP-2YE537 · Colis 1/2');
  assert.deepEqual(parseParcelCode('EXP-2YE537-1-2'), { ok: true, ref: 'EXP-2YE537', index: 1, count: 2, layoutCorrected: false });
  assert.deepEqual(parseParcelCode('EXP-1042-3-3'), { ok: true, ref: 'EXP-1042', index: 3, count: 3, layoutCorrected: false });
});

test('the readable line, lower case, other dashes and spaces are read too', () => {
  for (const text of ['EXP-2YE537 · Colis 1/2', 'exp-2ye537-1-2', '  EXP‑2YE537– 1 / 2 ', 'EXP-2YE537/1/2', 'EXP-2YE537 colis 1 2'])
    assert.deepEqual(parseParcelCode(text), { ok: true, ref: 'EXP-2YE537', index: 1, count: 2, layoutCorrected: false }, text);
});

test('a bare reference is read without a position', () => {
  assert.deepEqual(parseParcelCode('EXP-2YE537'), { ok: true, ref: 'EXP-2YE537', index: null, count: null, layoutCorrected: false });
});

test('a scanner typing with an English keyboard on a French device is restored', () => {
  // « EXP-2YE537-1-2 » typed as QWERTY keys on AZERTY.
  assert.deepEqual(parseParcelCode('EXP)éYE("è)&)é'), { ok: true, ref: 'EXP-2YE537', index: 1, count: 2, layoutCorrected: true });
  // A, Q, W, Z and M swap places: « EXP-AQWZM2-1-1 ».
  assert.deepEqual(parseParcelCode('EXP)QAZW?é)&)&'), { ok: true, ref: 'EXP-AQWZM2', index: 1, count: 1, layoutCorrected: true });
});

test('anything else is refused, never guessed', () => {
  assert.deepEqual(parseParcelCode(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parseParcelCode('   '), { ok: false, reason: 'empty' });
  for (const text of ['EXP-2YE53', 'EXP-2YE537-0-2', 'EXP-2YE537-3-2', 'ENV-2026-036', 'EXP-2YE537\nNICE Guillaume', '1Z999AA10123456784', 'EXP-2YE537-1'])
    assert.deepEqual(parseParcelCode(text), { ok: false, reason: 'unreadable' }, text);
});
