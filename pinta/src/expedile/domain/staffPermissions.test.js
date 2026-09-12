import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStaffPermissions, staffPermissionSaveArgs } from './staffPermissions.js';

test('unique permission relationship preserves granted and revoked rights as an object or array', () => {
  const row = { staff_id: 'staff-example', perm_colis_preparer: true, perm_colis_envoyer_devis: false };
  assert.deepEqual(normalizeStaffPermissions(row), row);
  assert.deepEqual(normalizeStaffPermissions([row]), row);
  assert.equal(normalizeStaffPermissions([]), null);
  assert.equal(normalizeStaffPermissions(null), null);
});

test('permission save carries explicit false and the baseline without replacing unrelated rights', () => {
  const baseline = { perm_colis_preparer: true, perm_colis_envoyer_devis: true };
  const args = staffPermissionSaveArgs('staff-example', { perm_colis_preparer: false }, baseline);
  assert.deepEqual(args.p_permissions, { perm_colis_preparer: false });
  assert.deepEqual(args.p_expected_permissions, baseline);
  assert.equal(baseline.perm_colis_preparer, true);
});

test('missing permission record remains distinct from an existing empty snapshot', () => {
  assert.equal(staffPermissionSaveArgs('staff-example', {}, null).p_expected_permissions, null);
  assert.deepEqual(staffPermissionSaveArgs('staff-example', {}, {}).p_expected_permissions, {});
  assert.throws(() => staffPermissionSaveArgs('staff-example', {}, undefined), /Rechargez/);
});

test('client adapter rejects record identifiers, unknown rights and truthy strings as permission changes', () => {
  for (const patch of [{ staff_id: 'other' }, { perm_unknown: true }, { perm_colis_preparer: 'false' }]) {
    assert.throws(() => staffPermissionSaveArgs('staff-example', patch, null), /permissions/);
  }
});
