import { ALL_PERMISSION_KEYS } from '../constants/permissions.js';

export function createPermissionDraft(permissions) {
  const values = Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, permissions?.[key] === true]));
  return {
    baseline: permissions == null ? null : { ...permissions, ...values },
    values,
  };
}

/** Only supported boolean changes are sent; a missing row remains a null baseline. */
export function permissionChanges(draft) {
  if (!draft) return {};
  return Object.fromEntries(ALL_PERMISSION_KEYS
    .filter((key) => (draft.values[key] === true) !== (draft.baseline?.[key] === true))
    .map((key) => [key, draft.values[key] === true]));
}

export const permissionChangeCount = (draft) => Object.keys(permissionChanges(draft)).length;

/** Refresh clean users, retaining both the values and original baseline of every dirty draft. */
export function mergePermissionDrafts(previous, users) {
  const next = { ...previous };
  for (const user of users) {
    if (!permissionChangeCount(previous[user.id])) next[user.id] = createPermissionDraft(user.permissions);
  }
  return next;
}

export function changePermissionValues(draft, keys, value) {
  const allowed = new Set(ALL_PERMISSION_KEYS);
  return {
    ...draft,
    values: { ...draft.values, ...Object.fromEntries(keys.filter((key) => allowed.has(key)).map((key) => [key, value === true])) },
  };
}
