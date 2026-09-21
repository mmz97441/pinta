import test from 'node:test';
import assert from 'node:assert/strict';
import { recordVersionAtLeast } from './recordVersion.js';

test('a freshly loaded record preserves microsecond ordering and timezone equivalence', () => {
  const before = '2026-09-20T10:00:00.123456Z', after = '2026-09-20T10:00:00.123457Z';
  assert.equal(recordVersionAtLeast(before, after), false);
  assert.equal(recordVersionAtLeast(after, before), true);
  assert.equal(recordVersionAtLeast(after, after), true);
  assert.equal(recordVersionAtLeast('2026-09-20T14:00:00.123457+04:00', after), true);
  assert.equal(recordVersionAtLeast('2026-09-20T10:00:00.123Z', after), false);
  assert.equal(recordVersionAtLeast(after, '2026-09-20T10:00:00.123Z'), true);
  assert.equal(recordVersionAtLeast('2026-09-20T10:00:01Z', after), true);
  assert.equal(recordVersionAtLeast(null, after), false);
  assert.equal(recordVersionAtLeast(after, 'invalid'), false);
});
