import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionDraft, permissionChanges, permissionChangeCount, mergePermissionDrafts, changePermissionValues } from '../src/expedile/domain/permissionDrafts.js';

const receive = 'perm_colis_receptionner';
const measure = 'perm_colis_mesurer';

test('an absent row stays a null baseline and granting one right sends only that boolean', () => {
  const empty = createPermissionDraft(null);
  assert.equal(empty.baseline, null);
  assert.equal(permissionChangeCount(empty), 0);
  const changed = changePermissionValues(empty, [receive], true);
  assert.equal(changed.baseline, null);
  assert.deepEqual(permissionChanges(changed), { [receive]: true });
});

test('a legacy null flag is compared as false, distinct from a missing permissions row', () => {
  const draft = changePermissionValues(createPermissionDraft({ id: 'legacy', [receive]: null }), [receive], true);
  assert.equal(draft.baseline[receive], false);
  assert.notEqual(draft.baseline, null);
  assert.deepEqual(permissionChanges(draft), { [receive]: true });
});

test('revoking a granted right preserves explicit false and reversing it removes the pending change', () => {
  const original = createPermissionDraft({ id: 'permissions-row', staff_id: 'staff', [receive]: true, [measure]: false });
  const revoked = changePermissionValues(original, [receive], false);
  assert.deepEqual(permissionChanges(revoked), { [receive]: false });
  assert.deepEqual(permissionChanges(changePermissionValues(revoked, [receive], true)), {});
  assert.equal(original.values[receive], true);
});

test('category changes are local, bounded to permission keys, and leave the baseline unchanged', () => {
  const initial = createPermissionDraft({ [receive]: true });
  const none = changePermissionValues(initial, [receive, measure, 'role', 'staff_id'], false);
  assert.deepEqual(permissionChanges(none), { [receive]: false });
  assert.equal(none.baseline[receive], true);
  assert.equal(Object.hasOwn(none.values, 'role'), false);
  const all = changePermissionValues(none, [receive, measure], true);
  assert.deepEqual(permissionChanges(all), { [measure]: true });
});

test('refreshing another user does not erase a draft or replace its concurrency baseline', () => {
  const dirty = changePermissionValues(createPermissionDraft({ [receive]: false }), [receive], true);
  const previous = { a: dirty, b: createPermissionDraft({ [measure]: false }) };
  const merged = mergePermissionDrafts(previous, [
    { id: 'a', permissions: { [receive]: true, [measure]: true } },
    { id: 'b', permissions: { [measure]: true } },
  ]);
  assert.equal(merged.a, dirty);
  assert.equal(merged.a.baseline[receive], false);
  assert.equal(merged.a.values[measure], false);
  assert.equal(merged.b.values[measure], true);
});

test('saved server values become the new clean baseline, including other rights returned by the server', () => {
  const saved = createPermissionDraft({ [receive]: true, [measure]: true });
  assert.equal(permissionChangeCount(saved), 0);
  assert.deepEqual(permissionChanges(changePermissionValues(saved, [receive], false)), { [receive]: false });
});
