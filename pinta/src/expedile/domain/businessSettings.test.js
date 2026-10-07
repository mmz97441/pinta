import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_FIELDS, REMINDER_DEFAULTS, businessDraftValues, businessSettingsPayload, validateBusinessValues } from './businessSettings.js';

// The seed of app_settings.business (20260910000001_application_schema.sql) plus later keys.
const STORED = { fraisStockage: '1.50', stockageGratuit: '14', relancesFeuVert: 'J+2,J+5,J+7', relancesPaiement: 'J+3,J+7,J+14', diviseurVolumetrique: '5000', timezone: 'Europe/Paris', relancesActivesDepuis: '2026-09-01T00:00:00Z', futureKey: { nested: [1, 2] } };

test('only three values are editable; the form starts from the stored ones', () => {
  assert.deepEqual(BUSINESS_FIELDS, ['fraisStockage', 'stockageGratuit', 'diviseurVolumetrique']);
  assert.deepEqual(businessDraftValues(STORED), { fraisStockage: '1.50', stockageGratuit: '14', diviseurVolumetrique: '5000' });
  assert.deepEqual(businessDraftValues(null), { fraisStockage: '', stockageGratuit: '', diviseurVolumetrique: '' });
  assert.deepEqual(businessDraftValues({ fraisStockage: 0, stockageGratuit: 0, diviseurVolumetrique: 6000 }), { fraisStockage: '0', stockageGratuit: '0', diviseurVolumetrique: '6000' });
});

test('a save keeps every stored key it does not show, unchanged, and changes only the edited values', () => {
  const { values, errors } = validateBusinessValues({ fraisStockage: '2,5', stockageGratuit: '7', diviseurVolumetrique: '6000' });
  assert.deepEqual(errors, {});
  const payload = businessSettingsPayload(STORED, values);
  assert.deepEqual(payload, { ...STORED, fraisStockage: 2.5, stockageGratuit: 7, diviseurVolumetrique: 6000 });
  for (const key of Object.keys(STORED)) assert.ok(key in payload, `${key} is kept`);
  assert.equal(payload.relancesFeuVert, 'J+2,J+5,J+7', 'The reminder cadences are not rewritten.');
  assert.equal(payload.relancesPaiement, 'J+3,J+7,J+14');
  assert.deepEqual(payload.futureKey, { nested: [1, 2] });
  assert.notEqual(payload, STORED); assert.equal(STORED.fraisStockage, '1.50', 'The stored object is not mutated.');
});

test('the server still requires both reminder cadences: an absent one receives the former default', () => {
  const values = { fraisStockage: 1, stockageGratuit: 7, diviseurVolumetrique: 5000 };
  assert.deepEqual(businessSettingsPayload(null, values), { ...REMINDER_DEFAULTS, ...values });
  assert.deepEqual(businessSettingsPayload({ timezone: 'Europe/Paris', relancesFeuVert: '' }, values), { timezone: 'Europe/Paris', ...REMINDER_DEFAULTS, ...values });
  const pattern = /^J\+[0-9]+(, *J\+[0-9]+)*$/; // save_admin_setting
  for (const stored of [null, {}, STORED]) {
    const payload = businessSettingsPayload(stored, values);
    assert.match(payload.relancesFeuVert, pattern); assert.match(payload.relancesPaiement, pattern);
  }
});

test('each invalid value gets its own message; nothing is saved from an invalid form', () => {
  const { values, errors } = validateBusinessValues({ fraisStockage: '-1', stockageGratuit: '2.5', diviseurVolumetrique: '0' });
  assert.deepEqual(values, {});
  assert.deepEqual(Object.keys(errors), BUSINESS_FIELDS);
  assert.match(errors.fraisStockage, /montant positif ou nul/);
  assert.match(errors.stockageGratuit, /nombre entier de jours/);
  assert.match(errors.diviseurVolumetrique, /supérieur à zéro/);
  for (const empty of ['', ' ', null, undefined, 'abc']) assert.ok(validateBusinessValues({ fraisStockage: empty, stockageGratuit: '1', diviseurVolumetrique: '5000' }).errors.fraisStockage, `« ${empty} » is refused`);
  assert.deepEqual(validateBusinessValues({ fraisStockage: '0', stockageGratuit: '0', diviseurVolumetrique: '1' }), { values: { fraisStockage: 0, stockageGratuit: 0, diviseurVolumetrique: 1 }, errors: {} }, 'Zero storage is explicit, not missing.');
});
