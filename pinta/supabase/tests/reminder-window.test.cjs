const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('../../node_modules/esbuild');
const compiled = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '../functions/_shared/reminderWindow.ts')],
  bundle: true, write: false, format: 'cjs', platform: 'node',
}).outputFiles[0].text;
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports, Date });
const { isReminderInActiveWindow, reminderTimestamp } = moduleObject.exports;
const activation = '2026-09-10T12:00:00.000Z';
const now = Date.parse('2026-09-12T12:00:00.000Z');

test('Historical request one millisecond before activation is excluded', () => {
  assert.equal(isReminderInActiveWindow('2026-09-10T11:59:59.999Z', activation, now), false);
});
test('Activation boundary and subsequent requests remain eligible', () => {
  assert.equal(isReminderInActiveWindow(activation, activation, now), true);
  assert.equal(isReminderInActiveWindow('2026-09-10T12:00:00.001Z', activation, now), true);
});
test('Explicit timezones identify the same eligibility boundary', () => {
  assert.equal(isReminderInActiveWindow('2026-09-10T16:00:00+04:00', activation, now), true);
  assert.equal(isReminderInActiveWindow('2026-09-10T13:59:59.999+02:00', activation, now), false);
  assert.equal(reminderTimestamp('2026-09-10T12:00:00.000000+00:00'), Date.parse(activation));
});
test('Absent or invalid activation fails closed instead of replaying history', () => {
  for (const value of [undefined, null, '', 'yesterday', '2026-09-10', '2026-09-10T12:00:00', '2026-99-10T12:00:00Z', '2026-02-30T12:00:00Z', '2026-02-29T12:00:00Z', '2026-09-10T24:00:00Z', 0, now, {}, []]) {
    assert.equal(isReminderInActiveWindow(activation, value, now), false);
  }
});
test('Missing, invalid or future request timestamps never create reminders', () => {
  for (const since of [null, '', 'invalid', '2026-09-13T12:00:00Z']) {
    assert.equal(isReminderInActiveWindow(since, activation, now), false);
  }
  assert.equal(isReminderInActiveWindow(activation, activation, NaN), false);
});
