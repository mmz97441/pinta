import { useState, useEffect, useCallback } from 'react';
import * as sb from '../lib/supabaseData';

/**
 * Hook pour charger et vérifier les permissions de l'utilisateur connecté.
 * Usage: const { can, perms, loading } = usePermissions(authUserId);
 * can('perm_colis_receptionner') → true/false
 */
export function usePermissions(authId) {
  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authId) { setPerms(null); setLoading(false); return; }

    sb.fetchStaffUsers().then((users) => {
      const me = users.find((u) => u.authId === authId || u.id === authId);
      if (me?.permissions) {
        setPerms(me.permissions);
      } else {
        // Fallback: all permissions (no restrictions)
        setPerms(null);
      }
      setLoading(false);
    }).catch(() => {
      setPerms(null);
      setLoading(false);
    });
  }, [authId]);

  const can = useCallback((permKey) => {
    if (!perms) return true; // No permissions loaded = allow all (backwards compat)
    return perms[permKey] === true;
  }, [perms]);

  return { can, perms, loading, setPerms };
}
