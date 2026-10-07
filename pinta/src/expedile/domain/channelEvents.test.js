import test from 'node:test';
import assert from 'node:assert/strict';
import { latestChannelEvent } from './channelEvents.js';

const first = { id: 'm1', canal: 'telegram', date: '2026-10-06T21:26:47.607Z' };
const second = { id: 'm2', canal: 'telegram', date: '2026-10-06T22:05:00.000Z' };
const email = { id: 'm3', canal: 'email', date: '2026-10-06T23:00:00.000Z' };

test('the latest message of a channel is the most recent one, in a newest-first log as in any order', () => {
  assert.equal(latestChannelEvent([email, second, first], 'telegram'), second, 'comLog is built newest first.');
  assert.equal(latestChannelEvent([first, second, email], 'telegram'), second);
  assert.equal(latestChannelEvent([email, second, first], 'email'), email);
});

test('no message, another channel only or an unreadable date: nothing to show', () => {
  assert.equal(latestChannelEvent([], 'telegram'), null);
  assert.equal(latestChannelEvent(undefined, 'telegram'), null);
  assert.equal(latestChannelEvent([email], 'telegram'), null);
  assert.equal(latestChannelEvent([{ canal: 'telegram', date: 'pas une date' }, { canal: 'telegram' }], 'telegram'), null);
  assert.equal(latestChannelEvent([{ canal: 'portal', date: second.date }], 'telegram'), null, 'A message left in the client space is not a Telegram delivery.');
});
