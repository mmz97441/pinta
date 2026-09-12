import { ALL_PERMISSION_KEYS } from '../constants/permissions.js';

/** PostgREST embeds this unique relationship as an object; older fixtures used an array. */
export function normalizeStaffPermissions(value) {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' && !Array.isArray(row) ? { ...row } : null;
}

export function staffPermissionSaveArgs(staffId, changes, expectedPermissions) {
  if (!staffId || !changes || typeof changes !== 'object' || Array.isArray(changes))
    throw new Error('Sélectionnez un utilisateur et des permissions valides.');
  const allowed = new Set(ALL_PERMISSION_KEYS);
  if (Object.entries(changes).some(([key, value]) => !allowed.has(key) || typeof value !== 'boolean'))
    throw new Error('Les permissions doivent être des droits connus, activés ou désactivés.');
  if (expectedPermissions !== null && !normalizeStaffPermissions(expectedPermissions))
    throw new Error('Rechargez les permissions avant de les enregistrer.');
  return {
    p_staff_id: staffId,
    p_permissions: { ...changes },
    p_expected_permissions: normalizeStaffPermissions(expectedPermissions),
  };
}
